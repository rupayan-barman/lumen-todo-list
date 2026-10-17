// Pure task helpers: overdue detection, filtering, sorting, scheduling conflicts, progress.
import { todayStr, addDays, diffDays, toEpoch, timeToMin } from './util.js';
import { clock } from './clock.js';

export const PRIORITY_RANK = { low: 0, medium: 1, high: 2, critical: 3 };
export const PRIORITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };
// Shape + text, never colour alone: each priority has its own glyph.
export const PRIORITY_GLYPH = { low: '▽', medium: '◇', high: '△', critical: '⬣' };

export const isDone = (t) => t.status === 'done';
export const isArchived = (t) => t.status === 'done' || t.archived === true;

export function deadlineEpoch(t) {
  return t.deadline ? toEpoch(t.deadline, t.deadlineTime || '23:59') : null;
}

export function isOverdue(t, now = clock.now()) {
  if (isDone(t) || !t.deadline) return false;
  return deadlineEpoch(t) < now;
}

/** days until deadline (negative = overdue), null if none. */
export function daysUntil(t, today = todayStr()) {
  return t.deadline ? diffDays(today, t.deadline) : null;
}

export function dueBucket(t, now = clock.now()) {
  if (!t.deadline) return 'none';
  if (isOverdue(t, now)) return 'overdue';
  const today = todayStr(now);
  const d = diffDays(today, t.deadline);
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d <= 7) return 'week';
  return 'later';
}

export function subtaskProgress(t) {
  const n = t.subtasks.length;
  const done = t.subtasks.filter((s) => s.done).length;
  return { done, total: n, pct: n ? Math.round((done / n) * 100) : 0 };
}

/** Does this task belong on `date` in the planner? (scheduled that day, or deadline that day) */
export function onDate(t, date) {
  return t.scheduledDate === date || t.deadline === date;
}

const norm = (s) => String(s ?? '').toLowerCase();

export function matchesText(t, q, lookups = {}) {
  const needle = norm(q).trim();
  if (!needle) return true;
  const hay = [
    t.title, t.description,
    lookups.categories?.get(t.categoryId)?.name,
    ...(t.tagIds || []).map((id) => lookups.tags?.get(id)?.name),
    ...t.subtasks.map((s) => s.title),
  ].map(norm).join('\n');
  return needle.split(/\s+/).every((w) => hay.includes(w));
}

/**
 * f = { text, scope:'active'|'archive'|'all', status:'any'|'todo'|'done', priorities:[], categoryIds:[], tagIds:[],
 *       projectId, due:'any'|'overdue'|'today'|'week'|'none'|'scheduled', focusOnly:boolean, hasSubtasks:boolean }
 */
export function filterTasks(tasks, f = {}, lookups = {}, now = clock.now()) {
  const scope = f.scope || 'active';
  return tasks.filter((t) => {
    if (scope === 'active' && isArchived(t)) return false;
    if (scope === 'archive' && !isArchived(t)) return false;
    if (f.status && f.status !== 'any' && t.status !== f.status) return false;
    if (f.priorities?.length && !f.priorities.includes(t.priority)) return false;
    if (f.categoryIds?.length && !f.categoryIds.includes(t.categoryId)) return false;
    if (f.tagIds?.length && !f.tagIds.every((id) => t.tagIds.includes(id))) return false;
    if (f.projectId && t.projectId !== f.projectId) return false;
    if (f.focusOnly && !t.focus.enabled) return false;
    if (f.hasSubtasks && t.subtasks.length === 0) return false;
    if (f.due && f.due !== 'any') {
      const b = dueBucket(t, now);
      if (f.due === 'overdue' && b !== 'overdue') return false;
      if (f.due === 'today' && b !== 'today' && t.scheduledDate !== todayStr(now)) return false;
      if (f.due === 'week' && !['today', 'tomorrow', 'week'].includes(b)) return false;
      if (f.due === 'none' && t.deadline) return false;
      if (f.due === 'scheduled' && !t.scheduledDate) return false;
    }
    return matchesText(t, f.text, lookups);
  });
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const NULL_LAST = 1e15;

export const SORTS = {
  manual: (a, b) => cmp(a.order, b.order) || cmp(a.createdAt, b.createdAt),
  deadline: (a, b) => cmp(deadlineEpoch(a) ?? NULL_LAST, deadlineEpoch(b) ?? NULL_LAST) || cmp(b.priority && PRIORITY_RANK[b.priority], PRIORITY_RANK[a.priority]),
  priority: (a, b) => cmp(PRIORITY_RANK[b.priority], PRIORITY_RANK[a.priority]) || cmp(deadlineEpoch(a) ?? NULL_LAST, deadlineEpoch(b) ?? NULL_LAST),
  created: (a, b) => cmp(b.createdAt, a.createdAt),
  title: (a, b) => norm(a.title).localeCompare(norm(b.title)),
  scheduled: (a, b) => cmp(a.scheduledDate ? toEpoch(a.scheduledDate, a.scheduledTime || '00:00') : NULL_LAST, b.scheduledDate ? toEpoch(b.scheduledDate, b.scheduledTime || '00:00') : NULL_LAST),
  completed: (a, b) => cmp(b.completedAt ?? 0, a.completedAt ?? 0),
};

export function sortTasks(tasks, key = 'manual', dir = 'asc') {
  const fn = SORTS[key] || SORTS.manual;
  const out = [...tasks].sort(fn);
  return dir === 'desc' ? out.reverse() : out;
}

/* ---------- scheduling conflicts ---------- */
/** Time block for a scheduled task: [startMin, endMin) on its date. Default length 30 min when no estimate. */
export function blockOf(t) {
  if (!t.scheduledDate || !t.scheduledTime) return null;
  const start = timeToMin(t.scheduledTime);
  const len = Math.max(15, t.estimateMin || (t.focus.enabled ? t.focus.durationMin : 30));
  return { date: t.scheduledDate, start, end: Math.min(24 * 60, start + len) };
}

export function overlaps(a, b) {
  return a && b && a.date === b.date && a.start < b.end && b.start < a.end;
}

/** Tasks (not done) whose scheduled block overlaps `task`'s block. */
export function conflictsFor(task, all) {
  const b = blockOf(task);
  if (!b) return [];
  return all.filter((o) => o.id !== task.id && !isDone(o) && !o.archived && overlaps(b, blockOf(o)));
}

/** Map taskId -> conflicting task ids, across a set of tasks. */
export function conflictMap(tasks) {
  const live = tasks.filter((t) => !isDone(t) && !t.archived && blockOf(t));
  const byDate = new Map();
  for (const t of live) { const d = t.scheduledDate; if (!byDate.has(d)) byDate.set(d, []); byDate.get(d).push(t); }
  const out = new Map();
  for (const list of byDate.values()) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      if (overlaps(blockOf(list[i]), blockOf(list[j]))) {
        (out.get(list[i].id) ?? out.set(list[i].id, []).get(list[i].id)).push(list[j].id);
        (out.get(list[j].id) ?? out.set(list[j].id, []).get(list[j].id)).push(list[i].id);
      }
    }
  }
  return out;
}

export function upcomingDeadlines(tasks, days = 7, now = clock.now()) {
  const today = todayStr(now);
  const end = addDays(today, days);
  return tasks
    .filter((t) => !isArchived(t) && t.deadline && t.deadline <= end)
    .sort((a, b) => cmp(deadlineEpoch(a), deadlineEpoch(b)));
}
