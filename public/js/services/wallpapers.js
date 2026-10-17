// Wallpaper library: bundled presets + user images stored as Blobs in IndexedDB (never localStorage).
import { app } from './ctx.js';
import { WALLPAPERS, wallpaperById } from '../data/wallpapers.js';
import { getPrefs, setPrefs } from './prefs.js';
import { uid } from '../core/util.js';

export const MAX_INPUT_BYTES = 25 * 1024 * 1024;   // refuse absurdly large inputs
export const MAX_STORED_BYTES = 12 * 1024 * 1024;  // what we are willing to keep in IndexedDB per image
export const MAX_EDGE = 2560;                      // longest side after downscaling
export const ACCEPT = 'image/png,image/jpeg,image/webp';

const urls = new Map();

/** Identify the real format from the first bytes (file.type and extensions can lie). */
export async function sniffImageType(file) {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const eq = (off, bytes) => bytes.every((b, i) => head[off + i] === b);
  if (eq(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (eq(0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (eq(0, [0x52, 0x49, 0x46, 0x46]) && eq(8, [0x57, 0x45, 0x42, 0x50])) return 'image/webp';
  return null;
}

export class ImageRejected extends Error {}

export async function inspectFile(file) {
  if (!file) throw new ImageRejected('No file selected.');
  if (file.size === 0) throw new ImageRejected('That file is empty.');
  if (file.size > MAX_INPUT_BYTES) throw new ImageRejected(`That file is ${(file.size / 1048576).toFixed(1)} MB. The limit is ${MAX_INPUT_BYTES / 1048576} MB.`);
  const type = await sniffImageType(file);
  if (!type) throw new ImageRejected('Unsupported file. Please choose a PNG, JPEG or WebP image (SVG, GIF and other formats are not supported).');
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new ImageRejected('This image could not be read. It may be corrupted or use an unsupported encoding.'); }
  return { type, bmp };
}

function canvasOf(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
const toBlob = (c, type, q) => new Promise((res) => c.toBlob(res, type, q));

/** Validate + downscale + build thumbnail + measure brightness. Returns the data for an `assets` record. */
export async function processImage(file) {
  const { type, bmp } = await inspectFile(file);
  try {
    const long = Math.max(bmp.width, bmp.height);
    const k = long > MAX_EDGE ? MAX_EDGE / long : 1;
    const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
    let blob = file, outType = type;
    if (k < 1 || file.size > 4 * 1024 * 1024) {
      const c = canvasOf(w, h); c.getContext('2d').drawImage(bmp, 0, 0, w, h);
      const re = await toBlob(c, 'image/webp', 0.86);
      if (re && re.type === 'image/webp' && (k < 1 || re.size < file.size)) { blob = re; outType = 'image/webp'; }
    }
    if (blob.size > MAX_STORED_BYTES) throw new ImageRejected(`Even after optimising, this image is ${(blob.size / 1048576).toFixed(1)} MB (limit ${MAX_STORED_BYTES / 1048576} MB). Try a smaller image.`);
    const tw = 320, th = Math.round(320 * (bmp.height / bmp.width));
    const tc = canvasOf(tw, Math.max(1, th)); tc.getContext('2d').drawImage(bmp, 0, 0, tw, tc.height);
    const thumb = await toBlob(tc, 'image/webp', 0.72);
    const sc = canvasOf(24, 14); const sx = sc.getContext('2d', { willReadFrequently: true }); sx.drawImage(bmp, 0, 0, 24, 14);
    const d = sx.getImageData(0, 0, 24, 14).data; let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    return { name: (file.name || 'Wallpaper').replace(/\.[^.]+$/, '').slice(0, 80), type: outType, size: blob.size, width: w, height: h, blob, thumb, stats: { luminance: +(sum / (d.length / 4)).toFixed(3), originalBytes: file.size } };
  } finally { bmp.close?.(); }
}

/** Save a processed image. Throws a readable error when storage refuses it (never loses it silently). */
export async function saveImage(processed) {
  try {
    const rec = await app.store.put('assets', { id: uid('asset'), ...processed });
    try { await navigator.storage?.persist?.(); } catch { /* best effort */ }
    return rec;
  } catch (e) {
    if (e.code === 'quota') throw new Error('Your browser has no storage space left for this image, so it was NOT saved. Free some disk space or remove old wallpapers, then try again.');
    throw new Error(`The image could not be saved: ${e.message}`);
  }
}

export const listImages = () => [...app.store.all('assets')].sort((a, b) => b.createdAt - a.createdAt);
export const getImage = (id) => app.store.get('assets', id);

export function assetUrl(id, thumb = false) {
  const rec = getImage(id); if (!rec) return null;
  const key = `${id}:${thumb ? 't' : 'f'}`;
  if (!urls.has(key)) urls.set(key, URL.createObjectURL(thumb && rec.thumb ? rec.thumb : rec.blob));
  return urls.get(key);
}
function revoke(id) { for (const k of [`${id}:t`, `${id}:f`]) if (urls.has(k)) { URL.revokeObjectURL(urls.get(k)); urls.delete(k); } }

/** Where is this asset referenced? (current prefs, favourites, saved visual presets) */
export function assetUsage(id) {
  const p = getPrefs(); const out = [];
  if (p.background.kind === 'image' && p.background.assetId === id) out.push('current wallpaper');
  for (const [name, a] of Object.entries(p.areas)) if (a.mode === 'image' && a.assetId === id) out.push(`${name} background`);
  if (p.favourites.includes(`asset:${id}`)) out.push('favourites');
  for (const v of app.store.all('visualPresets')) {
    const c = v.config || {};
    if (c.background?.assetId === id || Object.values(c.areas || {}).some((a) => a?.assetId === id)) out.push(`preset "${v.name}"`);
  }
  return out;
}

export async function deleteImage(id) {
  revoke(id);
  const p = getPrefs();
  const patch = {};
  if (p.background.assetId === id) patch.background = { kind: 'preset', presetId: 'aurora-night', assetId: '' };
  const areas = {}; for (const [n, a] of Object.entries(p.areas)) if (a.assetId === id) areas[n] = { mode: 'inherit', assetId: '' };
  if (Object.keys(areas).length) patch.areas = areas;
  patch.favourites = p.favourites.filter((f) => f !== `asset:${id}`);
  patch.recents = p.recents.filter((f) => f !== `asset:${id}`);
  setPrefs(patch);
  await app.store.remove('assets', id);
}

/* ---------- favourites & recents (ids are 'preset:<id>' or 'asset:<id>') ---------- */
export const wpKey = (kind, id) => `${kind}:${id}`;
export const isFavourite = (key) => getPrefs().favourites.includes(key);
export function toggleFavourite(key) {
  const f = getPrefs().favourites;
  setPrefs({ favourites: f.includes(key) ? f.filter((x) => x !== key) : [...f, key] });
}
export function pushRecent(key) {
  const r = getPrefs().recents.filter((x) => x !== key);
  setPrefs({ recents: [key, ...r].slice(0, 8) }, { silent: true });
}

/** Everything that can be shown in the gallery, as normalised items. */
export function galleryItems() {
  const items = WALLPAPERS.map((w) => ({ key: wpKey('preset', w.id), kind: 'preset', id: w.id, name: w.name, category: w.category, tone: w.tone, animated: !!w.animated, thumb: w.thumb || null, css: w.kind === 'css' }));
  for (const a of listImages()) items.push({ key: wpKey('asset', a.id), kind: 'asset', id: a.id, name: a.name, category: 'mine', tone: a.stats?.luminance > 0.6 ? 'light' : a.stats?.luminance > 0.3 ? 'mid' : 'dark', animated: false, thumb: null, css: false });
  return items;
}

/** Background patch that applies a gallery item. */
export function patchFor(item) {
  return item.kind === 'asset' ? { kind: 'image', assetId: item.id } : { kind: 'preset', presetId: item.id };
}
export function applyItem(item) {
  setPrefs({ background: patchFor(item) });
  pushRecent(item.key);
}
export const randomItem = (rand = Math.random, exclude = null) => {
  const pool = galleryItems().filter((i) => i.key !== exclude);
  return pool[Math.floor(rand() * pool.length)];
};
export { wallpaperById };
