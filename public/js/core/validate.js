// A small schema engine used for BOTH form input (strict: report errors) and
// loading/importing stored data (repair: fix what we can, never throw on bad fields).
import { isYmd, isHm, isNum, clone } from './util.js';

export class ValidationError extends Error {
  constructor(errors) {
    super(errors.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message)).join('; '));
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

const ID_RE = /^[A-Za-z0-9_.:-]{1,120}$/;
const HEX6 = /^#[0-9a-fA-F]{6}$/;
const HEX3 = /^#[0-9a-fA-F]{3}$/;
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
// eslint-disable-next-line no-control-regex
const CTRL_ONE_LINE = /[\u0000-\u001f\u007f]+/g;
// eslint-disable-next-line no-control-regex
const CTRL_MULTI = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export function normHex(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (HEX6.test(s)) return s.toLowerCase();
  if (HEX3.test(s)) return ('#' + s.slice(1).split('').map((c) => c + c).join('')).toLowerCase();
  return null;
}

/** Deep-clone arbitrary JSON, dropping prototype-pollution keys, functions and cycles. */
export function sanitizeJson(value, { maxDepth = 10, maxNodes = 100000 } = {}) {
  let nodes = 0;
  const walk = (v, depth) => {
    if (++nodes > maxNodes) throw new Error('Data structure too large');
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string') return v;
    if (depth > maxDepth) throw new Error('Data structure too deep');
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    if (typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v)) {
        if (FORBIDDEN.has(k)) continue;
        const r = walk(v[k], depth + 1);
        if (r !== undefined) out[k] = r;
      }
      return out;
    }
    return undefined; // functions, symbols, undefined
  };
  return walk(value, 0);
}

function defaultFor(spec) {
  if (spec.nullable) return null;
  if (spec.def !== undefined) return typeof spec.def === 'function' ? spec.def() : clone(spec.def);
  switch (spec.t) {
    case 'str': return '';
    case 'arr': return [];
    case 'bool': return false;
    case 'enum': return spec.vals[0];
    case 'num': return spec.min ?? 0;
    case 'obj': return buildDefaults(spec.fields);
    case 'json': return {};
    default: return null;
  }
}

function buildDefaults(fields) {
  const out = {};
  for (const [k, s] of Object.entries(fields)) out[k] = defaultFor(s);
  return out;
}

/**
 * Normalise one value against a spec. Returns the cleaned value.
 * ctx = { errors:[], warnings:[], repair:boolean }
 */
