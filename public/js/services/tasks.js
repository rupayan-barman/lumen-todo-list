// Task business logic. Views call these; they never touch the store directly for task rules.
import { app } from './ctx.js';
import { undo } from './undo.js';
import { clock } from '../core/clock.js';
import { uid, clone } from '../core/util.js';
import { buildNextInstance } from '../core/recurrence.js';
import { isLockActive, isActive as sessionOpen, remainingMs } from '../core/timer-engine.js';
import { normalizeRecord } from '../core/validate.js';
import { taskEntity } from '../core/entities.js';

export class TaskLockedError extends Error {
  constructor(task, remaining) {
    super(`"${task.title}" is locked by a running focus session`);
    this.name = 'TaskLockedError';
    this.remainingMs = remaining;
  }
}
export class TaskBusyError extends Error {
  constructor(task) { super(`"${task.title}" has an active timer session. Stop or interrupt it first.`); this.name = 'TaskBusyError'; }
}

const st = () => app.store;
const hist = (task, type, detail = '') => ({ type: 'put', store: 'taskHistory', record: { taskId: task.id, title: task.title, type, detail } });

export function lockFor(taskId, now = clock.now()) {
  return st().all('sessions').find((s) => s.taskId === taskId && isLockActive(s, now)) || null;
}
export function openSessionFor(taskId) {
  return st().all('sessions').find((s) => s.taskId === taskId && sessionOpen(s)) || null;
}

/** Returns { ok, reason?, remainingMs? } - the single rule used by every completion path. */
export function canComplete(task, now = clock.now()) {
  const lock = lockFor(task.id, now);
  if (lock) return { ok: false, reason: 'locked', remainingMs: remainingMs(lock, now) };
  return { ok: true };
}

/** Diff-based history text so the history panel can show what actually changed. */
function describeChanges(before, after) {
  const fields = ['title', 'priority', 'deadline', 'deadlineTime', 'scheduledDate', 'scheduledTime', 'startDate', 'categoryId', 'projectId', 'estimateMin'];
  const labels = { title: 'title', priority: 'priority', deadline: 'deadline', deadlineTime: 'deadline time', scheduledDate: 'scheduled date', scheduledTime: 'scheduled time', startDate: 'start date', categoryId: 'category', projectId: 'project', estimateMin: 'estimate' };
  const out = [];
  for (const f of fields) if (before[f] !== after[f]) out.push(`${labels[f]}: ${before[f] ?? '—'} → ${after[f] ?? '—'}`);
  if (JSON.stringify(before.tagIds) !== JSON.stringify(after.tagIds)) out.push('tags changed');
  if (before.description !== after.description) out.push('description changed');
  if (JSON.stringify(before.subtasks) !== JSON.stringify(after.subtasks)) out.push('subtasks changed');
  if (JSON.stringify(before.recurrence) !== JSON.stringify(after.recurrence)) out.push('recurrence changed');
  if (JSON.stringify(before.focus) !== JSON.stringify(after.focus)) out.push('focus settings changed');
  return out.join('; ');
}

function nextOrder() {
  let max = 0;
  for (const t of st().all('tasks')) if (t.order > max) max = t.order;
  return max + 10;
}

/** Validate without saving, for live form errors. */
export function validateTask(input) {
  const r = normalizeRecord(taskEntity, { id: input.id || 'task_preview', ...input }, { repair: false });
  return { ok: r.ok, errors: r.errors };
}

export async function createTask(input) {
  const rec = { ...input, id: undefined, status: 'todo', order: input.order ?? nextOrder() };
  const prepared = st().prepare('tasks', rec);
  await st().commit([
    { type: 'put', store: 'tasks', record: prepared, prepared: true },
    hist(prepared, 'created'),
  ]);
  return prepared;
}

