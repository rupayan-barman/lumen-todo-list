// End-to-end rules for Task Lock, run against the REAL services on an in-memory database with a fake clock.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = { addEventListener() {}, visibilityState: 'visible' };
globalThis.window = { addEventListener() {} };

const { app } = await import('../../public/js/services/ctx.js');
const { createStore } = await import('../../public/js/core/store.js');
const { createMemoryAdapter } = await import('../../public/js/core/db.js');
const { clock } = await import('../../public/js/core/clock.js');
const Tasks = await import('../../public/js/services/tasks.js');
const Focus = await import('../../public/js/services/focus.js');
const { undo } = await import('../../public/js/services/undo.js');

const MIN = 60_000;
const T0 = new Date(2026, 9, 13, 9, 0, 0).getTime();
let t = T0;

async function fresh() {
  t = T0;
  clock.set(() => t);
  app.db = createMemoryAdapter();
  app.store = createStore({ db: app.db, bus: app.bus });
  await app.store.init();
  undo.clear();
  Focus.stopAll();
}
test.afterEach(() => { Focus.stopAll(); });

/** Move time forward the way a live, open app experiences it: a heartbeat every 15 s. */
async function advance(ms) {
  const end = t + ms;
  while (t < end) { t = Math.min(end, t + 15_000); await Focus.check(); }
}

const timedTask = (o = {}) => Tasks.createTask({ title: 'Study maths', focus: { enabled: true, durationMin: 25 }, ...o });

test('normal tasks complete any time, no timer needed', async () => {
  await fresh();
  const a = await Tasks.createTask({ title: 'Email' });
  const r = await Tasks.completeTask(a.id);
  assert.equal(r.task.status, 'done');
  assert.ok(r.task.completedAt);
});

test('starting focus locks completion; it unlocks exactly when the session ends; it never auto-completes', async () => {
  await fresh();
  const a = await timedTask();
  await Focus.startFocusForTask(a.id);
  await advance(10 * MIN);
  await assert.rejects(() => Tasks.completeTask(a.id), (e) => e.name === 'TaskLockedError' && e.remainingMs === 15 * MIN);
  await assert.rejects(() => Tasks.updateTask(a.id, { status: 'done' }), /locked/);
  const bulk = await Tasks.bulkComplete([a.id]);
  assert.deepEqual(bulk, { done: 0, skipped: ['Study maths'] });

  await advance(15 * MIN); // reaches the target exactly
  const s = app.store.all('sessions')[0];
  assert.equal(s.status, 'completed');
  assert.equal(app.store.get('tasks', a.id).status, 'todo', 'timer end must not complete the task');
  assert.equal(Tasks.canComplete(app.store.get('tasks', a.id)).ok, true);
  const r = await Tasks.completeTask(a.id);
  assert.equal(r.task.status, 'done');
});

test('time spent is the observed focus time, not the planned duration', async () => {
  await fresh();
  const a = await timedTask();
  await Focus.startFocusForTask(a.id);
  await advance(5 * MIN);                 // app open for 5 minutes: heartbeats every 15 s
  t += 20 * MIN;                          // app "closed": no heartbeats for 20 min until target
  await Focus.check();                    // recovery after reopening
  const s = app.store.all('sessions')[0];
  assert.equal(s.status, 'completed');
  assert.equal(s.plannedMs, 25 * MIN);
  assert.equal(s.activeMs, 25 * MIN);
  assert.equal(s.unobservedMs, 20 * MIN);
  assert.equal(Focus.taskTimeMs(app.store.get('tasks', a.id)), 5 * MIN);
});

test('emergency interrupt releases the lock, records the reason, and credits only what elapsed', async () => {
  await fresh();
  const a = await timedTask();
  await Focus.startFocusForTask(a.id);
  await advance(3 * MIN);
  await Focus.interrupt('urgent call');
  const s = app.store.all('sessions')[0];
  assert.equal(s.status, 'interrupted');
  assert.equal(s.interruptReason, 'urgent call');
  assert.equal(s.activeMs, 3 * MIN);
  assert.equal(Focus.taskTimeMs(app.store.get('tasks', a.id)), 3 * MIN);
  assert.equal(Tasks.canComplete(app.store.get('tasks', a.id)).ok, true);
  const hist = Tasks.historyFor(a.id).map((h) => h.type);
  assert.ok(hist.includes('focus-start') && hist.includes('focus-interrupted'));
  assert.equal(app.store.get('kv', 'lock:active'), undefined);
});

test('only one session can be open; no accidental duplicates', async () => {
  await fresh();
  const a = await timedTask();
  const b = await timedTask({ title: 'Other' });
  await Focus.startFocusForTask(a.id);
  await assert.rejects(() => Focus.startFocusForTask(b.id), /already running/);
  await assert.rejects(() => Focus.startStopwatch(), /already running/);
  assert.equal(app.store.all('sessions').length, 1);
});

