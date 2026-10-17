// Visual presets + random appearance against the real service layer (in-memory DB, stubbed browser globals).
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.window = { addEventListener() {}, matchMedia: () => ({ matches: true, addEventListener() {} }) };
globalThis.document = { documentElement: { style: { setProperty() {}, removeProperty() {} }, dataset: {} }, getElementById: () => null, querySelector: () => null, addEventListener() {} };
globalThis.matchMedia = globalThis.window.matchMedia;
Object.defineProperty(globalThis, 'navigator', { value: { storage: {} }, configurable: true });

const { app } = await import('../../public/js/services/ctx.js');
const { createStore } = await import('../../public/js/core/store.js');
const { createMemoryAdapter } = await import('../../public/js/core/db.js');
const { getPrefs, setPrefs, resetPrefs } = await import('../../public/js/services/prefs.js');
const A = await import('../../public/js/services/appearance-actions.js');
const { undo } = await import('../../public/js/services/undo.js');
const { rng } = await import('../../public/js/core/color.js');

async function fresh() { app.db = createMemoryAdapter(); app.store = createStore({ db: app.db, bus: app.bus }); await app.store.init(); resetPrefs(); undo.clear(); }

test('random theme changes the theme, is readable, and undo restores the previous look', async () => {
  await fresh();
  setPrefs({ themeId: 'ocean', overrides: { dark: { primary: '#ff0000' } } });
  await A.randomizeTheme({ rand: rng(5) });
  assert.equal(getPrefs().themeId, A.RANDOM_THEME_ID);
  assert.equal(getPrefs().overrides.dark.primary, null);
  assert.ok(app.store.get('themes', A.RANDOM_THEME_ID));
  await undo.run();
  assert.equal(getPrefs().themeId, 'ocean');
  assert.equal(getPrefs().overrides.dark.primary, '#ff0000');
});

test('random wallpaper picks a different compatible one and is undoable', async () => {
  await fresh();
  const before = getPrefs().background.presetId;
  const item = A.randomizeWallpaper({ rand: rng(3) });
  assert.ok(item); assert.notEqual(getPrefs().background.presetId, before);
  await undo.run();
  assert.equal(getPrefs().background.presetId, before);
});

test('randomize appearance changes theme + wallpaper + glass together, then undo restores all', async () => {
  await fresh();
  const snap = JSON.stringify(A.snapshotAppearance());
  await A.randomizeAppearance({ rand: rng(11) });
  assert.notEqual(JSON.stringify(A.snapshotAppearance()), snap);
  assert.ok(getPrefs().glass.opacity >= 48 && getPrefs().glass.opacity <= 74);
  await undo.run();
  assert.equal(JSON.stringify(A.snapshotAppearance()), snap);
});

test('save / rename / duplicate / apply / delete visual presets', async () => {
  await fresh();
  setPrefs({ themeId: 'rose', radius: 22, glass: { blur: 31 }, background: { kind: 'preset', presetId: 'ember' } });
  const p = await A.savePreset('Deep Focus');
  setPrefs({ themeId: 'arctic', radius: 6, background: { presetId: 'paper' } });
  const r = await A.applyPreset(p.id);
  assert.equal(r.notes.length, 0);
  assert.equal(getPrefs().themeId, 'rose'); assert.equal(getPrefs().radius, 22); assert.equal(getPrefs().glass.blur, 31); assert.equal(getPrefs().background.presetId, 'ember');
  await A.renamePreset(p.id, 'Deep Focus v2'); assert.equal(app.store.get('visualPresets', p.id).name, 'Deep Focus v2');
  const d = await A.duplicatePreset(p.id); assert.notEqual(d.id, p.id); assert.deepEqual(d.config, p.config);
  await A.deletePreset(p.id); assert.equal(app.store.has('visualPresets', p.id), false); assert.equal(app.store.has('visualPresets', d.id), true);
});

test('deleting a preset never deletes a wallpaper image that it (or anything) uses', async () => {
  await fresh();
  const blob = new Blob(['x'], { type: 'image/webp' });
  await app.store.put('assets', { id: 'asset_keep', name: 'mine', type: 'image/webp', size: 1, width: 1, height: 1, blob });
  setPrefs({ background: { kind: 'image', assetId: 'asset_keep' } });
  const p = await A.savePreset('Uses image');
  await A.deletePreset(p.id);
  assert.ok(app.store.has('assets', 'asset_keep'));
});

test('applying a preset whose uploaded image is missing falls back instead of showing a blank background', async () => {
  await fresh();
  const p = await app.store.put('visualPresets', { name: 'Imported', config: { themeId: 'emerald', background: { kind: 'image', assetId: 'asset_gone' }, areas: { sidebar: { mode: 'image', assetId: 'asset_gone' } } } });
  const r = await A.applyPreset(p.id);
  assert.equal(getPrefs().background.kind, 'preset');
  assert.equal(getPrefs().areas.sidebar.mode, 'inherit');
  assert.equal(r.notes.length, 2);
  assert.equal(getPrefs().themeId, 'emerald');
});

test('malicious / malformed preset config is sanitised or rejected', async () => {
  await fresh();
  assert.equal(A.validatePresetConfig('nope').ok, false);
  const v = A.validatePresetConfig(JSON.parse('{"__proto__":{"polluted":1},"themeId":"x","radius":9999,"background":{"kind":"video","overlayColor":"javascript:1"},"glass":{"blur":"abc"}}'));
  assert.equal(v.ok, true);
  assert.equal({}.polluted, undefined);
  assert.equal(v.config.radius, 28); assert.equal(v.config.background.kind, 'preset'); assert.equal(v.config.background.overlayColor, null);
});

test('custom themes: create from current, rename, duplicate, delete falls back to Midnight', async () => {
  await fresh();
  setPrefs({ overrides: { dark: { primary: '#ff8800' } } });
  const t = await A.createThemeFromCurrent('My Theme');
  assert.equal(getPrefs().themeId, t.id); assert.equal(t.dark.primary, '#ff8800'); assert.equal(getPrefs().overrides.dark.primary, null);
  await A.renameTheme(t.id, 'Renamed'); assert.equal(app.store.get('themes', t.id).name, 'Renamed');
  const c = await A.duplicateTheme(t.id); assert.notEqual(c.id, t.id); assert.equal(c.dark.primary, '#ff8800');
  await A.deleteTheme(t.id); assert.equal(getPrefs().themeId, 'midnight'); assert.equal(app.store.has('themes', t.id), false);
  await undo.run(); assert.equal(app.store.has('themes', t.id), true); assert.equal(getPrefs().themeId, t.id);
});
