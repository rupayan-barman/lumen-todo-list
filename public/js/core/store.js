// In-memory cache over the storage adapter. Reads are synchronous (from the cache);
// every write goes to the database FIRST (atomically) and only then updates the cache,
// so what you see on screen is always what was actually saved.
import { ENTITIES, ID_PREFIX } from './entities.js';
import { STORE_NAMES, keyPathOf } from './schema.js';
import { normalizeRecord, ValidationError } from './validate.js';
import { uid } from './util.js';
import { clock } from './clock.js';
import { DbError } from './db.js';

export function createStore({ db, bus, channel = null, tabId = uid('tab') }) {
  const maps = Object.fromEntries(STORE_NAMES.map((n) => [n, new Map()]));
  const snapshots = {}; // cached array views
  const health = { quarantined: 0, repaired: 0, notes: [] };
  let queue = Promise.resolve();

  const arr = (name) => (snapshots[name] ??= [...maps[name].values()]);
  const invalidate = (name) => { delete snapshots[name]; };

  function rawJson(rec) {
    try {
      return JSON.stringify(rec, (k, v) => (typeof Blob !== 'undefined' && v instanceof Blob ? `[binary ${v.size} bytes]` : v)).slice(0, 1_900_000);
    } catch { return '[unserialisable record]'; }
  }

  async function loadStore(name, { reportHealth = true } = {}) {
    const entity = ENTITIES[name];
    const rows = await db.getAll(name);
    const map = new Map();
    const quarantine = [];
    for (const row of rows) {
      if (entity.skipLoadNormalize) { map.set(row[entity.keyPath], row); continue; }
      const r = normalizeRecord(entity, row, { repair: true });
      if (!r.ok) {
        quarantine.push({ store: name, reason: r.errors.map((e) => `${e.path}: ${e.message}`).join('; ') || 'Unreadable record', raw: rawJson(row) });
        continue;
      }
      if (r.warnings.length && reportHealth) {
        health.repaired++;
        quarantine.push({ store: name, reason: `Repaired on load: ${r.warnings.map((w) => `${w.path}: ${w.message}`).join('; ')}`, raw: rawJson(row) });
      }
      map.set(r.value[entity.keyPath], r.value);
    }
    maps[name] = map;
    invalidate(name);
    if (quarantine.length && reportHealth) {
      // Keep a copy of anything we could not read as-is. The original row is left untouched in its store.
      const ops = quarantine.map((q) => ({
        type: 'put', store: 'quarantine',
        record: { id: uid('quar'), store: q.store, at: clock.now(), reason: q.reason, raw: q.raw },
      }));
      try { await db.batch(ops); } catch (e) { console.warn('[store] could not write quarantine', e); }
      health.quarantined += quarantine.filter((q) => !q.reason.startsWith('Repaired')).length;
      health.notes.push(...quarantine.map((q) => `${q.store}: ${q.reason}`));
    }
  }

  async function init() {
    for (const name of STORE_NAMES) {
      if (name === 'quarantine') continue;
      await loadStore(name);
    }
    maps.quarantine = new Map((await db.getAll('quarantine')).map((r) => [r.id, r]));
    invalidate('quarantine');
    if (channel) {
      channel.onmessage = async (e) => {
        const m = e.data;
        if (!m || m.from === tabId || !Array.isArray(m.stores)) return;
        for (const s of m.stores) {
          if (!STORE_NAMES.includes(s)) continue;
          try { await loadStore(s, { reportHealth: false }); } catch (err) { console.warn('[store] reload failed', err); continue; }
          bus.emit(`store:${s}`, { external: true });
          bus.emit('store:any', { store: s, external: true });
        }
      };
    }
    return health;
  }

  /** Validate + stamp one put. Returns the clean record. */
  function prepare(name, raw, { keepTimestamps = false } = {}) {
    const entity = ENTITIES[name];
    const now = clock.now();
    const kp = entity.keyPath;
    const draft = { ...raw };
    if (!draft[kp] && kp === 'id') draft[kp] = uid(ID_PREFIX[name] || 'rec');
    const existing = maps[name].get(draft[kp]);
    if (!keepTimestamps) {
      if ('createdAt' in entity.fields) draft.createdAt = existing?.createdAt ?? draft.createdAt ?? now;
      if ('updatedAt' in entity.fields) draft.updatedAt = now;
    }
    const r = normalizeRecord(entity, draft, { repair: false });
    if (!r.ok) throw new ValidationError(r.errors.length ? r.errors : [{ path: kp, message: 'Missing key' }]);
    return r.value;
  }

  /**
   * Apply operations atomically. ops: {type:'put'|'add'|'delete'|'clear', store, record|key}
   * Returns the clean records written (in order).
   */
  function commit(ops, { silent = false, quiet = false } = {}) {
    const run = async () => {
      const prepared = ops.map((op) => {
        if (op.type === 'put' || op.type === 'add') return { ...op, record: op.prepared ? op.record : prepare(op.store, op.record, op) };
        return op;
      });
      if (quiet) silent = true;
      if (!silent) bus.emit('save', { state: 'saving' });
      try {
        await db.batch(prepared.map(({ type, store, record, key }) => ({ type, store, record, key })));
      } catch (err) {
        const e = err instanceof DbError ? err : new DbError(err.message, 'unknown', err);
        if (!silent) bus.emit('save', { state: 'error', error: e });
        throw e;
      }
      const changed = new Map();
      for (const op of prepared) {
        const kp = keyPathOf(op.store);
        const m = maps[op.store];
        if (op.type === 'put' || op.type === 'add') m.set(op.record[kp], op.record);
        else if (op.type === 'delete') m.delete(op.key);
        else if (op.type === 'clear') m.clear();
        invalidate(op.store);
        if (!changed.has(op.store)) changed.set(op.store, []);
        changed.get(op.store).push(op.type === 'delete' ? op.key : op.record?.[kp]);
      }
      if (!silent) bus.emit('save', { state: 'saved', at: clock.now() });
      if (quiet) return prepared.filter((o) => o.record).map((o) => o.record); // heartbeat writes: no UI churn
      for (const [s, ids] of changed) {
        bus.emit(`store:${s}`, { ids, external: false });
        bus.emit('store:any', { store: s, ids, external: false });
      }
      if (channel && changed.size) {
        try { channel.postMessage({ from: tabId, stores: [...changed.keys()] }); } catch { /* channel closed */ }
      }
      return prepared.filter((o) => o.record).map((o) => o.record);
    };
    // Serialise commits so the cache always reflects the order of writes.
    const p = queue.then(run, run);
    queue = p.catch(() => {});
    return p;
  }

  const api = {
    init,
    health,
    tabId,
    all: (name) => arr(name),
    get: (name, id) => maps[name].get(id),
    has: (name, id) => maps[name].has(id),
    count: (name) => maps[name].size,
    commit,
    prepare,
    async put(name, rec, opts) { const [r] = await commit([{ type: 'put', store: name, record: rec, ...opts }]); return r; },
    async putMany(name, recs) { return commit(recs.map((record) => ({ type: 'put', store: name, record }))); },
    async remove(name, id) { await commit([{ type: 'delete', store: name, key: id }]); },
    async removeMany(name, ids) { await commit(ids.map((key) => ({ type: 'delete', store: name, key }))); },
    async clear(name) { await commit([{ type: 'clear', store: name }]); },
    async reload(name) { await loadStore(name, { reportHealth: false }); bus.emit(`store:${name}`, { external: true }); },

    // ----- tiny key/value helper (settings, layouts, favourites ...) -----
    kvGet(key, fallback = null) {
      const r = maps.kv.get(key);
      return r === undefined ? fallback : r.value;
    },
    kvSet(key, value, opts) { return api.put('kv', { key, value }, opts); },
    kvRemove(key) { return api.remove('kv', key); },
  };
  return api;
}
