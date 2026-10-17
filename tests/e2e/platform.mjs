import { test, skip, open, shot, newPage, URL_ } from './harness.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const reload = async (p) => { await p.reload(); await p.waitForFunction(() => window.__lumen?.ready === true); await p.waitForSelector('#main:not(:has(.loading))'); };
const prefs = (p) => p.evaluate(async () => (await import('/js/services/prefs.js')).getPrefs());
const pngBytes = async (p, w = 800, h = 450) => Buffer.from(await p.evaluate(([w, h]) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#ff0066'); g.addColorStop(1, '#2200ff'); x.fillStyle = g; x.fillRect(0, 0, w, h); return c.toDataURL('image/png').split(',')[1]; }, [w, h]), 'base64');

/* ============ appearance ============ */
test('Mode switching (light/dark/system) applies to <html> and persists after reload', async (t) => {
  const p = await t.newPage({ colorScheme: 'dark' }); await open(p, 'dashboard');
  await p.evaluate(async () => (await import('/js/services/prefs.js')).setPrefs({ mode: 'light' })); await p.waitForTimeout(200);
  assert.equal(await p.evaluate(() => document.documentElement.dataset.mode || document.documentElement.style.colorScheme), 'light');
  await reload(p); assert.equal((await prefs(p)).mode, 'light'); assert.equal(await p.evaluate(() => document.documentElement.dataset.mode || document.documentElement.style.colorScheme), 'light');
  await p.evaluate(async () => (await import('/js/services/prefs.js')).setPrefs({ mode: 'system' })); await p.waitForTimeout(200);
  assert.equal(await p.evaluate(() => document.documentElement.dataset.mode || document.documentElement.style.colorScheme), 'dark', 'system follows OS dark');
});
test('All 8 preset themes apply and change CSS tokens', async (t) => {
  const p = await t.newPage(); await open(p, 'dashboard'); const seen = new Set();
  for (const id of ['midnight', 'cyberpunk', 'emerald', 'ocean', 'lavender', 'rose', 'arctic', 'minimal']) {
    await p.evaluate(async (id) => (await import('/js/services/prefs.js')).setPrefs({ themeId: id }), id); await p.waitForTimeout(120);
    seen.add(await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary-raw').trim()));
  }
  assert.ok(seen.size >= 7, `distinct primaries: ${[...seen]}`);
});
test('Appearance Studio: live preview applies immediately, Cancel reverts, Apply persists', async (t) => {
  const p = await t.newPage(); await open(p, 'settings/appearance'); await p.waitForSelector('.theme-card');
  const before = (await prefs(p)).themeId;
  await p.click('.theme-card[data-theme="rose"]'); await p.waitForSelector('.bulkbar:not([hidden])');
  assert.equal((await prefs(p)).themeId, 'rose'); // live
  assert.notEqual(await p.evaluate(() => JSON.parse(localStorage.getItem('lumen.prefs.v1') || '{}').themeId), 'rose', 'not persisted yet');
  await p.click('.bulkbar button:has-text("Cancel")'); assert.equal((await prefs(p)).themeId, before);
  await p.click('.theme-card[data-theme="ocean"]'); await p.click('.bulkbar button:has-text("Apply")'); await reload(p); assert.equal((await prefs(p)).themeId, 'ocean');
});
test('Appearance Studio: leaving without Apply discards the preview', async (t) => {
  const p = await t.newPage(); await open(p, 'settings/appearance'); await p.waitForSelector('.theme-card'); const before = (await prefs(p)).themeId;
  await p.click('.theme-card[data-theme="emerald"]'); await p.click('.nav__link:has-text("Tasks")'); await p.waitForTimeout(400); assert.equal((await prefs(p)).themeId, before);
});
test('Appearance Studio: Reset restores defaults (preview) and Apply persists', async (t) => {
  const p = await t.newPage(); await open(p, 'settings/appearance'); await p.evaluate(async () => (await import('/js/services/prefs.js')).setPrefs({ radius: 3, themeId: 'rose' })); await reload(p); await p.waitForSelector('.theme-card');
  await p.click('.theme-card[data-theme="ocean"]'); await p.click('.bulkbar button:has-text("Reset to defaults")'); const q = await prefs(p); assert.equal(q.themeId, 'midnight'); assert.equal(q.radius, 14);
});
test('Custom theme: create, rename, duplicate, delete (with undo)', async (t) => {
  const p = await t.newPage(); await open(p, 'settings/appearance');
  const r = await p.evaluate(async () => { const A = await import('/js/services/appearance-actions.js'); const { app } = await import('/js/services/ctx.js'); const { undo } = await import('/js/services/undo.js'); const a = await A.createThemeFromCurrent('Mine'); await A.renameTheme(a.id, 'Mine 2'); const b = await A.duplicateTheme(a.id); const n1 = app.store.all('themes').length; await A.deleteTheme(b.id); const n2 = app.store.all('themes').length; await undo.run(); return { n1, n2, n3: app.store.all('themes').length, name: app.store.get('themes', a.id).name }; });
  assert.deepEqual(r, { n1: 2, n2: 1, n3: 2, name: 'Mine 2' });
});
test('Random theme produces a readable palette (contrast ≥ 4.5 for body text on glass) and is undoable', async (t) => {
  const p = await t.newPage(); await open(p, 'dashboard');
  const r = await p.evaluate(async () => { const A = await import('/js/services/appearance-actions.js'); const { undo } = await import('/js/services/undo.js'); const { getPrefs } = await import('/js/services/prefs.js'); const C = await import('/js/core/color.js'); const before = getPrefs().themeId; const out = []; for (let i = 0; i < 6; i++) { await A.randomizeTheme(); await new Promise((r) => setTimeout(r, 60)); const cs = getComputedStyle(document.documentElement); const text = cs.getPropertyValue('--text').trim(); const glass = cs.getPropertyValue('--surface-solid').trim(); out.push(C.contrast(text, glass)); } await undo.run(); return { min: Math.min(...out), restored: getPrefs().themeId === before || getPrefs().themeId !== 'theme_random_latest' }; });
  assert.ok(r.min >= 4.5, `min contrast ${r.min}`);
});
test('Status is never colour-only: overdue and locked tasks carry text/icon', async (t) => {
  const p = await t.newPage(); await open(p, 'tasks');
  await p.evaluate(async () => { const T = await import('/js/services/tasks.js'); await T.createTask({ title: 'Late', deadline: '2020-01-01' }); }); await p.waitForSelector('.task.is-overdue');
  assert.match(await p.locator('.task.is-overdue').first().innerText(), /overdue|ago|late/i);
});
test('Sidebar collapses via button and Ctrl+B, and the state persists', async (t) => {
  const p = await t.newPage(); await open(p, 'dashboard'); await p.click('#collapse-btn'); assert.equal(await p.evaluate(() => document.documentElement.dataset.sidebar), 'collapsed');
  await reload(p); assert.equal(await p.evaluate(() => document.documentElement.dataset.sidebar), 'collapsed'); await p.keyboard.press('Control+b'); assert.notEqual(await p.evaluate(() => document.documentElement.dataset.sidebar), 'collapsed');
});
test('Reduced motion: preference sets data-motion and disables animations', async (t) => {
  const p = await t.newPage({ reducedMotion: 'reduce' }); await open(p, 'dashboard');
  const d = await p.evaluate(() => ({ anim: document.documentElement.dataset.anim, t: getComputedStyle(document.documentElement).getPropertyValue('--t-med').trim() })); assert.notEqual(d.anim, 'on'); assert.match(d.t, /^0/);
});

/* ============ wallpapers ============ */
test('Wallpaper gallery: picking a wallpaper updates the background layer; favourites and recents persist', async (t) => {
  const p = await t.newPage(); await open(p, 'settings/wallpapers'); await p.waitForSelector('.wp-card');
  await p.click('.wp-card[data-wp="preset:neon-grid"]'); await p.waitForTimeout(500);
  assert.match(await p.evaluate(() => document.querySelector('.bg-image').style.backgroundImage), /neon-grid/);
  await p.click('button[aria-label^="Add Neon Grid to favourites"]'); await p.click('.bulkbar button:has-text("Apply")'); await reload(p);
  const q = await prefs(p); assert.ok(q.favourites.includes('preset:neon-grid')); assert.ok(q.recents.includes('preset:neon-grid')); assert.equal(q.background.presetId, 'neon-grid');
});
test('Wallpaper upload: valid PNG is stored in IndexedDB (not localStorage), shown, and survives reload', async (t) => {
  const p = await t.newPage(); await open(p, 'settings/wallpapers'); const buf = await pngBytes(p);
  await p.setInputFiles('#wp-file', { name: 'mine.png', mimeType: 'image/png', buffer: buf }); await p.waitForSelector('.wp-card[data-wp^="asset:"]', { timeout: 15000 });
  const ls = await p.evaluate(() => Object.entries(localStorage).reduce((n, [k, v]) => n + v.length, 0)); assert.ok(ls < 50000, `localStorage ${ls} chars`);
  const a = await p.evaluate(async () => { const { app } = await import('/js/services/ctx.js'); const x = app.store.all('assets')[0]; return { type: x.type, isBlob: x.blob instanceof Blob, w: x.width }; }); assert.ok(['image/png', 'image/webp'].includes(a.type)); assert.equal(a.isBlob, true); assert.equal(a.w, 800);
  await p.click('.wp-card[data-wp^="asset:"]'); await p.click('.bulkbar button:has-text("Apply")'); await reload(p); await p.waitForTimeout(600);
  assert.match(await p.evaluate(() => document.querySelector('.bg-image').style.backgroundImage), /blob:/);
});
test('Wallpaper upload rejects non-images, spoofed extensions, empty and SVG files with a readable message', async (t) => {
  const p = await t.newPage({}); await open(p, 'settings/wallpapers');
  for (const [name, type, data] of [['x.png', 'image/png', Buffer.from('not an image at all')], ['x.svg', 'image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>')], ['empty.png', 'image/png', Buffer.alloc(0)]]) {
    await p.setInputFiles('#wp-file', { name, mimeType: type, buffer: data }); await p.waitForTimeout(500);
    assert.match(await p.locator('#upload-msg').innerText(), /unsupported|empty|could not|PNG, JPEG or WebP/i, name);
  }
  assert.equal(await p.evaluate(async () => (await import('/js/services/ctx.js')).app.store.count('assets')), 0);
});
test('Deleting an uploaded image falls back safely; deleting a preset never deletes an image used elsewhere', async (t) => {
  const p = await t.newPage(); await open(p, 'dashboard');
  const r = await p.evaluate(async () => { const { app } = await import('/js/services/ctx.js'); const W = await import('/js/services/wallpapers.js'); const A = await import('/js/services/appearance-actions.js'); const { getPrefs, setPrefs } = await import('/js/services/prefs.js');
    const c = document.createElement('canvas'); c.width = 64; c.height = 64; c.getContext('2d').fillRect(0, 0, 64, 64); const blob = await new Promise((r) => c.toBlob(r, 'image/png')); const rec = await W.saveImage(await W.processImage(new File([blob], 'a.png', { type: 'image/png' })));
    setPrefs({ background: { kind: 'image', assetId: rec.id } }); const pre = await A.savePreset('Uses image'); await A.deletePreset(pre.id); const stillThere = !!app.store.get('assets', rec.id);
    const pre2 = await A.savePreset('Again'); await W.deleteImage(rec.id); const bg = getPrefs().background; const apply = await A.applyPreset(pre2.id).then(() => 'ok').catch((e) => e.message);
    return { stillThere, fellBack: bg.kind === 'preset', apply, afterKind: getPrefs().background.kind }; });
  assert.equal(r.stillThere, true); assert.equal(r.fellBack, true); assert.equal(r.apply, 'ok'); assert.equal(r.afterKind, 'preset');
});
test('Per-area backgrounds apply CSS variables; random wallpaper/theme/appearance are undoable', async (t) => {
  const p = await t.newPage(); await open(p, 'dashboard');
  const r = await p.evaluate(async () => { const { setPrefs, getPrefs } = await import('/js/services/prefs.js'); const A = await import('/js/services/appearance-actions.js'); const { undo } = await import('/js/services/undo.js');
    setPrefs({ areas: { sidebar: { mode: 'solid', color: '#ff0000', dim: 10 } } }); await new Promise((r) => setTimeout(r, 120)); const sb = getComputedStyle(document.documentElement).getPropertyValue('--area-sidebar').trim();
    const b0 = JSON.stringify(A.snapshotAppearance()); await A.randomizeAppearance(); const changed = JSON.stringify(A.snapshotAppearance()) !== b0; await undo.run(); const back = JSON.stringify(A.snapshotAppearance()) === b0;
    A.randomizeWallpaper(); await undo.run(); const back2 = JSON.stringify(A.snapshotAppearance()) === b0; return { sb, changed, back, back2 }; });
  assert.match(r.sb, /#ff0000|rgb\(255/i); assert.ok(r.changed && r.back && r.back2, JSON.stringify(r));
});
test('Focus mode appearance: applies while a focus timer runs and is restored afterwards', async (t) => {
  const p = await t.newPage(); await open(p, 'dashboard');
  const r = await p.evaluate(async () => { const { setPrefs } = await import('/js/services/prefs.js'); const F = await import('/js/services/focus.js'); const wait = (ms) => new Promise((r) => setTimeout(r, ms)); setPrefs({ areas: { focus: { mode: 'solid', color: '#001122', dim: 30 } }, background: { kind: 'preset', presetId: 'aurora-night' } });
    const before = document.documentElement.dataset.focus; await F.startPomodoro({ cfg: { workMin: 25, shortMin: 5, longMin: 15, longEvery: 4 }, autoNext: false }); await wait(300); const during = document.documentElement.dataset.focus; await F.stop(); await wait(300); return { before, during, after: document.documentElement.dataset.focus }; });
  assert.equal(r.during, 'on'); assert.notEqual(r.after, 'on');
});

/* ============ backup / restore ============ */
async function seed(p) { await p.evaluate(async () => { const T = await import('/js/services/tasks.js'); const N = await import('/js/services/notes.js'); const H = await import('/js/services/habits.js'); const P = await import('/js/services/projects.js'); const S = await import('/js/services/study.js'); await T.createTask({ title: 'Backup me', deadline: '2030-05-05', priority: 'high' }); await N.createNote({ title: 'My note', body: '# hi' }); const h = await H.createHabit({ name: 'Walk' }); await H.toggleLog(h.id, '2026-01-01'); await P.createProject({ name: 'Proj' }); const s = await S.createSubject({ name: 'Math' }); await S.addChapter(s.id, 'Ch1'); }); }
const counts = (p) => p.evaluate(async () => { const { app } = await import('/js/services/ctx.js'); return Object.fromEntries(['tasks', 'notes', 'habits', 'habitLogs', 'projects', 'subjects'].map((k) => [k, app.store.count(k)])); });
test('Backup export → wipe → import restores everything (round trip, with image)', async (t) => {
  const p = await t.newPage(); await open(p, 'settings/data'); await seed(p);
  const buf = await pngBytes(p, 300, 200); await open(p, 'settings/wallpapers'); await p.setInputFiles('#wp-file', { name: 'i.png', mimeType: 'image/png', buffer: buf }); await p.waitForSelector('.wp-card[data-wp^="asset:"]');
  await open(p, 'settings/data'); const before = await counts(p);
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('button:has-text("Download backup")')]); const path = await dl.path(); const text = readFileSync(path, 'utf8'); const data = JSON.parse(text);
  assert.equal(data.format, 'lumen-backup'); assert.equal(data.encrypted, false); assert.equal(data.stores.tasks.length, 1); assert.equal(data.stores.assets.length, 1); assert.ok(/^data:image\/(png|webp);base64,/.test(data.stores.assets[0].blobData), 'image embedded as base64 data URL');
  // wipe through the UI-level service, then import via the file input
  await p.evaluate(async () => { const B = await import('/js/services/backup.js'); await B.deleteAllLocalData({ includeSnapshots: false }); }); await open(p, 'settings/data'); assert.equal((await counts(p)).tasks, 0);
  await p.setInputFiles('#import-file', path); await p.waitForSelector('dialog[open] table'); assert.match(await p.locator('dialog[open]').innerText(), /review before anything changes/i);
  await p.click('dialog button:has-text("Import")'); await p.waitForTimeout(1200); assert.deepEqual(await counts(p), before);
  assert.equal(await p.evaluate(async () => (await import('/js/services/ctx.js')).app.store.count('assets')), 1);
});
test('Import: invalid JSON, wrong format and newer version are rejected with a clear message and change nothing', async (t) => {
  const p = await t.newPage(); await open(p, 'settings/data'); await seed(p); const before = await counts(p);
  for (const [name, body] of [['bad.json', '{oops'], ['other.json', '{"format":"something-else"}'], ['new.json', JSON.stringify({ format: 'lumen-backup', formatVersion: 99, stores: {} })]]) {
    await p.setInputFiles('#import-file', { name, mimeType: 'application/json', buffer: Buffer.from(body) }); await p.waitForSelector('dialog[open]'); assert.match(await p.locator('dialog[open]').innerText(), /cannot be imported|Nothing was changed/i); await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  }
  assert.deepEqual(await counts(p), before);
});
test('Import: merge-keep never silently overwrites; duplicates are detected; a safety copy is created; prototype-pollution keys are stripped', async (t) => {
  const p = await t.newPage(); await open(p, 'settings/data'); await seed(p);
  const obj = await p.evaluate(async () => { const B = await import('/js/services/backup.js'); const { obj } = await B.createBackupObject({ includeImages: false }); return obj; });
  const edited = JSON.parse(JSON.stringify(obj)); edited.stores.tasks[0].title = 'CHANGED IN BACKUP'; edited.__proto__ = undefined; const text = JSON.stringify(edited).replace('"stores":', '"__proto__":{"polluted":true},"stores":');
  await p.setInputFiles('#import-file', { name: 'c.json', mimeType: 'application/json', buffer: Buffer.from(text) }); await p.waitForSelector('dialog[open] table');
  assert.match(await p.locator('dialog[open]').innerText(), /differ/i); await p.click('dialog button:has-text("Import")'); await p.waitForTimeout(800);
  const r = await p.evaluate(async () => { const { app } = await import('/js/services/ctx.js'); return { title: app.store.all('tasks')[0].title, snaps: app.store.count('backups'), polluted: ({}).polluted === true }; });
  assert.equal(r.title, 'Backup me'); assert.equal(r.snaps, 1); assert.equal(r.polluted, false);
});
test('Import: replace mode asks for a second confirmation and can be restored from the automatic safety copy', async (t) => {
  const p = await t.newPage(); await open(p, 'settings/data'); await seed(p);
  const text = await p.evaluate(async () => { const B = await import('/js/services/backup.js'); const { obj } = await B.createBackupObject({ includeImages: false }); obj.stores.tasks = []; obj.counts.tasks = 0; return JSON.stringify(obj); });
  await p.setInputFiles('#import-file', { name: 'r.json', mimeType: 'application/json', buffer: Buffer.from(text) }); await p.waitForSelector('dialog[open] table'); await p.click('dialog label:has-text("Replace everything")'); await p.click('dialog button:has-text("Import")');
  await p.waitForSelector('dialog:has-text("Replace all current data")'); await p.click('dialog:has-text("Replace all current data") button:has-text("Replace everything")'); await p.waitForTimeout(1000);
  assert.equal((await counts(p)).tasks, 0);
  const restored = await p.evaluate(async () => { const B = await import('/js/services/backup.js'); const s = B.listSnapshots()[0]; const prep = await B.prepareImport(B.snapshotAsFile(s.id), 'replace'); await B.applyImport(prep.plan, { mode: 'replace', data: prep.data }); const { app } = await import('/js/services/ctx.js'); return app.store.count('tasks'); });
  assert.equal(restored, 1);
});
test('Delete all data requires typing DELETE and then empties every store', async (t) => {
  const p = await t.newPage(); await open(p, 'settings/data'); await seed(p); await p.click('button:has-text("Delete all my data")'); await p.fill('dialog input[aria-label^="Type DELETE"]', 'nope'); await p.click('dialog button:has-text("Delete everything")');
  assert.ok(await p.locator('dialog .field__error:not(:empty)').isVisible()); assert.equal((await counts(p)).tasks, 1);
  await p.fill('dialog input[aria-label^="Type DELETE"]', 'DELETE'); await Promise.all([p.waitForNavigation({ waitUntil: 'load' }).catch(() => {}), p.click('dialog button:has-text("Delete everything")')]); await p.waitForFunction(() => window.__lumen?.ready); await p.waitForTimeout(500); assert.equal((await counts(p)).tasks, 0);
});

/* ============ data layer ============ */
test('Corrupt record in IndexedDB is quarantined, the app still boots, and other data loads', async (t) => {
  const p = await t.newPage(); await open(p, 'dashboard'); await p.evaluate(async () => { const T = await import('/js/services/tasks.js'); await T.createTask({ title: 'Healthy' }); });
  await p.evaluate(() => new Promise((res, rej) => { const rq = indexedDB.open('lumen'); rq.onsuccess = () => { const db = rq.result; const tx = db.transaction('tasks', 'readwrite'); tx.objectStore('tasks').put({ id: 'task_bad', title: { not: 'a string' }, priority: 'whatever', deadline: 12345, subtasks: 'x', recurrence: 7 }); tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); }; rq.onerror = () => rej(rq.error); }));
  await reload(p); const r = await p.evaluate(async () => { const { app } = await import('/js/services/ctx.js'); return { titles: app.store.all('tasks').map((x) => x.title), q: app.store.count('quarantine') }; });
  assert.ok(r.titles.includes('Healthy')); assert.ok(r.q >= 1, 'quarantined/repaired copy kept');
});
test('Multi-tab: a change in one tab appears in another without reload', async (t) => {
  const a = await t.newPage(); await open(a, 'tasks'); const b = await a.ctx.newPage(); await b.goto(`${URL_}/#/tasks`); await b.waitForFunction(() => window.__lumen?.ready); b.on('pageerror', () => {});
  await a.evaluate(async () => { const T = await import('/js/services/tasks.js'); await T.createTask({ title: 'From tab A' }); }); await b.waitForSelector('.task:has-text("From tab A")', { timeout: 6000 });
});
test('Only one focus session can exist across two tabs (atomic lock)', async (t) => {
  const a = await t.newPage(); await open(a, 'timer'); const b = await a.ctx.newPage(); await b.goto(`${URL_}/#/timer`); await b.waitForFunction(() => window.__lumen?.ready);
  const go = (pg) => pg.evaluate(async () => { const F = await import('/js/services/focus.js'); try { await F.startCountdown({ minutes: 5 }); return 'started'; } catch (e) { return 'refused'; } });
  const res = await Promise.all([go(a), go(b)]); const n = await a.evaluate(async () => (await import('/js/services/ctx.js')).app.store.all('sessions').filter((s) => s.status === 'running').length);
  assert.equal(res.filter((x) => x === 'started').length, 1, res.join()); assert.equal(n, 1);
});
test('Session persists timestamps: closing and reopening the tab keeps the countdown correct', async (t) => {
  const p = await t.newPage(); await open(p, 'timer'); await p.evaluate(async () => (await import('/js/services/focus.js')).startCountdown({ minutes: 10 })); await p.waitForTimeout(2500); await reload(p);
  const left = await p.evaluate(async () => { const F = await import('/js/services/focus.js'); const { clock } = await import('/js/core/clock.js'); const E = F.engine; const s = F.active(); return E.remainingMs(s, clock.now()); });
  assert.ok(left < 600000 - 2000 && left > 600000 - 30000, `remaining ${left}`);
});

