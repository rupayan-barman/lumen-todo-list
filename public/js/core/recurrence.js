// Recurrence rules for tasks. Pure functions over "YYYY-MM-DD" strings.
//   rule = { freq: 'daily'|'weekly'|'monthly'|'yearly', interval, byWeekday:[0-6], endDate, count, anchor }
// `anchor` is the date of the first occurrence; month/year steps are computed from it so
// "the 31st" does not drift to the 28th after passing through February.
import { addDays, addMonths, addYears, startOfWeek, weekdayOf, diffDays, parseYmd } from './util.js';

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function monthsBetween(a, b) {
  const da = parseYmd(a), db = parseYmd(b);
  return (db.getFullYear() - da.getFullYear()) * 12 + (db.getMonth() - da.getMonth());
}

/** Next occurrence strictly after `from`, ignoring end conditions. */
export function stepDate(rule, from) {
  const n = Math.max(1, rule.interval || 1);
  const anchor = rule.anchor || from;
  switch (rule.freq) {
    case 'daily':
      return addDays(from, n);
    case 'weekly': {
      const set = new Set(rule.byWeekday || []);
      if (set.size === 0) return addDays(from, 7 * n);
      const base = startOfWeek(from, 1);
      for (let k = 1; k <= 6; k++) {
        const cand = addDays(from, k);
        if (startOfWeek(cand, 1) !== base) break;
        if (set.has(weekdayOf(cand))) return cand;
      }
      const nextWeek = addDays(base, 7 * n);
      for (let k = 0; k < 7; k++) {
        const cand = addDays(nextWeek, k);
        if (set.has(weekdayOf(cand))) return cand;
      }
      return addDays(from, 7 * n);
    }
    case 'monthly': {
      const k = monthsBetween(anchor, from);
      // smallest multiple of n that moves strictly past `from`
      let steps = Math.floor(k / n) * n + n;
      let cand = addMonths(anchor, steps);
      while (diffDays(from, cand) <= 0) { steps += n; cand = addMonths(anchor, steps); }
      return cand;
    }
    case 'yearly': {
      const k = Math.floor(monthsBetween(anchor, from) / 12);
      let steps = Math.floor(k / n) * n + n;
      let cand = addYears(anchor, steps);
      while (diffDays(from, cand) <= 0) { steps += n; cand = addYears(anchor, steps); }
      return cand;
    }
    default:
      return null;
  }
}

/** Next occurrence date honouring `endDate` and `count`. `occurrence` is the 0-based index of `from`. */
export function nextOccurrence(rule, from, occurrence = 0) {
  if (!rule) return null;
  if (rule.count != null && occurrence + 1 >= rule.count) return null;
  const next = stepDate(rule, from);
  if (!next) return null;
  if (rule.endDate && diffDays(next, rule.endDate) < 0) return null;
  return next;
}

export const anchorDateOf = (t) => t.deadline || t.scheduledDate || t.startDate || null;

/**
 * Build the next instance of a recurring task, shifting every date field by the same delta.
 * Returns a partial task (no id) or null when the series has ended.
 */
export function buildNextInstance(task) {
  const rule = task.recurrence;
  if (!rule) return null;
  const anchor = anchorDateOf(task);
  if (!anchor) return null;
  const next = nextOccurrence({ ...rule, anchor: rule.anchor || anchor }, anchor, task.occurrence || 0);
  if (!next) return null;
  const delta = diffDays(anchor, next);
  const shift = (d) => (d ? addDays(d, delta) : d);
  return {
    ...task,
    id: undefined,
    status: 'todo',
    completedAt: null,
    archived: false,
    actualMs: 0,
    startDate: shift(task.startDate),
    deadline: shift(task.deadline),
    scheduledDate: shift(task.scheduledDate),
    subtasks: task.subtasks.map((s) => ({ ...s, done: false })),
    occurrence: (task.occurrence || 0) + 1,
    seriesId: task.seriesId || task.id,
    recurrence: { ...rule, anchor: rule.anchor || anchor },
  };
}

/** Future occurrence dates inside [rangeStart, rangeEnd] (the task's own date is excluded). */
export function expandOccurrences(task, rangeStart, rangeEnd, limit = 60) {
  const rule = task.recurrence;
  const anchor = anchorDateOf(task);
  if (!rule || !anchor) return [];
  const out = [];
  let cur = anchor;
  let occ = task.occurrence || 0;
  for (let guard = 0; guard < 2000 && out.length < limit; guard++) {
    const next = nextOccurrence({ ...rule, anchor: rule.anchor || anchor }, cur, occ);
    if (!next || diffDays(next, rangeEnd) < 0) break;
    cur = next;
    occ++;
    if (diffDays(rangeStart, next) >= 0) out.push({ date: next, occurrence: occ });
  }
  return out;
}

export function describeRecurrence(rule) {
  if (!rule) return '';
  const n = rule.interval || 1;
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[rule.freq];
  let s = n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`;
  if (rule.freq === 'weekly' && rule.byWeekday?.length) {
    s += ' on ' + [...rule.byWeekday].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => WD[d]).join(', ');
  }
  if (rule.count) s += `, ${rule.count} times`;
  if (rule.endDate) s += `, until ${rule.endDate}`;
  return s;
}
