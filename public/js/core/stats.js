// Pure aggregation helpers for the timer history, dashboard and analytics.
import { ymd, addDays, diffDays, todayStr } from './util.js';
import { countsAsFocus, creditedMs, isActive } from './timer-engine.js';

const closed = (s) => !isActive(s);

/** Map 'YYYY-MM-DD' -> observed focus ms. A session is attributed to the day it STARTED. */
export function focusByDay(sessions) {
  const m = new Map();
  for (const s of sessions) {
    if (!closed(s) || !countsAsFocus(s)) continue;
    const d = ymd(new Date(s.startedAt));
    m.set(d, (m.get(d) || 0) + creditedMs(s, 0));
  }
  return m;
}

export function lastNDays(n, today = todayStr()) {
  return Array.from({ length: n }, (_, i) => addDays(today, i - (n - 1)));
}

export function dailySeries(sessions, n = 7, today = todayStr()) {
  const m = focusByDay(sessions);
  return lastNDays(n, today).map((d) => ({ date: d, ms: m.get(d) || 0 }));
}

/** Planned vs observed for closed work sessions linked to a key (taskId / subjectId). */
export function plannedVsActual(sessions, pick) {
  let planned = 0, actual = 0, count = 0;
  for (const s of sessions) {
    if (!closed(s) || !countsAsFocus(s) || !pick(s)) continue;
    planned += s.plannedMs; actual += creditedMs(s, 0); count++;
  }
  return { planned, actual, count };
}

/** Tasks completed per day (by completedAt). */
export function completionsByDay(tasks) {
  const m = new Map();
  for (const t of tasks) if (t.status === 'done' && t.completedAt) { const d = ymd(new Date(t.completedAt)); m.set(d, (m.get(d) || 0) + 1); }
  return m;
}

export function sessionTotals(sessions, today = todayStr()) {
  const by = focusByDay(sessions);
  let week = 0, total = 0;
  for (const [d, ms] of by) { total += ms; if (diffDays(d, today) >= 0 && diffDays(d, today) < 7) week += ms; }
  return { today: by.get(today) || 0, week, total, sessions: sessions.filter((s) => closed(s) && countsAsFocus(s)).length };
}

/** Consecutive days (ending today, or yesterday if today is still empty) with any observed focus. */
export function focusStreak(sessions, today = todayStr()) {
  const by = focusByDay(sessions);
  let d = by.get(today) ? today : addDays(today, -1), n = 0;
  while ((by.get(d) || 0) >= 60_000) { n++; d = addDays(d, -1); }
  return n;
}