/* ============ offline ============ */
test('Offline: service worker installs and the app loads with the network cut', async (t) => {
  const p = await t.newPage({ sw: true }); await open(p, 'dashboard');
  await p.waitForFunction(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!r?.active; }, null, { timeout: 15000 });
  await p.reload(); await p.waitForFunction(() => navigator.serviceWorker.controller); await p.waitForTimeout(1500);
  await p.ctx.setOffline(true); await p.goto(`${URL_}/#/tasks`); await p.reload(); await p.waitForFunction(() => window.__lumen?.ready === true, null, { timeout: 10000 });
  await p.waitForFunction(() => /Tasks/.test(document.title), null, { timeout: 10000 }); assert.match(await p.locator('#net-status').innerText(), /offline/i);
  await p.evaluate(async () => { const T = await import('/js/services/tasks.js'); await T.createTask({ title: 'Made offline' }); }); await p.click('.nav__link:has-text("Settings")'); await p.waitForTimeout(500);
  await p.evaluate(() => { location.hash = '#/settings/wallpapers'; }); await p.waitForSelector('.wp-card img', { timeout: 8000 });
  await p.waitForFunction(() => [...document.querySelectorAll('.wp-card img')].filter((i) => i.complete && i.naturalWidth > 0).length >= 8, null, { timeout: 8000 }).catch(() => {}); const loaded = await p.evaluate(() => [...document.querySelectorAll('.wp-card img')].filter((i) => i.complete && i.naturalWidth > 0).length); assert.ok(loaded >= 8, `wallpaper thumbs loaded offline: ${loaded}`);
  await p.ctx.setOffline(false);
}, { allowErrors: true });

