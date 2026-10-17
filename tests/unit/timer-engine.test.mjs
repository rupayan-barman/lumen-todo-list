import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../public/js/core/timer-engine.js';

const MIN = 60_000;
const T0 = 1_700_000_000_000;
const focus = (o = {}) => T.createSession({ kind: 'focus', plannedMs: 25 * MIN, now: T0, locked: true, ...o });

test('remaining time is derived from timestamps', () => {
  const s = focus();
  assert.equal(T.remainingMs(s, T0), 25 * MIN);
  assert.equal(T.remainingMs(s, T0 + 10 * MIN), 15 * MIN);
  assert.equal(T.remainingMs(s, T0 + 99 * MIN), 0);
});

test('lock is active until the target and released exactly at it', () => {
  const s = focus();
  assert.equal(T.isLockActive(s, T0 + 25 * MIN - 1), true);
  assert.equal(T.isLockActive(s, T0 + 25 * MIN), false);
});

test('locked sessions cannot be paused', () => {
  const s = focus();
  assert.equal(T.pause(s, T0 + MIN).status, 'running');
});

test('pause and resume preserve remaining time and active time', () => {
  const s = T.createSession({ kind: 'countdown', plannedMs: 10 * MIN, now: T0 });
  const p = T.pause(s, T0 + 4 * MIN);
  assert.equal(T.remainingMs(p, T0 + 90 * MIN), 6 * MIN); // frozen while paused
  const r = T.resume(p, T0 + 20 * MIN);
  assert.equal(r.pausedTotalMs, 16 * MIN);
  assert.equal(r.targetAt, T0 + 26 * MIN);
  assert.equal(T.remainingMs(r, T0 + 22 * MIN), 4 * MIN);
  assert.equal(T.activeMs(r, T0 + 22 * MIN), 6 * MIN);
});

test('settle closes an expired session AT the target, not at now', () => {
  const s = focus();
  const { session } = T.settle({ ...s, lastSeenAt: T0 + 25 * MIN - 1000 }, T0 + 500 * MIN);
  assert.equal(session.status, 'completed');
  assert.equal(session.endedAt, T0 + 25 * MIN);
  assert.equal(session.activeMs, 25 * MIN);
  assert.equal(session.unobservedMs, 0);
});

test('closing the app mid-session books the gap as unobserved, so credited time is lower', () => {
  const s = { ...focus(), lastSeenAt: T0 + 5 * MIN }; // last heartbeat at minute 5, then app closed
  const { session } = T.settle(s, T0 + 600 * MIN);
  assert.equal(session.unobservedMs, 20 * MIN);
  assert.equal(T.creditedMs(session, 0), 5 * MIN);
  assert.equal(session.activeMs, 25 * MIN); // elapsed/active stays separate from credited
  assert.equal(session.recovered, true);
});

test('small heartbeat gaps are not counted as unobserved', () => {
  const s = T.heartbeat(focus(), T0 + 30_000);
  assert.equal(s.unobservedMs, 0);
});

test('interrupt records actual time, never the planned duration', () => {
  const s = T.heartbeat(focus(), T0 + 7 * MIN);
  const i = T.interrupt(s, T0 + 7 * MIN, '  phone call ');
  assert.equal(i.status, 'interrupted');
  assert.equal(i.interruptReason, 'phone call');
  assert.equal(i.activeMs, 7 * MIN);
  assert.notEqual(i.activeMs, i.plannedMs);
  assert.equal(T.isLockActive(i, T0 + 8 * MIN), false);
});

test('stopwatch has no target and counts up', () => {
  const s = T.createSession({ kind: 'stopwatch', now: T0 });
  assert.equal(T.remainingMs(s, T0 + MIN), null);
  assert.equal(T.activeMs(s, T0 + 3 * MIN), 3 * MIN);
  const st = T.stop(s, T0 + 3 * MIN);
  assert.equal(st.status, 'stopped');
  assert.equal(st.activeMs, 3 * MIN);
});

test('clock moving backwards never yields negative time', () => {
  const s = focus();
  assert.equal(T.elapsedMs(s, T0 - 10 * MIN), 0);
  assert.equal(T.remainingMs(s, T0 - 10 * MIN), 25 * MIN);
});

test('pomodoro auto-advances work -> short -> work -> ... -> long', () => {
  const cfg = { workMin: 25, shortMin: 5, longMin: 15, longEvery: 2 };
  let s = T.createSession({ kind: 'pomodoro', phase: 'work', plannedMs: 25 * MIN, now: T0, cfg, autoNext: true });
  let r = T.settle({ ...s, lastSeenAt: T0 + 25 * MIN }, T0 + 25 * MIN + 1000);
  assert.equal(r.next.phase, 'short');
  assert.equal(r.next.startedAt, T0 + 25 * MIN); // continues from the exact boundary
  const w2 = T.nextPomodoro(r.next, T0 + 30 * MIN);
  assert.equal(w2.phase, 'work');
  const done2 = T.settle({ ...w2, lastSeenAt: w2.targetAt }, w2.targetAt);
  assert.equal(done2.next.phase, 'long'); // 2nd work phase -> long break
});

test('pomodoro after a long absence chains completed phases and marks them unobserved', () => {
  const cfg = { workMin: 25, shortMin: 5, longMin: 15, longEvery: 4 };
  const s = T.createSession({ kind: 'pomodoro', phase: 'work', plannedMs: 25 * MIN, now: T0, cfg, autoNext: true });
  const r = T.settle({ ...s, lastSeenAt: T0 + MIN }, T0 + 100 * MIN);
  assert.ok(r.chain.length >= 2);
  const wholly = r.chain.filter((c) => c.status === 'completed');
  assert.ok(wholly.every((c) => c.unobservedMs === c.plannedMs));
  assert.ok(wholly.every((c) => T.creditedMs(c, 0) === 0));
  assert.equal(r.next?.status, 'running');
});

test('pomodoro without autoNext stops after one phase', () => {
  const s = T.createSession({ kind: 'pomodoro', phase: 'work', plannedMs: 25 * MIN, now: T0, cfg: T.POMODORO_DEFAULTS, autoNext: false });
  const r = T.settle({ ...s, lastSeenAt: s.targetAt }, s.targetAt + 5);
  assert.equal(r.next, null);
});

test('only work phases of a pomodoro count as focus', () => {
  assert.equal(T.countsAsFocus({ kind: 'pomodoro', phase: 'short' }), false);
  assert.equal(T.countsAsFocus({ kind: 'pomodoro', phase: 'work' }), true);
});

test('interrupting a paused session does not count paused time as active', () => {
  const s = T.createSession({ kind: 'countdown', plannedMs: 10 * MIN, now: T0 });
  const p = T.pause(s, T0 + 2 * MIN);
  const i = T.interrupt(p, T0 + 9 * MIN);
  assert.equal(i.activeMs, 2 * MIN);
});
