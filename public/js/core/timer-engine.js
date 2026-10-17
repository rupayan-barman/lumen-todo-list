// Pure timer maths. The persisted session record is the ONLY source of truth;
// setInterval/requestAnimationFrame in the UI merely trigger re-reads of `now`.
//
// Three durations are kept deliberately separate:
//   plannedMs   what the user configured ("25 minutes")
//   elapsedMs   wall-clock time between start and end (or now)
//   activeMs    elapsed minus time spent paused
// and one more for honesty:
//   unobservedMs  stretches where Lumen was not running (tab closed, computer asleep).
//   creditedMs = activeMs - unobservedMs   <- the only figure added to a task's "time spent".
// A timer can never prove the user was actually working; it only records what Lumen observed.
import { uid } from './util.js';

export const GAP_THRESHOLD_MS = 90_000; // heartbeat silence longer than this counts as unobserved
export const MAX_CHAIN = 60;            // safety cap when auto-advancing pomodoro phases after a long absence

const isOpen = (s) => s.status === 'running' || s.status === 'paused';
export const isActive = isOpen;

export function createSession({
  kind, phase = 'free', plannedMs = 0, now, taskId = null, subjectId = null, chapterId = null,
  label = '', locked = false, cfg = null, autoNext = false, cycleIndex = 0, startedAt = now, id = uid('sess'),
}) {
  const countdown = kind !== 'stopwatch';
  return {
    id, kind, phase, status: 'running', taskId, subjectId, chapterId, label,
    plannedMs: countdown ? plannedMs : 0,
    startedAt, targetAt: countdown ? startedAt + plannedMs : null,
    pausedAt: null, remainingAtPause: null, pausedTotalMs: 0,
    endedAt: null, activeMs: 0, unobservedMs: 0, lastSeenAt: now,
    locked: !!locked, interruptReason: '', recovered: false,
    cycleIndex, autoNext, cfg,
  };
}

const clampNow = (s, now) => Math.max(now, s.startedAt);

/** Milliseconds of wall time since start (or until the end if finished). */
export function elapsedMs(s, now) {
  const end = s.endedAt ?? (s.status === 'paused' ? s.pausedAt : clampNow(s, now));
  return Math.max(0, end - s.startedAt);
}

/** Elapsed minus paused time. For finished sessions this is the stored value. */
export function activeMs(s, now) {
  if (!isOpen(s)) return s.activeMs;
  const end = s.status === 'paused' ? s.pausedAt : clampNow(s, now);
  return Math.max(0, end - s.startedAt - s.pausedTotalMs);
}

export function creditedMs(s, now) {
  return Math.max(0, activeMs(s, now) - (s.unobservedMs || 0));
}

/** Remaining time for countdown-type sessions; null for stopwatches. */
export function remainingMs(s, now) {
  if (s.targetAt == null) return null;
  if (s.status === 'paused') return s.remainingAtPause;
  if (!isOpen(s)) return Math.max(0, s.targetAt - (s.endedAt ?? s.targetAt));
  return Math.max(0, s.targetAt - clampNow(s, now));
}

export const isExpired = (s, now) => s.status === 'running' && s.targetAt != null && now >= s.targetAt;

/** True while the task must not be completed because of this session. */
export function isLockActive(s, now) {
  return !!s && s.locked && s.status === 'running' && s.targetAt != null && now < s.targetAt;
}

/** Record a heartbeat; silence longer than the threshold is booked as unobserved time. */
export function heartbeat(s, now) {
  if (s.status !== 'running') return { ...s, lastSeenAt: now };
  const last = s.lastSeenAt ?? s.startedAt;
  const upTo = s.targetAt != null ? Math.min(now, s.targetAt) : now;
  const gap = upTo - last;
  const extra = gap > GAP_THRESHOLD_MS ? gap : 0;
  return { ...s, lastSeenAt: now, unobservedMs: (s.unobservedMs || 0) + extra, recovered: s.recovered || extra > 0 };
}

function finish(s, status, endAt, reason = '') {
  const end = Math.max(endAt, s.startedAt);
  const pausedExtra = s.status === 'paused' ? Math.max(0, end - s.pausedAt) : 0;
  const pausedTotal = s.pausedTotalMs + pausedExtra;
  return {
    ...s, status, endedAt: end, pausedAt: null, remainingAtPause: null, pausedTotalMs: pausedTotal,
    activeMs: Math.max(0, end - s.startedAt - pausedTotal), interruptReason: reason || s.interruptReason,
  };
}

/**
 * If a running countdown has passed its target, close it AT the target time (not at `now`),
 * crediting the unobserved gap first. Returns { session, next } where `next` is the auto-started
 * following pomodoro phase (also settled, chain-capped), or null.
 */
