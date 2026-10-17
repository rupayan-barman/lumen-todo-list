import test from 'node:test';
import assert from 'node:assert/strict';
import { nextOccurrence, buildNextInstance, expandOccurrences, stepDate } from '../../public/js/core/recurrence.js';

test('daily with interval', () => assert.equal(stepDate({ freq: 'daily', interval: 3 }, '2026-02-27'), '2026-03-02'));
test('monthly clamps then recovers to the anchor day (no drift)', () => {
  const rule = { freq: 'monthly', interval: 1, anchor: '2026-01-31' };
  assert.equal(stepDate(rule, '2026-01-31'), '2026-02-28');
  assert.equal(stepDate(rule, '2026-02-28'), '2026-03-31');
});
test('yearly handles Feb 29', () => {
  const rule = { freq: 'yearly', interval: 1, anchor: '2024-02-29' };
  assert.equal(stepDate(rule, '2024-02-29'), '2025-02-28');
  assert.equal(stepDate(rule, '2027-02-28'), '2028-02-29');
});
test('weekly on chosen weekdays', () => {
  const rule = { freq: 'weekly', interval: 1, byWeekday: [1, 3], anchor: '2026-10-12' }; // Mon
  assert.equal(stepDate(rule, '2026-10-12'), '2026-10-14'); // Wed
  assert.equal(stepDate(rule, '2026-10-14'), '2026-10-19'); // next Mon
});
test('weekly interval 2 skips a week', () => {
  const rule = { freq: 'weekly', interval: 2, byWeekday: [1], anchor: '2026-10-12' };
  assert.equal(stepDate(rule, '2026-10-12'), '2026-10-26');
});
test('end date and count stop the series', () => {
  assert.equal(nextOccurrence({ freq: 'daily', interval: 1, endDate: '2026-01-02' }, '2026-01-02'), null);
  assert.equal(nextOccurrence({ freq: 'daily', interval: 1, count: 3 }, '2026-01-02', 2), null);
  assert.equal(nextOccurrence({ freq: 'daily', interval: 1, count: 3 }, '2026-01-02', 1), '2026-01-03');
});
test('next instance shifts all dates, resets subtasks and links the series', () => {
  const n = buildNextInstance({
    id: 't1', startDate: '2026-03-01', deadline: '2026-03-03', scheduledDate: null, occurrence: 0, actualMs: 5,
    subtasks: [{ id: 's', title: 'x', done: true }], recurrence: { freq: 'weekly', interval: 1, byWeekday: [], endDate: null, count: null },
  });
  assert.equal(n.deadline, '2026-03-10');
  assert.equal(n.startDate, '2026-03-08');
  assert.equal(n.subtasks[0].done, false);
  assert.equal(n.actualMs, 0);
  assert.equal(n.seriesId, 't1');
  assert.equal(n.occurrence, 1);
});
test('expandOccurrences lists future dates in range only', () => {
  const t = { id: 'a', deadline: '2026-01-01', occurrence: 0, recurrence: { freq: 'daily', interval: 2, byWeekday: [], endDate: null, count: null } };
  const r = expandOccurrences(t, '2026-01-04', '2026-01-10').map((x) => x.date);
  assert.deepEqual(r, ['2026-01-05', '2026-01-07', '2026-01-09']);
});
