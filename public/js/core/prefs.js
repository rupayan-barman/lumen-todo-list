// Preferences: schema, defaults and normalisation. Stored as small JSON in localStorage
// (fast, available before the database opens, so the correct theme paints on first frame).
// Large things (uploaded wallpapers, custom themes, visual presets) live in IndexedDB.
import { S, norm } from './validate.js';

export const PREFS_KEY = 'lumen.prefs.v1';
export const PREFS_VERSION = 1;

export const WIDGETS = ['today', 'progress', 'deadlines', 'focus', 'calendar', 'habits', 'notes', 'projects', 'summary'];
export const NAV = ['dashboard', 'tasks', 'timer', 'calendar', 'notes', 'habits', 'projects', 'study', 'analytics', 'settings'];
export const WIDGET_SIZES = ['sm', 'md', 'lg', 'full'];
export const AREAS = ['sidebar', 'taskCards', 'focus', 'calendar', 'notes', 'projects'];
export const FONTS = ['system', 'humanist', 'serif', 'mono', 'rounded'];

const widgetRef = S.obj({ id: S.enum(WIDGETS), visible: S.bool(true), size: S.enum(WIDGET_SIZES, 'md') });
const nullHex = () => S.hex('#000000', { nullable: true });
const palOverride = () => S.obj({ bg: nullHex(), bg2: nullHex(), glass: nullHex(), border: nullHex(), primary: nullHex(), accent: nullHex() });
const area = () => S.obj({
  mode: S.enum(['inherit', 'preset', 'image', 'solid', 'gradient'], 'inherit'),
  presetId: S.str({ max: 60, def: '' }), assetId: S.str({ max: 120, def: '' }),
  color: S.hex('#101426'), from: S.hex('#101426'), to: S.hex('#2a1f4d'), angle: S.num({ min: 0, max: 360, int: true, def: 160 }),
  dim: S.num({ min: 0, max: 90, int: true, def: 0 }),
});

export const prefsSpec = S.obj({
  v: S.num({ int: true, def: PREFS_VERSION }),
  mode: S.enum(['system', 'light', 'dark'], 'system'),
  themeId: S.str({ max: 80, def: 'midnight' }),
  overrides: S.obj({ light: palOverride(), dark: palOverride() }),
  glass: S.obj({
    opacity: S.num({ min: 20, max: 98, int: true, def: 58 }),
    blur: S.num({ min: 0, max: 40, int: true, def: 18 }),
    border: S.num({ min: 0, max: 100, int: true, def: 22 }),
    shadow: S.num({ min: 0, max: 100, int: true, def: 40 }),
    highlight: S.num({ min: 0, max: 100, int: true, def: 30 }),
    glow: S.num({ min: 0, max: 100, int: true, def: 10 }),
    autoContrast: S.bool(true),
  }),
  type: S.obj({ font: S.enum(FONTS, 'system'), scale: S.num({ min: 85, max: 130, int: true, def: 100 }) }),
  radius: S.num({ min: 0, max: 28, int: true, def: 14 }),
  motion: S.enum(['system', 'full', 'reduced'], 'system'),
  effects: S.enum(['full', 'lite'], 'full'),
  density: S.enum(['comfortable', 'compact'], 'comfortable'),
  contentWidth: S.enum(['wide', 'full', 'narrow'], 'wide'),
  sidebar: S.obj({
    collapsed: S.bool(false), width: S.num({ min: 200, max: 360, int: true, def: 248 }),
    hidden: S.arr(S.enum(NAV), { max: 12, unique: true }), order: S.arr(S.enum(NAV), { max: 12, unique: true }),
  }),
  background: S.obj({
    kind: S.enum(['preset', 'solid', 'gradient', 'image', 'none'], 'preset'),
    presetId: S.str({ max: 60, def: 'aurora-night' }), assetId: S.str({ max: 120, def: '' }),
    solid: S.hex('#0b1020'), from: S.hex('#0b1020'), to: S.hex('#2a1f4d'), angle: S.num({ min: 0, max: 360, int: true, def: 160 }),
    fit: S.enum(['cover', 'contain', 'fill'], 'cover'),
    scale: S.num({ min: 100, max: 300, int: true, def: 100 }),
    posX: S.num({ min: 0, max: 100, int: true, def: 50 }), posY: S.num({ min: 0, max: 100, int: true, def: 50 }),
    brightness: S.num({ min: 30, max: 140, int: true, def: 100 }),
    blur: S.num({ min: 0, max: 30, int: true, def: 0 }),
    opacity: S.num({ min: 10, max: 100, int: true, def: 100 }),
    overlayColor: S.hex('#000000', { nullable: true }), overlayOpacity: S.num({ min: 0, max: 90, int: true, def: 25 }),
    gradientIntensity: S.num({ min: 0, max: 100, int: true, def: 60 }),
    vignette: S.num({ min: 0, max: 100, int: true, def: 20 }),
    rgbGlow: S.num({ min: 0, max: 100, int: true, def: 0 }),
    animated: S.bool(false), animSpeed: S.num({ min: 1, max: 10, int: true, def: 4 }),
  }),
  areas: S.obj(Object.fromEntries(AREAS.map((a) => [a, area()]))),
  focusMode: S.obj({ useAppearance: S.bool(true), calm: S.bool(true) }),
  dashboard: S.obj({
    preset: S.enum(['general', 'study', 'coding', 'custom'], 'general'),
    layouts: S.obj({
      general: S.arr(widgetRef, { max: 20 }), study: S.arr(widgetRef, { max: 20 }),
      coding: S.arr(widgetRef, { max: 20 }), custom: S.arr(widgetRef, { max: 20 }),
    }),
  }),
  sound: S.obj({ enabled: S.bool(true), volume: S.num({ min: 0, max: 100, int: true, def: 60 }), kind: S.enum(['chime', 'bell', 'beep', 'soft'], 'chime') }),
  notify: S.obj({
    enabled: S.bool(false), deadlines: S.bool(true), leadMin: S.num({ min: 5, max: 10080, int: true, def: 60 }),
    focus: S.bool(true), habits: S.bool(true), scheduled: S.bool(true), asked: S.bool(false),
  }),
  timer: S.obj({
    workMin: S.num({ min: 1, max: 600, int: true, def: 25 }), shortMin: S.num({ min: 1, max: 120, int: true, def: 5 }),
    longMin: S.num({ min: 1, max: 240, int: true, def: 15 }), longEvery: S.num({ min: 2, max: 12, int: true, def: 4 }),
    autoNext: S.bool(true),
  }),
  general: S.obj({ weekStart: S.enum([1, 0], 1), hour12: S.enum(['auto', '12', '24'], 'auto'), onboarded: S.bool(false) }),
  favourites: S.arr(S.str({ max: 120 }), { max: 100, unique: true }),
  recents: S.arr(S.str({ max: 120 }), { max: 8, unique: true }),
  taskView: S.obj({ sort: S.enum(['manual', 'deadline', 'priority', 'created', 'title', 'scheduled'], 'manual'), dir: S.enum(['asc', 'desc'], 'asc'), group: S.enum(['none', 'category', 'priority', 'due'], 'none') }),
});

