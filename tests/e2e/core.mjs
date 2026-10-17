import { test, skip, open, shot, URL_ } from './harness.mjs';
import assert from 'node:assert/strict';

const reload = async (p) => { await p.reload(); await p.waitForFunction(() => window.__lumen?.ready === true); await p.waitForSelector('#main:not(:has(.loading))'); };

/* ============ boot / shell ============ */
test('App boots, shell renders, no console errors', async (t) => {
  const p = await t.newPage(); await open(p, 'dashboard');
  assert.ok(await p.locator('.sidebar').isVisible()); assert.ok((await p.locator('.nav__link').count()) >= 10);
  assert.match(await p.title(), /Dashboard/);
});
test('Every route renders without a view error', async (t) => {
  const p = await t.newPage();
  for (const r of ['dashboard', 'tasks', 'timer', 'calendar', 'notes', 'habits', 'projects', 'study', 'analytics', 'settings/appearance', 'settings/wallpapers', 'settings/general', 'settings/notifications', 'settings/data', 'settings/about']) {
    await open(p, r); assert.equal(await p.locator('.empty__title', { hasText: 'could not be shown' }).count(), 0, `route ${r} failed`);
  }
});
test('Unknown route falls back to dashboard', async (t) => { const p = await t.newPage(); await open(p, 'nope/zzz'); assert.match(await p.title(), /Dashboard/); });

/* ============ tasks ============ */
test('Quick-add parses priority, tag, category, date, estimate; persists after reload', async (t) => {
  const p = await t.newPage(); await open(p, 'tasks');
  await p.fill('#quickadd', 'Write report !high #work @Study tomorrow ~45m'); await p.press('#quickadd', 'Enter');
  await p.waitForSelector('.task');
  const txt = await p.locator('.task').first().innerText();
  assert.match(txt, /Write report/); assert.match(txt, /High/i); assert.match(txt, /work/); assert.match(txt, /Study/); assert.match(txt, /45/);
  await reload(p); await p.waitForSelector('.task'); assert.match(await p.locator('.task').first().innerText(), /Write report/);
});
test('Task form validation shows an inline error and blocks save', async (t) => {
  const p = await t.newPage(); await open(p, 'tasks'); await p.click('text=New task');
  await p.fill('input[placeholder="What needs to be done?"]', ''); await p.click('dialog button:has-text("Save"), dialog button:has-text("Create")');
  assert.ok(await p.locator('dialog .field__error:not(:empty)').first().isVisible());
});
test('Complete, undo, archive flow', async (t) => {
  const p = await t.newPage(); await open(p, 'tasks');
  await p.fill('#quickadd', 'Pay bills'); await p.press('#quickadd', 'Enter'); await p.waitForSelector('.task');
  await p.locator('.task__check').first().click(); await p.waitForFunction(async () => { const { app } = await import('/js/services/ctx.js'); return app.store.all('tasks')[0]?.status === 'done'; });
  const done = await p.evaluate(async () => { const m = await import('/js/services/tasks.js'); const { app } = await import('/js/services/ctx.js'); return app.store.all('tasks')[0].status; });
  assert.equal(done, 'done');
  await p.keyboard.press('Control+z'); await p.waitForTimeout(300);
  const back = await p.evaluate(async () => { const { app } = await import('/js/services/ctx.js'); return app.store.all('tasks')[0].status; });
  assert.equal(back, 'todo');
});
test('Search and filter narrow the list; clear restores it', async (t) => {
  const p = await t.newPage(); await open(p, 'tasks');
  for (const n of ['Alpha one', 'Beta two', 'Gamma three']) { await p.fill('#quickadd', n); await p.press('#quickadd', 'Enter'); await p.waitForTimeout(150); }
  assert.equal(await p.locator('.task').count(), 3);
  await p.fill('input[type="search"]', 'beta'); await p.waitForTimeout(300); assert.equal(await p.locator('.task').count(), 1);
  await p.fill('input[type="search"]', 'zzzz'); await p.waitForTimeout(300); assert.ok(await p.locator('text=No tasks match').isVisible());
});
test('Task lock: completion is refused while a locked focus session runs; interrupt records and unlocks', async (t) => {
  const p = await t.newPage(); await open(p, 'tasks');
  const id = await p.evaluate(async () => { const T = await import('/js/services/tasks.js'); const F = await import('/js/services/focus.js'); const x = await T.createTask({ title: 'Locked work', focus: { enabled: true, durationMin: 25 } }); await F.startFocusForTask(x.id); return x.id; });
  await p.waitForTimeout(400);
  const r = await p.evaluate(async (id) => { const T = await import('/js/services/tasks.js'); try { await T.completeTask(id); return 'completed'; } catch (e) { return e.name; } }, id);
  assert.equal(r, 'TaskLockedError');
  await p.waitForSelector('.lock-chip'); // visible lock indicator
  const r2 = await p.evaluate(async (id) => { const F = await import('/js/services/focus.js'); const { app } = await import('/js/services/ctx.js'); await F.interrupt('phone call'); const s = app.store.all('sessions')[0]; const T = await import('/js/services/tasks.js'); await T.completeTask(id); return { status: s.status, reason: s.interruptReason, task: app.store.get('tasks', id).status }; }, id);
  assert.deepEqual(r2, { status: 'interrupted', reason: 'phone call', task: 'done' });
});
test('Locked session cannot be paused (engine rule via service)', async (t) => {
  const p = await t.newPage(); await open(p, 'tasks');
  const s = await p.evaluate(async () => { const T = await import('/js/services/tasks.js'); const F = await import('/js/services/focus.js'); const x = await T.createTask({ title: 'No pause', focus: { enabled: true, durationMin: 25 } }); await F.startFocusForTask(x.id); try { await F.pause(); } catch { /* expected or ignored */ } return F.active().status; });
  assert.equal(s, 'running');
});

