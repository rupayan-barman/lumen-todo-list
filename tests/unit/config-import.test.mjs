import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseConfig, planConfig, configHash, problemLines } from '../../public/js/core/config-import.js';
import { EXAMPLE_CONFIG } from '../../public/js/data/config-guide.js';
import { docText } from '../../tools/gen-config-docs.mjs';
import { createStore } from '../../public/js/core/store.js';
import { createMemoryAdapter } from '../../public/js/core/db.js';
import { createBus } from '../../public/js/core/bus.js';

const cfg = (o) => ({ format: 'lumen-config', version: 1, ...o });
const plan = (o, existing = {}, opts = {}) => planConfig(cfg(o), existing, { today: '2026-11-01', ...opts });
const errs = (p) => problemLines(p, 'error');

test('example config validates with zero errors and creates every kind of item', () => {
  const p = planConfig(EXAMPLE_CONFIG, {}, { today: '2026-11-01' });
  assert.deepEqual(errs(p), []);
  assert.equal(p.ok, true);
  assert.equal(p.canImport, true);
  const kinds = new Set(p.writes.map((w) => w.kind));
  for (const k of ['categories', 'tags', 'projects', 'subjects', 'tasks', 'notes', 'habits']) assert.ok(kinds.has(k), k);
});
test('docs and example file are in sync with the guide source', () => {
  assert.equal(readFileSync(new URL('../../docs/JSON-IMPORT-GUIDE.md', import.meta.url), 'utf8'), docText());
  assert.deepEqual(JSON.parse(readFileSync(new URL('../../docs/example-config.json', import.meta.url), 'utf8')), EXAMPLE_CONFIG);
});

test('parse: invalid JSON gives a position and hint; code fences and BOM are tolerated; curly quotes explained', () => {
  const bad = parseConfig('{ "a": 1,\n "b": }');
  assert.equal(bad.ok, false); assert.match(bad.error, /not valid JSON/);
  assert.equal(parseConfig('﻿```json\n{"format":"lumen-config","version":1}\n```').ok, true);
  assert.match(parseConfig('{ “format”: 1 }').hint, /curly quotes/);
  assert.equal(parseConfig('   ').ok, false);
});
test('top level: wrong format/version, empty config, non-list sections', () => {
  assert.match(planConfig({ format: 'x', version: 1, tasks: [{ title: 'a' }] }).topErrors[0], /format/);
  assert.ok(planConfig({ format: 'lumen-config', tasks: [{ title: 'a' }] }).topErrors.some((e) => /version/.test(e)));
  assert.ok(planConfig({ format: 'lumen-config', version: 2, tasks: [{ title: 'a' }] }).topErrors.some((e) => /newer/.test(e)));
  assert.ok(plan({}).topErrors.some((e) => /no items/.test(e)));
  assert.ok(plan({ tasks: {} }).topErrors.some((e) => /must be a list/.test(e)));
  assert.ok(plan({ tasks: [{ title: 'a' }], bogus: 1 }).topWarnings.some((w) => /bogus/.test(w)));
});

