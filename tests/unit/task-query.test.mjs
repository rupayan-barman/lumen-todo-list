import test from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../../public/js/core/task-query.js';
import { normalizeRecord } from '../../public/js/core/validate.js';
import { taskEntity } from '../../public/js/core/entities.js';
import { toEpoch } from '../../public/js/core/util.js';

let n = 0;
const mk = (o = {}) => normalizeRecord(taskEntity, { id: `t${++n}`, title: 'x', createdAt: n, updatedAt: n, order: n, ...o }, { repair: true }).value;
const NOW = toEpoch('2026-10-13', '12:00');

test('overdue: past date, or today with a passed time; never when done', () => {
  assert.equal(Q.isOverdue(mk({ deadline: '2026-10-12' }), NOW), true);
  assert.equal(Q.isOverdue(mk({ deadline: '2026-10-13', deadlineTime: '09:00' }), NOW), true);
  assert.equal(Q.isOverdue(mk({ deadline: '2026-10-13', deadlineTime: '18:00' }), NOW), false);
  assert.equal(Q.isOverdue(mk({ deadline: '2026-10-13' }), NOW), false); // all-day: due until 23:59
  assert.equal(Q.isOverdue(mk({ deadline: '2026-10-01', status: 'done' }), NOW), false);
  assert.equal(Q.isOverdue(mk({}), NOW), false);
});
test('active vs archive scope: done tasks live in the archive', () => {
  const a = mk(), b = mk({ status: 'done' }), c = mk({ archived: true });
  assert.deepEqual(Q.filterTasks([a, b, c], { scope: 'active' }, {}, NOW).map((t) => t.id), [a.id]);
  assert.deepEqual(Q.filterTasks([a, b, c], { scope: 'archive' }, {}, NOW).map((t) => t.id).sort(), [b.id, c.id].sort());
});
test('text search covers title, description, subtasks, tag and category names', () => {
  const t = mk({ title: 'Buy milk', description: 'organic', subtasks: [{ id: 's1', title: 'oat variant', done: false }], tagIds: ['tag_a'], categoryId: 'cat_a' });
  const lk = { tags: new Map([['tag_a', { name: 'errand' }]]), categories: new Map([['cat_a', { name: 'Home' }]]) };
  for (const q of ['milk', 'ORGANIC', 'oat', 'errand', 'home', 'milk errand']) assert.equal(Q.matchesText(t, q, lk), true, q);
  assert.equal(Q.matchesText(t, 'milk bread', lk), false);
});
test('filters combine: priority + tag (all) + due', () => {
  const a = mk({ priority: 'high', tagIds: ['x', 'y'], deadline: '2026-10-13' });
  const b = mk({ priority: 'high', tagIds: ['x'], deadline: '2026-10-13' });
  const c = mk({ priority: 'low', tagIds: ['x', 'y'], deadline: '2026-10-13' });
  const r = Q.filterTasks([a, b, c], { priorities: ['high'], tagIds: ['x', 'y'], due: 'today' }, {}, NOW);
  assert.deepEqual(r.map((t) => t.id), [a.id]);
});
test('sort by priority then nearest deadline; no-deadline last', () => {
  const a = mk({ priority: 'low', deadline: '2026-10-14' });
  const b = mk({ priority: 'critical' });
  const c = mk({ priority: 'high', deadline: '2026-10-20' });
  const d = mk({ priority: 'high', deadline: '2026-10-15' });
  assert.deepEqual(Q.sortTasks([a, b, c, d], 'priority').map((t) => t.id), [b.id, d.id, c.id, a.id]);
  assert.deepEqual(Q.sortTasks([c, a, b], 'deadline').map((t) => t.id), [a.id, c.id, b.id]);
});
test('scheduling conflicts detect overlaps on the same day only', () => {
  const a = mk({ scheduledDate: '2026-10-13', scheduledTime: '10:00', estimateMin: 60 });
  const b = mk({ scheduledDate: '2026-10-13', scheduledTime: '10:30', estimateMin: 30 });
  const c = mk({ scheduledDate: '2026-10-13', scheduledTime: '11:00', estimateMin: 30 }); // starts when a ends
  const d = mk({ scheduledDate: '2026-10-14', scheduledTime: '10:00', estimateMin: 60 });
  assert.deepEqual(Q.conflictsFor(a, [a, b, c, d]).map((t) => t.id), [b.id]);
  const m = Q.conflictMap([a, b, c, d]);
  assert.deepEqual(m.get(a.id), [b.id]);
  assert.equal(m.has(c.id), false);
  assert.equal(m.has(d.id), false);
});
test('completed tasks do not conflict', () => {
  const a = mk({ scheduledDate: '2026-10-13', scheduledTime: '10:00', estimateMin: 60 });
  const b = mk({ scheduledDate: '2026-10-13', scheduledTime: '10:15', estimateMin: 30, status: 'done' });
  assert.equal(Q.conflictsFor(a, [a, b]).length, 0);
});
test('subtask progress', () => {
  const t = mk({ subtasks: [{ id: 'a', title: 'a', done: true }, { id: 'b', title: 'b', done: false }, { id: 'c', title: 'c', done: false }] });
  assert.deepEqual(Q.subtaskProgress(t), { done: 1, total: 3, pct: 33 });
});
test('every priority has a distinct glyph and label (not colour alone)', () => {
  assert.equal(new Set(Object.values(Q.PRIORITY_GLYPH)).size, 4);
  assert.equal(new Set(Object.values(Q.PRIORITY_LABEL)).size, 4);
});
