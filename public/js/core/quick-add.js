// Quick-add parser: "Pay rent !high #bills @Home tomorrow ~30m" -> structured task fields.
//   !low !med !high !crit      priority
//   #tag                       tag (multiple allowed)
//   @category                  category (one)
//   today tomorrow mon..sun    deadline (only whole words, case-insensitive)
//   ~30m ~1h ~1h30m ~90        estimate
import { addDays, todayStr, weekdayOf } from './util.js';

const PRI = { low: 'low', med: 'medium', medium: 'medium', high: 'high', crit: 'critical', critical: 'critical' };
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function parseDuration(s) {
  const m = /^(?:(\d+)h)?(?:(\d+)m?)?$/i.exec(s);
  if (!m || (!m[1] && !m[2])) return null;
  const n = (+(m[1] || 0)) * 60 + (+(m[2] || 0));
  return n > 0 && n <= 100000 ? n : null;
}

export function nextWeekday(today, target) {
  const diff = (target - weekdayOf(today) + 7) % 7;
  return addDays(today, diff === 0 ? 7 : diff);
}

export function parseQuickAdd(input, today = todayStr()) {
  const out = { title: '', priority: null, tags: [], category: null, deadline: null, estimateMin: null };
  const words = [];
  for (const raw of String(input).trim().split(/\s+/)) {
    const w = raw.toLowerCase();
    let m;
    if ((m = /^!([a-z]+)$/.exec(w)) && PRI[m[1]]) out.priority = PRI[m[1]];
    else if ((m = /^#([\p{L}\p{N}_-]{1,40})$/u.exec(raw))) out.tags.push(m[1]);
    else if ((m = /^@([\p{L}\p{N}_-]{1,40})$/u.exec(raw))) out.category = m[1];
    else if ((m = /^~(.+)$/.exec(w)) && parseDuration(m[1])) out.estimateMin = parseDuration(m[1]);
    else if (w === 'today') out.deadline = today;
    else if (w === 'tomorrow') out.deadline = addDays(today, 1);
    else if (DAYS.includes(w.slice(0, 3)) && (w.length === 3 || ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].includes(w))) out.deadline = nextWeekday(today, DAYS.indexOf(w.slice(0, 3)));
    else words.push(raw);
  }
  out.title = words.join(' ').trim();
  out.tags = [...new Set(out.tags)];
  return out;
}
