// One low-frequency scheduler (every 30 s while the page is open) for deadline, scheduled-task and habit reminders.
// De-duplicated through kv['notified']; entries older than 3 days are pruned.
import { app } from './ctx.js';
import { getPrefs } from './prefs.js';
import { notify } from './alerts.js';
import { clock } from '../core/clock.js';
import { toEpoch, todayStr, fmtDate } from '../core/util.js';
import { isArchived, deadlineEpoch } from '../core/task-query.js';
import { isScheduled, todayState } from '../core/habits.js';
import { timeText } from '../ui/task-bits.js';

const KEY = 'notified';
const DAY = 86_400_000;
let timer = null;

const st = () => app.store;

export function dueReminders(now = clock.now(), prefs = getPrefs()) {
  const out = [];
  const n = prefs.notify;
  const lead = n.leadMin * 60_000;
  const today = todayStr(now);
  for (const t of st().all('tasks')) {
    if (isArchived(t)) continue;
    if (n.deadlines && t.deadline) {
      const end = deadlineEpoch(t);
      const trigger = t.deadlineTime ? end - lead : toEpoch(t.deadline, '09:00');
      if (now >= trigger && now < end + 0) out.push({ key: `deadline:${t.id}:${t.deadline}${t.deadlineTime || ''}`, type: 'deadline', title: 'Deadline approaching', body: `"${t.title}" is due ${t.deadline === today ? 'today' : fmtDate(t.deadline)}${t.deadlineTime ? ' at ' + timeText(t.deadlineTime) : ''}.`, link: '#/tasks', kind: 'warn' });
    }
    if (n.scheduled && t.scheduledDate && t.scheduledTime) {
      const start = toEpoch(t.scheduledDate, t.scheduledTime);
      if (now >= start - Math.min(lead, 10 * 60_000) && now < start + 30 * 60_000) out.push({ key: `sched:${t.id}:${t.scheduledDate}${t.scheduledTime}`, type: 'scheduled', title: 'Scheduled task starting', body: `"${t.title}" starts at ${timeText(t.scheduledTime)}.`, link: '#/calendar', kind: 'info' });
    }
  }
  if (n.habits) {
    for (const hb of st().all('habits')) {
      if (hb.archived || !hb.reminderTime) continue;
      if (now < toEpoch(today, hb.reminderTime)) continue;
      const logs = new Set(st().all('habitLogs').filter((l) => l.habitId === hb.id).map((l) => l.date));
      const state = todayState(hb, logs, today);
      if (state.due && !state.doneToday) out.push({ key: `habit:${hb.id}:${today}`, type: 'habit', title: 'Habit reminder', body: `Time for "${hb.name}".`, link: '#/habits', kind: 'info' });
    }
  }
  return out;
}

export async function check(now = clock.now()) {
  if (!app.store) return;
  const seen = { ...(st().kvGet(KEY, {}) || {}) };
  const fresh = dueReminders(now).filter((r) => !seen[r.key]);
  let dirty = false;
  for (const k of Object.keys(seen)) if (now - seen[k] > 3 * DAY) { delete seen[k]; dirty = true; }
  if (!fresh.length && !dirty) return;
  for (const r of fresh) { seen[r.key] = now; }
  try {
    await st().commit([
      { type: 'put', store: 'kv', record: { key: KEY, value: seen } },
      ...fresh.map((r) => ({ type: 'put', store: 'notifications', record: { id: `notif_${r.key.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 100)}`, at: now, type: r.type, title: r.title, body: r.body, link: r.link } })),
    ], { quiet: true });
  } catch (e) { console.warn('[scheduler] could not record reminders', e); return; }
  for (const r of fresh.slice(0, 5)) notify({ title: r.title, body: r.body, type: r.type, link: r.link, kind: r.kind, tag: r.key });
  if (fresh.length > 5) notify({ title: 'More reminders', body: `${fresh.length - 5} more are listed in the notification centre.`, type: 'system' });
  app.bus.emit('notifications:changed');
}

export function startScheduler() {
  if (timer) return;
  const run = () => { if (document.visibilityState !== 'hidden') check().catch(console.error); };
  timer = setInterval(() => check().catch(console.error), 30_000);
  document.addEventListener('visibilitychange', run);
  setTimeout(run, 1500);
}
export function stopScheduler() { clearInterval(timer); timer = null; }