export function norm(spec, value, path, ctx) {
  const fail = (msg) => {
    if (ctx.repair) {
      ctx.warnings.push({ path, message: msg });
      return defaultFor(spec);
    }
    ctx.errors.push({ path, message: msg });
    return value;
  };
  const label = spec.label || path;

  // Empty form fields ('') count as "not provided" for every type except text and enums.
  const empty = value === undefined || value === null || (value === '' && spec.t !== 'str' && spec.t !== 'enum');
  if (empty) {
    if (spec.req && !ctx.repair) {
      ctx.errors.push({ path, message: `${label} is required` });
      return value;
    }
    return defaultFor(spec);
  }

  switch (spec.t) {
    case 'str': {
      if (typeof value === 'number' || typeof value === 'boolean') value = String(value);
      if (typeof value !== 'string') return fail(`${label} must be text`);
      let s = spec.multiline ? value.replace(CTRL_MULTI, '').replace(/\r\n?/g, '\n') : value.replace(CTRL_ONE_LINE, ' ');
      if (spec.trim !== false) s = s.trim();
      const max = spec.max ?? 2000;
      if (s.length > max) {
        if (ctx.repair) { s = s.slice(0, max); ctx.warnings.push({ path, message: `${label} was truncated` }); }
        else { ctx.errors.push({ path, message: `${label} is too long (max ${max} characters)` }); return s; }
      }
      if (spec.req && s.length === 0) {
        if (ctx.repair && spec.def) return typeof spec.def === 'function' ? spec.def() : spec.def;
        ctx.errors.push({ path, message: `${label} is required` });
        return s;
      }
      if (spec.min && s.length < spec.min && !ctx.repair) { ctx.errors.push({ path, message: `${label} is too short` }); return s; }
      return s;
    }
    case 'num': {
      let n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
      if (!isNum(n)) return fail(`${label} must be a number`);
      if (spec.int) n = Math.round(n);
      if (spec.min !== undefined && n < spec.min) { if (ctx.repair) return spec.min; ctx.errors.push({ path, message: `${label} must be at least ${spec.min}` }); return n; }
      if (spec.max !== undefined && n > spec.max) { if (ctx.repair) return spec.max; ctx.errors.push({ path, message: `${label} must be at most ${spec.max}` }); return n; }
      return n;
    }
    case 'bool': return typeof value === 'boolean' ? value : fail(`${label} must be true or false`);
    case 'enum': return spec.vals.includes(value) ? value : fail(`${label} must be one of: ${spec.vals.join(', ')}`);
    case 'ymd': return isYmd(value) ? value : fail(`${label} must be a valid date`);
    case 'hm': return isHm(value) ? value : fail(`${label} must be a valid time (HH:mm)`);
    case 'ts': return isNum(value) && value >= 0 ? Math.round(value) : fail(`${label} must be a timestamp`);
    case 'id': return typeof value === 'string' && ID_RE.test(value) ? value : fail(`${label} must be a valid id`);
    case 'hex': {
      const h = normHex(value);
      return h || fail(`${label} must be a hex colour like #3b82f6`);
    }
    case 'blob': {
      if (typeof Blob !== 'undefined' && value instanceof Blob) return value;
      return fail(`${label} must be binary data`);
    }
    case 'arr': {
      if (!Array.isArray(value)) return fail(`${label} must be a list`);
      const max = spec.max ?? 1000;
      let items = value;
      if (items.length > max) {
        if (ctx.repair) { items = items.slice(0, max); ctx.warnings.push({ path, message: `${label} was truncated` }); }
        else { ctx.errors.push({ path, message: `${label} has too many items (max ${max})` }); return value; }
      }
      const out = [];
      items.forEach((it, i) => {
        const before = ctx.errors.length;
        const v = norm(spec.of, it, `${path}[${i}]`, ctx);
        if (ctx.repair && it !== undefined && it !== null && v === null && !spec.of.nullable) return; // drop unusable
        if (ctx.errors.length === before || !ctx.repair) out.push(v);
      });
      if (spec.unique) return [...new Set(out)];
      return out;
    }
    case 'obj': {
      if (typeof value !== 'object' || Array.isArray(value)) return fail(`${label} must be an object`);
      const out = {};
      for (const [k, s] of Object.entries(spec.fields)) out[k] = norm(s, value[k], path ? `${path}.${k}` : k, ctx);
      return out;
    }
    case 'json': {
      try {
        const clean = sanitizeJson(value, { maxDepth: spec.maxDepth ?? 10 });
        if (spec.maxBytes && JSON.stringify(clean).length > spec.maxBytes) return fail(`${label} is too large`);
        return clean;
      } catch (e) {
        return fail(`${label} is not valid data (${e.message})`);
      }
    }
    default:
      throw new Error(`Unknown spec type ${spec.t}`);
  }
}

/**
 * Normalise a record against an entity definition.
 * Returns { ok, value, errors, warnings }. `value` is always a clean object when ok.
 */
export function normalizeRecord(entity, raw, { repair = false } = {}) {
  const ctx = { errors: [], warnings: [], repair };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, value: null, errors: [{ path: '', message: 'Record is not an object' }], warnings: [] };
  }
  const value = {};
  for (const [k, spec] of Object.entries(entity.fields)) value[k] = norm(spec, raw[k], k, ctx);
  if (entity.cross) entity.cross(value, ctx);
  // In repair mode a missing key/id makes the record unusable; anything else is fixable.
  const keyOk = typeof value[entity.keyPath] === 'string' && value[entity.keyPath].length > 0;
  const ok = ctx.errors.length === 0 && keyOk;
  return { ok, value: ok ? value : null, errors: ctx.errors, warnings: ctx.warnings };
}

export function assertValid(entity, raw) {
  const r = normalizeRecord(entity, raw, { repair: false });
  if (!r.ok) throw new ValidationError(r.errors);
  return r.value;
}

/** Spec builders - keep entity definitions compact and readable. */
export const S = {
  str: (o = {}) => ({ t: 'str', ...o }),
  num: (o = {}) => ({ t: 'num', def: 0, ...o }),
  bool: (def = false) => ({ t: 'bool', def }),
  enum: (vals, def = vals[0], o = {}) => ({ t: 'enum', vals, def, ...o }),
  ymd: (o = {}) => ({ t: 'ymd', nullable: true, ...o }),
  hm: (o = {}) => ({ t: 'hm', nullable: true, ...o }),
  ts: (o = {}) => ({ t: 'ts', ...o }),
  id: (o = {}) => ({ t: 'id', ...o }),
  hex: (def = '#888888', o = {}) => ({ t: 'hex', def, ...o }),
  arr: (of, o = {}) => ({ t: 'arr', of, ...o }),
  obj: (fields, o = {}) => ({ t: 'obj', fields, ...o }),
  json: (o = {}) => ({ t: 'json', ...o }),
  blob: (o = {}) => ({ t: 'blob', nullable: true, ...o }),
};
