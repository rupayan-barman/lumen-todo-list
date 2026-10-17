import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../../public/js/core/stats.js';

const at = (d, h = 10) => new Date(`${d}T${String(h).padStart(2, '0')}:00:00`).getTime();
const sess = (d, activeMin, o = {}) => ({ kind: 'focus', phase: 'work', status: 'completed', startedAt: at(d), activeMs: activeMin * 60000, unobservedMs: 0, plannedMs: 25 * 60000, taskId: 't1', ...o });

test('daily totals use observed (credited) time and ignore pomodoro breaks and open sessions', () => {
  const m = S.focusByDay([sess('2026-10-13', 25), sess('2026-10-13', 5, { kind: 'pomodoro', phase: 'short' }), sess('2026-10-13', 10, { status: 'running' }), sess('2026-10-13', 25, { unobservedMs: 20 * 60000 })]);
  assert.equal(m.get('2026-10-13'), 30 * 60000);
});
test('series fills missing days with zero and has the requested length', () => {
  const s = S.dailySeries([sess('2026-10-12', 30)], 7, '2026-10-13');
  assert.equal(s.length, 7); assert.equal(s.at(-1).ms, 0); assert.equal(s.at(-2).ms, 30 * 60000); assert.equal(s[0].date, '2026-10-07');
});
test('planned vs actual keeps them separate', () => {
  const r = S.plannedVsActual([sess('2026-10-13', 10, { status: 'interrupted' }), sess('2026-10-13', 25)], (s) => s.taskId === 't1');
  assert.deepEqual(r, { planned: 50 * 60000, actual: 35 * 60000, count: 2 });
});
test('streak counts consecutive days, today optional', () => {
  const list = [sess('2026-10-11', 20), sess('2026-10-12', 20)];
  assert.equal(S.focusStreak(list, '2026-10-13'), 2);
  assert.equal(S.focusStreak([...list, sess('2026-10-13', 20)], '2026-10-13'), 3);
  assert.equal(S.focusStreak([sess('2026-10-10', 20)], '2026-10-13'), 0);
});
test('completions per day', () => {
  const m = S.completionsByDay([{ status: 'done', completedAt: at('2026-10-13') }, { status: 'done', completedAt: at('2026-10-13', 15) }, { status: 'todo', completedAt: null }]);
  assert.equal(m.get('2026-10-13'), 2);
});
