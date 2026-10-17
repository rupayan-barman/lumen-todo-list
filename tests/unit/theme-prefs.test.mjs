import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESET_THEMES, computeTokens, guardedAlpha, behindRange, makeRandomTheme } from '../../public/js/core/theme.js';
import { normalizePrefs, defaultPrefs, normalizeLayout, WIDGETS, mergeDeep } from '../../public/js/core/prefs.js';
import { contrast, mix, rng, hexToRgb } from '../../public/js/core/color.js';

const prefs = defaultPrefs();
const tok = (theme, mode, extra = {}) => computeTokens({ mode, theme, overrides: prefs.overrides, glass: prefs.glass, radius: 14, type: prefs.type, bg: prefs.background, ...extra });

test('there are exactly the 8 requested presets, each with light and dark palettes', () => {
  assert.deepEqual(PRESET_THEMES.map((t) => t.id), ['midnight', 'cyberpunk', 'emerald', 'ocean', 'lavender', 'rose', 'arctic', 'minimal']);
  for (const t of PRESET_THEMES) for (const m of ['light', 'dark']) for (const k of ['bg', 'bg2', 'glass', 'border', 'primary', 'accent']) assert.match(t[m][k], /^#[0-9a-f]{6}$/, `${t.id}.${m}.${k}`);
});

test('all presets: body, muted and faint text meet 4.5:1 on the worst-case glass surface, both modes', () => {
  for (const t of PRESET_THEMES) for (const m of ['light', 'dark']) {
    const { vars, meta } = tok(t, m);
    for (const w of meta.worst) for (const k of ['--text', '--text-muted', '--text-faint', '--primary', '--accent']) {
      assert.ok(contrast(vars[k], w) >= 4.5 - 0.01, `${t.id}/${m} ${k} ${contrast(vars[k], w).toFixed(2)}`);
    }
    assert.ok(contrast(vars['--on-primary'], vars['--primary-raw']) >= 4.5, `${t.id}/${m} button text`);
  }
});

test('status colours are readable on glass in both modes', () => {
  for (const t of PRESET_THEMES) for (const m of ['light', 'dark']) {
    const { vars, meta } = tok(t, m);
    for (const k of ['--danger', '--warning', '--success', '--info']) for (const w of meta.worst) assert.ok(contrast(vars[k], w) >= 4.5, `${t.id}/${m} ${k} ${contrast(vars[k], w).toFixed(2)}`);
  }
});

test('auto-contrast raises glass opacity when a bright wallpaper would hurt readability', () => {
  const t = PRESET_THEMES[0];
  const bright = { ...prefs.background, overlayOpacity: 0, brightness: 140 };
  const low = { ...prefs.glass, opacity: 20 };
  const guarded = computeTokens({ mode: 'dark', theme: t, overrides: prefs.overrides, glass: low, bg: bright });
  assert.ok(guarded.meta.guarded && guarded.meta.alpha > 0.2);
  const off = computeTokens({ mode: 'dark', theme: t, overrides: prefs.overrides, glass: { ...low, autoContrast: false }, bg: bright });
  assert.equal(off.meta.alpha, 0.2);
});

test('lite effects zero the blur and glow', () => {
  const { vars } = tok(PRESET_THEMES[1], 'dark', { effects: 'lite' });
  assert.equal(vars['--blur'], '0px');
  assert.equal(vars['--glow-alpha'], '0.000');
});

test('user colour overrides apply per mode only', () => {
  const o = { light: {}, dark: { primary: '#ff0000' } };
  assert.equal(computeTokens({ mode: 'dark', theme: PRESET_THEMES[0], overrides: o, bg: prefs.background }).vars['--primary-raw'], '#ff0000');
  assert.equal(computeTokens({ mode: 'light', theme: PRESET_THEMES[0], overrides: o, bg: prefs.background }).vars['--primary-raw'], PRESET_THEMES[0].light.primary);
});

test('random themes: 300 seeds, all readable in both modes under the contrast guard', () => {
  const r = rng(99);
  for (let i = 0; i < 300; i++) {
    const t = makeRandomTheme(r);
    for (const m of ['light', 'dark']) {
      const { vars, meta } = tok(t, m);
      for (const w of meta.worst) for (const k of ['--text', '--text-muted', '--primary', '--accent']) assert.ok(contrast(vars[k], w) >= 4.49, `${i}/${m}/${k}`);
    }
  }
});

test('prefs normalisation repairs garbage and never throws', () => {
  const { prefs: p, warnings } = normalizePrefs({ mode: 'purple', radius: 999, glass: { blur: -5, opacity: 'x' }, background: { kind: 'video', overlayColor: 'nope' }, sidebar: { hidden: ['settings', 'tasks', 'bogus'], order: ['tasks'] }, evil: { __proto__: { x: 1 } } });
  assert.equal(p.mode, 'system');
  assert.equal(p.radius, 28);
  assert.equal(p.glass.blur, 0);
  assert.equal(p.background.kind, 'preset');
  assert.equal(p.background.overlayColor, null); // null = automatic (white in light mode, black in dark)
  assert.deepEqual(p.sidebar.hidden, ['tasks']); // settings can never be hidden; bogus dropped
  assert.equal(p.sidebar.order.length, 10);
  assert.ok(warnings.length > 0);
  assert.equal(Object.hasOwn(p, 'evil'), false);
  assert.doesNotThrow(() => normalizePrefs(null));
  assert.doesNotThrow(() => normalizePrefs('x'));
});

test('dashboard layouts always contain every widget exactly once', () => {
  const l = normalizeLayout([{ id: 'notes', size: 'lg', visible: true }, { id: 'notes', size: 'sm' }, { id: 'ghost' }]);
  assert.equal(l.length, WIDGETS.length);
  assert.equal(l[0].id, 'notes'); assert.equal(l[0].size, 'lg');
  assert.equal(new Set(l.map((w) => w.id)).size, WIDGETS.length);
  const d = defaultPrefs();
  for (const n of ['general', 'study', 'coding']) assert.equal(d.dashboard.layouts[n].length, WIDGETS.length);
  assert.notDeepEqual(d.dashboard.layouts.study.map((w) => w.id), d.dashboard.layouts.general.map((w) => w.id));
});

test('mergeDeep merges nested objects and replaces arrays', () => {
  const r = mergeDeep({ a: { b: 1, c: 2 }, l: [1, 2] }, { a: { b: 9 }, l: [3] });
  assert.deepEqual(r, { a: { b: 9, c: 2 }, l: [3] });
});
