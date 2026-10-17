import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBackup, parseBackup, planImport, BACKUP_STORES } from '../../public/js/core/backup.js';
import { normalizeRecord } from '../../public/js/core/validate.js';
import { ENTITIES } from '../../public/js/core/entities.js';

const mk = (store, raw) => normalizeRecord(ENTITIES[store], { ...raw }, { repair: true }).value;
const task = (id, title) => mk('tasks', { id, title, createdAt: 1000, updatedAt: 1000 });
const stores = (o) => ({ ...Object.fromEntries(BACKUP_STORES.map((s) => [s, []])), ...o });

test('build excludes transient kv keys and records counts', () => {
  const b = buildBackup({ stores: stores({ kv: [{ key: 'lock:active', value: 1 }, { key: 'x', value: 2 }], tasks: [task('t_1', 'A')] }), prefs: {}, now: 5 });
  assert.equal(b.stores.kv.length, 1); assert.equal(b.counts.tasks, 1); assert.equal(b.encrypted, false);
});
test('parse rejects garbage, wrong format, newer versions', () => {
  assert.equal(parseBackup('').ok, false);
  assert.equal(parseBackup('{nope').ok, false);
  assert.equal(parseBackup('{"format":"other"}').ok, false);
  assert.match(parseBackup(JSON.stringify({ format: 'lumen-backup', formatVersion: 99, stores: {} })).error, /newer/);
  assert.equal(parseBackup(JSON.stringify({ format: 'lumen-backup', formatVersion: 1, stores: { tasks: 'x' } })).ok, false);
});
test('parse strips prototype pollution keys', () => {
  const p = parseBackup('{"format":"lumen-backup","formatVersion":1,"dbVersion":2,"stores":{"tasks":[]},"__proto__":{"evil":1},"constructor":{"x":1}}');
  assert.equal(p.ok, true); assert.equal({}.evil, undefined); assert.equal(Object.hasOwn(p.data, '__proto__'), false);
});
test('round trip: nothing to do when data already present', () => {
  const t = task('t_1', 'A');
  const b = parseBackup(JSON.stringify(buildBackup({ stores: stores({ tasks: [t] }), now: 1 }))).data;
  const plan = planImport(b, { tasks: new Map([['t_1', t]]) });
  assert.equal(plan.writes.length, 0); assert.equal(plan.report.same, 1);
});
test('merge-keep never overwrites; merge-overwrite does; replace clears', () => {
  const mine = task('t_1', 'Mine'); const theirs = { ...task('t_1', 'Theirs') };
  const b = parseBackup(JSON.stringify(buildBackup({ stores: stores({ tasks: [theirs, task('t_2', 'New')] }), now: 1 }))).data;
  const ex = { tasks: new Map([['t_1', mine]]) };
  const keep = planImport(b, ex, 'merge-keep'); assert.deepEqual(keep.writes.map((w) => w.record.id), ['t_2']); assert.equal(keep.report.conflict, 1);
  const ow = planImport(b, ex, 'merge-overwrite'); assert.deepEqual(ow.writes.map((w) => w.record.id).sort(), ['t_1', 't_2']);
  const rep = planImport(b, ex, 'replace'); assert.ok(rep.clears.includes('tasks')); assert.equal(rep.writes.length, 2);
});
test('invalid and duplicate-id rows are skipped and reported, not thrown', () => {
  const b = { format: 'lumen-backup', formatVersion: 1, dbVersion: 2, stores: { tasks: [task('t_1', 'A'), task('t_1', 'B'), 'junk', null, { id: 5 }] } };
  const plan = planImport(parseBackup(JSON.stringify(b)).data, {});
  assert.equal(plan.writes.length, 1); assert.ok(plan.report.invalid >= 2);
});
test('content duplicates with different ids are flagged; habit log (habit,date) stays unique', () => {
  const mine = task('t_1', 'Same'); const theirs = task('t_9', 'Same');
  const l1 = mk('habitLogs', { id: 'log_1', habitId: 'habit_1', date: '2026-01-01' }); const l2 = mk('habitLogs', { id: 'log_2', habitId: 'habit_1', date: '2026-01-01' });
  const b = parseBackup(JSON.stringify(buildBackup({ stores: stores({ tasks: [theirs], habitLogs: [l2] }), now: 1 }))).data;
  const plan = planImport(b, { tasks: new Map([['t_1', mine]]), habitLogs: new Map([['log_1', l1]]) });
  assert.equal(plan.report.duplicates, 2); assert.ok(plan.writes.some((w) => w.store === 'tasks')); assert.ok(!plan.writes.some((w) => w.store === 'habitLogs'));
});
