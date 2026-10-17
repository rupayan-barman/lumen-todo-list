// IndexedDB layout + versioned migrations.
//
// Version history
//   v1  core stores: tasks, history, labels, sessions, notes, habits, projects, subjects, themes, kv, ...
//   v2  Wallpaper Studio: adds `assets` (image blobs) and `visualPresets`; backfills task fields.
//
// To change the schema: bump DB_VERSION, add the new stores to STORES with `since: <newVersion>`,
// and add a `MIGRATIONS[<newVersion>]` entry that rewrites existing records if needed.
import { ENTITIES } from './entities.js';

export const DB_NAME = 'lumen';
export const DB_VERSION = 2;
export const APP_VERSION = '1.0.0';
export const BACKUP_FORMAT_VERSION = 1;

const idx = (...names) => names.map((n) => (Array.isArray(n) ? n : [n, n]));

export const STORES = {
  tasks: { since: 1, indexes: idx('status', 'deadline', 'projectId', 'scheduledDate', 'seriesId') },
  taskHistory: { since: 1, indexes: idx('taskId', 'at') },
  categories: { since: 1, indexes: [] },
  tags: { since: 1, indexes: [] },
  sessions: { since: 1, indexes: idx('startedAt', 'taskId', 'subjectId', 'status') },
  notes: { since: 1, indexes: idx('updatedAt', 'taskId', 'pinned') },
  habits: { since: 1, indexes: [] },
  habitLogs: { since: 1, indexes: idx('habitId', 'date') },
  projects: { since: 1, indexes: idx('status') },
  subjects: { since: 1, indexes: [] },
  themes: { since: 1, indexes: [] },
  kv: { since: 1, indexes: [] },
  notifications: { since: 1, indexes: idx('at') },
  backups: { since: 1, indexes: idx('at') },
  quarantine: { since: 1, indexes: [] },
  visualPresets: { since: 2, indexes: [] },
  assets: { since: 2, indexes: idx('createdAt') },
};

export const STORE_NAMES = Object.keys(STORES);

export function keyPathOf(store) {
  return ENTITIES[store].keyPath;
}

/**
 * Data migrations, keyed by the version they upgrade TO.
 * Each receives a plain record and returns the updated record (or the same one).
 * They run inside the IndexedDB upgrade transaction, so a failure rolls the upgrade back
 * and the old database stays intact.
 */
export const MIGRATIONS = {
  2: {
    tasks(rec) {
      const out = { ...rec };
      if (typeof out.order !== 'number') out.order = typeof out.createdAt === 'number' ? out.createdAt : 0;
      if (!out.focus || typeof out.focus !== 'object') out.focus = { enabled: false, durationMin: 25 };
      if (!Array.isArray(out.subtasks)) out.subtasks = [];
      if (!Array.isArray(out.tagIds)) out.tagIds = [];
      if (typeof out.actualMs !== 'number') out.actualMs = 0;
      return out;
    },
  },
};

/** Apply record-level migrations for every version in (from, to]. Pure; shared by IDB + tests + backup import. */
export function migrateRecord(store, rec, from, to = DB_VERSION) {
  let out = rec;
  for (let v = from + 1; v <= to; v++) {
    const fn = MIGRATIONS[v]?.[store];
    if (fn) out = fn(out);
  }
  return out;
}
