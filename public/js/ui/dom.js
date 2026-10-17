// Safe DOM construction. There is deliberately NO innerHTML path: strings become text nodes,
// so user content (task titles, notes, imported data) can never inject markup or script.
const SVG_NS = 'http://www.w3.org/2000/svg';
const BOOL_PROPS = new Set(['checked', 'disabled', 'hidden', 'selected', 'readOnly', 'required', 'multiple', 'open']);
const DIRECT_PROPS = new Set(['value', 'checked', 'disabled', 'hidden', 'selected', 'readOnly', 'required', 'multiple', 'tabIndex', 'id', 'name', 'type', 'placeholder', 'min', 'max', 'step', 'rows', 'cols', 'maxLength', 'draggable', 'title', 'htmlFor', 'accept', 'autocomplete']);

export function setAttrs(el, props = {}) {
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false && !BOOL_PROPS.has(k)) continue;
    if (k === 'class' || k === 'className') el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') throw new Error('html is not allowed; build elements instead');
    else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sv == null) continue; if (sk.startsWith('--')) el.style.setProperty(sk, String(sv)); else el.style[sk] = sv; } }
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'on') for (const [evt, fn] of Object.entries(v)) el.addEventListener(evt, fn);
    else if (k === 'ref') v(el);
    else if (k === 'href') { if (/^(#|\.\/|\/|https?:|mailto:)/i.test(v)) el.setAttribute('href', v); }
    else if (DIRECT_PROPS.has(k)) el[k] = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  return el;
}

export function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false || k === true) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) { kids.unshift(props); props = null; }
  if (props) setAttrs(el, props);
  return append(el, kids);
}

export function svg(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, String(v));
  for (const k of kids.flat()) if (k) el.append(k);
  return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
export function replace(el, ...kids) { clear(el); return append(el, kids); }

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let idCounter = 0;
export const domId = (p = 'u') => `${p}-${++idCounter}`;

export const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function focusables(root) {
  return $$(FOCUSABLE, root).filter((el) => !el.closest('[hidden],[inert]') && el.offsetParent !== null);
}

/** Collect listeners/cleanups so views can tear down completely (no leaks across navigation). */
export function createScope() {
  const fns = [];
  return {
    add(fn) { fns.push(fn); return fn; },
    on(target, evt, handler, opts) { target.addEventListener(evt, handler, opts); fns.push(() => target.removeEventListener(evt, handler, opts)); },
    dispose() { while (fns.length) { try { fns.pop()(); } catch (e) { console.error(e); } } },
  };
}

/** Coalesce many change events into one render per animation frame. */
export function frameScheduler(fn) {
  let queued = false;
  const run = () => { queued = false; fn(); };
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(run); } };
  schedule.now = () => { queued = false; fn(); };
  return schedule;
}

/* ---------- scroll & focus preservation for in-place re-renders ---------- */
const SCROLLABLE = /(auto|scroll)/;

/** Nearest ancestor that actually scrolls vertically (the app's `#main.view`, or the page itself). */
export function scrollParentOf(el) {
  for (let p = el?.parentElement; p; p = p.parentElement) if (SCROLLABLE.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight) return p;
  return document.scrollingElement;
}

/** Set a scroll position immediately, even where CSS says `scroll-behavior: smooth` (which would animate from the top). */
export function setScrollTop(sc, top) {
  if (!sc) return;
  const prev = sc.style.scrollBehavior; sc.style.scrollBehavior = 'auto';
  sc.scrollTop = top;
  sc.style.scrollBehavior = prev;
}

/**
 * Run `fn` (which empties and rebuilds `host`) without losing the reader's place:
 * the scroll position is restored and keyboard focus returns to the equivalent control.
 */
export function preserveScroll(host, fn) {
  const sc = scrollParentOf(host); const top = sc ? sc.scrollTop : 0;
  const ae = document.activeElement;
  const idx = ae && host.contains(ae) ? [...host.querySelectorAll(FOCUSABLE)].indexOf(ae) : -1;
  fn();
  setScrollTop(sc, top);
  if (idx >= 0) { const next = host.querySelectorAll(FOCUSABLE)[idx]; if (next) next.focus({ preventScroll: true }); }
}
