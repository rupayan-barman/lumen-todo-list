// Categories and tags (user-managed). Names are unique per kind, case-insensitively.
import { app } from './ctx.js';
import { undo } from './undo.js';
import { clone } from '../core/util.js';

const PALETTE = ['#7c9cff', '#34d399', '#f59e0b', '#fb7185', '#c084fc', '#38bdf8', '#a3e635', '#f472b6', '#2dd4bf', '#fb923c'];
const STORE = { category: 'categories', tag: 'tags' };
const st = () => app.store;

export const nextColor = (kind) => PALETTE[st().count(STORE[kind]) % PALETTE.length];
export const all = (kind) => [...st().all(STORE[kind])].sort((a, b) => a.name.localeCompare(b.name));
export const byName = (kind, name) => st().all(STORE[kind]).find((l) => l.name.toLowerCase() === String(name).trim().toLowerCase());
export const lookup = (kind) => new Map(st().all(STORE[kind]).map((l) => [l.id, l]));

function checkName(kind, name, selfId) {
  const n = String(name).trim();
  if (!n) throw new Error('Please enter a name.');
  const dup = byName(kind, n);
  if (dup && dup.id !== selfId) throw new Error(`A ${kind} called "${dup.name}" already exists.`);
  return n;
}

export async function createLabel(kind, name, color) {
  const n = checkName(kind, name);
  return st().put(STORE[kind], { name: n, color: color || nextColor(kind) });
}
/** Returns the existing label with this name or creates it. */
export async function ensureLabel(kind, name) {
  return byName(kind, name) || createLabel(kind, name);
}
export async function updateLabel(kind, id, { name, color }) {
  const cur = st().get(STORE[kind], id);
  if (!cur) throw new Error('That label no longer exists.');
  return st().put(STORE[kind], { ...cur, name: name !== undefined ? checkName(kind, name, id) : cur.name, color: color || cur.color });
}

export function usage(kind, id) {
  const key = kind === 'category' ? 'categoryId' : 'tagIds';
  const has = (r) => (kind === 'category' ? r[key] === id : r[key].includes(id));
  return { tasks: st().all('tasks').filter(has).length, notes: st().all('notes').filter(has).length };
}

/** Delete a label and detach it from every task/note, atomically. Undoable. */
export async function deleteLabel(kind, id) {
  const label = st().get(STORE[kind], id);
  if (!label) return;
  const tasks = st().all('tasks'), notes = st().all('notes');
  const touch = (rec, store) => ({ type: 'put', store, record: st().prepare(store, kind === 'category' ? { ...rec, categoryId: null } : { ...rec, tagIds: rec.tagIds.filter((t) => t !== id) }, { keepTimestamps: true }), prepared: true });
  const hit = (r) => (kind === 'category' ? r.categoryId === id : r.tagIds.includes(id));
  const affectedTasks = clone(tasks.filter(hit)), affectedNotes = clone(notes.filter(hit));
  await st().commit([
    ...tasks.filter(hit).map((t) => touch(t, 'tasks')), ...notes.filter(hit).map((n) => touch(n, 'notes')),
    { type: 'delete', store: STORE[kind], key: id },
  ]);
  undo.push(`delete ${kind} "${label.name}"`, async () => {
    await st().commit([
      { type: 'put', store: STORE[kind], record: st().prepare(STORE[kind], label, { keepTimestamps: true }), prepared: true },
      ...affectedTasks.map((t) => ({ type: 'put', store: 'tasks', record: st().prepare('tasks', t, { keepTimestamps: true }), prepared: true })),
      ...affectedNotes.map((n) => ({ type: 'put', store: 'notes', record: st().prepare('notes', n, { keepTimestamps: true }), prepared: true })),
    ]);
  });
}