export async function updateTask(id, patch) {
  const before = st().get('tasks', id);
  if (!before) throw new Error('That task no longer exists.');
  const next = { ...before, ...patch, id };
  if (lockFor(id) && patch.status === 'done') throw new TaskLockedError(before, remainingMs(lockFor(id), clock.now()));
  const prepared = st().prepare('tasks', next);
  const detail = describeChanges(before, prepared);
  const ops = [{ type: 'put', store: 'tasks', record: prepared, prepared: true }];
  if (detail) ops.push(hist(prepared, 'edited', detail));
  await st().commit(ops);
  return prepared;
}

export async function toggleSubtask(taskId, subId) {
  const t = st().get('tasks', taskId);
  if (!t) return null;
  const subtasks = t.subtasks.map((s) => (s.id === subId ? { ...s, done: !s.done } : s));
  return st().put('tasks', { ...t, subtasks });
}

export async function completeTask(id) {
  const t = st().get('tasks', id);
  if (!t) throw new Error('That task no longer exists.');
  if (t.status === 'done') return { task: t, next: null };
  const gate = canComplete(t);
  if (!gate.ok) throw new TaskLockedError(t, gate.remainingMs);

  const now = clock.now();
  const done = st().prepare('tasks', { ...t, status: 'done', completedAt: now });
  const ops = [{ type: 'put', store: 'tasks', record: done, prepared: true }, hist(done, 'completed')];

  let next = null;
  const proto = t.recurrence ? buildNextInstance(t) : null;
  if (proto) {
    // Don't create a duplicate if a later occurrence already exists (e.g. double click / other tab).
    const dup = st().all('tasks').find((o) => o.seriesId === proto.seriesId && o.occurrence === proto.occurrence);
    if (!dup) {
      next = st().prepare('tasks', { ...proto, id: undefined, order: t.order });
      ops.push({ type: 'put', store: 'tasks', record: next, prepared: true }, hist(next, 'recurred', `Next occurrence created from "${t.title}"`));
    }
  }
  await st().commit(ops);

  undo.push(`complete "${t.title}"`, async () => {
    const cur = st().get('tasks', id);
    const o = [];
    if (cur) o.push({ type: 'put', store: 'tasks', record: st().prepare('tasks', { ...cur, status: 'todo', completedAt: null }), prepared: true });
    if (next && st().has('tasks', next.id)) o.push({ type: 'delete', store: 'tasks', key: next.id });
    o.push(hist(t, 'reopened', 'Undo'));
    await st().commit(o);
  });
  return { task: done, next };
}

export async function reopenTask(id) {
  const t = st().get('tasks', id);
  if (!t || t.status !== 'done') return t;
  return st().commit([
    { type: 'put', store: 'tasks', record: st().prepare('tasks', { ...t, status: 'todo', completedAt: null, archived: false }), prepared: true },
    hist(t, 'reopened'),
  ]).then((r) => r[0]);
}

export async function setArchived(ids, archived) {
  const ops = [];
  for (const id of ids) {
    const t = st().get('tasks', id);
    if (!t) continue;
    ops.push({ type: 'put', store: 'tasks', record: st().prepare('tasks', { ...t, archived }), prepared: true });
    ops.push(hist(t, archived ? 'archived' : 'unarchived'));
  }
  await st().commit(ops);
}

export async function duplicateTask(id) {
  const t = st().get('tasks', id);
  if (!t) throw new Error('That task no longer exists.');
  const copy = {
    ...clone(t), id: undefined, title: `${t.title} (copy)`.slice(0, 300), status: 'todo', completedAt: null, archived: false,
    actualMs: 0, order: t.order + 1, seriesId: null, occurrence: 0,
    subtasks: t.subtasks.map((s) => ({ ...s, id: uid('sub'), done: false })),
  };
  const prepared = st().prepare('tasks', copy);
  await st().commit([{ type: 'put', store: 'tasks', record: prepared, prepared: true }, hist(prepared, 'duplicated', `Copied from "${t.title}"`)]);
  return prepared;
}

