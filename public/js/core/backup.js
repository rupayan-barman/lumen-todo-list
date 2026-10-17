// Backup file format, parsing, validation and import planning. Pure (no DOM / IndexedDB), so it is unit-tested in Node.
// A backup is plain JSON. It is NOT encrypted: anyone with the file can read it.
import { ENTITIES } from './entities.js';
import { DB_VERSION, BACKUP_FORMAT_VERSION, APP_VERSION, keyPathOf, migrateRecord } from './schema.js';
import { normalizeRecord, sanitizeJson } from './validate.js';

export const FORMAT = 'lumen-backup';
export const BACKUP_STORES = ['tasks', 'taskHistory', 'categories', 'tags', 'sessions', 'notes', 'habits', 'habitLogs', 'projects', 'subjects', 'themes', 'visualPresets', 'assets', 'kv'];
export const MAX_IMPORT_BYTES = 120 * 1024 * 1024;
export const MAX_EMBED_BYTES = 40 * 1024 * 1024; // total image payload embedded in one export
const EXCLUDED_KV = /^(lock:|notified)/;           // transient keys never belong in a backup

export const isExportableKv = (key) => !EXCLUDED_KV.test(key);

export function buildBackup({ stores, prefs, now, appVersion = APP_VERSION, notes = [] }) {
  const out = {};
  for (const s of BACKUP_STORES) {
    let rows = stores[s] || [];
    if (s === 'kv') rows = rows.filter((r) => isExportableKv(r.key));
    out[s] = rows;
  }
  return { format: FORMAT, formatVersion: BACKUP_FORMAT_VERSION, appVersion, dbVersion: DB_VERSION, exportedAt: now, encrypted: false, notes, counts: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])), prefs: prefs || null, stores: out };
}

/** Parse + structurally validate. Never throws; returns {ok, data?, error?, warnings}. */
export function parseBackup(text) {
  const warnings = [];
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'The file is empty.', warnings };
  if (text.length > MAX_IMPORT_BYTES) return { ok: false, error: `The file is larger than ${Math.round(MAX_IMPORT_BYTES / 1048576)} MB, which Lumen will not import.`, warnings };
  let raw;
  try { raw = JSON.parse(text); } catch { return { ok: false, error: 'This is not a valid JSON file. Nothing was changed.', warnings }; }
  let data;
  try { data = sanitizeJson(raw, { maxDepth: 14, maxNodes: 3_000_000 }); } catch (e) { return { ok: false, error: `The file structure is unsafe or too large (${e.message}).`, warnings }; }
  if (!data || typeof data !== 'object' || data.format !== FORMAT) return { ok: false, error: 'This is not a Lumen backup (missing format marker).', warnings };
  if (!Number.isInteger(data.formatVersion) || data.formatVersion < 1) return { ok: false, error: 'The backup has no valid format version.', warnings };
  if (data.formatVersion > BACKUP_FORMAT_VERSION) return { ok: false, error: `This backup was made by a newer version of Lumen (format ${data.formatVersion}). Update Lumen first; nothing was changed.`, warnings };
  if (!data.stores || typeof data.stores !== 'object' || Array.isArray(data.stores)) return { ok: false, error: 'The backup contains no data section.', warnings };
  const dbv = Number.isInteger(data.dbVersion) && data.dbVersion >= 1 ? data.dbVersion : 1;
  if (dbv > DB_VERSION) return { ok: false, error: 'The backup uses a newer database layout than this app understands.', warnings };
  for (const s of Object.keys(data.stores)) if (!BACKUP_STORES.includes(s)) warnings.push(`Ignored unknown section “${s}”.`);
  for (const s of BACKUP_STORES) if (data.stores[s] !== undefined && !Array.isArray(data.stores[s])) return { ok: false, error: `Section “${s}” is malformed.`, warnings };
  return { ok: true, data: { ...data, dbVersion: dbv }, warnings };
}

