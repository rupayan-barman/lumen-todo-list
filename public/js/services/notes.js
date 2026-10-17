import { app } from './ctx.js';
import { undo } from './undo.js';
import { clone } from '../core/util.js';

const st = () => app.store;

export const all = () => st().all('notes');
export function sorted(list = all()) {
  return [...list].sort((a, b) => (b.pinned - a.pinned) || (b.updatedAt - a.updatedAt));
}
export async function createNote(input = {}) { return st().put('notes', { title: '', body: '', ...input, id: undefined }); }
export async function updateNote(id, patch, opts) {
  const cur = st().get('notes', id); if (!cur) throw new Error('That note no longer exists.');
  return st().put('notes', { ...cur, ...patch, id }, opts);
}
export const togglePin = (id) => updateNote(id, { pinned: !st().get('notes', id)?.pinned });
export async function deleteNote(id) {
  const n = st().get('notes', id); if (!n) return;
  const snap = clone(n);
  await st().remove('notes', id);
  undo.push(`delete note "${n.title || 'Untitled'}"`, async () => { await st().put('notes', snap, { keepTimestamps: true }); });
  return snap;
}
export const forTask = (taskId) => sorted(all().filter((n) => n.taskId === taskId));
export const forSubject = (subjectId) => sorted(all().filter((n) => n.subjectId === subjectId));
