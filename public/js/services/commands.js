// Command registry. Every command calls real application functionality (no placeholders).
import { app } from './ctx.js';
import { getPrefs, setPrefs } from './prefs.js';
import { undo } from './undo.js';
import * as Focus from './focus.js';
import * as AA from './appearance-actions.js';
import { PRESET_THEMES } from '../core/theme.js';
import { ROUTES, navigate } from '../router.js';
import { customThemes } from './appearance.js';
import { toast, toastError } from '../ui/toast.js';

let ui = {}; // late-bound UI openers, set from main.js to avoid import cycles
export const bindUi = (o) => { ui = { ...ui, ...o }; };

const go = (path) => () => navigate(path);

export function getCommands() {
  const p = getPrefs();
  const cmds = [];
  const add = (id, title, group, run, o = {}) => cmds.push({ id, title, group, run, ...o });

  add('task.new', 'Create task', 'Create', () => ui.newTask?.(), { icon: 'plus', hint: 'N', keywords: 'add todo new' });
  add('task.quick', 'Quick add task (type with shortcuts)', 'Create', () => { navigate('tasks'); setTimeout(() => document.getElementById('quickadd')?.focus(), 250); }, { icon: 'zap', keywords: 'inline fast' });
  add('note.new', 'Create note', 'Create', () => ui.newNote?.(), { icon: 'note', keywords: 'write markdown' });
  add('note.quick', 'Quick note capture', 'Create', () => ui.quickNote?.(), { icon: 'note', hint: 'Shift N', keywords: 'capture jot' });
  add('habit.new', 'Create habit', 'Create', go('habits?new=1'), { icon: 'habit' });
  add('project.new', 'Create project', 'Create', go('projects?new=1'), { icon: 'kanban' });
  add('subject.new', 'Create study subject', 'Create', go('study?new=1'), { icon: 'book' });

  const open = Focus.active();
  add('focus.start', open ? 'Open running timer' : 'Start focus session', 'Timer', () => ui.startFocus?.(), { icon: 'timer', keywords: 'pomodoro countdown stopwatch timer' });
  if (open?.status === 'running' && !open.locked) add('focus.pause', 'Pause timer', 'Timer', () => Focus.pause().catch(toastError), { icon: 'pause' });
  if (open?.status === 'paused') add('focus.resume', 'Resume timer', 'Timer', () => Focus.resume().catch(toastError), { icon: 'play' });
  if (open) add('focus.interrupt', 'Emergency interrupt focus session', 'Timer', () => navigate('timer'), { icon: 'alert' });

  for (const [name, r] of Object.entries(ROUTES)) add(`nav.${name}`, `Open ${r.title.toLowerCase()}`, 'Go to', go(name), { icon: r.icon, keywords: `go navigate ${name}` });
  add('nav.settings.appearance', 'Open Appearance Studio', 'Go to', go('settings/appearance'), { icon: 'palette', keywords: 'theme colours glass' });
  add('nav.settings.wallpapers', 'Open Wallpaper Studio', 'Go to', go('settings/wallpapers'), { icon: 'image', keywords: 'background wallpaper' });
  add('nav.settings.data', 'Open backup & data settings', 'Go to', go('settings/data'), { icon: 'database', keywords: 'export import restore' });
  add('nav.settings.notifications', 'Open notification & sound settings', 'Go to', go('settings/notifications'), { icon: 'bell' });

  for (const t of [...PRESET_THEMES, ...customThemes()]) add(`theme.${t.id}`, `Switch theme: ${t.name}`, 'Appearance', () => { setPrefs({ themeId: t.id, overrides: AA.NO_OVERRIDES() }); toast({ kind: 'success', message: `Theme: ${t.name}` }); }, { icon: 'palette', keywords: 'theme colour' });
  add('theme.random', 'Randomize theme', 'Appearance', async () => { try { const t = await AA.randomizeTheme(); toast({ kind: 'success', message: `New ${t.harmony} theme applied.`, action: { label: 'Undo', onClick: () => undo.run() } }); } catch (e) { toastError(e); } }, { icon: 'shuffle', keywords: 'random theme' });
  add('wallpaper.random', 'Random wallpaper', 'Appearance', () => { const i = AA.randomizeWallpaper(); if (i) toast({ kind: 'success', message: `Wallpaper: ${i.name}`, action: { label: 'Undo', onClick: () => undo.run() } }); }, { icon: 'image' });
  add('appearance.random', 'Randomize appearance (theme + wallpaper + glass)', 'Appearance', async () => { try { const r = await AA.randomizeAppearance(); toast({ kind: 'success', message: `Randomized: ${r.wallpaper.name}`, action: { label: 'Undo', onClick: () => undo.run() } }); } catch (e) { toastError(e); } }, { icon: 'wand' });
  for (const [v, l] of [['light', 'Light'], ['dark', 'Dark'], ['system', 'System default']]) add(`mode.${v}`, `Appearance mode: ${l}`, 'Appearance', () => setPrefs({ mode: v }), { icon: v === 'light' ? 'sun' : v === 'dark' ? 'moon' : 'monitor', keywords: 'dark light mode' });
  add('effects.toggle', p.effects === 'full' ? 'Disable expensive effects (blur, glow, animation)' : 'Enable glass effects', 'Appearance', () => setPrefs({ effects: p.effects === 'full' ? 'lite' : 'full' }), { icon: 'zap', keywords: 'performance lite blur' });
  add('density.toggle', p.density === 'compact' ? 'Use spacious layout' : 'Use compact layout', 'Appearance', () => setPrefs({ density: p.density === 'compact' ? 'comfortable' : 'compact' }), { icon: 'layout' });
  add('sidebar.toggle', p.sidebar.collapsed ? 'Expand sidebar' : 'Collapse sidebar', 'Appearance', () => setPrefs({ sidebar: { collapsed: !p.sidebar.collapsed } }), { icon: 'sidebar', hint: 'Ctrl B' });

  add('search.open', 'Search everything…', 'General', () => ui.search?.(), { icon: 'search', hint: '/', keywords: 'find' });
  add('undo', 'Undo last action', 'General', () => undo.run(), { icon: 'undo', hint: 'Ctrl Z' });
  add('help.shortcuts', 'Keyboard shortcuts', 'General', () => ui.help?.(), { icon: 'keyboard', hint: '?' });
  add('notifications.open', 'Open notification centre', 'General', () => ui.notifications?.(), { icon: 'bell' });
  add('backup.export', 'Export full backup (JSON)', 'Data', () => ui.exportBackup?.(), { icon: 'download' });
  add('app.reload', 'Reload app', 'General', () => location.reload(), { icon: 'reset' });
  return cmds;
}

export function runCommand(id) {
  if (id === 'palette.open') return ui.palette?.();
  const c = getCommands().find((x) => x.id === id);
  if (!c) { console.warn('[commands] unknown command', id); return; }
  try { const r = c.run(); if (r && typeof r.catch === 'function') r.catch(toastError); } catch (e) { toastError(e); }
}
