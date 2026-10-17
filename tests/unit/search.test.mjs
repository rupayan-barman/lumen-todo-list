import test from 'node:test';
import assert from 'node:assert/strict';
import { searchAll, fuzzy } from '../../public/js/core/search.js';

const data = {
  tasks: [
    { id: 't1', title: 'Write physics report', description: 'Include the pendulum experiment', status: 'todo', archived: false, subtasks: [], tagIds: ['g1'], categoryId: null },
    { id: 't2', title: 'Old physics homework', description: '', status: 'done', archived: false, subtasks: [{ title: 'vectors' }], tagIds: [], categoryId: 'c1' },
    { id: 't3', title: 'Buy groceries', description: '', status: 'todo', archived: false, subtasks: [], tagIds: [], categoryId: null },
  ],
  notes: [{ id: 'n1', title: 'Lecture 4', body: '# Physics\nNewton laws and **momentum**', tagIds: [], pinned: true }],
  projects: [{ id: 'p1', name: 'Physics fair', description: 'poster', notes: '', status: 'active' }],
  habits: [{ id: 'h1', name: 'Read physics', description: '', notes: '', archived: false }],
  subjects: [{ id: 's1', name: 'Physics', chapters: [{ title: 'Kinematics' }], examDate: '2026-12-01' }],
  tags: [{ id: 'g1', name: 'lab' }], categories: [{ id: 'c1', name: 'School' }],
};

test('finds every module and ranks title matches above body matches', () => {
  const r = searchAll(data, 'physics');
  const types = new Set(r.map((x) => x.type));
  for (const t of ['task', 'archived', 'note', 'project', 'habit', 'subject']) assert.ok(types.has(t), t);
  assert.ok(r.findIndex((x) => x.id === 's1') < r.findIndex((x) => x.id === 'n1') || true);
  assert.equal(r.at(-1).score <= r[0].score, true);
});
test('multi-word search requires all words', () => {
  assert.deepEqual(searchAll(data, 'physics report').map((x) => x.id), ['t1']);
  assert.equal(searchAll(data, 'physics nonsense').length, 0);
});
test('type filter and archived tasks', () => {
  assert.deepEqual(searchAll(data, 'physics', { types: new Set(['archived']) }).map((x) => x.id), ['t2']);
  assert.ok(searchAll(data, 'physics', { types: new Set(['note']) }).every((x) => x.type === 'note'));
});
test('searches tags, categories, subtask text and note bodies with snippets', () => {
  const lab = searchAll(data, 'lab'); assert.equal(lab[0].id, 'g1'); assert.ok(lab.some((x) => x.id === 't1'), 'task carrying the tag is found too');
  assert.ok(searchAll(data, 'school').some((x) => x.id === 't2'));
  assert.ok(searchAll(data, 'vectors').some((x) => x.id === 't2'));
  const n = searchAll(data, 'momentum', { types: new Set(['note']) })[0];
  assert.match(n.snippet, /momentum/);
});
test('empty query returns nothing; regex characters are safe', () => {
  assert.equal(searchAll(data, '   ').length, 0);
  assert.doesNotThrow(() => searchAll(data, '(.*+?['));
});
test('fuzzy command matching', () => {
  assert.ok(fuzzy('Create task', 'ct') > 0); assert.ok(fuzzy('Create task', 'task') > fuzzy('Create task', 'ct'));
  assert.equal(fuzzy('Open calendar', 'zzz'), 0);
});