test('task: validates dates, times, enums and types with readable item + field messages', () => {
  const p = plan({ tasks: [
    { title: 'Bad date', deadline: '2026-02-31' },
    { title: 'Bad time', scheduledDate: '2026-11-02', scheduledTime: '25:00' },
    { title: 'Bad prio', priority: 'urgent' },
    { title: 'Time w/o date', scheduledTime: '10:00' },
    { title: 'Order', startDate: '2026-11-10', deadline: '2026-11-01' },
    { title: 42 },
    { title: '   ' },
    { title: 'Bad estimate', estimateMin: 'ten' },
    'not an object',
  ] });
  const lines = errs(p);
  assert.equal(p.ok, false); assert.equal(p.canImport, false);
  assert.ok(lines.some((l) => /Task #1 “Bad date” → deadline/.test(l)), lines.join('\n'));
  assert.ok(lines.some((l) => /Task #2 .*scheduledTime/.test(l)));
  assert.ok(lines.some((l) => /Task #3 .*priority: must be one of/.test(l)));
  assert.ok(lines.some((l) => /Task #4 .*scheduledTime/.test(l)));
  assert.ok(lines.some((l) => /Task #5 .*deadline/.test(l)));
  assert.ok(lines.some((l) => /Task #6.*title: must be text/.test(l)));
  assert.ok(lines.some((l) => /Task #7.*(title|Title)/.test(l)));
  assert.ok(lines.some((l) => /Task #8.*estimateMin: must be a number/.test(l)));
  assert.ok(lines.some((l) => /Task #9.*must be an object/.test(l)));
});
test('task defaults: priority medium, status todo, order increases after the existing maximum', () => {
  const p = plan({ tasks: [{ title: 'A' }, { title: 'B' }] }, { tasks: [{ id: 'task_x', title: 'old', order: 50 }] });
  const [a, b] = p.writes.map((w) => w.record);
  assert.equal(a.priority, 'medium'); assert.equal(a.status, 'todo'); assert.equal(a.order, 60); assert.equal(b.order, 70);
  assert.match(a.id, /^task_/);
});
test('task: status done gets completedAt; unknown fields are warnings, not errors', () => {
  const p = plan({ tasks: [{ title: 'Done one', status: 'done', mood: 'happy' }] });
  assert.equal(p.ok, true);
  assert.ok(p.writes[0].record.completedAt > 0);
  assert.ok(problemLines(p, 'warning').some((w) => /mood/.test(w)));
});
test('recurrence and focus: validated, with safe defaults', () => {
  const ok = plan({ tasks: [{ title: 'R', deadline: '2026-11-05', recurrence: { freq: 'weekly', byWeekday: [1, 3] }, focus: { enabled: true } }] });
  assert.equal(ok.ok, true, errs(ok).join('\n'));
  const r = ok.writes[0].record;
  assert.equal(r.recurrence.interval, 1); assert.deepEqual(r.recurrence.byWeekday, [1, 3]); assert.equal(r.focus.durationMin, 25); assert.equal(r.focus.enabled, true);
  const bad = plan({ tasks: [
    { title: 'no date', recurrence: { freq: 'daily' } },
    { title: 'bad freq', deadline: '2026-11-05', recurrence: { freq: 'hourly' } },
    { title: 'bad weekday', deadline: '2026-11-05', recurrence: { freq: 'weekly', byWeekday: [7] } },
    { title: 'bad focus', focus: { enabled: 'yes', durationMin: 5000 } },
    { title: 'no freq', deadline: '2026-11-05', recurrence: { interval: 2 } },
  ] });
  assert.equal(bad.summary.invalid, 5, errs(bad).join('\n'));
});

test('references: refs, names, auto-created labels, unknown project, bad column, column without project', () => {
  const p = plan({
    categories: [{ ref: 'c', name: 'Work' }],
    projects: [{ ref: 'p', name: 'Site', columns: ['Todo', { name: 'Shipped', done: true }] }],
    tasks: [
      { title: 'Good', category: 'c', tags: ['new-tag', 'New-Tag'], project: 'p', column: 'shipped' },
      { title: 'By name', category: 'WORK', project: 'Site' },
      { title: 'Bad project', project: 'nope' },
      { title: 'Bad column', project: 'p', column: 'Nope' },
      { title: 'Column only', column: 'Todo' },
    ],
  });
  const lines = errs(p);
  assert.ok(lines.some((l) => /Task #3.*project: no project with the ref or name “nope”/.test(l)));
  assert.ok(lines.some((l) => /Task #4.*column: the project has no column/.test(l)));
  assert.ok(lines.some((l) => /Task #5.*needs a "project"/.test(l)));
  const tasks = p.items.filter((e) => e.kind === 'tasks');
  const proj = p.items.find((e) => e.kind === 'projects').record;
  assert.equal(tasks[0].record.projectId, proj.id);
  assert.equal(tasks[0].record.columnId, proj.columns[1].id);
  assert.equal(tasks[0].record.categoryId, p.items.find((e) => e.kind === 'categories').id);
  assert.equal(tasks[1].record.categoryId, tasks[0].record.categoryId); // case-insensitive name reuse
  assert.equal(tasks[0].record.tagIds.length, 1);                      // New-Tag === new-tag
  assert.equal(tasks[1].record.columnId, proj.columns[0].id);          // default: first column
  assert.equal(p.counts.tags.implicit, 1);
});
test('references: existing categories/tags/projects are reused, never modified or duplicated', () => {
  const existing = {
    categories: [{ id: 'cat_1', name: 'Work', color: '#111111' }],
    projects: [{ id: 'proj_1', name: 'Site', columns: [{ id: 'col_a', name: 'Backlog', done: false }], milestones: [] }],
  };
  const p = plan({ categories: [{ name: 'work', color: '#ffffff' }], projects: [{ name: 'SITE', columns: ['X'] }], tasks: [{ title: 'T', category: 'Work', project: 'Site', column: 'Backlog' }] }, existing);
  assert.equal(p.ok, true, errs(p).join('\n'));
  assert.deepEqual(p.writes.map((w) => w.store), ['tasks']);
  assert.equal(p.writes[0].record.categoryId, 'cat_1'); assert.equal(p.writes[0].record.projectId, 'proj_1'); assert.equal(p.writes[0].record.columnId, 'col_a');
  assert.equal(p.summary.reuse, 2);
});
test('refs must be unique; duplicate names inside the file are errors', () => {
  const p = plan({ categories: [{ ref: 'a', name: 'One' }, { ref: 'a', name: 'Two' }, { name: 'one' }], projects: [{ name: 'P' }, { name: 'p' }] });
  const l = errs(p);
  assert.ok(l.some((x) => /ref: "a" is already used/.test(x)));
  assert.ok(l.some((x) => /appears twice/.test(x)));
  assert.equal(p.canImport, false);
});
test('dependency on an invalid item: dependents are skipped and nothing dangles', () => {
  const p = plan({ projects: [{ ref: 'p', name: '' }], tasks: [{ title: 'Child', project: 'p' }, { title: 'Fine' }], notes: [{ body: 'x', project: 'p' }] }, {}, { skipInvalid: true });
  assert.equal(p.canImport, true);
  assert.equal(p.items.find((e) => e.kind === 'tasks' && /Child/.test(e.label)).status, 'skipped');
  assert.equal(p.writes.length, 1);
  assert.equal(p.writes[0].record.title, 'Fine');
  const strict = plan({ projects: [{ ref: 'p', name: '' }], tasks: [{ title: 'Fine' }] });
  assert.equal(strict.canImport, false);
});
test('implicit labels are dropped when only failing items used them', () => {
  const p = plan({ tasks: [{ title: 'Bad', category: 'Ghost', deadline: 'nope' }, { title: 'Good' }] }, {}, { skipInvalid: true });
  assert.deepEqual(p.writes.map((w) => w.store), ['tasks']);
});

test('study: chapters/topics built, task links to subject chapter by title', () => {
  const p = plan({ subjects: [{ ref: 's', name: 'Bio', chapters: [{ title: 'Cells', plannedMin: 60, topics: ['a', { title: 'b', done: true }] }] }], tasks: [{ title: 'Read', subject: 's', chapter: 'cells' }, { title: 'X', subject: 's', chapter: 'zzz' }, { title: 'Y', chapter: 'Cells' }] });
  const subj = p.items.find((e) => e.kind === 'subjects').record;
  assert.equal(subj.chapters[0].topics.length, 2); assert.equal(subj.chapters[0].plannedMin, 60);
  assert.equal(p.items.find((e) => /Read/.test(e.label)).record.chapterId, subj.chapters[0].id);
  assert.equal(p.summary.invalid, 2);
});
test('habits: schedule + scheduleHistory, weekday validation, default start date', () => {
  const p = plan({ habits: [{ name: 'Gym', schedule: { type: 'days', days: [1, 3] } }, { name: 'Bad', schedule: { type: 'days', days: [] } }, { name: 'Bad2', schedule: { type: 'weekly', perWeek: 9 } }, { name: 'Bad3', reminderTime: '7am' }] });
  const gym = p.items[0].record;
  assert.equal(gym.startDate, '2026-11-01'); assert.deepEqual(gym.scheduleHistory, [{ from: '2026-11-01', schedule: gym.schedule }]);
  assert.equal(p.summary.invalid, 3, errs(p).join('\n'));
});
test('notes: need content; link to task by ref only; project/subject by ref or name', () => {
  const p = plan({ tasks: [{ ref: 't', title: 'Task' }], notes: [{ title: 'N', task: 't', pinned: true }, { title: '' }, { body: 'x', task: 'missing' }, { body: 'y', pinned: 'yes' }] });
  const n = p.items.filter((e) => e.kind === 'notes');
  assert.equal(n[0].status, 'new'); assert.equal(n[0].record.taskId, p.items[0].id); assert.equal(n[0].record.pinned, true);
  assert.equal(n[1].status, 'invalid'); assert.equal(n[2].status, 'invalid'); assert.equal(n[3].status, 'invalid');
});

test('duplicate detection: vs existing, within the file, with override; same config recognised', () => {
  const existing = { tasks: [{ id: 'task_1', title: 'Pay rent', deadline: '2026-11-30', scheduledDate: null, projectId: null, order: 1 }], habits: [{ id: 'h1', name: 'Gym' }], notes: [{ id: 'n1', title: 'T', body: 'B' }] };
  const input = { tasks: [{ title: 'pay RENT', deadline: '2026-11-30' }, { title: 'Pay rent', deadline: '2026-12-31' }, { title: 'Pay rent', deadline: '2026-12-31' }], habits: [{ name: 'gym' }], notes: [{ title: 't', body: 'b' }] };
  const p = plan(input, existing);
  assert.deepEqual(p.items.map((e) => e.status), ['duplicate', 'new', 'duplicate', 'duplicate', 'duplicate']);
  assert.equal(p.writes.length, 1);
  const all = plan(input, existing, { allowDuplicates: true });
  assert.equal(all.writes.length, 5);
  const h = configHash(cfg(input));
  assert.equal(plan(input, existing, { log: [{ hash: h, at: 5 }] }).previous.at, 5);
  assert.equal(configHash({ b: 1, a: 2 }), configHash({ a: 2, b: 1 }));
});

test('security: prototype pollution keys are stripped; script text stays plain text; size limits', () => {
  const parsed = parseConfig('{"format":"lumen-config","version":1,"__proto__":{"x":1},"tasks":[{"title":"<script>alert(1)</script>","constructor":{"a":1}}]}');
  assert.equal(parsed.ok, true);
  assert.equal(({}).x, undefined);
  const p = planConfig(parsed.config, {}, {});
  assert.equal(p.writes[0].record.title, '<script>alert(1)</script>'); // stored as data; the UI only ever renders text nodes
  assert.equal(parseConfig('x'.repeat(2 * 1024 * 1024 + 1)).ok, false);
  const many = plan({ tasks: Array.from({ length: 2001 }, (_, i) => ({ title: `t${i}` })) });
  assert.ok(many.topErrors.some((e) => /limit/.test(e)));
});

test('applying a plan through the real store is atomic and leaves existing data untouched', async () => {
  const db = createMemoryAdapter(); const store = createStore({ db, bus: createBus() }); await store.init();
  const mine = await store.put('tasks', { title: 'Existing' });
  const p = planConfig(EXAMPLE_CONFIG, Object.fromEntries(['categories', 'tags', 'projects', 'subjects', 'tasks', 'notes', 'habits'].map((k) => [k, store.all(k)])), { today: '2026-11-01' });
  await store.commit(p.writes.map((w) => ({ type: 'put', store: w.store, record: w.record })));
  assert.equal(store.get('tasks', mine.id).title, 'Existing');
  assert.equal(store.count('tasks'), 4); assert.equal(store.count('habits'), 3); assert.equal(store.count('projects'), 1);
  assert.equal(store.health.quarantined, 0);
  // a second plan against the new state finds everything already present
  const again = planConfig(EXAMPLE_CONFIG, Object.fromEntries(['categories', 'tags', 'projects', 'subjects', 'tasks', 'notes', 'habits'].map((k) => [k, store.all(k)])), { today: '2026-11-01' });
  assert.equal(again.writes.length, 0); assert.equal(again.canImport, false);
  // an invalid write aborts the whole batch
  const before = store.count('tasks');
  await assert.rejects(store.commit([{ type: 'put', store: 'tasks', record: { title: 'ok' } }, { type: 'put', store: 'tasks', record: { title: '' } }]));
  assert.equal(store.count('tasks'), before);
});
