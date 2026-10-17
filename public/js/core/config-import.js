// JSON configuration import: parse -> validate -> resolve references -> plan.
// Pure logic (no DOM, no IndexedDB), so it is unit-tested in Node. The plan it returns is applied by
// services/config-import.js through the normal store, which writes everything in ONE atomic transaction.
//
// Format: { "format": "lumen-config", "version": 1, "categories": [], "tags": [], "projects": [],
//           "subjects": [], "tasks": [], "notes": [], "habits": [] }
// This module never edits or deletes existing data: it only plans NEW records (and reuses existing
// categories, tags, projects and subjects that match by name).
import { ENTITIES } from './entities.js';
import { normalizeRecord, sanitizeJson } from './validate.js';
import { uid, todayStr } from './util.js';

export const CONFIG_FORMAT = 'lumen-config';
export const CONFIG_VERSION = 1;
export const MAX_CONFIG_BYTES = 2 * 1024 * 1024;
export const MAX_CONFIG_ITEMS = 2000;
export const SECTIONS = ['categories', 'tags', 'projects', 'subjects', 'tasks', 'notes', 'habits'];
const STORE_OF = { categories: 'categories', tags: 'tags', projects: 'projects', subjects: 'subjects', tasks: 'tasks', notes: 'notes', habits: 'habits' };
const ID_PREFIX = { categories: 'cat', tags: 'tag', projects: 'proj', subjects: 'subj', tasks: 'task', notes: 'note', habits: 'habit' };
export const KIND_LABEL = { categories: 'Categories', tags: 'Tags', projects: 'Projects', subjects: 'Study subjects', tasks: 'Tasks (incl. calendar items)', notes: 'Notes', habits: 'Habits' };
const SINGULAR = { categories: 'Category', tags: 'Tag', projects: 'Project', subjects: 'Subject', tasks: 'Task', notes: 'Note', habits: 'Habit' };

// Allowed fields per section. Anything else is reported as a warning and ignored.
const LABEL_SPEC = { ref: 'string', name: 'string', color: 'string' };
const SPECS = {
  categories: LABEL_SPEC,
  tags: LABEL_SPEC,
  projects: { ref: 'string', name: 'string', description: 'string', notes: 'string', deadline: 'string', color: 'string', columns: 'array', milestones: 'array' },
  subjects: { ref: 'string', name: 'string', color: 'string', examDate: 'string', examTime: 'string', chapters: 'array' },
  tasks: {
    ref: 'string', title: 'string', description: 'string', priority: 'string', status: 'string', category: 'string', tags: 'array',
    project: 'string', column: 'string', subject: 'string', chapter: 'string', startDate: 'string', deadline: 'string', deadlineTime: 'string',
    scheduledDate: 'string', scheduledTime: 'string', estimateMin: 'number', subtasks: 'array', recurrence: 'object', focus: 'object',
  },
  notes: { ref: 'string', title: 'string', body: 'string', pinned: 'boolean', category: 'string', tags: 'array', task: 'string', project: 'string', subject: 'string' },
  habits: { ref: 'string', name: 'string', description: 'string', color: 'string', schedule: 'object', startDate: 'string', reminderTime: 'string', notes: 'string' },
};
const TOP_KEYS = new Set(['format', 'version', 'description', ...SECTIONS]);
// record field -> name used in the JSON, so error messages point at what the person actually wrote
const FIELD_NAME = { categoryId: 'category', tagIds: 'tags', projectId: 'project', columnId: 'column', subjectId: 'subject', chapterId: 'chapter', taskId: 'task' };

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const present = (v) => v !== undefined && v !== null;
const lc = (s) => String(s ?? '').trim().toLowerCase();
const typeOk = (v, t) => (t === 'array' ? Array.isArray(v) : t === 'object' ? isObj(v) : t === 'number' ? typeof v === 'number' && Number.isFinite(v) : typeof v === t);
const TYPE_WORD = { string: 'text', number: 'a number', boolean: 'true or false', array: 'a list', object: 'an object' };

/* ------------------------------------------------------------------ parsing */

