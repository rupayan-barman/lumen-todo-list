// Study planner: subjects -> chapters -> topics, spaced revisions, exam countdown, planned vs actual.
import { app } from './ctx.js';
import { undo } from './undo.js';
import { clone, uid, todayStr, addDays, diffDays, toEpoch } from '../core/util.js';
import { clock } from '../core/clock.js';
import * as Focus from './focus.js';

const st = () => app.store;
export const REVISION_STEPS = [1, 3, 7, 14, 30]; // days after completing a chapter
export const all = (archived = false) => st().all('subjects').filter((s) => !!s.archived === archived).sort((a, b) => a.createdAt - b.createdAt);

export const createSubject = (input) => st().put('subjects', { ...input, id: undefined, chapters: input.chapters || [] });
export async function updateSubject(id, patch) { const c = st().get('subjects', id); if (!c) throw new Error('That subject no longer exists.'); return st().put('subjects', { ...c, ...patch, id }); }
export const setArchived = (id, a) => updateSubject(id, { archived: a });
export async function deleteSubject(id) {
  const s = st().get('subjects', id); if (!s) return; const snap = clone(s);
  // Linked tasks/notes keep existing; only the link is cleared.
  const tasks = st().all('tasks').filter((t) => t.subjectId === id).map(clone); const notes = st().all('notes').filter((n) => n.subjectId === id).map(clone);
  await st().commit([...tasks.map((t) => ({ type: 'put', store: 'tasks', record: { ...t, subjectId: null, chapterId: null }, keepTimestamps: true })), ...notes.map((n) => ({ type: 'put', store: 'notes', record: { ...n, subjectId: null }, keepTimestamps: true })), { type: 'delete', store: 'subjects', key: id }]);
  undo.push(`delete subject "${s.name}"`, () => st().commit([{ type: 'put', store: 'subjects', record: snap, keepTimestamps: true }, ...tasks.map((t) => ({ type: 'put', store: 'tasks', record: t, keepTimestamps: true })), ...notes.map((n) => ({ type: 'put', store: 'notes', record: n, keepTimestamps: true }))]));
}

const mapCh = (sid, cid, fn) => { const s = st().get('subjects', sid); return updateSubject(sid, { chapters: s.chapters.map((c) => (c.id === cid ? fn(c) : c)) }); };
export async function addChapter(sid, title, plannedMin = 0) { const s = st().get('subjects', sid); return updateSubject(sid, { chapters: [...s.chapters, { id: uid('chap'), title, done: false, completedAt: null, plannedMin, topics: [], revisions: [] }] }); }
export const updateChapter = (sid, cid, patch) => mapCh(sid, cid, (c) => ({ ...c, ...patch }));
export async function deleteChapter(sid, cid) { const s = st().get('subjects', sid); return updateSubject(sid, { chapters: s.chapters.filter((c) => c.id !== cid) }); }
export const addTopic = (sid, cid, title) => mapCh(sid, cid, (c) => ({ ...c, topics: [...c.topics, { id: uid('top'), title, done: false }] }));
export const toggleTopic = (sid, cid, tid) => mapCh(sid, cid, (c) => ({ ...c, topics: c.topics.map((t) => (t.id === tid ? { ...t, done: !t.done } : t)) }));
export const deleteTopic = (sid, cid, tid) => mapCh(sid, cid, (c) => ({ ...c, topics: c.topics.filter((t) => t.id !== tid) }));

/** Completing a chapter schedules spaced revisions from today; reopening removes revisions that are not yet done. */
export const setChapterDone = (sid, cid, done) => mapCh(sid, cid, (c) => {
  if (done === c.done) return c;
  if (done) { const today = todayStr(); return { ...c, done: true, completedAt: clock.now(), revisions: [...c.revisions, ...REVISION_STEPS.map((d) => ({ id: uid('rev'), date: addDays(today, d), done: false, doneAt: null }))] }; }
  return { ...c, done: false, completedAt: null, revisions: c.revisions.filter((r) => r.done) };
});
export const toggleRevision = (sid, cid, rid) => mapCh(sid, cid, (c) => ({ ...c, revisions: c.revisions.map((r) => (r.id === rid ? { ...r, done: !r.done, doneAt: r.done ? null : clock.now() } : r)) }));
export const addRevision = (sid, cid, date) => mapCh(sid, cid, (c) => ({ ...c, revisions: [...c.revisions, { id: uid('rev'), date, done: false, doneAt: null }] }));

export function dueRevisions(today = todayStr()) {
  const out = [];
  for (const s of all()) for (const c of s.chapters) for (const r of c.revisions) if (!r.done && r.date <= today) out.push({ subject: s, chapter: c, revision: r, overdueDays: diffDays(r.date, today) });
  return out.sort((a, b) => (a.revision.date < b.revision.date ? -1 : 1));
}
export function upcomingRevisions(days = 14, today = todayStr()) {
  const end = addDays(today, days); const out = [];
  for (const s of all()) for (const c of s.chapters) for (const r of c.revisions) if (!r.done && r.date >= today && r.date <= end) out.push({ subject: s, chapter: c, revision: r });
  return out.sort((a, b) => (a.revision.date < b.revision.date ? -1 : 1));
}
export function examCountdown(s, now = clock.now()) {
  if (!s.examDate) return null;
  const at = toEpoch(s.examDate, s.examTime || '09:00'); const ms = at - now;
  return { ms, days: Math.floor(ms / 86400000), past: ms < 0 };
}
/** Planned (chapter plannedMin) vs actual focus (closed sessions linked to the subject/chapter). Time is from focus sessions only. */
export function plannedVsActual(s) {
  const sessions = Focus.closedSessions().filter((x) => x.subjectId === s.id);
  const rows = s.chapters.map((c) => {
    const actual = sessions.filter((x) => x.chapterId === c.id).reduce((a, x) => a + Math.max(0, x.activeMs - x.unobservedMs), 0);
    return { chapter: c, plannedMin: c.plannedMin, actualMin: Math.round(actual / 60000) };
  });
  const unassigned = sessions.filter((x) => !x.chapterId).reduce((a, x) => a + Math.max(0, x.activeMs - x.unobservedMs), 0);
  return { rows, unassignedMin: Math.round(unassigned / 60000), plannedMin: rows.reduce((a, r) => a + r.plannedMin, 0), actualMin: rows.reduce((a, r) => a + r.actualMin, 0) + Math.round(unassigned / 60000) };
}
