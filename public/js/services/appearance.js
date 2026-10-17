// Turns preferences into what you see: CSS tokens, mode, motion, effects, wallpaper and per-area backgrounds.
// Safe to call as often as needed; it only touches CSS custom properties and data-attributes.
import { app } from './ctx.js';
import { getPrefs } from './prefs.js';
import { PRESET_THEMES, computeTokens, findTheme } from '../core/theme.js';
import { mix } from '../core/color.js';
import { wallpaperById } from '../data/wallpapers.js';
import { assetUrl, getImage } from './wallpapers.js';
import { AREAS } from '../core/prefs.js';

const root = document.documentElement;
const mqDark = window.matchMedia('(prefers-color-scheme: dark)');
const mqMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let appliedVars = new Set();
let focusActive = false;
let lastBgKey = '';
let failedImage = false;

export const customThemes = () => { try { return app.store?.all('themes') || []; } catch { return []; } };
export const allThemes = () => [...PRESET_THEMES, ...customThemes()];
export const resolveMode = (p = getPrefs()) => (p.mode === 'system' ? (mqDark.matches ? 'dark' : 'light') : p.mode);
export const motionReduced = (p = getPrefs()) => p.motion === 'reduced' || (p.motion === 'system' && mqMotion.matches);
export const currentTheme = (p = getPrefs()) => findTheme(p.themeId, customThemes());

function bgOf(p) {
  const f = p.areas.focus;
  if (focusActive && p.focusMode.useAppearance && f.mode !== 'inherit') {
    return { ...p.background, kind: f.mode === 'preset' ? 'preset' : f.mode === 'image' ? 'image' : f.mode, presetId: f.presetId || p.background.presetId, assetId: f.assetId, solid: f.color, from: f.from, to: f.to, angle: f.angle, overlayOpacity: Math.max(p.background.overlayOpacity, f.dim) };
  }
  return p.background;
}

/** Tokens for any prefs (also used by the live preview in the Appearance Studio). */
export function tokensFor(p = getPrefs()) {
  const mode = resolveMode(p);
  return { mode, ...computeTokens({ mode, theme: currentTheme(p), overrides: p.overrides, glass: p.glass, radius: p.radius, type: p.type, bg: bgOf(p), effects: p.effects, density: p.density }) };
}

export function applyAppearance(p = getPrefs()) {
  const { mode, vars, meta } = tokensFor(p);
  const next = new Set();
  for (const [k, v] of Object.entries(vars)) {
    if (k === 'color_scheme') { root.style.colorScheme = v; continue; }
    root.style.setProperty(k, v); next.add(k);
  }
  for (const k of appliedVars) if (!next.has(k)) root.style.removeProperty(k);
  appliedVars = next;

  const reduced = motionReduced(p);
  root.dataset.mode = mode;
  root.dataset.effects = p.effects;
  root.dataset.motion = p.motion === 'system' ? 'system' : p.motion;
  root.dataset.density = p.density;
  root.dataset.width = p.contentWidth;
  root.dataset.sidebar = p.sidebar.collapsed ? 'collapsed' : 'expanded';
  root.dataset.focusCalm = focusActive && p.focusMode.calm ? 'on' : 'off';
  root.style.setProperty('--sidebar-w', `${p.sidebar.width}px`);
  const bg = bgOf(p);
  const preset = bg.kind === 'preset' ? wallpaperById(bg.presetId) : null;
  const wantsAnim = (bg.animated || preset?.animated || bg.rgbGlow > 0) && !reduced && p.effects === 'full';
  root.dataset.anim = wantsAnim && !(focusActive && p.focusMode.calm) ? 'on' : 'off';
  root.style.setProperty('--anim-speed', String(bg.animSpeed));
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', mode === 'dark' ? vars['--bg'] : vars['--bg-2']);

  try { localStorage.setItem('lumen.boot', JSON.stringify({ mode, scheme: vars.color_scheme, vars: Object.fromEntries(Object.entries(vars).filter(([k]) => k !== 'color_scheme')) })); } catch { /* optional cache */ }
  applyBackground(p);
  applyAreas(p);
  app.bus.emit('appearance:applied', { mode, meta });
  return { mode, meta };
}

/* ---------- wallpaper layers ---------- */
function layers() {
  let el = document.getElementById('bg');
  if (!el) return null;
  return { el, base: el.querySelector('.bg-base'), img: el.querySelector('.bg-image'), ov: el.querySelector('.bg-overlay'), vig: el.querySelector('.bg-vignette'), rgb: el.querySelector('.bg-rgb') };
}

function imageUrlFor(bg) {
  if (bg.kind === 'preset') { const w = wallpaperById(bg.presetId); return w && w.kind === 'image' ? w.file : null; }
  if (bg.kind === 'image') return assetUrl(bg.assetId);
  return null;
}

