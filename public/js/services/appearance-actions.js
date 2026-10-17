// Higher-level appearance operations: random theme/wallpaper/appearance, custom themes, visual presets.
// Everything that changes the look in bulk is undoable, and none of it touches task/timer/note data.
import { app } from './ctx.js';
import { getPrefs, setPrefs, replacePrefs } from './prefs.js';
import { undo } from './undo.js';
import { currentTheme, resolveMode, customThemes } from './appearance.js';
import * as WP from './wallpapers.js';
import { PRESET_THEMES, makeRandomTheme, newCustomThemeFrom, findTheme } from '../core/theme.js';
import { normalizePrefs, mergeDeep } from '../core/prefs.js';
import { normalizeRecord, sanitizeJson } from '../core/validate.js';
import { visualPresetEntity } from '../core/entities.js';
import { clone, uid } from '../core/util.js';
import { wallpaperById } from '../data/wallpapers.js';

export const PRESET_KEYS = ['mode', 'themeId', 'overrides', 'glass', 'type', 'radius', 'effects', 'density', 'contentWidth', 'background', 'areas', 'focusMode'];
export const RANDOM_THEME_ID = 'theme_random_latest';
const NULLS = { bg: null, bg2: null, glass: null, border: null, primary: null, accent: null };
/** Deep-merge cannot delete keys, so clearing colour overrides must null each one explicitly. */
export const NO_OVERRIDES = () => ({ light: { ...NULLS }, dark: { ...NULLS } });

export function snapshotAppearance(p = getPrefs()) {
  const s = {}; for (const k of PRESET_KEYS) s[k] = clone(p[k]);
  s.sidebar = { collapsed: p.sidebar.collapsed, width: p.sidebar.width };
  return s;
}
export function restoreAppearance(snap) {
  replacePrefs({ ...getPrefs(), ...clone(snap), sidebar: { ...getPrefs().sidebar, ...(snap.sidebar || {}) } });
}
const withUndo = (label, fn) => { const before = snapshotAppearance(); const r = fn(); undo.push(label, async () => restoreAppearance(before)); return r; };

/* ---------- random ---------- */
const pick = (arr, rand) => arr[Math.floor(rand() * arr.length)];
const between = (lo, hi, rand) => Math.round(lo + rand() * (hi - lo));

export async function saveRandomTheme(theme) {
  const rec = { id: RANDOM_THEME_ID, name: 'Random (latest)', light: theme.light, dark: theme.dark, glass: {}, radius: getPrefs().radius };
  return app.store.put('themes', rec);
}

export async function randomizeTheme({ rand = Math.random } = {}) {
  const before = snapshotAppearance();
  const t = makeRandomTheme(rand);
  await saveRandomTheme(t);
  setPrefs({ themeId: RANDOM_THEME_ID, overrides: NO_OVERRIDES() });
  undo.push('random theme', async () => restoreAppearance(before));
  return t;
}

export function compatibleWallpapers(mode) {
  const want = mode === 'light' ? ['light', 'mid'] : ['dark', 'mid'];
  return WP.galleryItems().filter((i) => want.includes(i.tone) || i.kind === 'asset');
}
export function randomizeWallpaper({ rand = Math.random } = {}) {
  const cur = getPrefs().background;
  const curKey = cur.kind === 'image' ? WP.wpKey('asset', cur.assetId) : WP.wpKey('preset', cur.presetId);
  const pool = compatibleWallpapers(resolveMode()).filter((i) => i.key !== curKey);
  if (!pool.length) return null;
  const item = pick(pool, rand);
  return withUndo('random wallpaper', () => { WP.applyItem(item); return item; });
}

export async function randomizeAppearance({ rand = Math.random } = {}) {
  const before = snapshotAppearance();
  const t = makeRandomTheme(rand);
  await saveRandomTheme(t);
  const pool = compatibleWallpapers(resolveMode());
  const item = pick(pool, rand);
  const glass = { opacity: between(48, 74, rand), blur: between(10, 26, rand), border: between(16, 34, rand), glow: between(0, 26, rand), shadow: between(28, 55, rand), highlight: between(18, 40, rand) };
  const bgPatch = { ...WP.patchFor(item), overlayOpacity: between(18, 40, rand), brightness: between(85, 105, rand), blur: 0, vignette: between(8, 30, rand) };
  setPrefs({ themeId: RANDOM_THEME_ID, overrides: NO_OVERRIDES(), glass, background: bgPatch });
  WP.pushRecent(item.key);
  undo.push('randomize appearance', async () => restoreAppearance(before));
  return { theme: t, wallpaper: item };
}