/** Parse pasted text. Never throws. Returns { ok, config?, error?, hint? }. */
export function parseConfig(text) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'Paste your JSON configuration into the box first.' };
  if (text.length > MAX_CONFIG_BYTES) return { ok: false, error: `The text is larger than ${MAX_CONFIG_BYTES / 1048576} MB, which is more than Lumen will import in one go.` };
  let src = text.replace(/^﻿/, '').trim();
  const fence = /^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```\s*$/.exec(src); // chat apps often wrap JSON in a code fence
  if (fence) src = fence[1].trim();
  let raw;
  try { raw = JSON.parse(src); } catch (e) {
    let where = '';
    const pm = /position (\d+)/.exec(e.message);
    if (pm) {
      const pos = Number(pm[1]); const before = src.slice(0, pos);
      where = ` (line ${before.split('\n').length}, column ${pos - before.lastIndexOf('\n')})`;
    } else { const lm = /line (\d+) column (\d+)/.exec(e.message); if (lm) where = ` (line ${lm[1]}, column ${lm[2]})`; }
    const hints = [];
    if (/[“”‘’]/.test(src)) hints.push('The text contains curly quotes. JSON needs straight quotes ("). This often happens when text is copied through a word processor.');
    if (/,\s*[}\]]/.test(src)) hints.push('There seems to be a trailing comma before a closing bracket, which JSON does not allow.');
    if (/^\s*[^{\[]/.test(src)) hints.push('The text should start with { . Remove any explanation the AI wrote before or after the JSON.');
    return { ok: false, error: `This is not valid JSON${where}. Nothing was changed.`, hint: hints.join(' ') };
  }
  let config;
  try { config = sanitizeJson(raw, { maxDepth: 12, maxNodes: 400000 }); } catch (e) { return { ok: false, error: `The structure is unsafe or too large (${e.message}).` }; }
  return { ok: true, config };
}

/** Stable 53-bit string hash (cyrb53) of the key-sorted JSON; used to recognise a configuration that was already imported. */
export function configHash(config) {
  const canon = (v) => (Array.isArray(v) ? v.map(canon) : isObj(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
  const s = JSON.stringify(canon(config));
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/* ------------------------------------------------------------------ planning */

const DEFAULT_COLUMN_NAMES = [['To do', false], ['In progress', false], ['Done', true]];

/**
 * Build the import plan. `existing` = { categories, tags, projects, subjects, tasks, notes, habits } (arrays of stored records).
 * opts: { today, skipInvalid, allowDuplicates, log: [{hash, at}] }.
 * Returns { ok, fatal?, topErrors, topWarnings, items, writes, counts, hash, previous, canImport, summary }.
 */
export function planConfig(config, existing = {}, opts = {}) {
  const today = opts.today || todayStr();
  const ex = Object.fromEntries(SECTIONS.map((k) => [k, existing[k] || []]));
  const plan = { ok: false, topErrors: [], topWarnings: [], items: [], writes: [], counts: {}, hash: null, previous: null, canImport: false, skipInvalid: !!opts.skipInvalid, allowDuplicates: !!opts.allowDuplicates };
  const top = (m) => plan.topErrors.push(m);

  if (!isObj(config)) { top('The top level must be a JSON object { ... }.'); return plan; }
  if (config.format !== CONFIG_FORMAT) top(`Missing or wrong "format". It must be exactly "${CONFIG_FORMAT}".`);
  if (!Number.isInteger(config.version)) top('Missing "version". It must be the number 1.');
  else if (config.version > CONFIG_VERSION) top(`This configuration uses version ${config.version}, which is newer than this copy of Lumen understands (${CONFIG_VERSION}).`);
  else if (config.version < 1) top('"version" must be 1.');
  for (const k of Object.keys(config)) if (!TOP_KEYS.has(k)) plan.topWarnings.push(`Unknown top-level field "${k}" was ignored.`);
  let total = 0;
  for (const s of SECTIONS) {
    if (config[s] === undefined || config[s] === null) continue;
    if (!Array.isArray(config[s])) top(`"${s}" must be a list [ ... ].`); else total += config[s].length;
  }
  if (total === 0 && !plan.topErrors.length) top('The configuration contains no items to import.');
  if (total > MAX_CONFIG_ITEMS) top(`The configuration has ${total} items; the limit is ${MAX_CONFIG_ITEMS} per import.`);
  if (plan.topErrors.length) return plan;

  plan.hash = configHash(config);
  plan.previous = (opts.log || []).find((e) => e.hash === plan.hash) || null;

  // ----- lookup tables -----
  const refs = Object.fromEntries(SECTIONS.map((k) => [k, new Map()])); // ref -> { id, entry, invalid }
  const nameIdx = { categories: new Map(), tags: new Map(), projects: new Map(), subjects: new Map() };
  const exIndex = (kind, byName) => { for (const r of ex[kind]) if (!byName.has(lc(r.name))) byName.set(lc(r.name), { id: r.id, existing: true, record: r }); };
  for (const k of Object.keys(nameIdx)) exIndex(k, nameIdx[k]);
  const dupKey = {
    tasks: (r) => [r.title, r.deadline || '', r.scheduledDate || '', r.projectId || ''].map(lc).join('|'),
    notes: (r) => [r.title, r.body].map((x) => lc(x)).join('|'),
    habits: (r) => lc(r.name),
  };
  const seenKey = Object.fromEntries(Object.keys(dupKey).map((k) => [k, new Map()]));
  for (const k of Object.keys(dupKey)) for (const r of ex[k]) { const key = dupKey[k](r); if (!seenKey[k].has(key)) seenKey[k].set(key, r.id); }
  let order = ex.tasks.reduce((m, t) => Math.max(m, Number(t.order) || 0), 0);
  const implicit = []; // labels created because a task/note named them

  const newEntry = (kind, index, raw) => {
    const title = isObj(raw) ? (raw.title ?? raw.name) : null;
    const e = { kind, index, label: `${SINGULAR[kind]} #${index + 1}${typeof title === 'string' && title.trim() ? ` “${title.trim().slice(0, 60)}”` : ''}`, status: 'new', messages: [], record: null, id: null, dep: false, extra: [] };
    plan.items.push(e);
    return e;
  };
  const err = (e, path, message) => e.messages.push({ level: 'error', path, message });
  const warn = (e, path, message) => e.messages.push({ level: 'warning', path, message });
  const depErr = (e, path, message) => { e.dep = true; err(e, path, message); };

  function shape(e, raw, spec) {
    if (!isObj(raw)) { err(e, '', 'must be an object { ... }'); return false; }
    let ok = true;
    for (const k of Object.keys(raw)) if (!(k in spec)) warn(e, k, `Unknown field "${k}" was ignored.`);
    for (const [k, t] of Object.entries(spec)) {
      if (present(raw[k]) && !typeOk(raw[k], t)) { err(e, k, `must be ${TYPE_WORD[t]}`); ok = false; }
    }
    return ok;
  }
  const registerRef = (e, kind, raw) => {
    if (!present(raw.ref) || typeof raw.ref !== 'string') return;
    const r = raw.ref.trim();
    if (!r) return;
    if (refs[kind].has(r)) { err(e, 'ref', `"${r}" is already used by another ${SINGULAR[kind].toLowerCase()} in this file. Each ref must be unique within its list.`); return; }
    refs[kind].set(r, { id: null, entry: e });
  };
  const finish = (e, kind, rec, entity = ENTITIES[STORE_OF[kind]]) => {
    const r = normalizeRecord(entity, rec, { repair: false });
    for (const m of r.errors) e.messages.push({ level: 'error', path: String(m.path || '').replace(/^[a-zA-Z]+(?=$|\.|\[)/, (f) => FIELD_NAME[f] || f), message: m.message });
    if (!r.ok) return null;
    return r.value;
  };
  const bindRef = (e, kind, id) => { const k = e.refKey; if (k && refs[kind].get(k)?.entry === e) refs[kind].get(k).id = id; };

  /* ----- labels (categories / tags) ----- */
  const labelFor = (kind, value, e, path) => {
    if (typeof value !== 'string' || !value.trim()) { err(e, path, 'must be a name (text)'); return null; }
    const v = value.trim();
    const byRef = refs[kind].get(v);
    if (byRef) {
      if (!byRef.id) { depErr(e, path, `refers to ${byRef.entry.label}, which has errors`); return null; }
      byRef.entry.usedBy = (byRef.entry.usedBy || []); byRef.entry.usedBy.push(e);
      return byRef.id;
    }
    const hit = nameIdx[kind].get(lc(v));
    if (hit) { if (hit.entry) { hit.entry.usedBy = hit.entry.usedBy || []; hit.entry.usedBy.push(e); } return hit.id; }
    // unknown name: create it implicitly (labels are low-risk and this is what people expect from "category": "Work")
    const rec = finish(e, kind, { id: uid(ID_PREFIX[kind]), name: v, color: undefined }, ENTITIES[kind]);
    if (!rec) { for (const m of e.messages) if (m.level === 'error' && /^name/.test(m.path)) m.path = path; return null; }
    const imp = { kind, label: `${SINGULAR[kind]} “${rec.name}” (created from a reference)`, status: 'new', record: rec, id: rec.id, implicit: true, usedBy: [e], messages: [] };
    implicit.push(imp); nameIdx[kind].set(lc(v), { id: rec.id, entry: imp });
    return rec.id;
  };

  /* ===== categories & tags ===== */
  for (const kind of ['categories', 'tags']) {
    (config[kind] || []).forEach((raw, i) => {
      const e = newEntry(kind, i, raw); e.refKey = isObj(raw) && typeof raw.ref === 'string' ? raw.ref.trim() : null;
      if (!shape(e, raw, SPECS[kind])) return;
      registerRef(e, kind, raw);
      const name = typeof raw.name === 'string' ? raw.name.trim() : '';
      const known = nameIdx[kind].get(lc(name));
      if (known && !known.existing) { err(e, 'name', `“${name}” appears twice in this file (names are not case-sensitive).`); return; }
      if (known) { e.status = 'reuse'; e.id = known.id; e.note = 'already exists; will be reused'; bindRef(e, kind, known.id); if (present(raw.color)) warn(e, 'color', 'The existing item keeps its own colour.'); nameIdx[kind].set(lc(name), { ...known, entry: e }); return; }
      const rec = finish(e, kind, { id: uid(ID_PREFIX[kind]), name: raw.name, color: raw.color });
      if (!rec || e.messages.some((m) => m.level === 'error')) return;
      e.record = rec; e.id = rec.id; bindRef(e, kind, rec.id); nameIdx[kind].set(lc(rec.name), { id: rec.id, entry: e });
    });
  }

  /* ===== projects ===== */
  const projectInfo = new Map(); // id -> { columns }
  const resolveByNameOrRef = (kind, value, e, path) => {
    if (typeof value !== 'string' || !value.trim()) { err(e, path, 'must be a ref or a name (text)'); return null; }
    const v = value.trim();
    const byRef = refs[kind].get(v);
    let hit = null;
    if (byRef) {
      if (byRef.entry.status === 'invalid' || !byRef.id) { depErr(e, path, `refers to ${byRef.entry.label}, which has errors`); return null; }
      hit = byRef.entry;
    } else {
      const n = nameIdx[kind].get(lc(v));
      if (!n) { err(e, path, `no ${SINGULAR[kind].toLowerCase()} with the ref or name “${v}”. Declare it in "${kind}" or use the exact name of an existing one.`); return null; }
      hit = n.entry || { id: n.id, record: n.record, existing: true };
    }
    (hit.usedBy = hit.usedBy || []).push(e);
    return hit;
  };

  (config.projects || []).forEach((raw, i) => {
    const e = newEntry('projects', i, raw); e.refKey = isObj(raw) && typeof raw.ref === 'string' ? raw.ref.trim() : null;
    if (!shape(e, raw, SPECS.projects)) return;
    registerRef(e, 'projects', raw);
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    const known = nameIdx.projects.get(lc(name));
    if (known && !plan.allowDuplicates) {
      if (known.existing) {
        e.status = 'reuse'; e.id = known.id; e.note = 'a project with this name exists; it will be reused and left unchanged';
        if (present(raw.columns) || present(raw.milestones) || present(raw.description) || present(raw.notes)) warn(e, '', 'The existing project is not modified, so its columns, milestones and text from this file were ignored.');
        projectInfo.set(known.id, { columns: known.record.columns }); bindRef(e, 'projects', known.id); nameIdx.projects.set(lc(name), { ...known, entry: e });
      } else err(e, 'name', `“${name}” appears twice in this file.`);
      return;
    }
    const cols = [];
    const colsRaw = Array.isArray(raw.columns) && raw.columns.length ? raw.columns : DEFAULT_COLUMN_NAMES.map(([n, d]) => ({ name: n, done: d }));
    colsRaw.forEach((c, ci) => {
      if (typeof c === 'string') cols.push({ id: uid('col'), name: c, done: false });
      else if (isObj(c) && typeof c.name === 'string') { cols.push({ id: uid('col'), name: c.name, done: c.done === true }); if (present(c.done) && typeof c.done !== 'boolean') err(e, `columns[${ci}].done`, 'must be true or false'); }
      else err(e, `columns[${ci}]`, 'must be a name (text) or an object { "name": "...", "done": false }');
    });
    const seen = new Set();
    for (const c of cols) { if (seen.has(lc(c.name))) err(e, 'columns', `column name “${c.name}” is used twice`); seen.add(lc(c.name)); }
    const ms = [];
    (raw.milestones || []).forEach((m, mi) => {
      if (isObj(m) && typeof m.title === 'string') { ms.push({ id: uid('ms'), title: m.title, date: present(m.date) ? m.date : null, done: m.done === true }); if (present(m.done) && typeof m.done !== 'boolean') err(e, `milestones[${mi}].done`, 'must be true or false'); }
      else err(e, `milestones[${mi}]`, 'must be an object { "title": "...", "date": "YYYY-MM-DD" }');
    });
    const rec = finish(e, 'projects', { id: uid('proj'), name: raw.name, description: raw.description, notes: raw.notes, deadline: raw.deadline, color: raw.color, status: 'active', columns: cols, milestones: ms });
    if (!rec || e.messages.some((m) => m.level === 'error')) return;
    e.record = rec; e.id = rec.id; projectInfo.set(rec.id, { columns: rec.columns }); bindRef(e, 'projects', rec.id);
    nameIdx.projects.set(lc(rec.name), { id: rec.id, entry: e, record: rec });
  });

  /* ===== subjects ===== */
  const subjectInfo = new Map();
  (config.subjects || []).forEach((raw, i) => {
    const e = newEntry('subjects', i, raw); e.refKey = isObj(raw) && typeof raw.ref === 'string' ? raw.ref.trim() : null;
    if (!shape(e, raw, SPECS.subjects)) return;
    registerRef(e, 'subjects', raw);
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    const known = nameIdx.subjects.get(lc(name));
    if (known && !plan.allowDuplicates) {
      if (known.existing) {
        e.status = 'reuse'; e.id = known.id; e.note = 'a subject with this name exists; it will be reused and left unchanged';
        if (present(raw.chapters) || present(raw.examDate)) warn(e, '', 'The existing subject is not modified, so its chapters and exam date from this file were ignored.');
        subjectInfo.set(known.id, { chapters: known.record.chapters }); bindRef(e, 'subjects', known.id); nameIdx.subjects.set(lc(name), { ...known, entry: e });
      } else err(e, 'name', `“${name}” appears twice in this file.`);
      return;
    }
    const chapters = [];
    (raw.chapters || []).forEach((c, ci) => {
      if (!isObj(c) || typeof c.title !== 'string') { err(e, `chapters[${ci}]`, 'must be an object { "title": "...", "plannedMin": 60, "topics": [...] }'); return; }
      if (present(c.plannedMin) && typeof c.plannedMin !== 'number') err(e, `chapters[${ci}].plannedMin`, 'must be a number of minutes');
      const topics = [];
      (Array.isArray(c.topics) ? c.topics : []).forEach((t, ti) => {
        if (typeof t === 'string') topics.push({ id: uid('top'), title: t, done: false });
        else if (isObj(t) && typeof t.title === 'string') topics.push({ id: uid('top'), title: t.title, done: t.done === true });
        else err(e, `chapters[${ci}].topics[${ti}]`, 'must be a title (text) or { "title": "...", "done": false }');
      });
      chapters.push({ id: uid('chap'), title: c.title, done: false, completedAt: null, plannedMin: present(c.plannedMin) ? c.plannedMin : 0, topics, revisions: [] });
    });
    const rec = finish(e, 'subjects', { id: uid('subj'), name: raw.name, color: raw.color, examDate: raw.examDate, examTime: raw.examTime, archived: false, chapters });
    if (!rec || e.messages.some((m) => m.level === 'error')) return;
    e.record = rec; e.id = rec.id; subjectInfo.set(rec.id, { chapters: rec.chapters }); bindRef(e, 'subjects', rec.id);
    nameIdx.subjects.set(lc(rec.name), { id: rec.id, entry: e, record: rec });
  });

  /* ===== tasks ===== */
  const tagList = (e, raw, path) => {
    if (!present(raw.tags)) return [];
    const ids = [];
    raw.tags.forEach((t, ti) => { const id = labelFor('tags', t, e, `${path}[${ti}]`); if (id && !ids.includes(id)) ids.push(id); });
    return ids;
  };
  (config.tasks || []).forEach((raw, i) => {
    const e = newEntry('tasks', i, raw); e.refKey = isObj(raw) && typeof raw.ref === 'string' ? raw.ref.trim() : null;
    if (!shape(e, raw, SPECS.tasks)) return;
    registerRef(e, 'tasks', raw);
    if (present(raw.priority) && !['low', 'medium', 'high', 'critical'].includes(raw.priority)) err(e, 'priority', 'must be one of: low, medium, high, critical');
    if (present(raw.status) && !['todo', 'done'].includes(raw.status)) err(e, 'status', 'must be one of: todo, done');
    const categoryId = present(raw.category) ? labelFor('categories', raw.category, e, 'category') : null;
    const tagIds = tagList(e, raw, 'tags');
    let projectId = null, columnId = null, subjectId = null, chapterId = null;
    if (present(raw.project)) {
      const p = resolveByNameOrRef('projects', raw.project, e, 'project');
      if (p) {
        projectId = p.id; const cols = projectInfo.get(p.id)?.columns || [];
        if (present(raw.column)) {
          const c = typeof raw.column === 'string' ? cols.find((x) => lc(x.name) === lc(raw.column)) : null;
          if (c) columnId = c.id; else err(e, 'column', `the project has no column called “${raw.column}” (columns: ${cols.map((x) => x.name).join(', ') || 'none'})`);
        } else if (cols.length) columnId = ((raw.status === 'done' && cols.find((x) => x.done)) || cols[0]).id;
      }
    } else if (present(raw.column)) err(e, 'column', 'a "column" needs a "project"');
    if (present(raw.subject)) {
      const s = resolveByNameOrRef('subjects', raw.subject, e, 'subject');
      if (s) {
        subjectId = s.id; const chs = subjectInfo.get(s.id)?.chapters || [];
        if (present(raw.chapter)) {
          const c = typeof raw.chapter === 'string' ? chs.find((x) => lc(x.title) === lc(raw.chapter)) : null;
          if (c) chapterId = c.id; else err(e, 'chapter', `the subject has no chapter called “${raw.chapter}”`);
        }
      }
    } else if (present(raw.chapter)) err(e, 'chapter', 'a "chapter" needs a "subject"');

    const subtasks = [];
    if (present(raw.subtasks)) raw.subtasks.forEach((s, si) => {
      if (typeof s === 'string') subtasks.push({ id: uid('sub'), title: s, done: false });
      else if (isObj(s) && typeof s.title === 'string') { subtasks.push({ id: uid('sub'), title: s.title, done: s.done === true }); if (present(s.done) && typeof s.done !== 'boolean') err(e, `subtasks[${si}].done`, 'must be true or false'); }
      else err(e, `subtasks[${si}]`, 'must be a title (text) or { "title": "...", "done": false }');
    });
    let recurrence = null;
    if (present(raw.recurrence)) {
      const R = { freq: 'string', interval: 'number', byWeekday: 'array', endDate: 'string', count: 'number' };
      const rr = raw.recurrence;
      for (const k of Object.keys(rr)) if (!(k in R)) warn(e, `recurrence.${k}`, `Unknown field "${k}" was ignored.`);
      for (const [k, t] of Object.entries(R)) if (present(rr[k]) && !typeOk(rr[k], t)) err(e, `recurrence.${k}`, `must be ${TYPE_WORD[t]}`);
      if (present(rr.freq) && !['daily', 'weekly', 'monthly', 'yearly'].includes(rr.freq)) err(e, 'recurrence.freq', 'must be one of: daily, weekly, monthly, yearly');
      else if (!present(rr.freq)) err(e, 'recurrence.freq', 'is required when "recurrence" is given');
      recurrence = { freq: rr.freq, interval: rr.interval, byWeekday: rr.byWeekday ?? [], endDate: rr.endDate, count: rr.count, anchor: null };
      if (present(rr.count) && present(rr.endDate)) warn(e, 'recurrence', 'Both "count" and "endDate" are set; the series stops at whichever comes first.');
    }
    let focus;
    if (present(raw.focus)) {
      for (const k of Object.keys(raw.focus)) if (k !== 'enabled' && k !== 'durationMin') warn(e, `focus.${k}`, `Unknown field "${k}" was ignored.`);
      if (present(raw.focus.enabled) && typeof raw.focus.enabled !== 'boolean') err(e, 'focus.enabled', 'must be true or false');
      if (present(raw.focus.durationMin) && typeof raw.focus.durationMin !== 'number') err(e, 'focus.durationMin', 'must be a number of minutes');
      focus = { enabled: raw.focus.enabled === true, durationMin: raw.focus.durationMin };
    }
    // task-specific rules from the entity run inside finish(); `order` is assigned only if the task will be new
    const rec = finish(e, 'tasks', {
      id: uid('task'), title: raw.title, description: raw.description, priority: raw.priority, status: raw.status || 'todo', categoryId, tagIds,
      startDate: raw.startDate, deadline: raw.deadline, deadlineTime: raw.deadlineTime, scheduledDate: raw.scheduledDate, scheduledTime: raw.scheduledTime,
      estimateMin: raw.estimateMin, subtasks, recurrence, focus, projectId, columnId, subjectId, chapterId, seriesId: null,
    });
    if (!rec || e.messages.some((m) => m.level === 'error')) return;
    const key = dupKey.tasks(rec);
    if (!plan.allowDuplicates && seenKey.tasks.has(key)) { e.status = 'duplicate'; e.matchId = seenKey.tasks.get(key); e.id = e.matchId; e.note = 'same title and dates already exist'; return; }
    seenKey.tasks.set(key, rec.id);
    order += 10; rec.order = order;
    e.record = rec; e.id = rec.id; bindRef(e, 'tasks', rec.id);
  });

  /* ===== notes ===== */
  (config.notes || []).forEach((raw, i) => {
    const e = newEntry('notes', i, raw); e.refKey = isObj(raw) && typeof raw.ref === 'string' ? raw.ref.trim() : null;
    if (!shape(e, raw, SPECS.notes)) return;
    registerRef(e, 'notes', raw);
    if (!String(raw.title ?? '').trim() && !String(raw.body ?? '').trim()) { err(e, 'body', 'a note needs a "title" or a "body"'); return; }
    const categoryId = present(raw.category) ? labelFor('categories', raw.category, e, 'category') : null;
    const tagIds = tagList(e, raw, 'tags');
    let taskId = null, projectId = null, subjectId = null;
    if (present(raw.task)) {
      const t = typeof raw.task === 'string' ? refs.tasks.get(raw.task.trim()) : null;
      if (!t) err(e, 'task', `no task with the ref “${raw.task}” in this file. Notes can only link to tasks declared in "tasks" with a "ref".`);
      else if (t.entry.status === 'invalid' || t.entry.messages.some((m) => m.level === 'error') || t.entry.status === 'skipped') depErr(e, 'task', `refers to ${t.entry.label}, which has errors`);
      else { taskId = t.entry.status === 'duplicate' ? t.entry.matchId : t.id; (t.entry.usedBy = t.entry.usedBy || []).push(e); }
    }
    if (present(raw.project)) { const p = resolveByNameOrRef('projects', raw.project, e, 'project'); if (p) projectId = p.id; }
    if (present(raw.subject)) { const s = resolveByNameOrRef('subjects', raw.subject, e, 'subject'); if (s) subjectId = s.id; }
    const rec = finish(e, 'notes', { id: uid('note'), title: raw.title, body: raw.body, pinned: raw.pinned === true, categoryId, tagIds, taskId, projectId, subjectId });
    if (!rec || e.messages.some((m) => m.level === 'error')) return;
    const key = dupKey.notes(rec);
    if (!plan.allowDuplicates && seenKey.notes.has(key)) { e.status = 'duplicate'; e.matchId = seenKey.notes.get(key); e.note = 'a note with the same title and text already exists'; return; }
    seenKey.notes.set(key, rec.id);
    e.record = rec; e.id = rec.id;
  });

  /* ===== habits ===== */
  (config.habits || []).forEach((raw, i) => {
    const e = newEntry('habits', i, raw); e.refKey = isObj(raw) && typeof raw.ref === 'string' ? raw.ref.trim() : null;
    if (!shape(e, raw, SPECS.habits)) return;
    registerRef(e, 'habits', raw);
    let schedule = { type: 'daily', days: [], perWeek: 3 };
    if (present(raw.schedule)) {
      const s = raw.schedule; const S = { type: 'string', days: 'array', perWeek: 'number' };
      for (const k of Object.keys(s)) if (!(k in S)) warn(e, `schedule.${k}`, `Unknown field "${k}" was ignored.`);
      for (const [k, t] of Object.entries(S)) if (present(s[k]) && !typeOk(s[k], t)) err(e, `schedule.${k}`, `must be ${TYPE_WORD[t]}`);
      if (present(s.type) && !['daily', 'days', 'weekly'].includes(s.type)) err(e, 'schedule.type', 'must be one of: daily, days, weekly');
      schedule = { type: s.type || 'daily', days: s.days ?? [], perWeek: s.perWeek ?? 3 };
    }
    const startDate = present(raw.startDate) ? raw.startDate : today;
    const rec = finish(e, 'habits', { id: uid('habit'), name: raw.name, description: raw.description, color: raw.color, schedule, scheduleHistory: [{ from: startDate, schedule }], startDate, archived: false, notes: raw.notes, reminderTime: raw.reminderTime });
    if (!rec || e.messages.some((m) => m.level === 'error')) return;
    const key = dupKey.habits(rec);
    if (!plan.allowDuplicates && seenKey.habits.has(key)) { e.status = 'duplicate'; e.matchId = seenKey.habits.get(key); e.note = 'a habit with this name already exists'; return; }
    seenKey.habits.set(key, rec.id);
    e.record = rec; e.id = rec.id;
  });

  /* ===== settle statuses and build the write list ===== */
  for (const e of plan.items) {
    const hasErr = e.messages.some((m) => m.level === 'error');
    if (hasErr) e.status = e.dep && e.messages.every((m) => m.level !== 'error' || /which has errors/.test(m.message)) ? 'skipped' : 'invalid';
  }
  // a reuse/new item that something else depended on and then turned invalid does not matter; but a NEW label/project that is
  // only used by items that will not be written is still written when it was declared explicitly, and dropped when implicit.
  const willWrite = (e) => e.status === 'new' && e.record;
  const writeEntries = plan.items.filter(willWrite);
  for (const imp of implicit) if (imp.usedBy.some((u) => willWrite(u))) { plan.items.push({ ...imp, kind: imp.kind, index: -1, messages: [], extra: [] }); writeEntries.push(imp); }
  plan.writes = writeEntries.map((e) => ({ store: STORE_OF[e.kind], record: e.record, kind: e.kind }));

  const counts = {};
  for (const k of SECTIONS) counts[k] = { total: 0, new: 0, reuse: 0, duplicate: 0, invalid: 0, skipped: 0, implicit: 0 };
  for (const e of plan.items) { const c = counts[e.kind]; if (e.implicit) { c.implicit++; c.new++; continue; } c.total++; c[e.status]++; }
  plan.counts = counts;
  const nBad = plan.items.filter((e) => e.status === 'invalid' || e.status === 'skipped').length;
  plan.invalid = nBad;
  plan.ok = nBad === 0;
  plan.canImport = plan.writes.length > 0 && (nBad === 0 || plan.skipInvalid);
  plan.summary = { new: plan.writes.length, reuse: plan.items.filter((e) => e.status === 'reuse').length, duplicate: plan.items.filter((e) => e.status === 'duplicate').length, invalid: plan.items.filter((e) => e.status === 'invalid').length, skipped: plan.items.filter((e) => e.status === 'skipped').length };
  return plan;
}

/** Human-readable lines for the error list: "Task #4 “Write report” → deadline: must be a valid date". */
export function problemLines(plan, level = 'error') {
  const out = [];
  for (const e of plan.items) for (const m of e.messages) if (m.level === level) out.push(`${e.label}${m.path ? ` → ${m.path}` : ''}: ${m.message}`);
  return out;
}
