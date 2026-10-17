// Sounds (synthesised with WebAudio: no audio files, works offline) and optional system notifications.
// Notifications only work while Lumen is open in a browser tab/window; there is no background service.
import { app } from './ctx.js';
import { getPrefs, setPrefs } from './prefs.js';

let ctx = null;
let unlocked = false;

function audio() {
  if (!ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; ctx = new AC(); }
  return ctx;
}
/** Browsers only allow sound after a user gesture; resume the context on the first one. */
export function unlockAudio() {
  if (unlocked) return;
  const c = audio(); if (!c) return;
  c.resume?.().then(() => { unlocked = c.state === 'running'; }).catch(() => {});
}
for (const evt of ['pointerdown', 'keydown']) window.addEventListener(evt, unlockAudio, { once: false, passive: true });

function tone(c, { f, t0, dur, type = 'sine', gain = 0.3, attack = 0.01, to }) {
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t0); if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination); o.start(t0); o.stop(t0 + dur + 0.05);
}

export const SOUNDS = { chime: 'Chime', bell: 'Bell', beep: 'Beep', soft: 'Soft' };

/** Returns true if a sound was actually started. */
export function playSound(kind = getPrefs().sound.kind, volume = getPrefs().sound.volume, { force = false } = {}) {
  const s = getPrefs().sound;
  if (!force && !s.enabled) return false;
  const c = audio(); if (!c) return false;
  if (c.state === 'suspended') { c.resume?.().catch(() => {}); if (c.state === 'suspended' && !unlocked) return false; }
  const v = Math.max(0, Math.min(1, volume / 100)); if (v === 0) return false;
  const t = c.currentTime + 0.02;
  switch (kind) {
    case 'bell': for (const [i, m] of [1, 2.01, 2.76, 5.4].entries()) tone(c, { f: 523 * m, t0: t, dur: 1.8 / (i + 1), gain: 0.22 * v / (i + 1), attack: 0.005 }); break;
    case 'beep': for (let i = 0; i < 3; i++) tone(c, { f: 880, t0: t + i * 0.22, dur: 0.14, type: 'square', gain: 0.12 * v }); break;
    case 'soft': tone(c, { f: 392, t0: t, dur: 1.2, gain: 0.28 * v, attack: 0.15 }); tone(c, { f: 587, t0: t + 0.25, dur: 1.4, gain: 0.2 * v, attack: 0.15 }); break;
    default: tone(c, { f: 1046.5, t0: t, dur: 0.9, gain: 0.3 * v }); tone(c, { f: 1318.5, t0: t + 0.18, dur: 1.1, gain: 0.3 * v }); tone(c, { f: 1568, t0: t + 0.36, dur: 1.4, gain: 0.26 * v });
  }
  return true;
}

/* ---------- system notifications ---------- */
export const notificationSupport = () => ('Notification' in window ? Notification.permission : 'unsupported');

/** Must be called from a user gesture (button click). Never called automatically. */
export async function requestNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  let perm = Notification.permission;
  if (perm === 'default') { try { perm = await Notification.requestPermission(); } catch { perm = Notification.permission; } }
  setPrefs({ notify: { asked: true, enabled: perm === 'granted' } });
  return perm;
}

/** Shows an in-app toast always, and a system notification when enabled + permitted + tab not focused. */
export function notify({ title, body = '', type = 'system', link = '', kind = 'info', toast = true, tag }) {
  if (toast) app.bus.emit('toast', { kind, message: body ? `${title}: ${body}` : title, timeout: 9000 });
  const n = getPrefs().notify;
  if (n.enabled && 'Notification' in window && Notification.permission === 'granted' && document.visibilityState === 'hidden') {
    try {
      const x = new Notification(title, { body, tag: tag || `${type}:${title}`, silent: true });
      x.onclick = () => { window.focus(); if (link) location.hash = link; x.close(); };
    } catch { /* some browsers throw outside secure contexts */ }
  }
}

app.bus.on('focus:ended', ({ session: s, late }) => {
  if (s.status !== 'completed') return;
  const isBreak = s.kind === 'pomodoro' && s.phase !== 'work';
  const what = s.label || (s.kind === 'pomodoro' ? 'Pomodoro' : 'Timer');
  const n = getPrefs().notify;
  if (n.focus) {
    notify({
      title: isBreak ? 'Break over' : s.kind === 'focus' ? 'Focus session complete' : 'Timer finished',
      body: isBreak ? 'Ready for the next focus block?' : s.kind === 'focus' ? `${what}. The task is now unlocked; it has NOT been marked complete.` : what,
      type: 'focus', link: '#/timer', kind: 'success', tag: `focus:${s.id}`,
    });
  }
  if (!late) playSound();
  else if (document.visibilityState !== 'hidden') playSound();
});