test('locked sessions cannot be paused or stopped normally', async () => {
  await fresh();
  const a = await timedTask();
  await Focus.startFocusForTask(a.id);
  await assert.rejects(() => Focus.pause(), /cannot be paused/);
  await assert.rejects(() => Focus.stop(), /locked/);
});

test('a task with an open session cannot be deleted', async () => {
  await fresh();
  const a = await timedTask();
  await Focus.startFocusForTask(a.id);
  await assert.rejects(() => Tasks.deleteTasks([a.id]), (e) => e.name === 'TaskBusyError');
  assert.ok(app.store.get('tasks', a.id));
});

test('normal tasks cannot start a focus session', async () => {
  await fresh();
  const a = await Tasks.createTask({ title: 'Plain' });
  await assert.rejects(() => Focus.startFocusForTask(a.id), /normal task/);
});

test('session survives a "restart" (new store over the same database) and is still locked', async () => {
  await fresh();
  const a = await timedTask();
  await Focus.startFocusForTask(a.id);
  t += 2 * MIN;
  // simulate browser restart: new in-memory cache, same persisted data
  app.store = createStore({ db: app.db, bus: app.bus });
  await app.store.init();
  await Focus.init();
  const s = Focus.active();
  assert.ok(s && s.status === 'running');
  assert.equal(Focus.engine.remainingMs(s, t), 23 * MIN);
  assert.equal(Tasks.canComplete(app.store.get('tasks', a.id)).ok, false);
});

test('stale lock record is healed', async () => {
  await fresh();
  await app.store.put('kv', { key: 'lock:active', value: { sessionId: 'sess_ghost' } });
  await Focus.check();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(app.store.get('kv', 'lock:active'), undefined);
});

test('countdown pause/resume is stable and stopwatch works', async () => {
  await fresh();
  await Focus.startCountdown({ minutes: 10, label: 'tea' });
  t += 4 * MIN; await Focus.pause();
  t += 60 * MIN; await Focus.resume();
  assert.equal(Focus.engine.remainingMs(Focus.active(), t), 6 * MIN);
  t += 6 * MIN; await Focus.check();
  assert.equal(app.store.all('sessions')[0].status, 'completed');
  await Focus.startStopwatch({ label: 'read' });
  t += 7 * MIN; await Focus.stop();
  assert.equal(app.store.all('sessions').find((s) => s.kind === 'stopwatch').activeMs, 7 * MIN);
});

test('recurring task: completing creates exactly one next occurrence, undo removes it', async () => {
  await fresh();
  const a = await Tasks.createTask({ title: 'Water plants', deadline: '2026-10-13', recurrence: { freq: 'daily', interval: 1, byWeekday: [], endDate: null, count: null } });
  const r = await Tasks.completeTask(a.id);
  assert.equal(r.next.deadline, '2026-10-14');
  await Tasks.completeTask(a.id); // second click: no duplicate
  assert.equal(app.store.all('tasks').filter((x) => x.title === 'Water plants').length, 2);
  await undo.run();
  assert.equal(app.store.get('tasks', a.id).status, 'todo');
  assert.equal(app.store.all('tasks').length, 1);
});

test('delete + undo restores the task and bulk edit + undo restores values', async () => {
  await fresh();
  const a = await Tasks.createTask({ title: 'A', priority: 'low' });
  const b = await Tasks.createTask({ title: 'B', priority: 'low' });
  await Tasks.bulkPatch([a.id, b.id], { priority: 'high' }, 'set priority');
  assert.equal(app.store.get('tasks', a.id).priority, 'high');
  await undo.run();
  assert.equal(app.store.get('tasks', a.id).priority, 'low');
  await Tasks.deleteTasks([a.id, b.id]);
  assert.equal(app.store.count('tasks'), 0);
  await undo.run();
  assert.equal(app.store.count('tasks'), 2);
  assert.ok(Tasks.historyFor(a.id).some((h) => h.type === 'deleted') && Tasks.historyFor(a.id).some((h) => h.type === 'restored'));
});

test('duplicate resets state; invalid input is rejected with field errors', async () => {
  await fresh();
  const a = await Tasks.createTask({ title: 'Orig', subtasks: [{ id: 's1', title: 'x', done: true }] });
  await Tasks.completeTask(a.id);
  const d = await Tasks.duplicateTask(a.id);
  assert.equal(d.status, 'todo');
  assert.equal(d.subtasks[0].done, false);
  assert.notEqual(d.subtasks[0].id, 's1');
  await assert.rejects(() => Tasks.createTask({ title: '' }), (e) => e.name === 'ValidationError' && e.errors[0].path === 'title');
});
