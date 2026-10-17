// Storage adapters. Both expose the same small, promise-based interface:
//   open() getAll(store) get(store,key) batch(ops) close()
// `batch` is ATOMIC: either every operation is applied or none are.
//   op = { type: 'put'|'add'|'delete'|'clear', store, record?, key? }
//   'add' fails (and aborts the whole batch) if the key already exists - used to claim the single active timer.
import { DB_NAME, DB_VERSION, STORES, STORE_NAMES, keyPathOf, MIGRATIONS } from './schema.js';
import { clone } from './util.js';

export class DbError extends Error {
  constructor(message, code = 'unknown', cause) {
    super(message);
    this.name = 'DbError';
    this.code = code;
    this.cause = cause;
  }
}

function wrap(err, fallback = 'Database operation failed') {
  if (err instanceof DbError) return err;
  const name = err?.name || '';
  if (name === 'QuotaExceededError') {
    return new DbError('Browser storage is full. Free up disk space or delete old data, then try again.', 'quota', err);
  }
  if (name === 'ConstraintError') return new DbError('That record already exists.', 'constraint', err);
  if (name === 'InvalidStateError' || name === 'TransactionInactiveError') {
    return new DbError('The database connection was closed. Reload the page.', 'closed', err);
  }
  return new DbError(`${fallback}${err?.message ? ': ' + err.message : ''}`, 'unknown', err);
}

/* =====================================================================
 * IndexedDB adapter
 * ===================================================================*/
export function createIdbAdapter({ name = DB_NAME, version = DB_VERSION, onVersionChange } = {}) {
  let db = null;

  function upgrade(request, event) {
    const d = request.result;
    const tx = request.transaction;
    const oldVersion = event.oldVersion;
    for (const [store, def] of Object.entries(STORES)) {
      if (def.since > oldVersion && !d.objectStoreNames.contains(store)) {
        const os = d.createObjectStore(store, { keyPath: keyPathOf(store) });
        for (const [iname, path] of def.indexes) os.createIndex(iname, path, { unique: false });
      }
    }
    // Rewrite existing records for each migration step crossed.
    for (let v = oldVersion + 1; v <= version; v++) {
      const steps = MIGRATIONS[v];
      if (!steps) continue;
      for (const [store, fn] of Object.entries(steps)) {
        if (!d.objectStoreNames.contains(store)) continue;
        const os = tx.objectStore(store);
        const cur = os.openCursor();
        cur.onsuccess = () => {
          const c = cur.result;
          if (!c) return;
          try { c.update(fn(c.value)); } catch (e) { tx.abort(); return; }
          c.continue();
        };
      }
    }
  }

  return {
    kind: 'idb',
    open() {
      return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') return reject(new DbError('This browser does not provide IndexedDB.', 'unavailable'));
        let req;
        try { req = indexedDB.open(name, version); } catch (e) { return reject(wrap(e, 'Could not open the database')); }
        req.onupgradeneeded = (e) => {
          try { upgrade(req, e); } catch (err) { try { req.transaction.abort(); } catch { /* already aborted */ } }
        };
        req.onblocked = () => console.warn('[db] open blocked by another tab using an older version');
        req.onerror = () => reject(wrap(req.error, 'Could not open the database'));
        req.onsuccess = () => {
          db = req.result;
          db.onversionchange = () => { db.close(); onVersionChange?.(); };
          db.onclose = () => { db = null; };
          resolve(this);
        };
      });
    },
    getAll(store) {
      return new Promise((resolve, reject) => {
        try {
          const r = db.transaction(store, 'readonly').objectStore(store).getAll();
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(wrap(r.error, `Could not read ${store}`));
        } catch (e) { reject(wrap(e, `Could not read ${store}`)); }
      });
    },
    get(store, key) {
      return new Promise((resolve, reject) => {
        try {
          const r = db.transaction(store, 'readonly').objectStore(store).get(key);
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(wrap(r.error));
        } catch (e) { reject(wrap(e)); }
      });
    },
    batch(ops) {
      return new Promise((resolve, reject) => {
        if (!ops.length) return resolve();
        if (!db) return reject(new DbError('Database is not open.', 'closed'));
        let tx;
        try { tx = db.transaction([...new Set(ops.map((o) => o.store))], 'readwrite'); } catch (e) { return reject(wrap(e)); }
        let failure = null;
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(wrap(failure || tx.error || new Error('Transaction aborted')));
        tx.onerror = (e) => { failure = failure || e.target?.error; };
        try {
          for (const op of ops) {
            const os = tx.objectStore(op.store);
            if (op.type === 'put') os.put(op.record);
            else if (op.type === 'add') os.add(op.record);
            else if (op.type === 'delete') os.delete(op.key);
            else if (op.type === 'clear') os.clear();
            else throw new Error(`Unknown op ${op.type}`);
          }
        } catch (e) {
          failure = e;
          try { tx.abort(); } catch { /* ignore */ }
        }
      });
    },
    close() { db?.close(); db = null; },
    async deleteDatabase() {
      db?.close(); db = null;
      return new Promise((resolve, reject) => {
        const r = indexedDB.deleteDatabase(name);
        r.onsuccess = () => resolve();
        r.onerror = () => reject(wrap(r.error));
        r.onblocked = () => reject(new DbError('Close other Lumen tabs, then try again.', 'blocked'));
      });
    },
  };
}

/* =====================================================================
 * In-memory adapter: used by unit tests and as an emergency fallback when
 * IndexedDB is unavailable (e.g. some private-browsing modes). NOT persistent.
 * ===================================================================*/
export function createMemoryAdapter() {
  const data = {};
  for (const s of STORE_NAMES) data[s] = new Map();
  const copy = (v) => (v instanceof Blob ? v : clone(v));
  return {
    kind: 'memory',
    async open() { return this; },
    async getAll(store) { return [...data[store].values()].map(copy); },
    async get(store, key) { const v = data[store].get(key); return v === undefined ? undefined : copy(v); },
    async batch(ops) {
      // Dry-run on shadow maps so a failing op leaves nothing behind.
      const shadow = new Map();
      const view = (s) => { if (!shadow.has(s)) shadow.set(s, new Map(data[s])); return shadow.get(s); };
      for (const op of ops) {
        const m = view(op.store);
        const kp = keyPathOf(op.store);
        if (op.type === 'put') m.set(op.record[kp], copy(op.record));
        else if (op.type === 'add') {
          if (m.has(op.record[kp])) throw new DbError('That record already exists.', 'constraint');
          m.set(op.record[kp], copy(op.record));
        } else if (op.type === 'delete') m.delete(op.key);
        else if (op.type === 'clear') m.clear();
      }
      for (const [s, m] of shadow) data[s] = m;
    },
    close() {},
    async deleteDatabase() { for (const s of STORE_NAMES) data[s].clear(); },
  };
}
