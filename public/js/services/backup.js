// Backup / restore / local-data deletion. IO layer around core/backup.js.
import { app } from './ctx.js';
import { getPrefs, replacePrefs } from './prefs.js';
import { clock } from '../core/clock.js';
import { uid } from '../core/util.js';
import { STORE_NAMES } from '../core/schema.js';
import { BACKUP_STORES, MAX_EMBED_BYTES, buildBackup, parseBackup, planImport } from '../core/backup.js';
import { sniffImageType, MAX_STORED_BYTES } from './wallpapers.js';
import * as Focus from './focus.js';

const st = () => app.store;

const blobToDataUrl = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
function dataUrlToBlob(url, expectType) {
  const m = /^data:([a-z/+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(url || '');
  if (!m || m[1] !== expectType) throw new Error('bad image data');
  const bin = atob(m[2].replace(/\s/g, '')); const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: m[1] });
}

export const storeCounts = () => Object.fromEntries(BACKUP_STORES.map((s) => [s, st().count(s)]));

/** Build the backup object. Images are embedded (base64) while the total stays under the limit. */
export async function createBackupObject({ includeImages = true } = {}) {
  const stores = Object.fromEntries(BACKUP_STORES.map((s) => [s, st().all(s)]));
  const notes = []; let embedded = 0;
  const assets = [];
  for (const a of stores.assets) {
    const { blob, thumb, ...meta } = a;
    if (includeImages && blob && embedded + blob.size <= MAX_EMBED_BYTES) {
      embedded += blob.size;
      assets.push({ ...meta, blobData: await blobToDataUrl(blob), thumbData: thumb ? await blobToDataUrl(thumb) : null });
    } else { assets.push({ ...meta, blobData: null, thumbData: null, omitted: true }); notes.push(`Image “${a.name}” was not embedded${includeImages ? ' (size limit)' : ''}.`); }
  }
  stores.assets = assets;
  return { obj: buildBackup({ stores, prefs: getPrefs(), now: clock.now(), notes }), omitted: notes.length, embeddedBytes: embedded };
}

export async function downloadBackup(opts) {
  const { obj, omitted } = await createBackupObject(opts);
  const text = JSON.stringify(obj);
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a'); const url = URL.createObjectURL(blob);
  const d = new Date(clock.now()); const p = (n) => String(n).padStart(2, '0');
  a.href = url; a.download = `lumen-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10_000);
  await st().kvSet('lastBackupAt', clock.now(), { quiet: true });
  return { bytes: text.length, omitted, counts: obj.counts };
}

/** Parse a user-chosen file and prepare (but do not apply) an import. */
export async function prepareImport(file, mode = 'merge-keep') {
  const text = await file.text();
  const parsed = parseBackup(text);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const data = parsed.data; const warnings = [...parsed.warnings]; const assetProblems = [];
  // decode embedded images
  if (Array.isArray(data.stores.assets)) {
    const good = [];
    for (const row of data.stores.assets) {
      try {
        if (!row.blobData) { assetProblems.push(`“${row.name || 'image'}” had no image data in the backup.`); continue; }
        const type = row.type; const blob = dataUrlToBlob(row.blobData, type);
        if (blob.size > MAX_STORED_BYTES) throw new Error('too large');
        if ((await sniffImageType(blob)) !== type) throw new Error('content does not match its type');
        const thumb = row.thumbData ? dataUrlToBlob(row.thumbData, 'image/webp') : null;
        const { blobData, thumbData, omitted, ...rest } = row;
        good.push({ ...rest, size: blob.size, blob, thumb });
      } catch (e) { assetProblems.push(`Image “${row.name || row.id}” was rejected (${e.message}).`); }
    }
    data.stores.assets = good;
  }
  const existing = Object.fromEntries(BACKUP_STORES.map((s) => [s, new Map(st().all(s).map((r) => [r[s === 'kv' ? 'key' : 'id'], r]))]));
  const plan = planImport(data, existing, mode);
  plan.report.problems.push(...assetProblems);
  return { ok: true, data, plan, warnings, meta: { exportedAt: data.exportedAt, appVersion: data.appVersion, counts: data.counts } };
}

export const replan = (prep, mode) => {
  const existing = Object.fromEntries(BACKUP_STORES.map((s) => [s, new Map(st().all(s).map((r) => [r[s === 'kv' ? 'key' : 'id'], r]))]));
  const plan = planImport(prep.data, existing, mode); plan.report.problems.push(...prep.plan.report.problems.filter((p) => /^Image/.test(p)));
  return plan;
};

/** Safety copy stored inside the app itself (no images) before any restore or deletion. */
export async function snapshotBeforeChange(label) {
  const { obj } = await createBackupObject({ includeImages: false });
  const data = JSON.stringify(obj);
  await st().put('backups', { id: uid('bak'), at: clock.now(), label, size: data.length, data });
  const all = [...st().all('backups')].sort((a, b) => b.at - a.at);
  for (const old of all.slice(3)) await st().remove('backups', old.id);
}
export const listSnapshots = () => [...st().all('backups')].sort((a, b) => b.at - a.at);
export const snapshotAsFile = (id) => { const s = st().get('backups', id); return s ? new File([s.data], 'snapshot.json', { type: 'application/json' }) : null; };

export async function applyImport(plan, { mode, importPrefs = false, data }) {
  if (Focus.active() && mode === 'replace') throw new Error('A timer is running. Stop or interrupt it before replacing your data.');
  await snapshotBeforeChange(`Automatic copy before import (${new Date(clock.now()).toLocaleString()})`);
  const ops = [];
  for (const s of plan.clears) if (s !== 'kv') ops.push({ type: 'clear', store: s });
  for (const w of plan.writes) ops.push({ type: 'put', store: w.store, record: w.record, keepTimestamps: true });
  // one atomic transaction: either everything is applied or nothing is
  if (ops.length) await st().commit(ops);
  if (importPrefs && data?.prefs) replacePrefs(data.prefs);
  app.bus.emit('data:restored', {});
  return plan.report;
}

/** Delete everything this app stored on this device. Caller must have confirmed. */
export async function deleteAllLocalData({ includeSnapshots = true } = {}) {
  Focus.stopAll();
  const ops = STORE_NAMES.filter((s) => includeSnapshots || s !== 'backups').map((s) => ({ type: 'clear', store: s }));
  await st().commit(ops);
  try { for (const k of Object.keys(localStorage)) if (k.startsWith('lumen')) localStorage.removeItem(k); } catch { /* storage blocked */ }
  try { sessionStorage.clear(); } catch { /* ignore */ }
  try { if ('caches' in window) for (const k of await caches.keys()) if (k.startsWith('lumen-')) await caches.delete(k); } catch { /* ignore */ }
}
export async function deleteSection(kind) {
  const map = { history: ['sessions', 'taskHistory'], notifications: ['notifications'], quarantine: ['quarantine'], snapshots: ['backups'], images: ['assets'] };
  const stores = map[kind]; if (!stores) throw new Error('Unknown section');
  if (kind === 'history' && Focus.active()) throw new Error('Stop the running timer first.');
  await st().commit(stores.map((s) => ({ type: 'clear', store: s })));
}