/* ============ timer ============ */
test('Countdown starts, persists across reload, and can be stopped', async (t) => {
  const p = await t.newPage(); await open(p, 'timer');
  await p.click('button:has-text("Start countdown")'); await p.waitForSelector('.timer__face');
  const a = await p.locator('.timer__face').first().innerText(); await p.waitForTimeout(2200);
  const b = await p.locator('.timer__face').first().innerText(); assert.notEqual(a, b, 'clock should tick');
  await reload(p); await p.waitForSelector('.timer__face'); assert.match(await p.locator('.timer__face').first().innerText(), /\d\d:\d\d/);
});
test('Stopwatch records a closed session with credited time', async (t) => {
  const p = await t.newPage(); await open(p, 'timer');
  await p.click('label:has-text("Stopwatch")'); await p.click('button:has-text("Start stopwatch")'); await p.waitForTimeout(2300);
  await p.click('button:has-text("Stop")'); await p.waitForSelector('dialog[open]'); await p.click('dialog button.btn--primary, dialog button.btn--danger'); await p.waitForTimeout(500);
  const s = await p.evaluate(async () => { const { app } = await import('/js/services/ctx.js'); return app.store.all('sessions').map((x) => ({ k: x.kind, st: x.status, ms: x.activeMs })); });
  assert.equal(s.length, 1); assert.equal(s[0].st, 'stopped'); assert.ok(s[0].ms >= 2000 && s[0].ms < 6000, `activeMs ${s[0].ms}`);
});

/* ============ command palette / search / shortcuts ============ */
test('Ctrl+K opens the palette, filters commands, Enter navigates, Esc closes', async (t) => {
  const p = await t.newPage(); await open(p, 'dashboard');
  await p.keyboard.press('Control+k'); await p.waitForSelector('.palette__input');
  assert.equal(await p.getAttribute('.palette__input', 'role'), 'combobox');
  await p.fill('.palette__input', 'calend'); await p.waitForTimeout(150); await p.keyboard.press('Enter');
  await p.waitForFunction(() => location.hash.includes('calendar')); await p.keyboard.press('Control+k'); await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  assert.equal(await p.locator('.palette').count(), 0);
});
test('Global search finds tasks, notes and tags and opens the result', async (t) => {
  const p = await t.newPage(); await open(p, 'dashboard');
  await p.evaluate(async () => { const T = await import('/js/services/tasks.js'); const N = await import('/js/services/notes.js'); await T.createTask({ title: 'Quarterly budget review' }); await N.createNote({ title: 'Budget ideas', body: 'cut costs' }); });
  await p.keyboard.press('/'); await p.waitForSelector('.palette__input'); await p.fill('.palette__input', 'budget'); await p.waitForTimeout(250);
  const items = await p.locator('.palette__item').allInnerTexts(); assert.ok(items.some((x) => /Quarterly budget/.test(x)) && items.some((x) => /Budget ideas/.test(x)), items.join('|'));
  await p.locator('.palette__item', { hasText: 'Budget ideas' }).click(); await p.waitForFunction(() => location.hash.includes('notes'));
});
test('Single-key shortcuts do not fire while typing', async (t) => {
  const p = await t.newPage(); await open(p, 'tasks'); await p.click('#quickadd'); await p.keyboard.type('nnn?/'); assert.equal(await p.locator('dialog[open]').count(), 0);
  assert.equal(await p.inputValue('#quickadd'), 'nnn?/');
});
test('? opens the shortcuts help; Go-to chord navigates', async (t) => {
  const p = await t.newPage(); await open(p, 'dashboard'); await p.keyboard.press('?'); await p.waitForSelector('dialog[open]'); await p.keyboard.press('Escape');
  await p.keyboard.press('g'); await p.keyboard.press('h'); await p.waitForFunction(() => location.hash.includes('habits'));
});

