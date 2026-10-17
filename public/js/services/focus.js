// Focus / timer session lifecycle. Persisted timestamps are the source of truth (see core/timer-engine.js).
// Timers here (one setTimeout + one 15 s heartbeat) only TRIGGER re-evaluation; they never accumulate time.
//
// Invariants
//  * At most one open (running/paused) session, enforced by an atomic 'add' of kv key `lock:active`.
//  * Settling is idempotent: a session closes at its targetAt, and task time is DERIVED from closed
//    sessions, so two tabs settling the same session cannot double count.
import { app } from './ctx.js';
import { clock } from '../core/clock.js';
import * as E from '../core/timer-engine.js';
import { uid } from '../core/util.js';

const LOCK_KEY = 'lock:active';
const HEARTBEAT_MS = 15_000;
const st = () => app.store;

let timeout = null;
let beat = null;
let started = false;
let memo = { src: null, map: null };

export const active = () => st().all('sessions').find(E.isActive) || null;
export const closedSessions = () => st().all('sessions').filter((s) => !E.isActive(s));

/** Map taskId -> credited focus ms (closed sessions only). Memoised on the store snapshot. */
export function timeByTask() {
  const src = st().all('sessions');
  if (memo.src === src) return memo.map;
  const map = new Map();
  for (const s of src) {
    if (!s.taskId || E.isActive(s) || !E.countsAsFocus(s)) continue;
    map.set(s.taskId, (map.get(s.taskId) || 0) + E.creditedMs(s, 0));
  }
  memo = { src, map };
  return map;
}
/** Time spent on a task = manual adjustments + credited session time. */
export function taskTimeMs(task) {
  return (task.actualMs || 0) + (timeByTask().get(task.id) || 0);
}
export function subjectTimeMs(subjectId) {
  let n = 0;
  for (const s of st().all('sessions')) if (s.subjectId === subjectId && !E.isActive(s) && E.countsAsFocus(s)) n += E.creditedMs(s, 0);
  return n;
}

function sessionHistory(c) {
  if (!c.taskId || c.kind === 'stopwatch' && c.status === 'running') return null;
  const task = st().get('tasks', c.taskId);
  if (!task) return null;
  const type = c.status === 'interrupted' ? 'focus-interrupted' : 'focus-end';
  const mins = Math.floor(E.creditedMs(c, 0) / 60000);
  const detail = c.status === 'interrupted'
    ? `Interrupted after ${mins} min of observed focus${c.interruptReason ? `: ${c.interruptReason}` : ''}`
    : `${E.describeOutcome(c)} - ${mins} min of observed focus (planned ${Math.round(c.plannedMs / 60000)} min)`;
  return { type: 'put', store: 'taskHistory', record: { id: `hist_${c.id}_end`, taskId: c.taskId, title: task.title, type, detail, at: c.endedAt } };
}

async function persist(updated, { next = null, chain = [], quiet = false } = {}) {
  const ops = [];
  const closed = [updated, ...chain.filter((c) => !E.isActive(c))].filter((c) => !E.isActive(c));
  ops.push({ type: 'put', store: 'sessions', record: updated });
  for (const c of chain) ops.push({ type: 'put', store: 'sessions', record: c });
  if (next) {
    ops.push({ type: 'put', store: 'kv', record: { key: LOCK_KEY, value: { sessionId: next.id } } });
  } else if (!E.isActive(updated)) {
    ops.push({ type: 'delete', store: 'kv', key: LOCK_KEY });
  }
  if (!quiet) {
    for (const c of closed) {
      const h = sessionHistory(c);
      if (h) ops.push(h);
      if (c.status === 'completed' && c.phase !== 'short' && c.phase !== 'long' && E.countsAsFocus(c)) {
        ops.push({ type: 'put', store: 'notifications', record: { id: `notif_focus_${c.id}`, at: c.endedAt, type: 'focus', title: 'Session complete', body: c.label || 'Your timer finished.', link: '#/timer' } });
      }
    }
  }
  await st().commit(ops, { quiet });
  return closed;
}

function emitEnded(closed, late) {
  for (const c of closed) app.bus.emit('focus:ended', { session: c, late });
}

async function claimAndStart(session) {
  const open = active();
  if (open) throw new Error('A timer is already running. Stop or interrupt it before starting another.');
  const ops = [
    { type: 'add', store: 'kv', record: { key: LOCK_KEY, value: { sessionId: session.id } } },
    { type: 'put', store: 'sessions', record: session },
  ];
  if (session.taskId && session.kind === 'focus') {
    const task = st().get('tasks', session.taskId);
    if (task) ops.push({ type: 'put', store: 'taskHistory', record: { id: `hist_${session.id}_start`, taskId: task.id, title: task.title, type: 'focus-start', detail: `Focus session started (${Math.round(session.plannedMs / 60000)} min, task locked until it ends)`, at: session.startedAt } });
  }
  try {
    await st().commit(ops);
  } catch (e) {
    if (e.code === 'constraint') throw new Error('Another timer is already running (possibly in another tab).');
    throw e;
  }
  schedule();
  app.bus.emit('focus:started', { session });
  return session;
}