/** Delete with undo. Tasks that have an open timer session are protected. History is kept for restore. */
export async function deleteTasks(ids) {
  const tasks = ids.map((i) => st().get('tasks', i)).filter(Boolean);
  const busy = tasks.find((t) => openSessionFor(t.id));
  if (busy) throw new TaskBusyError(busy);
  if (!tasks.length) return 0;
  const snapshot = clone(tasks);
  await st().commit([
    ...tasks.map((t) => ({ type: 'delete', store: 'tasks', key: t.id })),
    ...tasks.map((t) => hist(t, 'deleted')),
  ]);
  undo.push(tasks.length === 1 ? `delete "${tasks[0].title}"` : `delete ${tasks.length} tasks`, async () => {
    await st().commit([
      ...snapshot.map((t) => ({ type: 'put', store: 'tasks', record: st().prepare('tasks', t, { keepTimestamps: true }), prepared: true })),
      ...snapshot.map((t) => hist(t, 'restored', 'Undo delete')),
    ]);
  });
  return tasks.length;
}

/** Bulk patch (priority/category/tags/project/dates). Returns count changed. Undoable. */
export async function bulkPatch(ids, patchFn, label = 'bulk edit') {
  const before = ids.map((i) => st().get('tasks', i)).filter(Boolean);
  const ops = before.map((t) => {
    const patch = typeof patchFn === 'function' ? patchFn(t) : patchFn;
    return { type: 'put', store: 'tasks', record: st().prepare('tasks', { ...t, ...patch }), prepared: true };
  });
  if (!ops.length) return 0;
  await st().commit(ops);
  const snap = clone(before);
  undo.push(`${label} (${before.length})`, async () => {
    await st().commit(snap.map((t) => ({ type: 'put', store: 'tasks', record: st().prepare('tasks', t, { keepTimestamps: true }), prepared: true })));
  });
  return ops.length;
}

/** Complete many; locked tasks are skipped and reported. */
export async function bulkComplete(ids) {
  let done = 0; const skipped = [];
  for (const id of ids) {
    try { const r = await completeTask(id); if (r.task.status === 'done') done++; }
    catch (e) { if (e instanceof TaskLockedError) skipped.push(st().get('tasks', id)?.title); else throw e; }
  }
  return { done, skipped };
}

/** Reassign `order` among the given ids to match the new sequence (drag & drop / keyboard move). */
export async function reorder(idsInNewOrder) {
  const tasks = idsInNewOrder.map((i) => st().get('tasks', i)).filter(Boolean);
  const slots = tasks.map((t) => t.order).sort((a, b) => a - b);
  // ensure strictly increasing slots even when several tasks share an order value
  for (let i = 1; i < slots.length; i++) if (slots[i] <= slots[i - 1]) slots[i] = slots[i - 1] + 0.001;
  const ops = tasks.map((t, i) => ({ type: 'put', store: 'tasks', record: st().prepare('tasks', { ...t, order: slots[i] }, { keepTimestamps: true }), prepared: true }));
  await st().commit(ops);
}

export function historyFor(taskId) {
  return st().all('taskHistory').filter((h) => h.taskId === taskId).sort((a, b) => b.at - a.at);
}

/** Reschedule (calendar drag & drop / date picker). */
export async function reschedule(id, { scheduledDate, scheduledTime }) {
  const t = st().get('tasks', id);
  if (!t) throw new Error('That task no longer exists.');
  const before = { scheduledDate: t.scheduledDate, scheduledTime: t.scheduledTime };
  const prepared = st().prepare('tasks', { ...t, scheduledDate, scheduledTime: scheduledTime ?? t.scheduledTime });
  await st().commit([{ type: 'put', store: 'tasks', record: prepared, prepared: true }, hist(prepared, 'scheduled', `${before.scheduledDate ?? '—'} → ${scheduledDate ?? '—'}`)]);
  undo.push(`reschedule "${t.title}"`, async () => { await st().put('tasks', { ...st().get('tasks', id), ...before }); });
  return prepared;
}
