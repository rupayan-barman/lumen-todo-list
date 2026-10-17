// Applies a JSON configuration plan. Existing data is never edited or deleted by an import:
// it only ADDS records. Everything is written in one atomic commit, after an automatic safety copy.
import { app } from './ctx.js';
import { undo } from './undo.js';
import { clock } from '../core/clock.js';
import { uid } from '../core/util.js';
import { parseConfig, planConfig, SECTIONS } from '../core/config-import.js';
import { snapshotBeforeChange } from './backup.js';

const st = () => app.store;
const LOG_KEY = 'configImports'; // [{hash, at, created}] newest first, last 50

export const importLog = () => st().kvGet(LOG_KEY, []) || [];

const existingRecords = () => Object.fromEntries(SECTIONS.map((k) => [k, st().all(k)]));

/** Parse + plan against the current data. Safe to call repeatedly; writes nothing. */
export function prepare(text, { skipInvalid = false, allowDuplicates = false } = {}) {
  const parsed = parseConfig(text);
  if (!parsed.ok) return { ok: false, parseError: parsed.error, hint: parsed.hint };
  const plan = planConfig(parsed.config, existingRecords(), { skipInvalid, allowDuplicates, log: importLog() });
  return { ok: true, plan, config: parsed.config };
}

/**
 * Write the plan. Returns a report listing exactly what was created and what was not.
 * All records are saved in a single transaction, so a storage failure means NOTHING was saved.
 */
export async function applyPlan(plan) {
  if (!plan?.canImport) throw new Error('This configuration cannot be imported. Fix the errors or choose to skip invalid items.');
  // Re-check duplicates against the data as it is now (another tab may have added items since the preview).
  await snapshotBeforeChange(`Automatic copy before JSON import (${new Date(clock.now()).toLocaleString()})`);

  const ops = []; const created = [];
  for (const w of plan.writes) {
    ops.push({ type: 'put', store: w.store, record: w.record, keepTimestamps: false });
    created.push({ store: w.store, id: w.record.id });
    if (w.store === 'tasks') {
      const hid = uid('hist');
      ops.push({ type: 'put', store: 'taskHistory', record: { id: hid, taskId: w.record.id, title: w.record.title, type: 'created', detail: 'Imported from a JSON configuration' } });
      created.push({ store: 'taskHistory', id: hid });
    }
  }
  const prevLog = importLog();
  const entry = { hash: plan.hash, at: clock.now(), created: created.filter((c) => c.store !== 'taskHistory').length };
  ops.push({ type: 'put', store: 'kv', record: { key: LOG_KEY, value: [entry, ...prevLog].slice(0, 50) } });

  await st().commit(ops); // atomic

  undo.push(`JSON import (${entry.created} items)`, async () => {
    const dels = created.filter((c) => st().has(c.store, c.id)).map((c) => ({ type: 'delete', store: c.store, key: c.id }));
    dels.push({ type: 'put', store: 'kv', record: { key: LOG_KEY, value: prevLog } });
    await st().commit(dels);
  });

  return {
    created: plan.items.filter((e) => e.status === 'new' && e.record).map((e) => ({ kind: e.kind, label: e.label })),
    reused: plan.items.filter((e) => e.status === 'reuse').map((e) => ({ kind: e.kind, label: e.label })),
    duplicates: plan.items.filter((e) => e.status === 'duplicate').map((e) => ({ kind: e.kind, label: e.label, note: e.note })),
    failed: plan.items.filter((e) => e.status === 'invalid' || e.status === 'skipped').map((e) => ({ kind: e.kind, label: e.label, skipped: e.status === 'skipped', reasons: e.messages.filter((m) => m.level === 'error').map((m) => `${m.path ? m.path + ': ' : ''}${m.message}`) })),
    total: entry.created,
  };
}