export function applyBackground(p = getPrefs()) {
  const L = layers(); if (!L) return;
  const mode = resolveMode(p);
  const bg = bgOf(p);
  const s = L.el.style;
  const ovColor = bg.overlayColor || (mode === 'light' ? '#ffffff' : '#000000');
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(ovColor.slice(i, i + 2), 16));
  s.setProperty('--bg-overlay', `rgb(${r} ${g} ${b} / ${bg.overlayOpacity / 100})`);
  s.setProperty('--bg-brightness', String(bg.brightness / 100));
  s.setProperty('--bg-blur', `${bg.blur}px`);
  s.setProperty('--bg-opacity', String(bg.opacity / 100));
  s.setProperty('--bg-size', bg.fit === 'fill' ? '100% 100%' : bg.fit);
  s.setProperty('--bg-pos', `${bg.posX}% ${bg.posY}%`);
  s.setProperty('--bg-scale', String(bg.scale / 100));
  s.setProperty('--bg-vignette', String(bg.vignette / 100 * 0.8));
  s.setProperty('--bg-rgb', p.effects === 'lite' ? '0' : String(bg.rgbGlow / 100 * 0.6));
  L.rgb.dataset.live = bg.rgbGlow > 0 ? '1' : '0';

  // base layer: solid / gradient / css-animated preset / theme gradient
  L.base.className = 'bg-base';
  L.base.style.background = '';
  L.base.style.backgroundColor = '';
  const preset = bg.kind === 'preset' ? wallpaperById(bg.presetId) : null;
  if (bg.kind === 'solid') L.base.style.backgroundColor = bg.solid;
  else if (bg.kind === 'gradient') {
    const k = bg.gradientIntensity / 100;
    L.base.style.background = `linear-gradient(${bg.angle}deg, ${bg.from}, ${mix(bg.to, bg.from, k)})`;
  } else if (preset?.kind === 'css') L.base.classList.add(`bg-${preset.id.replace('anim-', 'anim-')}`);
  else L.base.style.background = `linear-gradient(160deg, var(--bg), var(--bg-2))`;

  // image layer
  const url = failedImage && lastBgKey === `${bg.kind}:${bg.presetId}:${bg.assetId}` ? null : imageUrlFor(bg);
  const key = `${bg.kind}:${bg.presetId}:${bg.assetId}`;
  if (key !== lastBgKey) { failedImage = false; lastBgKey = key; }
  if (url && !failedImage) {
    if (L.img.dataset.src !== url) {
      L.img.dataset.src = url;
      const probe = new Image();
      probe.onload = () => { if (L.img.dataset.src === url) L.img.style.backgroundImage = `url("${url}")`; };
      probe.onerror = () => {
        failedImage = true;
        L.img.style.backgroundImage = 'none'; L.img.dataset.src = '';
        L.base.style.background = 'linear-gradient(160deg, var(--bg), var(--bg-2))'; // fallback so the app is never blank
        app.bus.emit('toast', { kind: 'warn', message: 'The selected wallpaper could not be loaded, so a plain themed background is shown instead.' });
      };
      probe.src = url;
    }
  } else { L.img.style.backgroundImage = 'none'; L.img.dataset.src = ''; }
}

/* ---------- per-area backgrounds ---------- */
function areaCss(a) {
  switch (a.mode) {
    case 'preset': { const w = wallpaperById(a.presetId); return w?.kind === 'image' ? `url("${w.file}")` : null; }
    case 'image': { const u = assetUrl(a.assetId); return u ? `url("${u}")` : null; }
    case 'solid': return a.color;
    case 'gradient': return `linear-gradient(${a.angle}deg, ${a.from}, ${a.to})`;
    default: return null;
  }
}
export function applyAreas(p = getPrefs()) {
  const dark = resolveMode(p) === 'dark';
  for (const name of AREAS) {
    const a = p.areas[name];
    const css = a.mode === 'inherit' ? null : areaCss(a);
    root.style.setProperty(`--area-${name}`, css || 'none');
    root.style.setProperty(`--area-${name}-dim`, css ? `rgb(${dark ? '0 0 0' : '255 255 255'} / ${a.dim / 100})` : 'transparent');
    root.dataset[`area${name[0].toUpperCase()}${name.slice(1)}`] = css ? 'custom' : 'inherit';
  }
}

/* ---------- focus mode appearance ---------- */
export function setFocusActive(on) {
  if (focusActive === on) return;
  focusActive = on;
  root.dataset.focus = on ? 'on' : 'off';
  applyAppearance();
}
export const isFocusAppearance = () => focusActive;

/* ---------- boot + reactive wiring ---------- */
export function initAppearance() {
  applyAppearance();
  const reapply = () => applyAppearance();
  mqDark.addEventListener('change', () => { if (getPrefs().mode === 'system') reapply(); });
  mqMotion.addEventListener('change', reapply);
  app.bus.on('prefs:change', reapply);
  app.bus.on('store:themes', reapply);
  app.bus.on('store:assets', reapply);
}
