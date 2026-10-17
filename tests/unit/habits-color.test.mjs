import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, isScheduled, todayState, scheduleOn } from '../../public/js/core/habits.js';
import { contrast, randomPalette, rng, ensureContrast, hexToHsl, hslToHex, readableOn } from '../../public/js/core/color.js';

const daily = (start, extra = {}) => ({ startDate: start, schedule: { type: 'daily', days: [], perWeek: 3 }, scheduleHistory: [], ...extra });

test('daily streak counts consecutive days and tolerates an open today', () => {
  const h = daily('2026-10-01');
  const s = computeStats(h, ['2026-10-10', '2026-10-11', '2026-10-12'], '2026-10-13');
  assert.equal(s.current, 3);
  assert.equal(s.longest, 3);
});
test('a missed scheduled day breaks the current streak but keeps longest and total', () => {
  const h = daily('2026-10-01');
  const logs = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-06', '2026-10-07'];
  const s = computeStats(h, logs, '2026-10-07');
  assert.equal(s.longest, 4);
  assert.equal(s.current, 2);
  assert.equal(s.total, 6);
});
test('specific weekdays: unscheduled days never break the streak', () => {
  const h = { startDate: '2026-10-05', schedule: { type: 'days', days: [1, 3], perWeek: 3 }, scheduleHistory: [] }; // Mon, Wed
  const s = computeStats(h, ['2026-10-05', '2026-10-07', '2026-10-12'], '2026-10-13'); // Tue 13th
  assert.equal(s.current, 3);
  assert.equal(isScheduled(h, '2026-10-06'), false);
});
test('weekly habit counts weeks that met the target', () => {
  const h = { startDate: '2026-09-28', schedule: { type: 'weekly', days: [], perWeek: 2 }, scheduleHistory: [] };
  const logs = ['2026-09-28', '2026-09-30', '2026-10-05', '2026-10-06']; // two full weeks
  const s = computeStats(h, logs, '2026-10-08');
  assert.equal(s.unit, 'week');
  assert.equal(s.current, 2);
});
test('editing the schedule does not rewrite history', () => {
  const h = {
    startDate: '2026-10-01', schedule: { type: 'days', days: [1], perWeek: 3 },
    scheduleHistory: [{ from: '2026-10-01', schedule: { type: 'daily', days: [], perWeek: 3 } }, { from: '2026-10-10', schedule: { type: 'days', days: [1], perWeek: 3 } }],
  };
  assert.equal(scheduleOn(h, '2026-10-05').type, 'daily');
  assert.equal(scheduleOn(h, '2026-10-11').type, 'days');
  assert.equal(isScheduled(h, '2026-10-06'), true);   // Tuesday, daily era
  assert.equal(isScheduled(h, '2026-10-13'), false);  // Tuesday, Monday-only era
});
test('todayState for weekly shows progress', () => {
  const h = { startDate: '2026-09-01', schedule: { type: 'weekly', days: [], perWeek: 3 }, scheduleHistory: [] };
  const st = todayState(h, ['2026-10-12'], '2026-10-13');
  assert.deepEqual(st.progress, { done: 1, target: 3 });
});

test('contrast ratio matches WCAG reference values', () => {
  assert.ok(Math.abs(contrast('#000000', '#ffffff') - 21) < 0.01);
  assert.ok(Math.abs(contrast('#777777', '#ffffff') - 4.48) < 0.05);
});
test('hsl round trip', () => assert.equal(hslToHex(hexToHsl('#3b82f6')), '#3b82f6'));
test('ensureContrast reaches the target or falls back to black/white', () => {
  assert.ok(contrast(ensureContrast('#777788', '#ffffff', 4.5), '#ffffff') >= 4.5);
  assert.ok(contrast(ensureContrast('#222233', '#101020', 4.5), '#101020') >= 4.5);
});
test('1000 random palettes are all readable in both modes', () => {
  const r = rng(12345);
  for (let i = 0; i < 1000; i++) {
    const p = randomPalette(r);
    for (const m of ['light', 'dark']) {
      const t = p[m];
      assert.ok(contrast(t.primary, t.glass) >= 4.5, `primary/glass ${m} ${JSON.stringify(t)}`);
      assert.ok(contrast(t.accent, t.glass) >= 4.5, `accent/glass ${m}`);
      const text = readableOn(t.primary);
      assert.ok(contrast(text, t.primary) >= 4.5, `button text ${m}`);
    }
  }
});
test('seeded rng is reproducible', () => {
  assert.deepEqual(randomPalette(rng(7)), randomPalette(rng(7)));
});
