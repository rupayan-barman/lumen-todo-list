// Undo stack for destructive/bulk actions. Each entry holds a closure that reverses the action.
// Entries expire after a while so a stale undo can never clobber newer edits.
import { app } from './ctx.js';
import { clock } from '../core/clock.js';

const MAX = 20;
const TTL = 10 * 60_000;
const stack = [];

export const undo = {
  push(label, fn) {
    stack.push({ label, fn, at: clock.now() });
    if (stack.length > MAX) stack.shift();
    app.bus.emit('undo:change', { label });
  },
  peek() {
    const now = clock.now();
    while (stack.length && now - stack[stack.length - 1].at > TTL) stack.pop();
    return stack[stack.length - 1] || null;
  },
  async run() {
    const e = this.peek();
    if (!e) return null;
    stack.pop();
    try { await e.fn(); } catch (err) {
      app.bus.emit('toast', { kind: 'error', message: `Could not undo: ${err.message}` });
      return null;
    }
    app.bus.emit('undo:change', { label: null });
    app.bus.emit('toast', { kind: 'success', message: `Undone: ${e.label}` });
    return e;
  },
  /** Run exactly the entry that was pushed (used by its toast button). */
  async runLast(label) { const e = this.peek(); return e && e.label === label ? this.run() : null; },
  clear() { stack.length = 0; },
  size: () => stack.length,
};
