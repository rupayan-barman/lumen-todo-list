// Accessible modal dialogs built on the native <dialog> element (focus trap, Esc, inert background).
import { h, domId, focusables, clear } from './dom.js';
import { icon } from './icons.js';

const stack = [];

/**
 * openDialog({ title, body, actions, size, onClose, dismissible })
 * actions: [{ label, kind:'primary'|'danger'|'ghost', value, onClick(close) -> may return false to stay open, autofocus }]
 * Resolves (via .closed promise) with the value of the action chosen, or null if dismissed.
 */
export function openDialog({ title, body, actions = [], size = 'md', onClose, dismissible = true, description, className = '' }) {
  const opener = document.activeElement;
  const titleId = domId('dlg-title');
  const descId = domId('dlg-desc');
  let result = null;
  let resolveClosed;
  const closed = new Promise((r) => { resolveClosed = r; });

  const dlg = h('dialog', { class: ['dialog', `dialog--${size}`, className], 'aria-labelledby': titleId, 'aria-describedby': description ? descId : undefined });
  const close = (value = null) => { result = value; if (dlg.open) dlg.close(); };

  const bodyWrap = h('div', { class: 'dialog__body' }, description && h('p', { id: descId, class: 'muted' }, description), body);
  const foot = actions.length && h('div', { class: 'dialog__foot' }, ...actions.map((a) => {
    const btn = h('button', {
      type: 'button', class: ['btn', a.kind === 'primary' ? 'btn--primary' : a.kind === 'danger' ? 'btn--danger' : 'btn--ghost'],
      on: { click: async () => { const r = a.onClick ? await a.onClick(close) : undefined; if (r !== false && !a.keepOpen) close(a.value ?? null); } },
    }, a.icon && icon(a.icon, 16), a.label);
    if (a.autofocus) btn.dataset.autofocus = '1';
    a.ref?.(btn);
    return btn;
  }));

  dlg.append(
    h('header', { class: 'dialog__head' }, h('h2', { id: titleId, class: 'dialog__title' }, title),
      dismissible && h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close dialog', on: { click: () => close(null) } }, icon('x', 18))),
    bodyWrap, foot || null);

  dlg.addEventListener('cancel', (e) => { if (!dismissible) e.preventDefault(); });
  dlg.addEventListener('click', (e) => { if (dismissible && e.target === dlg) close(null); }); // backdrop click
  dlg.addEventListener('close', () => {
    stack.splice(stack.indexOf(dlg), 1);
    dlg.remove();
    try { onClose?.(result); } catch (e) { console.error(e); }
    if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
    resolveClosed(result);
  });

  document.body.append(dlg);
  stack.push(dlg);
  dlg.showModal();
  const target = dlg.querySelector('[data-autofocus],[autofocus]') || focusables(bodyWrap)[0] || focusables(dlg)[0];
  target?.focus();
  return { el: dlg, body: bodyWrap, close, closed, setBody(node) { clear(bodyWrap); bodyWrap.append(node); } };
}

export const openDialogCount = () => stack.length;

export function confirmDialog({ title = 'Are you sure?', message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, details }) {
  return new Promise((resolve) => {
    openDialog({
      title, size: 'sm',
      body: h('div', null, h('p', null, message), details && h('p', { class: 'muted small' }, details)),
      actions: [
        { label: cancelLabel, kind: 'ghost', value: false, autofocus: danger },
        { label: confirmLabel, kind: danger ? 'danger' : 'primary', value: true, autofocus: !danger },
      ],
      onClose: (v) => resolve(v === true),
    });
  });
}

export function alertDialog({ title, message, details }) {
  return openDialog({ title, size: 'sm', body: h('div', null, h('p', null, message), details && h('pre', { class: 'code-block' }, details)), actions: [{ label: 'OK', kind: 'primary', autofocus: true }] }).closed;
}

/** promptDialog({title,label,value,placeholder,validate(v)->string|null,confirmLabel,multiline}) -> string | null */
export function promptDialog({ title, label, value = '', placeholder = '', validate, confirmLabel = 'Save', hint, maxLength = 120 }) {
  return new Promise((resolve) => {
    const id = domId('prompt');
    const errId = domId('perr');
    const input = h('input', { class: 'input', id, type: 'text', value, placeholder, maxLength, autocomplete: 'off', 'aria-describedby': errId });
    const err = h('div', { class: 'field__error', id: errId, role: 'alert' });
    const submit = (close) => {
      const v = input.value.trim();
      const msg = validate ? validate(v) : (v ? null : 'Please enter a value');
      err.textContent = msg || '';
      input.setAttribute('aria-invalid', msg ? 'true' : 'false');
      if (msg) { input.focus(); return false; }
      close(v);
      return false;
    };
    const form = h('form', { class: 'field', on: { submit: (e) => { e.preventDefault(); dlgSubmit(); } } },
      h('label', { class: 'field__label', htmlFor: id }, label), input, hint && h('div', { class: 'field__hint' }, hint), err);
    let dlgRef;
    const dlgSubmit = () => submit(dlgRef.close);
    dlgRef = openDialog({
      title, size: 'sm', body: form,
      actions: [{ label: 'Cancel', kind: 'ghost' }, { label: confirmLabel, kind: 'primary', onClick: submit, keepOpen: true }],
      onClose: (v) => resolve(typeof v === 'string' ? v : null),
    });
    input.select();
  });
}
