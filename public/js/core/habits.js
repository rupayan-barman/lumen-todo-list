// Habit scheduling + streak maths. Pure. History is never rewritten: a missed day simply has no log.
import { addDays, diffDays, startOfWeek, weekdayOf, todayStr } from './util.js';

/** The schedule that applied on `date` (schedule edits are appended to scheduleHistory). */
export function scheduleOn(habit, date) {
  const hist = [...(habit.scheduleHistory || [])].sort((a, b) => (a.from < b.from ? -1 : 1));
  let pick = null;
  for (const h of hist) if (h.from <= date) pick = h.schedule;
  return pick || hist[0]?.schedule || habit.schedule;
}

/** Is a specific day expected? 'weekly' (N per week) habits are flexible, so any day can count. */
export function isScheduled(habit, date) {
  if (date < habit.startDate) return false;
  const s = scheduleOn(habit, date);
  if (s.type === 'daily') return true;
  if (s.type === 'days') return s.days.includes(weekdayOf(date));
  return false;
}

function weekCounts(logDates, from, to) {
  const m = new Map();
  for (const d of logDates) {
    if (d < from || d > to) continue;
    const w = startOfWeek(d, 1);
    m.set(w, (m.get(w) || 0) + 1);
  }
  return m;
}

/**
 * Stats for one habit.
 *   current  streak ending today (today not yet done does NOT break it; a missed scheduled day does)
 *   longest  best streak ever
 * Unit is days for daily/days habits, weeks for N-per-week habits (see `unit`).
 */
export function computeStats(habit, logDates, today = todayStr()) {
  const logs = logDates instanceof Set ? logDates : new Set(logDates);
  const start = habit.startDate;
  const total = [...logs].filter((d) => d <= today).length;
  const firstLog = [...logs].sort()[0];
  const from = firstLog && firstLog < start ? firstLog : start;
  const sched = scheduleOn(habit, today);
  const weekly = sched.type === 'weekly';

  let current = 0, longest = 0, run = 0;
  let unit = weekly ? 'week' : 'day';

  if (!weekly) {
    const span = Math.max(0, diffDays(from, today));
    for (let i = 0; i <= span; i++) {
      const d = addDays(from, i);
      const done = logs.has(d);
      const expected = isScheduled(habit, d);
      if (done) run++;
      else if (expected && d !== today) run = 0;       // missed scheduled day (today is still open)
      longest = Math.max(longest, run);
    }
    current = run;
  } else {
    const target = sched.perWeek;
    const counts = weekCounts(logs, from, today);
    const thisWeek = startOfWeek(today, 1);
    let w = startOfWeek(from, 1);
    while (w <= thisWeek) {
      const met = (counts.get(w) || 0) >= (scheduleOn(habit, w).perWeek || target);
      if (met) run++;
      else if (w !== thisWeek) run = 0;                 // an unfinished current week is still open
      longest = Math.max(longest, run);
      w = addDays(w, 7);
    }
    current = run;
  }

  // completion rate over the last 30 days: done / expected (weekly habits: weeks met)
  let expected = 0, done = 0;
  const win = Math.min(30, diffDays(start, today) + 1);
  for (let i = 0; i < win; i++) {
    const d = addDays(today, -i);
    if (!weekly) { if (isScheduled(habit, d)) { expected++; if (logs.has(d)) done++; } }
    else { expected += 1 / 7 * sched.perWeek; if (logs.has(d)) done++; }
  }
  const rate30 = expected > 0 ? Math.min(1, done / expected) : 0;
  return { current, longest, total, rate30, unit };
}

/** Did the user already do enough this week / is today done? */
export function todayState(habit, logDates, today = todayStr()) {
  const logs = logDates instanceof Set ? logDates : new Set(logDates);
  const sched = scheduleOn(habit, today);
  const doneToday = logs.has(today);
  if (sched.type !== 'weekly') return { due: isScheduled(habit, today), doneToday, progress: null };
  const wk = startOfWeek(today, 1);
  let n = 0;
  for (let i = 0; i < 7; i++) if (logs.has(addDays(wk, i))) n++;
  return { due: n < sched.perWeek, doneToday, progress: { done: n, target: sched.perWeek } };
}

/** Heatmap cells for the last `weeks` weeks ending today (Mon-first columns). */
export function heatmap(habit, logDates, weeks = 26, today = todayStr()) {
  const logs = logDates instanceof Set ? logDates : new Set(logDates);
  const end = addDays(startOfWeek(today, 1), 6);
  const start = addDays(end, -weeks * 7 + 1);
  const cells = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const future = d > today;
    cells.push({ date: d, done: logs.has(d), scheduled: isScheduled(habit, d), future, beforeStart: d < habit.startDate });
  }
  return cells;
}
