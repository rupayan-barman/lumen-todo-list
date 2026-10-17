// Projects, kanban columns and milestones. Cards are ordinary tasks with projectId/columnId.
import { app } from './ctx.js';
import { undo } from './undo.js';
import { clone, uid } from '../core/util.js';
import { clock } from '../core/clock.js';

const st = () => app.store;
export const DEFAULT_COLUMNS = () => [{ id: uid('col'), name: 'To do', done: false }, { id: uid('col'), name: 'In progress', done: false }, { id: uid('col'), name: 'Done', done: true }];
export const all = (archived = false) => st().all('projects').filter((p) => (p.status === 'archived') === archived).sort((a, b) => a.createdAt - b.createdAt);
export const tasksOf = (pid) => st().all('tasks').filter((t) => t.projectId === pid && !t.archived).sort((a, b) => a.order - b.order);

export function progressOf(p) {
  const tasks = st().all('tasks').filter((t) => t.projectId === p.id);
  const done = tasks.filter((t) => t.status === 'done').length;
  const ms = p.milestones || [];
  return { total: tasks.length, done, pct: tasks.length ? Math.round((done / tasks.length) * 100) : 0, msDone: ms.filter((m) => m.done).length, msTotal: ms.length };
}

export const createProject = (input) => st().put('projects', { ...input, id: undefined, columns: input.columns?.length ? input.columns : DEFAULT_COLUMNS(), milestones: input.milestones || [] });
export async function updateProject(id, patch) {
  const cur = st().get('projects', id); if (!cur) throw new Error('That project no longer exists.');
  return st().put('projects', { ...cur, ...patch, id });
}
export const setArchived = (id, archived) => updateProject(id, { status: archived ? 'archived' : 'active', archivedAt: archived ? clock.now() : null });

export async function deleteProject(id) {
  const p = st().get('projects', id); if (!p) return;
  const snap = clone(p);
  const tasks = st().all('tasks').filter((t) => t.projectId === id).map(clone);
  // Tasks are kept (just detached) - deleting a project never deletes work.
  await st().commit([...tasks.map((t) => ({ type: 'put', store: 'tasks', record: { ...t, projectId: null, columnId: null }, keepTimestamps: true })), { type: 'delete', store: 'projects', key: id }]);
  undo.push(`delete project "${p.name}"`, async () => st().commit([{ type: 'put', store: 'projects', record: snap, keepTimestamps: true }, ...tasks.map((t) => ({ type: 'put', store: 'tasks', record: t, keepTimestamps: true }))]));
}

export async function addColumn(pid, name) { const p = st().get('projects', pid); return updateProject(pid, { columns: [...p.columns, { id: uid('col'), name, done: false }] }); }
export async function renameColumn(pid, cid, name) { const p = st().get('projects', pid); return updateProject(pid, { columns: p.columns.map((c) => (c.id === cid ? { ...c, name } : c)) }); }
export async function setColumnDone(pid, cid, done) { const p = st().get('projects', pid); return updateProject(pid, { columns: p.columns.map((c) => (c.id === cid ? { ...c, done } : c)) }); }
export async function moveColumn(pid, cid, dir) {
  const p = st().get('projects', pid); const cols = [...p.columns]; const i = cols.findIndex((c) => c.id === cid); const j = i + dir;
  if (i < 0 || j < 0 || j >= cols.length) return;
  [cols[i], cols[j]] = [cols[j], cols[i]]; return updateProject(pid, { columns: cols });
}
/** Deleting a column moves its cards to the first remaining column (never deletes tasks). */
export async function deleteColumn(pid, cid) {
  const p = st().get('projects', pid);
  if (p.columns.length <= 1) throw new Error('A project needs at least one column.');
  const rest = p.columns.filter((c) => c.id !== cid); const target = rest[0].id;
  const moved = st().all('tasks').filter((t) => t.projectId === pid && t.columnId === cid);
  await st().commit([...moved.map((t) => ({ type: 'put', store: 'tasks', record: { ...t, columnId: target } })), { type: 'put', store: 'projects', record: { ...p, columns: rest } }]);
}

export async function addMilestone(pid, m) { const p = st().get('projects', pid); return updateProject(pid, { milestones: [...p.milestones, { id: uid('ms'), title: m.title, date: m.date || null, done: false }] }); }
export async function updateMilestone(pid, mid, patch) { const p = st().get('projects', pid); return updateProject(pid, { milestones: p.milestones.map((m) => (m.id === mid ? { ...m, ...patch } : m)) }); }
export async function deleteMilestone(pid, mid) { const p = st().get('projects', pid); return updateProject(pid, { milestones: p.milestones.filter((m) => m.id !== mid) }); }

/** Move a card to a column (and position). Completing = landing in a "done" column, via the shared completion rules. */
export async function moveCard(taskId, columnId, beforeId = null) {
  const t = st().get('tasks', taskId); if (!t) return;
  const p = st().get('projects', t.projectId); const col = p?.columns.find((c) => c.id === columnId); if (!col) return;
  const Tasks = await import('./tasks.js');
  if (col.done && t.status !== 'done') { await Tasks.completeTask(taskId); }   // throws TaskLockedError when a timer locks it
  else if (!col.done && t.status === 'done') await Tasks.reopenTask(taskId);
  const cards = tasksOf(t.projectId).filter((x) => x.columnId === columnId && x.id !== taskId);
  const idx = beforeId ? cards.findIndex((x) => x.id === beforeId) : cards.length;
  cards.splice(idx < 0 ? cards.length : idx, 0, st().get('tasks', taskId));
  await st().commit(cards.map((c, i) => ({ type: 'put', store: 'tasks', record: { ...c, columnId, order: i }, quiet: false })));
}
