// Hash router with lazy-loaded views. Each view: export default mount(container, {params, path}) -> {destroy()}.
import { h, clear } from './ui/dom.js';
import { icon } from './ui/icons.js';

export const ROUTES = {
  dashboard: { title: 'Dashboard', icon: 'home', module: './views/dashboard.js' },
  tasks: { title: 'Tasks', icon: 'list', module: './views/tasks.js' },
  timer: { title: 'Timers', icon: 'timer', module: './views/timer.js' },
  calendar: { title: 'Calendar', icon: 'calendar', module: './views/calendar.js' },
  notes: { title: 'Notes', icon: 'note', module: './views/notes.js' },
  habits: { title: 'Habits', icon: 'habit', module: './views/habits.js' },
  projects: { title: 'Projects', icon: 'kanban', module: './views/projects.js' },
  study: { title: 'Study', icon: 'book', module: './views/study.js' },
  analytics: { title: 'Analytics', icon: 'chart', module: './views/analytics.js' },
  settings: { title: 'Settings', icon: 'settings', module: './views/settings/index.js' },
};

export function parseHash(hash = location.hash) {
  const raw = hash.replace(/^#\/?/, '');
  const [pathPart, query = ''] = raw.split('?');
  const [name, ...rest] = pathPart.split('/').filter(Boolean);
  return { name: ROUTES[name] ? name : 'dashboard', rest, params: new URLSearchParams(query), known: !name || !!ROUTES[name] };
}

export function navigate(path, { replace = false } = {}) {
  const target = `#/${path.replace(/^#?\/?/, '')}`;
  if (replace) history.replaceState(null, '', target); else location.hash = target;
  if (replace) window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function startRouter(main, { onRoute } = {}) {
  let current = null;
  let token = 0;
  const live = () => document.getElementById('live');

  async function render() {
    const route = parseHash();
    const my = ++token;
    current?.view?.destroy?.();
    current = null;
    clear(main);
    main.dataset.route = route.name;
    main.append(h('div', { class: 'loading', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', null, 'Loading…')));
    try {
      const mod = await import(ROUTES[route.name].module);
      if (my !== token) return;
      clear(main);
      const view = mod.default(main, { params: route.params, rest: route.rest, path: route.name });
      current = { name: route.name, view };
      document.title = `${ROUTES[route.name].title} · Lumen`;
      onRoute?.(route);
      if (live()) live().textContent = `${ROUTES[route.name].title} page`;
      if (!route.params.get('keepscroll')) main.scrollTop = 0;
    } catch (err) {
      if (my !== token) return;
      console.error('[router] view failed', route.name, err);
      clear(main);
      main.append(h('div', { class: 'glass panel' }, h('div', { class: 'empty' }, h('div', { class: 'empty__art' }, icon('alert', 34)), h('h2', { class: 'empty__title' }, 'This page could not be shown'),
        h('p', { class: 'empty__text' }, `Something went wrong while opening ${ROUTES[route.name].title}. Your data is safe.`), h('pre', { class: 'code-block' }, String(err?.stack || err).slice(0, 800)),
        h('div', { class: 'empty__action' }, h('button', { class: 'btn btn--primary', type: 'button', on: { click: render } }, 'Try again'), h('a', { class: 'btn', href: '#/dashboard' }, 'Go to dashboard')))));
    }
  }
  window.addEventListener('hashchange', render);
  if (!location.hash || !ROUTES[parseHash().name] || !parseHash().known) history.replaceState(null, '', '#/dashboard');
  render();
  return { render, current: () => current };
}
