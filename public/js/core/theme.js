// Theme engine: preset palettes + the function that turns preferences into CSS custom properties.
// Pure (no DOM): the same code is unit-tested for contrast across every preset and mode.
import { hexToRgb, rgbToHex, mix, contrast, ensureContrast, readableOn, randomPalette, rng, hexToHsl, hslToHex } from './color.js';
import { clamp } from './util.js';

const pal = (bg, bg2, glass, border, primary, accent) => ({ bg, bg2, glass, border, primary, accent });

export const PRESET_THEMES = [
  { id: 'midnight', name: 'Midnight', light: pal('#eef1fb', '#dfe5fa', '#ffffff', '#4a5bd0', '#3949c9', '#7a45d6'), dark: pal('#070b1a', '#141b3a', '#182044', '#8da2ff', '#8aa4ff', '#c4a1ff') },
  { id: 'cyberpunk', name: 'Cyberpunk', light: pal('#fbf3ff', '#f1dcff', '#ffffff', '#b0129a', '#b0129a', '#007c91'), dark: pal('#0a0612', '#1f0a35', '#1c0e33', '#ff2bd6', '#ff4fd8', '#19f0ff'), glow: 30 },
  { id: 'emerald', name: 'Emerald', light: pal('#effaf5', '#d3f2e3', '#ffffff', '#0f7a55', '#0b7a55', '#4d7c0f'), dark: pal('#04130e', '#0b2e22', '#0f2a21', '#34d399', '#34d399', '#a3e635') },
  { id: 'ocean', name: 'Ocean', light: pal('#ecf6fd', '#d2e9fa', '#ffffff', '#0369a1', '#0369a1', '#0f766e'), dark: pal('#04111f', '#0a2a4a', '#0c2540', '#38bdf8', '#38bdf8', '#2dd4bf') },
  { id: 'lavender', name: 'Lavender', light: pal('#f6f1ff', '#e7dcff', '#ffffff', '#6d3fd1', '#6d3fd1', '#a21caf'), dark: pal('#100b1f', '#261a45', '#21173d', '#c4b5fd', '#c4b5fd', '#f0abfc') },
  { id: 'rose', name: 'Rose', light: pal('#fff1f3', '#ffdde3', '#ffffff', '#be123c', '#be123c', '#b45309'), dark: pal('#190a10', '#3a1226', '#2b1220', '#fb7185', '#fb7185', '#fbbf24') },
  { id: 'arctic', name: 'Arctic', light: pal('#f1f8fb', '#dcedf4', '#ffffff', '#0e7490', '#0e7490', '#1d4ed8'), dark: pal('#0b141a', '#16303c', '#14262f', '#a5f3fc', '#7dd3fc', '#bae6fd') },
  { id: 'minimal', name: 'Minimal', light: pal('#f6f6f6', '#ececec', '#ffffff', '#525252', '#171717', '#525252'), dark: pal('#111111', '#1b1b1b', '#1c1c1c', '#a3a3a3', '#e5e5e5', '#a3a3a3'), glass: { opacity: 80, blur: 8, glow: 0, highlight: 12 } },
];

export const STATUS = {
  light: { danger: '#b91c1c', warning: '#92400e', success: '#166534', info: '#075985' },
  dark: { danger: '#ff9a9a', warning: '#ffd166', success: '#6ee7a1', info: '#8bd3ff' },
};

export const FONT_STACKS = {
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  humanist: '"Segoe UI", "Trebuchet MS", Candara, Verdana, sans-serif',
  serif: 'Georgia, "Iowan Old Style", "Palatino Linotype", Cambria, serif',
  mono: 'ui-monospace, "Cascadia Mono", "Cascadia Code", Consolas, Menlo, monospace',
  rounded: '"Segoe UI Variable Display", "Nunito", "Varela Round", system-ui, sans-serif',
};

const rgbTriplet = (hex) => hexToRgb(hex).join(' ');
const GLASS_DEFAULTS = { opacity: 58, blur: 18, border: 22, shadow: 40, highlight: 30, glow: 10 };

export function findTheme(id, customThemes = []) {
  return PRESET_THEMES.find((t) => t.id === id) || customThemes.find((t) => t.id === id) || PRESET_THEMES[0];
}

export function paletteFor(theme, mode, overrides = {}) {
  const base = theme[mode] || theme.dark;
  const out = { ...base };
  for (const [k, v] of Object.entries(overrides[mode] || {})) if (v) out[k] = v;
  return out;
}

/** Range of colours that could sit BEHIND the glass (wallpaper under overlay + brightness). */
export function behindRange(bg, mode = 'dark') {
  const ov = bg.overlayColor || (mode === 'light' ? '#ffffff' : '#000000'); // null = automatic, follows the mode
  const a = clamp((bg.overlayOpacity ?? 0) / 100, 0, 0.9);
  const bright = clamp((bg.brightness ?? 100) / 100, 0.3, 1.4);
  const gray = (v) => rgbToHex([v, v, v]);
  const lo = mix(ov, gray(0), a);
  const hi = mix(ov, gray(clamp(255 * bright, 0, 255)), a);
  return [lo, hi];
}