export function settle(s, now) {
  if (!isExpired(s, now)) return { session: s, next: null, chain: [] };
  const hb = heartbeat(s, now);
  const done = finish(hb, 'completed', s.targetAt);
  const chain = [];
  let cur = done;
  while (cur.kind === 'pomodoro' && cur.autoNext && chain.length < MAX_CHAIN) {
    const nxt = nextPomodoro(cur, cur.endedAt);
    // Time after the previous phase ended was never observed if we had no heartbeat in it.
    nxt.lastSeenAt = Math.min(now, nxt.targetAt);
    if (now >= nxt.targetAt) {
      // Entire phase elapsed while away: record it as completed but wholly unobserved.
      const closed = finish({ ...nxt, unobservedMs: nxt.plannedMs, recovered: true }, 'completed', nxt.targetAt);
      chain.push(closed);
      cur = closed;
    } else {
      const partlyAway = Math.max(0, now - nxt.startedAt);
      chain.push({ ...nxt, unobservedMs: partlyAway > GAP_THRESHOLD_MS ? partlyAway : 0, recovered: partlyAway > GAP_THRESHOLD_MS, lastSeenAt: now });
      break;
    }
  }
  const last = chain[chain.length - 1];
  return { session: done, next: last && last.status === 'running' ? last : null, chain };
}

export function pause(s, now) {
  if (s.status !== 'running') return s;
  if (s.locked) return s; // a locked focus session cannot be paused, only interrupted
  const at = clampNow(s, now);
  return { ...s, status: 'paused', pausedAt: at, remainingAtPause: s.targetAt != null ? Math.max(0, s.targetAt - at) : null, lastSeenAt: at };
}

export function resume(s, now) {
  if (s.status !== 'paused') return s;
  const at = Math.max(now, s.pausedAt);
  return {
    ...s, status: 'running', pausedTotalMs: s.pausedTotalMs + (at - s.pausedAt), pausedAt: null,
    targetAt: s.targetAt != null ? at + s.remainingAtPause : null, remainingAtPause: null, lastSeenAt: at,
  };
}

/** Emergency stop of a (usually locked) focus session. Only observed active time is kept. */
export function interrupt(s, now, reason = '') {
  if (!isOpen(s)) return s;
  const hb = heartbeat(s, now);
  return finish(hb, 'interrupted', clampNow(s, now), reason.trim());
}

/** User stops a stopwatch / ends a countdown early (not an emergency). */
export function stop(s, now) {
  if (!isOpen(s)) return s;
  const hb = heartbeat(s, now);
  return finish(hb, 'stopped', clampNow(s, now));
}

export const POMODORO_DEFAULTS = { workMin: 25, shortMin: 5, longMin: 15, longEvery: 4 };

/** Which phase follows `prev`? cycleIndex counts completed work phases. */
export function nextPhase(prev) {
  const cfg = prev.cfg || POMODORO_DEFAULTS;
  if (prev.phase === 'work') {
    const done = prev.cycleIndex + 1;
    return { phase: done % cfg.longEvery === 0 ? 'long' : 'short', cycleIndex: done };
  }
  return { phase: 'work', cycleIndex: prev.cycleIndex };
}

export function phaseMs(cfg, phase) {
  const c = cfg || POMODORO_DEFAULTS;
  return (phase === 'work' ? c.workMin : phase === 'short' ? c.shortMin : c.longMin) * 60_000;
}

export function nextPomodoro(prev, startAt) {
  const { phase, cycleIndex } = nextPhase(prev);
  return createSession({
    kind: 'pomodoro', phase, plannedMs: phaseMs(prev.cfg, phase), now: startAt, startedAt: startAt,
    taskId: prev.taskId, subjectId: prev.subjectId, chapterId: prev.chapterId, label: prev.label,
    cfg: prev.cfg, autoNext: prev.autoNext, cycleIndex,
  });
}

/** Aggregate for history/analytics: only work-like sessions count as focus time. */
export function countsAsFocus(s) {
  if (s.kind === 'pomodoro') return s.phase === 'work';
  return s.kind === 'focus' || s.kind === 'countdown' || s.kind === 'stopwatch';
}

export function describeOutcome(s) {
  switch (s.status) {
    case 'completed': return s.unobservedMs > 0 ? 'Completed (some time was not observed)' : 'Completed';
    case 'interrupted': return 'Interrupted';
    case 'stopped': return 'Stopped early';
    case 'running': return 'Running';
    case 'paused': return 'Paused';
    default: return s.status;
  }
}
