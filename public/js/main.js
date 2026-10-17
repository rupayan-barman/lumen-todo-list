// Application bootstrap. Order matters: storage -> store -> prefs/appearance -> services -> shell -> router.
import { app } from './services/ctx.js';
import { createIdbAdapter, createMemoryAdapter } from './core/db.js';
import { createStore } from './core/store.js';
import { uid } from './core/util.js';
import { initAppearance, setFocusActive } from './services/appearance.js';
import { initTooltips } from './ui/tooltip.js';
import { toast, toastError } from './ui/toast.js';
import { h } from './ui/dom.js';
import { buildShell } from './ui/shell.js';
import { startRouter, navigate } from './router.js';
import * as Focus from './services/focus.js';
import { startScheduler } from './services/scheduler.js';
import { bindUi, runCommand } from './services/commands.js';
import { openPalette } from './ui/palette.js';
import { initShortcuts, showShortcuts } from './ui/shortcuts.js';
import { openQuickNote } from './views/quick-note.js';
import { openNotificationCentre } from './views/notifications-ui.js';
import { openTaskForm } from './views/task-form.js';
import { alertDialog } from './ui/dialog.js';
import './services/alerts.js';

async function openDb() {
  try {
    const db = createIdbAdapter({
      onVersionChange: () => toast({ kind: 'warn', message: 'Lumen was updated in another tab. Reload this tab to continue safely.', timeout: 15000, action: { label: 'Reload', onClick: () => location.reload() } }),
    });
    await db.open();
    return { db, degraded: false };
  } catch (e) {
    console.warn('[boot] IndexedDB unavailable, using memory', e);
    return { db: createMemoryAdapter(), degraded: true, reason: e };
  }
}

async function boot() {
  const root = document.getElementById('root');
  const { db, degraded } = await openDb();
  app.db = db; app.degraded = degraded;
  let channel = null; try { channel = 'BroadcastChannel' in window ? new BroadcastChannel('lumen') : null; } catch { /* unsupported */ }
  app.store = createStore({ db, bus: app.bus, channel, tabId: uid('tab') });
  const health = await app.store.init();
  app.ready = true;

  app.bus.on('toast', (t) => toast(t));
  initAppearance();
  initTooltips();

  const shell = buildShell(root, { runCommand });
  const openTask = (task) => openTaskForm({ task });
  bindUi({
    newTask: () => openTaskForm({}), quickNote: () => openQuickNote(), newNote: () => navigate('notes?new=1'),
    startFocus: () => navigate('timer'), help: showShortcuts, notifications: openNotificationCentre,
    palette: () => openPalette({ mode: 'palette', openTask }), search: () => openPalette({ mode: 'search', openTask }),
    exportBackup: async () => { const m = await import('./services/backup.js'); m.downloadBackup().catch(toastError); },
  });
  initShortcuts();

  await Focus.init();
  startScheduler();
  // Focus Mode appearance applies only while a focus-type session is running, and is restored afterwards.
  const syncFocus = () => { const s = Focus.active(); setFocusActive(!!s && s.status === 'running' && (s.locked || s.kind === 'focus' || s.phase === 'work')); };
  for (const ev of ['focus:started', 'focus:changed', 'focus:ended']) app.bus.on(ev, syncFocus);
  syncFocus();

  startRouter(shell.main);

  if (degraded) {
    root.prepend(h('div', { class: 'banner banner--warn', role: 'alert' }, h('strong', null, 'Storage unavailable. '), 'Your browser blocked IndexedDB (private window or storage disabled), so nothing you enter will be kept after closing this tab. Export a backup before leaving.'));
  }
  if (health.quarantined) {
    toast({ kind: 'warn', timeout: 12000, message: `${health.quarantined} unreadable record${health.quarantined === 1 ? ' was' : 's were'} set aside (originals kept). See Settings → Data.`, action: { label: 'Open', onClick: () => navigate('settings/data') } });
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => { const w = reg.installing; w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) toast({ kind: 'info', message: 'A new version of Lumen is ready.', action: { label: 'Reload', onClick: () => location.reload() }, timeout: 15000 }); }); });
    }).catch((e) => console.warn('[sw] registration failed', e));
  }
  window.__lumen = { app, ready: true };
}

boot().catch((err) => {
  console.error('[boot] fatal', err);
  const root = document.getElementById('root') || document.body;
  root.replaceChildren(h('div', { class: 'glass panel', style: { margin: '40px auto', maxWidth: '560px' } }, h('h1', null, 'Lumen could not start'), h('p', null, 'Your saved data has not been touched.'), h('pre', { class: 'code-block' }, String(err?.stack || err).slice(0, 1200)), h('button', { class: 'btn btn--primary', type: 'button', on: { click: () => location.reload() } }, 'Reload')));
});