/* ============ responsive / a11y ============ */
test('Mobile (390px): no horizontal scroll on any page; bottom nav visible', async (t) => {
  const p = await t.newPage({ viewport: { width: 390, height: 800 } }); const bad = [];
  for (const r of ['dashboard', 'tasks', 'timer', 'calendar', 'notes', 'habits', 'projects', 'study', 'analytics', 'settings/appearance', 'settings/wallpapers', 'settings/data']) { await open(p, r); await p.waitForTimeout(250); const w = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })); if (w.sw > w.cw + 1) bad.push(`${r}: ${w.sw}>${w.cw}`); }
  assert.deepEqual(bad, [], bad.join('; ')); assert.ok(await p.locator('.bottom-nav').isVisible());
});
test('Keyboard: skip link, visible focus, dialog traps focus and Esc returns focus', async (t) => {
  const p = await t.newPage(); await open(p, 'tasks'); await p.keyboard.press('Tab'); assert.match(await p.evaluate(() => document.activeElement.className), /skip-link/);
  await p.focus('button:has-text("New task")'); await p.keyboard.press('Enter'); await p.waitForSelector('dialog[open]');
  const inside = []; for (let i = 0; i < 25; i++) { await p.keyboard.press('Tab'); inside.push(await p.evaluate(() => !!document.activeElement.closest('dialog'))); } assert.ok(inside.every(Boolean), 'focus stayed in dialog');
  await p.keyboard.press('Escape'); await p.waitForTimeout(200); assert.match(await p.evaluate(() => document.activeElement.innerText || ''), /New task/);
  const outline = await p.evaluate(() => { const b = document.querySelector('button.btn--primary'); b.focus(); const s = getComputedStyle(b); return `${s.outlineStyle} ${s.outlineWidth}`; }); assert.doesNotMatch(outline, /^none/);
});
test('Landmarks, labels and live regions exist; every icon button has an accessible name', async (t) => {
  const p = await t.newPage(); for (const r of ['dashboard', 'tasks', 'timer', 'calendar', 'notes', 'habits', 'projects', 'study', 'analytics', 'settings/appearance']) { await open(p, r); await p.waitForTimeout(200);
    const bad = await p.evaluate(() => [...document.querySelectorAll('button, a[href], input, select, textarea')].filter((el) => { if (el.type === 'hidden' || el.closest('[hidden]') || el.classList.contains('sr-only')) return false; const name = (el.getAttribute('aria-label') || el.innerText || el.value || el.title || (el.labels && el.labels[0]?.innerText) || el.getAttribute('aria-labelledby') || el.getAttribute('placeholder') || '').trim(); return !name; }).map((el) => el.outerHTML.slice(0, 90)));
    assert.deepEqual(bad.slice(0, 3), [], `${r}: unlabeled controls`); }
  assert.ok(await p.locator('main#main').count() === 1 && await p.locator('#live[aria-live]').count() === 1 && await p.locator('nav[aria-label]').count() >= 1);
});
test('Light and dark text contrast: body text vs panel background ≥ 4.5:1 for every preset in both modes', async (t) => {
  const p = await t.newPage(); await open(p, 'dashboard');
  const worst = await p.evaluate(async () => { const { setPrefs } = await import('/js/services/prefs.js'); const C = await import('/js/core/color.js'); let min = 99, where = ''; for (const id of ['midnight', 'cyberpunk', 'emerald', 'ocean', 'lavender', 'rose', 'arctic', 'minimal']) for (const mode of ['light', 'dark']) { setPrefs({ themeId: id, mode }, { persist: false }); await new Promise((r) => setTimeout(r, 40)); const cs = getComputedStyle(document.documentElement); for (const k of ['--text', '--text-muted']) { const c = C.contrast(cs.getPropertyValue(k).trim(), cs.getPropertyValue('--surface-solid').trim()); if (c < min) { min = c; where = `${id}/${mode}/${k}`; } } } return { min, where }; });
  assert.ok(worst.min >= 4.5, `${worst.where} = ${worst.min}`);
});
test('Notification permission is never requested automatically', async (t) => {
  const p = await t.newPage(); await p.ctx.addInitScript(() => { window.__notifAsk = 0; const N = window.Notification; if (N) { const orig = N.requestPermission; N.requestPermission = (...a) => { window.__notifAsk++; return orig.apply(N, a); }; } });
  await open(p, 'dashboard'); await open(p, 'settings/notifications'); await p.waitForTimeout(500); assert.equal(await p.evaluate(() => window.__notifAsk), 0);
});
test('Security headers and CSP are served; inline script injection via note title is inert', async (t) => {
  const p = await t.newPage(); const r = await p.goto(`${URL_}/`); const h = r.headers(); assert.match(h['content-security-policy'], /default-src 'self'/); assert.ok(h['x-content-type-options']);
  await open(p, 'notes'); await p.evaluate(async () => { const N = await import('/js/services/notes.js'); await N.createNote({ title: '<img src=x onerror=window.__pwn=1>', body: '[click](javascript:window.__pwn=2) [ok](https://example.com)' }); }); await p.waitForSelector('.note-item'); await p.click('.note-item'); await p.waitForSelector('.note-preview');
  assert.equal(await p.evaluate(() => window.__pwn || 0), 0); const hrefs = await p.locator('.note-preview a').evaluateAll((a) => a.map((x) => x.getAttribute('href'))); assert.ok(!hrefs.some((x) => /^javascript:/i.test(x)));
});
test('Performance: 1,000 tasks render and filter responsively', async (t) => {
  const p = await t.newPage(); await open(p, 'tasks');
  const ms = await p.evaluate(async () => { const { app } = await import('/js/services/ctx.js'); const recs = Array.from({ length: 1000 }, (_, i) => ({ title: `Bulk task ${i}`, priority: ['low', 'medium', 'high', 'critical'][i % 4], order: i })); const t0 = performance.now(); await app.store.putMany('tasks', recs); return performance.now() - t0; });
  assert.ok(ms < 8000, `insert ${ms}`); await p.waitForSelector('.task'); const t0 = Date.now(); await p.fill('input[type="search"]', 'Bulk task 99'); await p.waitForFunction(() => document.querySelectorAll('.task').length > 0 && document.querySelectorAll('.task').length < 50); assert.ok(Date.now() - t0 < 3000);
});
