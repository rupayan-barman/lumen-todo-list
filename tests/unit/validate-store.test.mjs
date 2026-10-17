import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRecord, sanitizeJson, normHex } from '../../public/js/core/validate.js';
import { taskEntity } from '../../public/js/core/entities.js';
import { createStore } from '../../public/js/core/store.js';
import { createMemoryAdapter } from '../../public/js/core/db.js';
import { createBus } from '../../public/js/core/bus.js';
import { migrateRecord } from '../../public/js/core/schema.js';

const strict = (o) => normalizeRecord(taskEntity, o, { repair: false });
const repair = (o) => normalizeRecord(taskEntity, o, { repair: true });

test('strict mode reports clear errors', () => {
  const r = strict({ id: 'task_1', title: '   ', priority: 'urgent', deadline: '2026-02-31' });
  assert.equal(r.ok, false);
  const paths = r.errors.map((e) => e.path);
  assert.ok(paths.includes('title') && paths.includes('priority') && paths.includes('deadline'));
});
test('valid task passes and gets defaults', () => {
  const r = strict({ id: 'task_1', title: ' Hello ', deadline: '2026-05-01' });
  assert.equal(r.ok, true);
  assert.equal(r.value.title, 'Hello');
  assert.equal(r.value.priority, 'medium');
  assert.deepEqual(r.value.subtasks, []);
});
test('deadline before start is rejected; time without date is rejected', () => {
  assert.equal(strict({ id: 'a', title: 'x', startDate: '2026-05-10', deadline: '2026-05-01' }).ok, false);
  assert.equal(strict({ id: 'a', title: 'x', scheduledTime: '10:00' }).ok, false);
});
test('recurring task needs a date', () => {
  assert.equal(strict({ id: 'a', title: 'x', recurrence: { freq: 'daily', interval: 1 } }).ok, false);
  assert.equal(strict({ id: 'a', title: 'x', deadline: '2026-01-01', recurrence: { freq: 'daily', interval: 1 } }).ok, true);
});
test('repair mode salvages a corrupted record instead of throwing', () => {
  const r = repair({ id: 'task_9', title: 42, priority: 'nope', tagIds: 'bad', subtasks: [{ id: 's1', title: 'ok' }, null, 7], estimateMin: -5, focus: 'x' });
  assert.equal(r.ok, true);
  assert.equal(r.value.priority, 'medium');
  assert.deepEqual(r.value.tagIds, []);
  assert.equal(r.value.estimateMin, 0);
  assert.ok(r.warnings.length > 0);
});
test('record without a key is unusable even in repair mode', () => {
  assert.equal(repair({ title: 'x' }).ok, false);
  assert.equal(repair('nonsense').ok, false);
});
test('control characters are stripped from one-line text', () => {
  assert.equal(strict({ id: 'a', title: 'a\u0000b\nc' }).value.title, 'a b c');
});
test('sanitizeJson drops prototype pollution keys and non-JSON values', () => {
  const evil = JSON.parse('{"__proto__":{"x":1},"a":{"constructor":{"y":1},"b":2},"f":null}');
  const clean = sanitizeJson({ ...evil, fn() {} });
  assert.equal(Object.prototype.x, undefined);
  assert.equal(clean.a.b, 2);
  assert.equal('constructor' in clean.a && Object.hasOwn(clean.a, 'constructor'), false);
  assert.equal(Object.hasOwn(clean, 'fn'), false);
});
test('sanitizeJson enforces depth', () => {
  let o = {}; let c = o; for (let i = 0; i < 30; i++) { c.n = {}; c = c.n; }
  assert.throws(() => sanitizeJson(o, { maxDepth: 10 }));
});
test('normHex', () => {
  assert.equal(normHex('#ABC'), '#aabbcc');
  assert.equal(normHex('red'), null);
  assert.equal(normHex('#12345'), null);
});

async function mkStore() {
  const db = createMemoryAdapter();
  const store = createStore({ db, bus: createBus() });
  await store.init();
  return { db, store };
}

test('store writes through to the db before the cache and validates', async () => {
  const { db, store } = await mkStore();
  const t = await store.put('tasks', { title: 'Write tests' });
  assert.ok(t.id.startsWith('task_'));
  assert.equal(store.get('tasks', t.id).title, 'Write tests');
  assert.equal((await db.getAll('tasks')).length, 1);
  await assert.rejects(() => store.put('tasks', { title: '' }), /required/);
  assert.equal(store.count('tasks'), 1);
});
test('a failed batch leaves neither db nor cache changed (atomic)', async () => {
  const { db, store } = await mkStore();
  const a = await store.put('tasks', { title: 'A' });
  await assert.rejects(() => store.commit([
    { type: 'put', store: 'tasks', record: { id: a.id, title: 'A2' } },
    { type: 'put', store: 'tasks', record: { title: '' } },
  ]));
  assert.equal(store.get('tasks', a.id).title, 'A');
  assert.equal((await db.getAll('tasks'))[0].title, 'A');
});
test("'add' refuses duplicates (used to claim the single active timer)", async () => {
  const { store } = await mkStore();
  await store.commit([{ type: 'add', store: 'kv', record: { key: 'lock:active', value: { id: 's1' } } }]);
  await assert.rejects(() => store.commit([{ type: 'add', store: 'kv', record: { key: 'lock:active', value: { id: 's2' } } }]));
  assert.equal(store.kvGet('lock:active').id, 's1');
});
test('corrupted rows are quarantined, repaired rows are kept, nothing is silently dropped', async () => {
  const db = createMemoryAdapter();
  await db.batch([
    { type: 'put', store: 'tasks', record: { id: 'task_ok', title: 'fine' } },
    { type: 'put', store: 'tasks', record: { id: 'task_bad', title: 12345, priority: 'zzz' } },
    { type: 'put', store: 'tasks', record: { title: 'no id' } },
  ]).catch(() => {});
  // memory adapter keys by keyPath; insert the key-less row separately to simulate corruption
  const store = createStore({ db, bus: createBus() });
  const health = await store.init();
  assert.ok(store.get('tasks', 'task_ok'));
  assert.equal(store.get('tasks', 'task_bad').priority, 'medium');
  assert.ok(health.repaired >= 1);
  assert.ok(store.all('quarantine').length >= 1);
});
test('commits are serialised in order', async () => {
  const { store } = await mkStore();
  const t = await store.put('tasks', { title: 'v0' });
  await Promise.all([1, 2, 3, 4, 5].map((i) => store.put('tasks', { ...store.get('tasks', t.id), title: `v${i}` })));
  assert.equal(store.get('tasks', t.id).title, 'v5');
});
test('v1 task records are migrated to the v2 shape', () => {
  const m = migrateRecord('tasks', { id: 'x', title: 't', createdAt: 99 }, 1, 2);
  assert.equal(m.order, 99);
  assert.deepEqual(m.focus, { enabled: false, durationMin: 25 });
  assert.deepEqual(m.tagIds, []);
});
