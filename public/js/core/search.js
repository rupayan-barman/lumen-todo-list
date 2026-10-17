// Unified search across every module. Pure: takes plain arrays, returns ranked results.
import { isArchived } from './task-query.js';
import { stripMarkdown } from './markdown.js';

export const SEARCH_TYPES = [['task', 'Tasks'], ['archived', 'Archived tasks'], ['note', 'Notes'], ['project', 'Projects'], ['habit', 'Habits'], ['subject', 'Subjects'], ['tag', 'Tags']];

const lc = (s) => String(s ?? '').toLowerCase();

function score(title, body, words) {
  const t = lc(title), b = lc(body);
  let total = 0;
  for (const w of words) {
    let s = 0;
    if (t === w) s = 100;
    else if (t.startsWith(w)) s = 80;
    else if (new RegExp(`(^|[\\s\\-_/#@])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(t)) s = 60;
    else if (t.includes(w)) s = 45;
    else if (b.includes(w)) s = 15;
    else return 0; // every word must match somewhere
    total += s;
  }
  return total / words.length;
}

function snippet(text, words, max = 140) {
  const plain = stripMarkdown(text, 100000);
  const i = words.map((w) => lc(plain).indexOf(w)).filter((n) => n >= 0).sort((a, b) => a - b)[0];
  if (i === undefined) return plain.slice(0, max);
  const start = Math.max(0, i - 40);
  return (start ? '…' : '') + plain.slice(start, start + max) + (start + max < plain.length ? '…' : '');
}

/**
 * searchAll({tasks,notes,projects,habits,subjects,tags,categories}, query, { types:Set|null, limit })
 * -> [{ type, id, title, snippet, score, archived?, meta? }]
 */
export function searchAll(data, query, { types = null, limit = 60 } = {}) {
  const words = lc(query).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const want = (t) => !types || types.size === 0 || types.has(t);
  const out = [];
  const tagName = new Map((data.tags || []).map((t) => [t.id, t.name]));
  const catName = new Map((data.categories || []).map((c) => [c.id, c.name]));

  for (const t of data.tasks || []) {
    const arch = isArchived(t);
    if (!want(arch ? 'archived' : 'task')) continue;
    const body = [t.description, ...(t.subtasks || []).map((s) => s.title), ...(t.tagIds || []).map((i) => tagName.get(i)), catName.get(t.categoryId)].join(' ');
    const s = score(t.title, body, words); if (s <= 0) continue;
    out.push({ type: arch ? 'archived' : 'task', id: t.id, title: t.title, snippet: snippet(t.description || body, words), score: s + (arch ? -5 : 5), archived: arch, meta: t.status === 'done' ? 'Completed' : t.deadline ? `Due ${t.deadline}` : '' });
  }
  if (want('note')) for (const n of data.notes || []) {
    const body = [n.body, ...(n.tagIds || []).map((i) => tagName.get(i))].join(' ');
    const s = score(n.title || 'Untitled note', body, words); if (s <= 0) continue;
    out.push({ type: 'note', id: n.id, title: n.title || 'Untitled note', snippet: snippet(n.body, words), score: s + (n.pinned ? 4 : 0), meta: n.pinned ? 'Pinned' : '' });
  }
  if (want('project')) for (const p of data.projects || []) {
    const s = score(p.name, `${p.description} ${p.notes}`, words); if (s <= 0) continue;
    out.push({ type: 'project', id: p.id, title: p.name, snippet: snippet(p.description || p.notes, words), score: s, meta: p.status === 'archived' ? 'Archived' : '' });
  }
  if (want('habit')) for (const h of data.habits || []) {
    const s = score(h.name, `${h.description} ${h.notes}`, words); if (s <= 0) continue;
    out.push({ type: 'habit', id: h.id, title: h.name, snippet: snippet(h.description || h.notes, words), score: s, meta: h.archived ? 'Archived' : '' });
  }
  if (want('subject')) for (const sj of data.subjects || []) {
    const s = score(sj.name, (sj.chapters || []).map((c) => c.title).join(' '), words); if (s <= 0) continue;
    out.push({ type: 'subject', id: sj.id, title: sj.name, snippet: (sj.chapters || []).slice(0, 4).map((c) => c.title).join(' · '), score: s, meta: sj.examDate ? `Exam ${sj.examDate}` : '' });
  }
  if (want('tag')) for (const g of [...(data.tags || []), ...(data.categories || []).map((c) => ({ ...c, isCategory: true }))]) {
    const s = score(g.name, '', words); if (s <= 0) continue;
    out.push({ type: 'tag', id: g.id, title: `${g.isCategory ? '' : '#'}${g.name}`, snippet: g.isCategory ? 'Category' : 'Tag', score: s - 2, meta: g.isCategory ? 'category' : 'tag' });
  }
  out.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return out.slice(0, limit);
}

/** Subsequence-style fuzzy match for command titles. Returns score or 0. */
export function fuzzy(title, query) {
  const t = lc(title), q = lc(query).trim();
  if (!q) return 1;
  if (t.startsWith(q)) return 100 - t.length * 0.1;
  const i = t.indexOf(q); if (i >= 0) return 80 - i * 0.5;
  const words = q.split(/\s+/);
  if (words.every((w) => t.includes(w))) return 60;
  let j = 0; for (const ch of t) if (ch === q[j]) j++;
  return j === q.length ? 30 : 0;
}
