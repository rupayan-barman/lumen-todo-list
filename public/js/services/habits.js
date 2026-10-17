// Habit rules. Logs are never erased by schedule edits or archiving; deleting a habit is explicit and undoable.
import { app } from './ctx.js';
import { undo } from './undo.js';
import { clone, todayStr, uid } from '../core/util.js';
import { computeStats, todayState, scheduleOn } from '../core/habits.js';

const st = () => app.store;
export const all = (includeArchived = false) => st().all('habits').filter((h) => includeArchived || !h.archived).sort((a, b) => a.createdAt - b.createdAt);
export const logsFor = (habitId) => st().all('habitLogs').filter((l) => l.habitId === habitId);
export const logDates = (habitId) => new Set(logsFor(habitId).map((l) => l.date));
export const statsFor = (h, today = todayStr()) => computeStats(h, logDates(h.id), today);
export const stateFor = (h, today = todayStr()) => todayState(h, logDates(h.id), today);

export async function createHabit(input) {
  const schedule = input.schedule || { type: 'daily', days: [], perWeek: 3 };
  const startDate = input.startDate || todayStr();
  return st().put('habits', { ...input, id: undefined, schedule, startDate, scheduleHistory: [{ from: startDate, schedule }] });
}

/** Editing the schedule appends to scheduleHistory from today on, so past days keep the schedule that applied. */
export async function updateHabit(id, patch) {
  const cur = st().get('habits', id); if (!cur) throw new Error('That habit no longer exists.');
  const next = { ...cur, ...patch, id };
  if (patch.schedule && JSON.stringify(patch.schedule) !== JSON.stringify(scheduleOn(cur, todayStr()))) {
    const from = todayStr();
    const hist = (cur.scheduleHistory || []).filter((h) => h.from !== from);
    next.scheduleHistory = [...hist, { from, schedule: patch.schedule }];
  }
  return st().put('habits', next);
}

export async function toggleLog(habitId, date = todayStr()) {
  const existing = logsFor(habitId).find((l) => l.date === date);
  if (existing) { await st().remove('habitLogs', existing.id); return false; }
  await st().put('habitLogs', { habitId, date });
  return true;
}
export async function setLogNote(habitId, date, note) {
  const ex = logsFor(habitId).find((l) => l.date === date);
  if (ex) return st().put('habitLogs', { ...ex, note });
  return st().put('habitLogs', { habitId, date, note });
}
export const setArchived = (id, archived) => updateHabit(id, { archived });

export async function deleteHabit(id) {
  const h = st().get('habits', id); if (!h) return;
  const logs = logsFor(id).map(clone), snap = clone(h);
  await st().commit([...logs.map((l) => ({ type: 'delete', store: 'habitLogs', key: l.id })), { type: 'delete', store: 'habits', key: id }]);
  undo.push(`delete habit "${h.name}"`, async () => {
    await st().commit([{ type: 'put', store: 'habits', record: snap, keepTimestamps: true }, ...logs.map((l) => ({ type: 'put', store: 'habitLogs', record: l, keepTimestamps: true }))]);
  });
}
