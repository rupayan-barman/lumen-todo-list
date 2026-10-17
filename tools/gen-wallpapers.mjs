// Renders the bundled wallpapers from procedural SVG art (deterministic; no external assets).
// Needs the `sharp` package ONLY to regenerate; the generated .webp files are committed with the app.
//   npm i --no-save sharp && npm run gen:wallpapers
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { WALLPAPERS } from '../public/js/data/wallpapers.js';

const require = createRequire(import.meta.url);
let sharp;
for (const p of ['sharp', '/opt/npm-tools/node_modules/sharp']) { try { sharp = require(p); break; } catch { /* try next */ } }
if (!sharp) { console.error('sharp is not installed. Run: npm i --no-save sharp'); process.exit(1); }

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'wallpapers');
mkdirSync(OUT, { recursive: true });
const W = 1600, H = 900;

function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const svg = (body, defs = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs}</defs>${body}</svg>`;
const stops = (s) => s.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('');
const lin = (id, s, x1 = 0, y1 = 0, x2 = 0, y2 = 1) => `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops(s)}</linearGradient>`;
const rad = (id, s, cx = 0.5, cy = 0.5, r = 0.5) => `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${stops(s)}</radialGradient>`;
const blur = (id, sd) => `<filter id="${id}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="${sd}"/></filter>`;
const rect = (fill) => `<rect width="${W}" height="${H}" fill="${fill}"/>`;
const blob = (cx, cy, rx, ry, fill, f, op = 1) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" opacity="${op}" filter="url(#${f})"/>`;

function ridge(r, baseY, amp, rough, fill, op = 1, step = 40) {
  const pts = []; let y = baseY;
  for (let x = -step; x <= W + step; x += step) { y += (r() - 0.5) * rough; y = Math.min(baseY + amp, Math.max(baseY - amp, y)); pts.push([x, y]); }
  let d = `M${pts[0][0]},${H} L${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) { const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2; d += ` Q${pts[i][0]},${pts[i][1]} ${mx},${my}`; }
  return `<path d="${d} L${W + step},${H} Z" fill="${fill}" opacity="${op}"/>`;
}
function pines(r, baseY, color, count, op = 1) {
  let s = '';
  for (let i = 0; i < count; i++) { const x = r() * W, h = 70 + r() * 110, w = h * 0.34; s += `<path d="M${x},${baseY - h} L${x + w},${baseY} L${x - w},${baseY} Z" fill="${color}" opacity="${op}"/>`; }
  return s + `<rect x="0" y="${baseY - 2}" width="${W}" height="${H - baseY + 2}" fill="${color}" opacity="${op}"/>`;
}
function stars(r, n, color = '#fff', maxY = H) { let s = ''; for (let i = 0; i < n; i++) s += `<circle cx="${(r() * W).toFixed(0)}" cy="${(r() * maxY).toFixed(0)}" r="${(0.5 + r() * 1.3).toFixed(1)}" fill="${color}" opacity="${(0.25 + r() * 0.6).toFixed(2)}"/>`; return s; }
function grain(id, opacity = 0.05) { return `<filter id="${id}"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 ${opacity} 0"/></filter>`; }

const SCENES = {
  'aurora-night': () => { const r = prng(11); return svg(rect('url(#bg)') + stars(r, 140, '#cfe', 500) + blob(500, 330, 520, 70, '#34d399', 'b1', 0.5) + blob(900, 280, 560, 60, '#8b5cf6', 'b1', 0.55) + blob(1250, 360, 420, 50, '#38bdf8', 'b1', 0.4) + ridge(r, 780, 40, 60, '#060912') + `<rect width="${W}" height="${H}" fill="url(#vg)"/>`, lin('bg', [[0, '#050816'], [1, '#0c1330']]) + blur('b1', 38) + rad('vg', [[0.6, '#000', 0], [1, '#000', 0.55]], 0.5, 0.5, 0.75)); },
  obsidian: () => svg(rect('url(#bg)') + `<ellipse cx="1200" cy="200" rx="620" ry="320" fill="#4b5563" opacity="0.18" filter="url(#b)"/><ellipse cx="300" cy="780" rx="500" ry="260" fill="#6366f1" opacity="0.12" filter="url(#b)"/><rect width="${W}" height="${H}" filter="url(#n)"/>`, lin('bg', [[0, '#0a0a0c'], [1, '#17171c']], 0, 0, 1, 1) + blur('b', 70) + grain('n', 0.06)),
  'void-grid': () => { let g = ''; for (let x = 0; x <= W; x += 80) g += `<line x1="${x}" y1="0" x2="${x}" y2="${H}"/>`; for (let y = 0; y <= H; y += 80) g += `<line x1="0" y1="${y}" x2="${W}" y2="${y}"/>`; return svg(rect('#06070d') + `<g stroke="#7c9cff" stroke-opacity="0.07" stroke-width="1">${g}</g><circle cx="800" cy="450" r="520" fill="url(#c)"/>`, rad('c', [[0, '#5b6cff', 0.28], [1, '#5b6cff', 0]])); },
  ember: () => { const r = prng(5); let sp = ''; for (let i = 0; i < 70; i++) sp += `<circle cx="${(r() * W).toFixed(0)}" cy="${(300 + r() * 600).toFixed(0)}" r="${(1 + r() * 2.2).toFixed(1)}" fill="#ffb27a" opacity="${(0.2 + r() * 0.6).toFixed(2)}"/>`; return svg(rect('url(#bg)') + blob(800, 980, 900, 380, '#ff5a1f', 'b', 0.55) + blob(400, 900, 500, 240, '#ff2a6d', 'b', 0.35) + sp + `<rect width="${W}" height="${H}" fill="url(#vg)"/>`, lin('bg', [[0, '#0b0405'], [1, '#1d0a0a']]) + blur('b', 60) + rad('vg', [[0.55, '#000', 0], [1, '#000', 0.6]])); },
  flow: () => svg(rect('url(#bg)') + blob(300, 250, 520, 360, '#ff7eb3', 'b', 0.8) + blob(1200, 200, 560, 300, '#7a5cff', 'b', 0.8) + blob(900, 750, 640, 320, '#35d0ff', 'b', 0.7) + blob(150, 800, 420, 260, '#ffd166', 'b', 0.6), lin('bg', [[0, '#2b1b66'], [1, '#14295e']], 0, 0, 1, 1) + blur('b', 90)),
  prism: () => { const r = prng(21); const cols = ['#ff6b9d', '#c44dff', '#4d8bff', '#2ee6c5', '#ffd166']; let t = ''; for (let i = 0; i < 16; i++) { const x = r() * W, y = r() * H, s = 260 + r() * 460, a = r() * Math.PI * 2; t += `<polygon points="${x},${y} ${x + Math.cos(a) * s},${y + Math.sin(a) * s} ${x + Math.cos(a + 1.1) * s},${y + Math.sin(a + 1.1) * s}" fill="${cols[i % 5]}" opacity="${(0.16 + r() * 0.3).toFixed(2)}"/>`; } return svg(rect('url(#bg)') + t, lin('bg', [[0, '#1a1840'], [1, '#2a1a4d']], 0, 0, 1, 1)); },
  mesh: () => svg(rect('#101a3a') + blob(200, 150, 560, 420, '#7c5cff', 'b', 0.85) + blob(1400, 120, 520, 400, '#00c2ff', 'b', 0.7) + blob(1300, 800, 600, 420, '#ff5ea8', 'b', 0.65) + blob(300, 760, 540, 380, '#3dffb0', 'b', 0.5), blur('b', 110)),
  waves: () => { let w = ''; const cols = ['#5b8cff', '#7a5cff', '#c05cff', '#ff5cb8']; for (let i = 0; i < 9; i++) { const y = 260 + i * 70, a = 40 + i * 6; w += `<path d="M0,${y} C400,${y - a} 800,${y + a} 1200,${y - a / 2} S1600,${y + a / 2} 1600,${y} L1600,${H} L0,${H} Z" fill="${cols[i % 4]}" opacity="0.2"/>`; } return svg(rect('url(#bg)') + w, lin('bg', [[0, '#111a44'], [1, '#2a1650']])); },
  orbit: () => { let c = ''; for (let i = 1; i <= 12; i++) c += `<circle cx="1100" cy="420" r="${i * 70}" fill="none" stroke="#9db4ff" stroke-opacity="${(0.28 - i * 0.02).toFixed(2)}" stroke-width="1.5"/>`; return svg(rect('url(#bg)') + c + `<circle cx="1100" cy="420" r="90" fill="url(#c)"/><circle cx="${1100 + 350}" cy="${420 - 20}" r="9" fill="#b8c7ff"/><circle cx="${1100 - 140}" cy="${420 + 210}" r="6" fill="#ffb8e0"/>`, lin('bg', [[0, '#070a1c'], [1, '#141a40']], 0, 0, 1, 1) + rad('c', [[0, '#a8b8ff', 0.9], [1, '#a8b8ff', 0]])); },
  'neon-grid': () => { let g = ''; for (let i = -10; i <= 10; i++) g += `<line x1="${800 + i * 40}" y1="560" x2="${800 + i * 220}" y2="${H}"/>`; for (let i = 0; i < 9; i++) { const y = 560 + Math.pow(i / 8, 2) * 340; g += `<line x1="0" y1="${y}" x2="${W}" y2="${y}"/>`; } return svg(rect('url(#bg)') + `<circle cx="800" cy="470" r="190" fill="url(#sun)"/><g stroke="#ff2bd6" stroke-width="2" stroke-opacity="0.65">${g}</g><rect y="556" width="${W}" height="6" fill="#19f0ff" opacity="0.5" filter="url(#b)"/>`, lin('bg', [[0, '#12031f'], [0.62, '#3b0a50'], [0.62, '#12031f'], [1, '#080112']]) + lin('sun', [[0, '#ffe45e'], [1, '#ff2bd6']]) + blur('b', 6)); },
  'cyber-city': () => { const r = prng(33); let b = ''; const cols = ['#ff2bd6', '#19f0ff', '#9b5cff']; for (let i = 0; i < 40; i++) { const w = 40 + r() * 90, h = 120 + r() * 380, x = i * 42 + r() * 20; b += `<rect x="${x}" y="${H - h}" width="${w}" height="${h}" fill="#0a0518"/>`; for (let k = 0; k < 6; k++) b += `<rect x="${x + 8 + r() * (w - 20)}" y="${H - h + 14 + r() * (h - 30)}" width="4" height="4" fill="${cols[Math.floor(r() * 3)]}" opacity="${(0.4 + r() * 0.6).toFixed(2)}"/>`; } return svg(rect('url(#bg)') + blob(1100, 300, 500, 200, '#ff2bd6', 'bl', 0.35) + blob(400, 360, 520, 220, '#19f0ff', 'bl', 0.3) + b, lin('bg', [[0, '#0a0420'], [1, '#2a0a47']]) + blur('bl', 70)); },
  'rgb-spectrum': () => svg(rect('#05060c') + blob(250, 450, 380, 700, '#ff2a6d', 'b', 0.6) + blob(800, 450, 380, 700, '#2aff9d', 'b', 0.45) + blob(1350, 450, 380, 700, '#2a6dff', 'b', 0.6) + `<rect width="${W}" height="${H}" fill="url(#vg)"/>`, blur('b', 100) + rad('vg', [[0.5, '#000', 0], [1, '#000', 0.55]])),
  circuit: () => { const r = prng(77); let p = ''; for (let i = 0; i < 46; i++) { let x = Math.round(r() * 20) * 80, y = Math.round(r() * 12) * 75, d = `M${x},${y}`; for (let k = 0; k < 4; k++) { if (r() > 0.5) x += (r() > 0.5 ? 1 : -1) * 80 * (1 + Math.floor(r() * 2)); else y += (r() > 0.5 ? 1 : -1) * 75 * (1 + Math.floor(r() * 2)); d += ` L${x},${y}`; } p += `<path d="${d}" fill="none" stroke="${r() > 0.5 ? '#19f0ff' : '#ff2bd6'}" stroke-opacity="0.28" stroke-width="2"/><circle cx="${x}" cy="${y}" r="5" fill="none" stroke="#19f0ff" stroke-opacity="0.5" stroke-width="2"/>`; } return svg(rect('#040712') + p + `<rect width="${W}" height="${H}" fill="url(#vg)"/>`, rad('vg', [[0.4, '#000', 0], [1, '#000', 0.6]])); },
  'mountain-dawn': () => { const r = prng(8); return svg(rect('url(#bg)') + `<circle cx="1050" cy="520" r="120" fill="#ffe3b3" opacity="0.9" filter="url(#b)"/>` + ridge(r, 560, 110, 120, '#9b7fb8', 0.7, 60) + ridge(r, 650, 90, 100, '#6c5a99', 0.85, 50) + ridge(r, 740, 70, 80, '#3d3a6e', 1, 45) + ridge(r, 830, 40, 50, '#221f45', 1, 40), lin('bg', [[0, '#3a3a7a'], [0.55, '#ff9e80'], [1, '#ffd7a1']]) + blur('b', 14)); },
  'forest-mist': () => { const r = prng(14); return svg(rect('url(#bg)') + pines(r, 600, '#1d3b3a', 36, 0.7) + `<rect y="520" width="${W}" height="200" fill="url(#m)"/>` + pines(r, 720, '#14292c', 30, 0.9) + `<rect y="650" width="${W}" height="160" fill="url(#m)"/>` + pines(r, 840, '#0b1a1e', 24, 1), lin('bg', [[0, '#0f2a35'], [1, '#2c5b5a']]) + lin('m', [[0, '#cfe8e0', 0], [0.5, '#cfe8e0', 0.28], [1, '#cfe8e0', 0]])); },
  'ocean-dusk': () => { let w = ''; for (let i = 0; i < 14; i++) w += `<rect x="${200 + i * 7}" y="${520 + i * 24}" width="${1200 - i * 14}" height="3" fill="#ffd7a8" opacity="${(0.5 - i * 0.03).toFixed(2)}"/>`; return svg(rect('url(#bg)') + `<circle cx="800" cy="500" r="110" fill="#ffd2a1" opacity="0.95" filter="url(#b)"/><rect y="520" width="${W}" height="${H - 520}" fill="url(#sea)"/>` + w, lin('bg', [[0, '#1c1f4a'], [0.5, '#c0527a'], [1, '#ffb27a']]) + lin('sea', [[0, '#3a2d5c'], [1, '#0d1634']]) + blur('b', 10)); },
  dunes: () => { const r = prng(61); return svg(rect('url(#bg)') + `<circle cx="1200" cy="260" r="90" fill="#fff1c9" opacity="0.9" filter="url(#b)"/>` + ridge(r, 620, 70, 70, '#e0a064', 1, 80) + ridge(r, 720, 60, 60, '#c47f4b', 1, 70) + ridge(r, 820, 40, 40, '#8f5a38', 1, 60), lin('bg', [[0, '#f6c28b'], [1, '#ffe7c4']]) + blur('b', 12)); },
  'aurora-peaks': () => { const r = prng(90); return svg(rect('url(#bg)') + stars(r, 120, '#e9f4ff', 420) + blob(700, 250, 600, 80, '#2ee6a0', 'b', 0.55) + blob(1050, 200, 560, 70, '#6a8bff', 'b', 0.5) + ridge(r, 600, 150, 150, '#1b2a4a', 1, 80) + ridge(r, 720, 90, 100, '#101a33', 1, 60) + ridge(r, 820, 50, 60, '#070c1a', 1, 50), lin('bg', [[0, '#040a1c'], [1, '#12284a']]) + blur('b', 40)); },
  paper: () => svg(rect('#f4f1ea') + `<rect width="${W}" height="${H}" filter="url(#n)"/>` + `<ellipse cx="1300" cy="150" rx="500" ry="300" fill="#ffe6c7" opacity="0.5" filter="url(#b)"/>`, grain('n', 0.1).replace('1  0 0 0 0 1  0 0 0 0 1', '0  0 0 0 0 0  0 0 0 0 0') + blur('b', 80)),
  slate: () => svg(rect('url(#bg)') + `<ellipse cx="400" cy="200" rx="560" ry="300" fill="#ffffff" opacity="0.08" filter="url(#b)"/><rect width="${W}" height="${H}" filter="url(#n)"/>`, lin('bg', [[0, '#3a4252'], [1, '#232a38']], 0, 0, 1, 1) + blur('b', 90) + grain('n', 0.05)),
  'soft-gradient': () => svg(rect('url(#bg)') + blob(300, 200, 500, 320, '#ffd1e8', 'b', 0.7) + blob(1300, 700, 560, 340, '#c9ddff', 'b', 0.8), lin('bg', [[0, '#f3f0ff'], [1, '#e8f4ff']], 0, 0, 1, 1) + blur('b', 100)),
};

let ok = 0;
for (const w of WALLPAPERS) {
  if (w.kind !== 'image') continue;
  const scene = SCENES[w.id];
  if (!scene) { console.error(`missing scene for ${w.id}`); process.exitCode = 1; continue; }
  const buf = Buffer.from(scene());
  const full = await sharp(buf).resize(W, H).webp({ quality: 74, effort: 5 }).toBuffer();
  const thumb = await sharp(buf).resize(320, 180).webp({ quality: 70, effort: 5 }).toBuffer();
  writeFileSync(join(OUT, `${w.id}.webp`), full);
  writeFileSync(join(OUT, `${w.id}.thumb.webp`), thumb);
  console.log(`${w.id.padEnd(16)} ${(full.length / 1024).toFixed(0).padStart(4)} KB  thumb ${(thumb.length / 1024).toFixed(0)} KB`);
  ok++;
}
console.log(`\nRendered ${ok} wallpapers.`);
