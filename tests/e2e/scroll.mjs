import { test, open } from './harness.mjs';
import assert from 'node:assert/strict';
// Regression: changing a control on a long Settings page must not move the reader's place.
// `#main` is the scroll container. We compare the control's on-screen position (not just scrollTop), because the
// unsaved-changes bar appearing above the content must not push the control away either.
const setTop = (p, y) => p.evaluate((y) => { const m = document.getElementById('main'); m.style.scrollBehavior = 'auto'; m.scrollTop = y; m.style.scrollBehavior = ''; }, y);
const topOf = (loc) => loc.evaluate((e) => Math.round(e.getBoundingClientRect().top));
const scrollTo = async (p, loc) => { await loc.evaluate((e) => { const m = document.getElementById('main'); m.style.scrollBehavior = 'auto'; m.scrollTop += e.getBoundingClientRect().top - m.getBoundingClientRect().top - 150; m.style.scrollBehavior = ''; }); await p.waitForTimeout(150); };
const barVisible = (p) => p.evaluate(() => !document.querySelector('[aria-label="Unsaved appearance changes"]').hidden);
const taskCards = (p) => p.locator('.glass-inner', { hasText: 'Task cards' });

test('Scroll: Task cards background dropdown keeps the page position (bar appears, controls re-render)', async (t) => {
  const p = await t.newPage({ viewport: { width: 1280, height: 800 } }); await open(p, 'settings/wallpapers'); await p.waitForSelector('text=Per-area backgrounds');
  const sel = taskCards(p).locator('select'); await scrollTo(p, sel);
  assert.equal(await barVisible(p), false); const y0 = await topOf(sel); const m0 = await p.evaluate(() => document.getElementById('main').scrollTop); assert.ok(m0 > 800, `scrolled far down (${m0})`);
  await sel.focus({ preventScroll: true }); await sel.selectOption('solid'); await p.waitForTimeout(400);
  assert.equal(await barVisible(p), true, 'unsaved-changes bar appears');
  const y1 = await topOf(taskCards(p).locator('select')); assert.ok(Math.abs(y1 - y0) <= 2, `dropdown moved on screen: ${y0} -> ${y1}`);
  assert.ok(await p.evaluate(() => document.getElementById('main').scrollTop) > 800, 'did not jump to top');
  assert.equal(await p.evaluate(() => document.activeElement?.tagName), 'SELECT', 'keyboard focus stays on the dropdown');
  assert.equal(await taskCards(p).locator('input[type=color]').count() >= 1, true, 'solid colour control appeared');
  // second change (bar already visible), then Calendar dropdown
  await taskCards(p).locator('select').selectOption('inherit'); await p.waitForTimeout(300); const y2 = await topOf(taskCards(p).locator('select')); assert.ok(Math.abs(y2 - y0) <= 2, `second change moved: ${y0} -> ${y2}`);
  const cal = p.locator('.glass-inner', { hasText: 'Calendar' }).locator('select'); const c0 = await topOf(cal); await cal.selectOption('gradient'); await p.waitForTimeout(300);
  const c1 = await topOf(p.locator('.glass-inner', { hasText: 'Calendar' }).locator('select')); assert.ok(Math.abs(c1 - c0) <= 2, `calendar dropdown moved: ${c0} -> ${c1}`);
});

test('Scroll: slider, toggle, segmented control and wallpaper choice keep position; bar, Apply, Cancel, Reset still work', async (t) => {
  const p = await t.newPage({ viewport: { width: 1280, height: 800 } }); await open(p, 'settings/wallpapers'); await p.waitForSelector('text=Display & live preview');
  const bgNow = () => p.evaluate(async () => JSON.stringify((await import('/js/services/prefs.js')).getPrefs().background)); const base = await bgNow();
  const sl = p.locator('main input[type=range]').nth(5); await scrollTo(p, sl); const s0 = await topOf(sl);
  await sl.focus({ preventScroll: true }); await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(300);
  assert.ok(Math.abs((await topOf(sl)) - s0) <= 2, 'slider moved'); assert.equal(await barVisible(p), true, 'bar after slider');
  const sw = p.locator('input[role=switch]').first(); await scrollTo(p, sw); const w0 = await topOf(sw); await sw.evaluate((e) => e.click()); await p.waitForTimeout(300);
  assert.ok(Math.abs((await topOf(p.locator('input[role=switch]').first())) - w0) <= 2, 'toggle moved');
  const segLab = () => p.locator('[aria-label="Background type"] .segmented__label', { hasText: 'Gradient' });
  await scrollTo(p, segLab()); const g0 = await topOf(segLab()); await segLab().click(); await p.waitForTimeout(400);
  const gi = await p.evaluate(() => { const m = document.getElementById('main'); return [m.scrollTop, m.scrollHeight - m.clientHeight]; }); assert.ok(Math.abs((await topOf(segLab())) - g0) <= 4, `segmented control moved: ${g0} -> ${await topOf(segLab())}, scrollTop/max ${gi}`);
  const card = p.locator('.wp-card').nth(6); await scrollTo(p, card); const k0 = await topOf(card); await card.click(); await p.waitForTimeout(400);
  assert.ok(Math.abs((await topOf(p.locator('.wp-card').nth(6))) - k0) <= 2, 'wallpaper card moved after choosing');
  // Cancel returns to saved look; Reset marks dirty; Apply clears the bar and persists
  const bg = () => p.evaluate(async () => JSON.stringify((await import('/js/services/prefs.js')).getPrefs().background));
  assert.notEqual(await bg(), base, 'live preview changed the background'); await p.getByRole('button', { name: 'Cancel' }).first().click(); await p.waitForTimeout(300);
  assert.equal(await barVisible(p), false, 'bar hidden after Cancel'); assert.equal(await bg(), base, 'Cancel restored the saved background');
  await p.getByRole('radio', { name: 'Solid' }).first().evaluate((e) => e.click()).catch(() => {}); await p.waitForTimeout(200);
  await p.getByRole('button', { name: 'Reset to defaults' }).click(); assert.equal(await barVisible(p), true, 'bar after Reset');
  await p.getByRole('button', { name: 'Apply' }).click(); await p.waitForTimeout(300); assert.equal(await barVisible(p), false, 'bar hidden after Apply');
});

test('Scroll: Appearance and General pages also keep position when a control changes', async (t) => {
  const p = await t.newPage({ viewport: { width: 1280, height: 800 } }); await open(p, 'settings/appearance'); await p.waitForSelector('main select');
  const sels = p.locator('main select'); const n = await sels.count(); assert.ok(n > 0);
  const sel = sels.nth(n - 1); await scrollTo(p, sel); const y0 = await topOf(sel); const opts = await sel.locator('option').evaluateAll((o) => o.map((x) => x.value)); await sel.selectOption(opts[opts.length - 1]); await p.waitForTimeout(400);
  const after = await topOf(p.locator('main select').nth(n - 1)); assert.ok(Math.abs(after - y0) <= 2, `appearance dropdown moved: ${y0} -> ${after}`);
});