const DEFAULT_WIDGETS = {
  general: [['today', 'lg'], ['progress', 'md'], ['deadlines', 'md'], ['focus', 'md'], ['habits', 'md'], ['calendar', 'md'], ['projects', 'md'], ['notes', 'md'], ['summary', 'md']],
  study: [['focus', 'lg'], ['today', 'md'], ['deadlines', 'md'], ['progress', 'md'], ['habits', 'md'], ['notes', 'md'], ['calendar', 'md'], ['summary', 'md'], ['projects', 'sm']],
  coding: [['projects', 'lg'], ['today', 'md'], ['focus', 'md'], ['deadlines', 'md'], ['notes', 'md'], ['progress', 'md'], ['summary', 'md'], ['calendar', 'sm'], ['habits', 'sm']],
};
const hiddenIn = { study: ['projects'], coding: ['habits', 'calendar'] };

export function defaultLayout(name) {
  const base = DEFAULT_WIDGETS[name] || DEFAULT_WIDGETS.general;
  return base.map(([id, size]) => ({ id, size, visible: !(hiddenIn[name] || []).includes(id) }));
}

/** Make a layout complete and unique: every known widget exactly once, in the stored order. */
export function normalizeLayout(list, fallbackName = 'general') {
  const seen = new Set();
  const out = [];
  for (const w of list || []) if (WIDGETS.includes(w.id) && !seen.has(w.id)) { seen.add(w.id); out.push({ id: w.id, size: w.size, visible: w.visible !== false }); }
  if (out.length === 0) return defaultLayout(fallbackName);
  for (const id of WIDGETS) if (!seen.has(id)) out.push({ id, size: 'md', visible: false });
  return out;
}

export function normalizePrefs(raw) {
  const ctx = { errors: [], warnings: [], repair: true };
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const p = norm(prefsSpec, src, '', ctx);
  for (const name of ['general', 'study', 'coding', 'custom']) p.dashboard.layouts[name] = normalizeLayout(p.dashboard.layouts[name], name);
  const order = [...p.sidebar.order.filter((x) => NAV.includes(x))];
  for (const n of NAV) if (!order.includes(n)) order.push(n);
  p.sidebar.order = order;
  p.sidebar.hidden = p.sidebar.hidden.filter((n) => n !== 'settings' && n !== 'dashboard'); // these two can never be hidden
  p.general.weekStart = Number(p.general.weekStart) === 0 ? 0 : 1;
  p.v = PREFS_VERSION;
  return { prefs: p, warnings: ctx.warnings };
}

export const defaultPrefs = () => normalizePrefs({}).prefs;

export function mergeDeep(target, patch) {
  const out = Array.isArray(target) ? [...target] : { ...target };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target && typeof target[k] === 'object' && !Array.isArray(target[k])) out[k] = mergeDeep(target[k], v);
    else out[k] = v;
  }
  return out;
}