/* ---------- starting ---------- */
export async function startFocusForTask(taskId) {
  const task = st().get('tasks', taskId);
  if (!task) throw new Error('That task no longer exists.');
  if (task.status === 'done') throw new Error('This task is already completed.');
  if (!task.focus.enabled) throw new Error('This task is a normal task. Enable "Timed focus" in its settings first.');
  const now = clock.now();
  return claimAndStart(E.createSession({ kind: 'focus', phase: 'work', plannedMs: task.focus.durationMin * 60_000, now, taskId, label: task.title, locked: true }));
}
export async function startCountdown({ minutes, label = '', taskId = null, subjectId = null, chapterId = null }) {
  if (!(minutes > 0)) throw new Error('Enter a duration greater than zero.');
  return claimAndStart(E.createSession({ kind: 'countdown', plannedMs: Math.round(minutes * 60_000), now: clock.now(), label, taskId, subjectId, chapterId }));
}
export async function startStopwatch({ label = '', taskId = null, subjectId = null, chapterId = null } = {}) {
  return claimAndStart(E.createSession({ kind: 'stopwatch', now: clock.now(), label, taskId, subjectId, chapterId }));
}
export async function startPomodoro({ cfg, autoNext = true, label = '', taskId = null, subjectId = null, chapterId = null }) {
  const c = { ...E.POMODORO_DEFAULTS, ...cfg };
  return claimAndStart(E.createSession({ kind: 'pomodoro', phase: 'work', plannedMs: E.phaseMs(c, 'work'), now: clock.now(), cfg: c, autoNext, label, taskId, subjectId, chapterId }));
}

/* ---------- controls ---------- */
export async function pause() {
  const s = active(); if (!s) return null;
  const p = E.pause(s, clock.now());
  if (p === s) throw new Error(s.locked ? 'A locked focus session cannot be paused. Use Emergency interrupt if you must stop.' : 'Nothing to pause.');
  await persist(p, { quiet: true });
  schedule();
  app.bus.emit('focus:changed', { session: p });
  return p;
}
export async function resume() {
  const s = active(); if (!s || s.status !== 'paused') return null;
  const r = E.resume(s, clock.now());
  await persist(r, { quiet: true });
  schedule();
  app.bus.emit('focus:changed', { session: r });
  return r;
}
export async function interrupt(reason = '') {
  const s = active(); if (!s) return null;
  const i = E.interrupt(s, clock.now(), reason);
  const closed = await persist(i);
  schedule();
  emitEnded(closed, false);
  return i;
}
export async function stop() {
  const s = active(); if (!s) return null;
  if (s.locked && E.isLockActive(s, clock.now())) throw new Error('This focus session is locked. Use Emergency interrupt to end it early.');
  const e = E.stop(s, clock.now());
  const closed = await persist(e);
  schedule();
  emitEnded(closed, false);
  return e;
}
/** Skip the current pomodoro phase (ends it as "stopped" and starts the next if autoNext). */
export async function skipPhase() {
  const s = active();
  if (!s || s.kind !== 'pomodoro') return null;
  const now = clock.now();
  const stopped = E.stop(s, now);
  const nxt = E.nextPomodoro(stopped, now);
  const closed = await persist(stopped, { next: nxt, chain: [nxt] });
  schedule();
  emitEnded(closed, false);
  app.bus.emit('focus:started', { session: nxt });
  return nxt;
}

/* ---------- evaluation (called by the timeout, heartbeat, visibility changes, boot) ---------- */
export async function check() {
  heal();
  const s = active();
  if (!s) { clearTimers(); return; }
  const now = clock.now();
  if (E.isExpired(s, now)) {
    const r = E.settle(s, now);
    const late = now - s.targetAt > 5000;
    const closed = await persist(r.session, { next: r.next, chain: r.chain });
    emitEnded(closed.filter((c) => c.id === r.session.id || c.status === 'completed'), late);
    if (r.next) app.bus.emit('focus:started', { session: r.next, auto: true });
  } else if (s.status === 'running') {
    const h = E.heartbeat(s, now);
    await persist(h, { quiet: true });
  }
  schedule();
  app.bus.emit('focus:changed', { session: active() });
}

/** Keep the lock record consistent with reality (e.g. after a crash between writes). */
function heal() {
  const lock = st().get('kv', LOCK_KEY);
  const s = active();
  if (lock && (!s || lock.value?.sessionId !== s.id)) {
    if (s) st().put('kv', { key: LOCK_KEY, value: { sessionId: s.id } }, { quiet: true }).catch(() => {});
    else st().remove('kv', LOCK_KEY).catch(() => {});
  } else if (!lock && s) {
    st().put('kv', { key: LOCK_KEY, value: { sessionId: s.id } }, { quiet: true }).catch(() => {});
  }
}

function clearTimers() {
  clearTimeout(timeout); timeout = null;
  clearInterval(beat); beat = null;
}

function schedule() {
  clearTimeout(timeout);
  const s = active();
  if (!s || s.status !== 'running') { clearInterval(beat); beat = null; return; }
  if (s.targetAt != null) {
    const wait = Math.min(Math.max(0, s.targetAt - clock.now()) + 50, 60_000);
    timeout = setTimeout(check, wait);
  }
  if (!beat) beat = setInterval(check, HEARTBEAT_MS);
}

export async function init() {
  if (!started) {
    started = true;
    const wake = () => { if (document.visibilityState !== 'hidden') check().catch(console.error); };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('pageshow', wake);
    window.addEventListener('online', wake);
    // another tab changed sessions
    app.bus.on('store:sessions', ({ external }) => { if (external) { schedule(); app.bus.emit('focus:changed', { session: active() }); } });
  }
  await check();
}

export function stopAll() { clearTimers(); }
export const _debug = { schedule, heal };
export { E as engine };
