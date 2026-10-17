// Small, dependency-free helpers shared by every module. Pure functions only
// (apart from uid/debounce), so they are unit-testable in Node.
import { clock } from './clock.js';

/* ---------- ids ---------- */
export function uid(prefix = 'id') {
  let r;
  if (globalThis.crypto?.randomUUID) r = globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 20);
  else r = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  return `${prefix}_${r}`;
}

/* ---------- numbers ---------- */
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
export const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

/* ---------- dates: all calendar dates are local "YYYY-MM-DD" strings ---------- */
export const pad2 = (n) => String(n).padStart(2, '0');

export function ymd(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function parseYmd(s) {
  if (typeof s !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

export const isYmd = (s) => parseYmd(s) !== null;
export const isHm = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

export function todayStr(now = clock.now()) {
  return ymd(new Date(now));
}

export function addDays(s, n) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

/** Add months, clamping the day (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(s, n) {
  const d = parseYmd(s);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return ymd(d);
}

export function addYears(s, n) {
  return addMonths(s, n * 12);
}

/** Whole days from a to b (b - a). DST safe because it works in UTC. */
export function diffDays(a, b) {
  const da = parseYmd(a), db = parseYmd(b);
  return Math.round((Date.UTC(db.getFullYear(), db.getMonth(), db.getDate()) - Date.UTC(da.getFullYear(), da.getMonth(), da.getDate())) / 86400000);
}

export const weekdayOf = (s) => parseYmd(s).getDay(); // 0 = Sunday

export function startOfWeek(s, weekStart = 1) {
  const diff = (weekdayOf(s) - weekStart + 7) % 7;
  return addDays(s, -diff);
}

export function monthStart(s) { return s.slice(0, 8) + '01'; }
export function monthEnd(s) {
  const d = parseYmd(s);
  return ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

export const timeToMin = (hm) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
export const minToTime = (min) => `${pad2(Math.floor(min / 60) % 24)}:${pad2(min % 60)}`;

/** Local epoch-ms for a date string plus optional HH:mm. */
export function toEpoch(dateStr, hm = '00:00') {
  const d = parseYmd(dateStr);
  const [h, m] = hm.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

/* ---------- formatting (locale aware; not used in unit-tested logic) ---------- */
export function fmtDate(s, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  const d = parseYmd(s);
  return d ? new Intl.DateTimeFormat(undefined, opts).format(d) : '';
}

export function fmtTime(hm, hour12) {
  if (!hm) return '';
  const [h, m] = hm.split(':').map(Number);
  const d = new Date(2000, 0, 1, h, m);
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12 }).format(d);
}

/** 3725000 -> "1h 02m". Minutes are rounded down so we never overstate. */
export function fmtDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(total / 60), m = total % 60;
  if (h && m) return `${h}h ${pad2(m)}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/** Timer face: mm:ss or h:mm:ss. ceil=true for countdowns so 0:00 only shows at the very end. */
export function fmtClock(ms, ceil = false) {
  const s = Math.max(0, ceil ? Math.ceil(ms / 1000) : Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${pad2(m)}:${pad2(sec)}` : `${pad2(m)}:${pad2(sec)}`;
}

/* ---------- misc ---------- */
export function debounce(fn, ms) {
  let t;
  const wrapped = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  wrapped.flush = (...args) => { clearTimeout(t); fn(...args); };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

export const clone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

export function groupBy(arr, fn) {
  const m = new Map();
  for (const x of arr) {
    const k = fn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

export const sum = (arr, fn = (x) => x) => arr.reduce((a, x) => a + fn(x), 0);

export function sortBy(arr, ...keys) {
  return [...arr].sort((a, b) => {
    for (const k of keys) {
      const f = typeof k === 'function' ? k : (x) => x[k];
      const va = f(a), vb = f(b);
      if (va < vb) return -1;
      if (va > vb) return 1;
    }
    return 0;
  });
}

export function plural(n, one, many = one + 's') {
  return `${n} ${n === 1 ? one : many}`;
}