const contentKey = {
  tasks: (r) => `${r.title}|${r.deadline || ''}|${r.scheduledDate || ''}|${r.createdAt}`,
  notes: (r) => `${r.title}|${r.createdAt}`,
  habits: (r) => `${r.name}|${r.startDate}`,
  habitLogs: (r) => `${r.habitId}|${r.date}`,
  categories: (r) => r.name.toLowerCase(),
  tags: (r) => r.name.toLowerCase(),
  projects: (r) => `${r.name}|${r.createdAt}`,
  subjects: (r) => `${r.name}|${r.createdAt}`,
};
const strip = (r) => { const { updatedAt, ...rest } = r; return JSON.stringify(rest, (k, v) => (typeof Blob !== 'undefined' && v instanceof Blob ? `blob:${v.size}` : v)); };

/**
 * Decide what an import would do. `existing` = { store: Map(key -> record) }.
 * mode: 'merge-keep' (existing wins on id conflict) | 'merge-overwrite' (backup wins) | 'replace' (wipe then restore).
 * Returns { writes:[{store,record}], clears:[store], report }.
 */
export function planImport(data, existing, mode = 'merge-keep') {
  const report = { total: 0, add: 0, same: 0, conflict: 0, overwrite: 0, invalid: 0, repaired: 0, duplicates: 0, perStore: {}, problems: [], dupNotes: [] };
  const writes = []; const clears = mode === 'replace' ? BACKUP_STORES.filter((s) => data.stores[s] !== undefined || s !== 'kv') : [];
  for (const store of BACKUP_STORES) {
    const rows = data.stores[store]; if (!rows) continue;
    const entity = ENTITIES[store]; const kp = keyPathOf(store);
    const per = report.perStore[store] = { total: rows.length, add: 0, same: 0, conflict: 0, invalid: 0 };
    const have = mode === 'replace' ? new Map() : (existing[store] || new Map());
    const seenIds = new Set(); const haveContent = new Map();
    if (contentKey[store]) for (const r of have.values()) haveContent.set(contentKey[store](r), r[kp]);
    for (const raw of rows) {
      report.total++;
      let rec;
      try { rec = migrateRecord(store, raw, data.dbVersion, DB_VERSION); } catch { rec = null; }
      if (store === 'kv' && rec && typeof rec.key === 'string' && !isExportableKv(rec.key)) { continue; }
      const r = rec ? normalizeRecord(entity, rec, { repair: true }) : { ok: false, errors: [{ path: '', message: 'migration failed' }], warnings: [] };
      if (!r.ok) { per.invalid++; report.invalid++; if (report.problems.length < 20) report.problems.push(`${store}: ${r.errors.map((e) => `${e.path || 'record'}: ${e.message}`).join('; ')}`); continue; }
      if (r.warnings.length) report.repaired++;
      const v = r.value; const key = v[kp];
      if (seenIds.has(key)) { per.invalid++; report.invalid++; report.problems.push(`${store}: duplicate id “${key}” inside the backup (kept the first).`); continue; }
      seenIds.add(key);
      const cur = have.get(key);
      if (cur) {
        if (strip(cur) === strip(v)) { per.same++; report.same++; continue; }
        per.conflict++; report.conflict++;
        if (mode === 'merge-overwrite') { writes.push({ store, record: v, keepTimestamps: true }); report.overwrite++; }
        continue;
      }
      const ck = contentKey[store]?.(v);
      if (ck && haveContent.has(ck)) {
        report.duplicates++; if (report.dupNotes.length < 10) report.dupNotes.push(`${store}: “${v.title || v.name || v.date || key}” looks like an existing item with a different id.`);
        if (store === 'habitLogs') { per.same++; report.same++; continue; } // (habit, date) must be unique
      }
      if (ck) haveContent.set(ck, key);
      writes.push({ store, record: v, keepTimestamps: true }); per.add++; report.add++;
    }
  }
  return { writes, clears, report };
}

export const describeReport = (rep) => {
  const parts = [`${rep.add} new`, `${rep.same} already present`];
  if (rep.conflict) parts.push(`${rep.conflict} differ from what you have`);
  if (rep.invalid) parts.push(`${rep.invalid} unreadable (skipped)`);
  return parts.join(' · ');
};
