// Reusable presentational components. All styling lives in css/components.css via design tokens.
import { h, domId } from './dom.js';
import { icon } from './icons.js';

export function button({ label, icon: ic, kind = 'ghost', size, onClick, type = 'button', tip, disabled, ariaLabel, className } = {}) {
  return h('button', {
    type, class: ['btn', `btn--${kind}`, size && `btn--${size}`, className], disabled: !!disabled, 'data-tip': tip, 'aria-label': ariaLabel,
    on: onClick ? { click: onClick } : undefined,
  }, ic && icon(ic, size === 'sm' ? 14 : 16), label && h('span', null, label));
}

export function iconButton({ icon: ic, label, onClick, tip, size = 18, pressed, className, disabled } = {}) {
  return h('button', {
    type: 'button', class: ['icon-btn', className], 'aria-label': label, 'data-tip': tip ?? label, disabled: !!disabled,
    'aria-pressed': pressed === undefined ? undefined : String(!!pressed), on: onClick ? { click: onClick } : undefined,
  }, icon(ic, size));
}

export function chip(text, { color, icon: ic, title } = {}) {
  const el = h('span', { class: 'chip', title }, ic && icon(ic, 12), h('span', null, text));
  if (color) el.style.setProperty('--chip', color);
  return el;
}

export function badge(text, kind = 'neutral', ic) {
  return h('span', { class: ['badge', `badge--${kind}`] }, ic && icon(ic, 12), text);
}

export function emptyState({ icon: ic = 'sparkle', title, text, action }) {
  return h('div', { class: 'empty' },
    h('div', { class: 'empty__art', 'aria-hidden': 'true' }, icon(ic, 34)),
    h('h3', { class: 'empty__title' }, title),
    text && h('p', { class: 'empty__text' }, text),
    action && h('div', { class: 'empty__action' }, action));
}

export function loadingState(text = 'Loading…') {
  return h('div', { class: 'loading', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', null, text));
}

/** field(label, control, {error, hint}) - links label, hint and error to the control for screen readers. */
export function field(label, control, { hint, error, className, required } = {}) {
  const id = control.id || (control.id = domId('f'));
  const hintId = hint ? `${id}-hint` : null;
  const errId = `${id}-err`;
  const errEl = h('div', { class: 'field__error', id: errId, role: 'alert' }, error || '');
  const describedBy = [hintId, errId].filter(Boolean).join(' ');
  control.setAttribute('aria-describedby', describedBy);
  if (error) control.setAttribute('aria-invalid', 'true');
  return {
    el: h('div', { class: ['field', className] },
      h('label', { class: 'field__label', htmlFor: id }, label, required && h('span', { class: 'req', 'aria-hidden': 'true' }, ' *')),
      control, hint && h('div', { class: 'field__hint', id: hintId }, hint), errEl),
    setError(msg) {
      errEl.textContent = msg || '';
      if (msg) control.setAttribute('aria-invalid', 'true'); else control.removeAttribute('aria-invalid');
    },
  };
}

export const input = (props = {}) => h('input', { class: 'input', type: 'text', autocomplete: 'off', ...props });
export const textarea = (props = {}) => h('textarea', { class: 'input textarea', ...props });
export function select(options, value, props = {}) {
  const el = h('select', { class: 'input select', ...props },
    options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return h('option', { value: v, selected: v === value }, l); }));
  el.value = value ?? options[0]?.[0] ?? options[0];
  return el;
}

export function switchEl({ checked = false, label, onChange, describedBy }) {
  const id = domId('sw');
  const input = h('input', { type: 'checkbox', id, class: 'switch__input', checked, role: 'switch', on: { change: () => onChange?.(input.checked) } });
  if (describedBy) input.setAttribute('aria-describedby', describedBy);
  return h('label', { class: 'switch', htmlFor: id }, input, h('span', { class: 'switch__track', 'aria-hidden': 'true' }, h('span', { class: 'switch__thumb' })), h('span', { class: 'switch__label' }, label));
}

/** Segmented radio group: native radios for free keyboard + screen reader support. */
export function segmented({ name = domId('seg'), options, value, onChange, label, size }) {
  const wrap = h('div', { class: ['segmented', size && `segmented--${size}`], role: 'radiogroup', 'aria-label': label });
  for (const o of options) {
    const [v, text, ic] = Array.isArray(o) ? o : [o, o];
    const id = domId('seg');
    wrap.append(
      h('input', { type: 'radio', name, id, value: v, class: 'segmented__input', checked: v === value, on: { change: () => onChange?.(v) } }),
      h('label', { htmlFor: id, class: 'segmented__label' }, ic && icon(ic, 15), h('span', null, text)));
  }
  return wrap;
}

export function range({ min, max, step = 1, value, onInput, onChange, label, format = (v) => v, unit = '' }) {
  const id = domId('rng');
  const out = h('output', { class: 'range__value', htmlFor: id }, format(value) + unit);
  const el = h('input', { type: 'range', id, class: 'range__input', min, max, step, value, 'aria-label': label,
    on: { input: () => { out.textContent = format(+el.value) + unit; onInput?.(+el.value); }, change: () => onChange?.(+el.value) } });
  return { el: h('div', { class: 'range' }, h('div', { class: 'range__head' }, h('label', { htmlFor: id }, label), out), el), input: el, set(v) { el.value = v; out.textContent = format(v) + unit; } };
}

export function progressBar(pct, { label, className } = {}) {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  const el = h('div', { class: ['progress', className], role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': p, 'aria-label': label || 'Progress' }, h('div', { class: 'progress__fill' }));
  el.firstChild.style.width = `${p}%`;
  return el;
}

export function kbd(...keys) { return h('span', { class: 'kbd-group' }, keys.map((k) => h('kbd', null, k))); }

export function sectionHeader(title, ...actions) {
  return h('div', { class: 'section-head' }, h('h2', { class: 'section-head__title' }, title), h('div', { class: 'section-head__actions' }, ...actions));
}

/** Inline form-level error summary (role=alert). */
export function errorSummary() {
  const el = h('div', { class: 'form-error', role: 'alert', hidden: true });
  return { el, show(msg) { el.textContent = msg; el.hidden = !msg; }, };
}
