// Preferences service: synchronous reads, validated writes, localStorage persistence.
import { app } from './ctx.js';
import { PREFS_KEY, normalizePrefs, defaultPrefs, mergeDeep } from '../core/prefs.js';

let prefs = load();
let warned = false;

function load() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return normalizePrefs(raw ? JSON.parse(raw) : {}).prefs;
  } catch (e) {
    console.warn('[prefs] could not read stored preferences, using defaults', e);
    return defaultPrefs();
  }
}

function save() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); warned = false; return true; }
  catch (e) {
    if (!warned) { warned = true; app.bus.emit('toast', { kind: 'error', message: 'Could not save preferences (browser storage is blocked or full). Changes apply until you close the tab.' }); }
    return false;
  }
}

export const getPrefs = () => prefs;

/** Merge a patch (object or fn(prefs)->patch), validate, persist and notify. */
export function setPrefs(patch, { persist = true, silent = false } = {}) {
  const p = typeof patch === 'function' ? patch(prefs) : patch;
  prefs = normalizePrefs(mergeDeep(prefs, p)).prefs;
  if (persist) save();
  if (!silent) app.bus.emit('prefs:change', prefs);
  return prefs;
}

/** Replace everything (restore / reset / preset apply). */
export function replacePrefs(full, { persist = true } = {}) {
  prefs = normalizePrefs(full).prefs;
  if (persist) save();
  app.bus.emit('prefs:change', prefs);
  return prefs;
}

export function resetPrefs() { return replacePrefs({}); }

/** Pure helper for previews: what would prefs look like with this patch? Never persisted. */
export const previewOf = (patch) => normalizePrefs(mergeDeep(prefs, patch)).prefs;

// other tab changed preferences
window.addEventListener('storage', (e) => {
  if (e.key !== PREFS_KEY) return;
  prefs = load();
  app.bus.emit('prefs:change', prefs);
});