/** Smallest glass alpha (>= wanted) that keeps `textHex` at `min` contrast over every possible backdrop. */
export function guardedAlpha(textHex, glassHex, wanted, [lo, hi], min = 4.5) {
  const ok = (a) => [lo, hi].every((b) => contrast(textHex, mix(glassHex, b, a)) >= min);
  if (ok(wanted)) return wanted;
  for (let a = wanted; a <= 0.985; a += 0.01) if (ok(a)) return Math.min(a, 0.985);
  return 0.985;
}

export function deriveText(dark, bg, glass) {
  const text = dark ? mix('#ffffff', bg, 0.93) : mix('#0b1020', bg, 0.96);
  return text;
}

/**
 * computeTokens({ mode:'light'|'dark', theme, overrides, glass, radius, type, bg, effects, density, motion })
 * -> { vars: {'--x': 'value'}, meta: { alpha, guarded } }
 */
export function computeTokens({ mode, theme, overrides, glass: g = {}, radius = 14, type = {}, bg = {}, effects = 'full', density = 'comfortable' }) {
  const dark = mode === 'dark';
  const p = paletteFor(theme, mode, overrides);
  const gl = { ...GLASS_DEFAULTS, ...(theme.glass || {}), ...g };
  const lite = effects === 'lite';
  const status = STATUS[mode];

  const text = deriveText(dark, p.bg, p.glass);
  const range = behindRange(bg, mode);
  const wantedAlpha = clamp(gl.opacity / 100, 0.2, 0.98);
  const guarded = g.autoContrast === false ? wantedAlpha : guardedAlpha(text, p.glass, lite ? Math.max(wantedAlpha, 0.8) : wantedAlpha, range);
  const strongAlpha = clamp(Math.max(guarded + 0.3, 0.9), 0, 0.99);

  // Worst-case surface colours for checking secondary text
  const worst = [mix(p.glass, range[0], guarded), mix(p.glass, range[1], guarded)];
  const dir = dark ? 'lighter' : 'darker';
  const fitText = (hex, min = 4.5) => worst.reduce((c, w) => ensureContrast(c, w, min, dir), hex);
  const textMuted = fitText(mix(text, p.glass, 0.74));
  const textFaint = fitText(mix(text, p.glass, 0.58));
  const primary = fitText(p.primary);
  const accent = fitText(p.accent);
  const onPrimary = readableOn(p.primary, '#ffffff', '#0b1020');
  const onAccent = readableOn(p.accent, '#ffffff', '#0b1020');
  const border = p.border;
  const shadowK = gl.shadow / 100, glowK = lite ? 0 : gl.glow / 100;

  const vars = {
    '--bg': p.bg, '--bg-2': p.bg2,
    '--glass-rgb': rgbTriplet(p.glass), '--glass-alpha': guarded.toFixed(3), '--glass-alpha-strong': strongAlpha.toFixed(3),
    '--surface-solid': mix(p.glass, p.bg, 1),
    '--border-rgb': rgbTriplet(border), '--border-alpha': (gl.border / 100).toFixed(3),
    '--text': text, '--text-muted': textMuted, '--text-faint': textFaint,
    '--primary': primary, '--primary-raw': p.primary, '--primary-rgb': rgbTriplet(p.primary), '--on-primary': onPrimary,
    '--accent': accent, '--accent-rgb': rgbTriplet(p.accent), '--on-accent': onAccent,
    '--danger': fitText(status.danger), '--warning': fitText(status.warning), '--success': fitText(status.success), '--info': fitText(status.info),
    '--focus-ring': dark ? mix('#ffffff', p.primary, 0.55) : mix('#000000', p.primary, 0.35),
    '--shadow-color': dark ? '0 0 0' : '31 41 90',
    '--shadow-k': shadowK.toFixed(3),
    '--shadow-alpha': ((dark ? 0.55 : 0.22) * shadowK).toFixed(3),
    '--highlight-alpha': ((dark ? 0.16 : 0.7) * (gl.highlight / 100) * 1.6).toFixed(3),
    '--glow-alpha': (glowK * 0.55).toFixed(3),
    '--blur': lite ? '0px' : `${gl.blur}px`,
    '--blur-strong': lite ? '0px' : `${Math.round(gl.blur * 1.4)}px`,
    '--radius': `${radius}px`, '--radius-sm': `${Math.max(2, Math.round(radius * 0.6))}px`, '--radius-lg': `${Math.round(radius * 1.5)}px`,
    '--font': FONT_STACKS[type.font] || FONT_STACKS.system,
    '--font-scale': String((type.scale ?? 100) / 100),
    '--space': density === 'compact' ? '0.8' : '1',
    color_scheme: dark ? 'dark' : 'light',
  };
  return { vars, meta: { alpha: guarded, wanted: wantedAlpha, guarded: guarded > wantedAlpha + 0.001, text, textMuted, worst } };
}

/* ---------- random theme ---------- */
export function makeRandomTheme(rand = Math.random, name = 'Random') {
  const p = randomPalette(rand);
  return { id: 'random', name, light: p.light, dark: p.dark, harmony: p.harmony };
}

export function newCustomThemeFrom(base, name, id) {
  return { id, name, light: { ...base.light }, dark: { ...base.dark }, glass: base.glass ? { ...base.glass } : {}, radius: base.radius ?? 14 };
}
