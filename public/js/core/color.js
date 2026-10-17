// Colour maths for the theme engine: hex <-> HSL, WCAG contrast, coordinated random palettes.
import { clamp } from './util.js';
import { normHex } from './validate.js';

export function hexToRgb(hex) {
  const h = normHex(hex);
  if (!h) return null;
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}
export const rgbToHex = ([r, g, b]) => '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');

export function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, s, l];
}
export function hslToRgb([h, s, l]) {
  h = ((h % 360) + 360) % 360; s = clamp(s, 0, 1); l = clamp(l, 0, 1);
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
export const hexToHsl = (hex) => rgbToHsl(hexToRgb(hex));
export const hslToHex = (hsl) => rgbToHex(hslToRgb(hsl));

export function luminance(hex) {
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = hexToRgb(hex).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** Blend fg over bg with alpha (0..1). */
export function mix(fgHex, bgHex, alpha) {
  const f = hexToRgb(fgHex), b = hexToRgb(bgHex);
  return rgbToHex(f.map((v, i) => v * alpha + b[i] * (1 - alpha)));
}
/** Pick black-ish or white-ish text for a background, whichever contrasts more. */
export function readableOn(bgHex, light = '#ffffff', dark = '#0b1020') {
  return contrast(bgHex, light) >= contrast(bgHex, dark) ? light : dark;
}
/**
 * Nudge `fg` lightness until it reaches `min` contrast against `bg`.
 * `dir` ('lighter' | 'darker') fixes the direction, which matters when several backdrops must be
 * satisfied at once; without it the direction follows the backdrop's brightness.
 */
export function ensureContrast(fgHex, bgHex, min = 4.5, dir) {
  if (contrast(fgHex, bgHex) >= min) return fgHex;
  const [h, s, l] = hexToHsl(fgHex);
  const sign = dir === 'lighter' ? 1 : dir === 'darker' ? -1 : (luminance(bgHex) < 0.4 ? 1 : -1);
  for (let i = 1; i <= 50; i++) {
    const cand = hslToHex([h, s, clamp(l + sign * i * 0.02, 0, 1)]);
    if (contrast(cand, bgHex) >= min) return cand;
  }
  const primary = sign > 0 ? '#ffffff' : '#000000';
  const other = sign > 0 ? '#000000' : '#ffffff';
  return contrast(primary, bgHex) >= contrast(other, bgHex) ? primary : other;
}

/** Seeded PRNG so tests (and "undo random") are reproducible. */
export function rng(seed = Date.now()) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HARMONIES = ['analogous', 'complementary', 'triadic', 'split'];

/**
 * A coordinated palette for both appearance modes. Hue relationships come from a colour-wheel
 * harmony, background/surface share the base hue, and the primary is adjusted until it meets
 * 4.5:1 against its surface and white/dark button text meets 4.5:1 on the primary.
 */
export function randomPalette(rand = Math.random) {
  const h0 = rand() * 360;
  const harmony = HARMONIES[Math.floor(rand() * HARMONIES.length)];
  const offs = { analogous: 35, complementary: 180, triadic: 120, split: 150 }[harmony];
  const h1 = (h0 + offs * (rand() > 0.5 ? 1 : -1) + 360) % 360;
  const sat = 0.55 + rand() * 0.3;

  const build = (dark) => {
    const bg = hslToHex([h0, dark ? 0.35 + rand() * 0.2 : 0.35 + rand() * 0.2, dark ? 0.07 + rand() * 0.04 : 0.95 + rand() * 0.03]);
    const bg2 = hslToHex([(h0 + 20) % 360, dark ? 0.4 : 0.45, dark ? 0.15 + rand() * 0.05 : 0.88 + rand() * 0.04]);
    const glass = hslToHex([h0, dark ? 0.3 : 0.25, dark ? 0.16 : 0.99]);
    const border = hslToHex([h0, 0.5, dark ? 0.7 : 0.35]);
    const primary = ensureContrast(hslToHex([h0, sat, dark ? 0.66 : 0.42]), glass, 4.5);
    const accent = ensureContrast(hslToHex([h1, sat, dark ? 0.68 : 0.4]), glass, 4.5);
    return { bg, bg2, glass, border, primary, accent };
  };
  return { harmony, light: build(false), dark: build(true) };
}