/* ---------- custom themes ---------- */
export async function createThemeFromCurrent(name) {
  const base = currentTheme();
  const p = getPrefs();
  const dark = { ...base.dark, ...Object.fromEntries(Object.entries(p.overrides.dark).filter(([, v]) => v)) };
  const light = { ...base.light, ...Object.fromEntries(Object.entries(p.overrides.light).filter(([, v]) => v)) };
  const rec = await app.store.put('themes', { id: uid('theme'), name, light, dark, glass: { ...p.glass }, radius: p.radius });
  setPrefs({ themeId: rec.id, overrides: NO_OVERRIDES() });
  return rec;
}
export async function renameTheme(id, name) { const t = app.store.get('themes', id); if (!t) throw new Error('Theme not found.'); return app.store.put('themes', { ...t, name }); }
export async function duplicateTheme(id) {
  const t = findTheme(id, customThemes());
  const copy = newCustomThemeFrom(t, `${t.name} copy`.slice(0, 40), uid('theme'));
  return app.store.put('themes', { ...copy, glass: { ...(t.glass || {}) } });
}
export async function deleteTheme(id) {
  const t = app.store.get('themes', id); if (!t) return;
  const wasCurrent = getPrefs().themeId === id;
  await app.store.remove('themes', id);
  if (wasCurrent) setPrefs({ themeId: 'midnight' });
  undo.push(`delete theme "${t.name}"`, async () => { await app.store.put('themes', t, { keepTimestamps: true }); if (wasCurrent) setPrefs({ themeId: id }); });
}

/* ---------- visual presets ---------- */
export function presetConfigFromCurrent() {
  const cfg = snapshotAppearance();
  const t = currentTheme();
  if (!PRESET_THEMES.some((x) => x.id === t.id)) cfg.themeDef = { name: t.name, light: t.light, dark: t.dark, glass: t.glass || {}, radius: t.radius ?? 14 };
  return cfg;
}
export const listPresets = () => [...app.store.all('visualPresets')].sort((a, b) => b.updatedAt - a.updatedAt);

export async function savePreset(name) { return app.store.put('visualPresets', { name, config: presetConfigFromCurrent() }); }
export async function renamePreset(id, name) { const p = app.store.get('visualPresets', id); if (!p) throw new Error('Preset not found.'); return app.store.put('visualPresets', { ...p, name }); }
export async function duplicatePreset(id) { const p = app.store.get('visualPresets', id); if (!p) throw new Error('Preset not found.'); return app.store.put('visualPresets', { name: `${p.name} copy`.slice(0, 60), config: clone(p.config) }); }
/** Deletes only the preset record. Uploaded wallpapers it referenced are never touched. */
export async function deletePreset(id) {
  const p = app.store.get('visualPresets', id); if (!p) return;
  await app.store.remove('visualPresets', id);
  undo.push(`delete preset "${p.name}"`, async () => { await app.store.put('visualPresets', p, { keepTimestamps: true }); });
}
/** Validate an arbitrary (possibly imported) preset config. Returns { ok, config, warnings }. */
export function validatePresetConfig(raw) {
  const warnings = [];
  let clean;
  try { clean = sanitizeJson(raw, { maxDepth: 8 }); } catch (e) { return { ok: false, warnings: [`Preset is not valid data (${e.message}).`] }; }
  if (!clean || typeof clean !== 'object' || Array.isArray(clean)) return { ok: false, warnings: ['Preset must be an object.'] };
  const picked = {};
  for (const k of [...PRESET_KEYS, 'sidebar', 'themeDef']) if (k in clean) picked[k] = clean[k];
  const merged = normalizePrefs(mergeDeep(getPrefs(), { ...picked, themeDef: undefined })).prefs;
  const out = {}; for (const k of PRESET_KEYS) out[k] = merged[k];
  out.sidebar = { collapsed: merged.sidebar.collapsed, width: merged.sidebar.width };
  if (picked.themeDef && typeof picked.themeDef === 'object') out.themeDef = picked.themeDef;
  return { ok: true, config: out, warnings };
}
export async function applyPreset(id) {
  const p = app.store.get('visualPresets', id); if (!p) throw new Error('Preset not found.');
  const v = validatePresetConfig(p.config);
  if (!v.ok) throw new Error(v.warnings.join(' '));
  const cfg = clone(v.config); const notes = [];
  // embedded custom theme: recreate if this device does not have it
  if (cfg.themeId && !PRESET_THEMES.some((t) => t.id === cfg.themeId) && !app.store.has('themes', cfg.themeId)) {
    if (cfg.themeDef) {
      const def = normalizeRecord({ keyPath: 'id', fields: { ...(await import('../core/entities.js')).themeEntity.fields } }, { id: cfg.themeId, ...cfg.themeDef }, { repair: true });
      if (def.ok) await app.store.put('themes', def.value); else { cfg.themeId = 'midnight'; notes.push('The preset\'s custom theme was invalid; Midnight is used instead.'); }
    } else { cfg.themeId = 'midnight'; notes.push('The preset\'s custom theme is not on this device; Midnight is used instead.'); }
  }
  delete cfg.themeDef;
  // missing uploaded images fall back to a bundled wallpaper instead of a blank background
  if (cfg.background.kind === 'image' && !WP.getImage(cfg.background.assetId)) { cfg.background = { ...cfg.background, kind: 'preset', presetId: wallpaperById('aurora-night') ? 'aurora-night' : cfg.background.presetId, assetId: '' }; notes.push('The preset used an uploaded image that is not on this device; a bundled wallpaper is shown instead.'); }
  for (const [name, a] of Object.entries(cfg.areas)) if (a.mode === 'image' && !WP.getImage(a.assetId)) { cfg.areas[name] = { ...a, mode: 'inherit', assetId: '' }; notes.push(`The ${name} image is missing, so that area inherits the main background.`); }
  const before = snapshotAppearance();
  restoreAppearance(cfg);
  undo.push(`apply preset "${p.name}"`, async () => restoreAppearance(before));
  return { preset: p, notes };
}
