// Catalogue of wallpapers shipped with the app. Images are local files under /wallpapers (no network).
// `tone` tells the contrast guard what to expect behind the glass.
//  kind 'image' -> /wallpapers/<id>.webp  (+ <id>.thumb.webp)    kind 'css' -> pure CSS (animated / light-weight)
export const WALLPAPER_CATEGORIES = [
  ['abstract', 'Abstract'], ['dark', 'Dark'], ['cyber', 'Cyberpunk & RGB'], ['nature', 'Nature'], ['minimal', 'Minimal'], ['animated', 'Animated'],
];

const img = (id, name, category, tone, extra = {}) => ({ id, name, category, tone, kind: 'image', file: `wallpapers/${id}.webp`, thumb: `wallpapers/${id}.thumb.webp`, ...extra });

export const WALLPAPERS = [
  img('aurora-night', 'Aurora Night', 'dark', 'dark'),
  img('obsidian', 'Obsidian', 'dark', 'dark'),
  img('void-grid', 'Void Grid', 'dark', 'dark'),
  img('ember', 'Ember', 'dark', 'dark'),
  img('flow', 'Flow', 'abstract', 'mid'),
  img('prism', 'Prism', 'abstract', 'mid'),
  img('mesh', 'Mesh', 'abstract', 'mid'),
  img('waves', 'Waves', 'abstract', 'mid'),
  img('orbit', 'Orbit', 'abstract', 'dark'),
  img('neon-grid', 'Neon Grid', 'cyber', 'dark'),
  img('cyber-city', 'Cyber City', 'cyber', 'dark'),
  img('rgb-spectrum', 'RGB Spectrum', 'cyber', 'dark'),
  img('circuit', 'Circuit', 'cyber', 'dark'),
  img('mountain-dawn', 'Mountain Dawn', 'nature', 'mid'),
  img('forest-mist', 'Forest Mist', 'nature', 'dark'),
  img('ocean-dusk', 'Ocean Dusk', 'nature', 'mid'),
  img('dunes', 'Desert Dunes', 'nature', 'mid'),
  img('aurora-peaks', 'Aurora Peaks', 'nature', 'dark'),
  img('paper', 'Paper', 'minimal', 'light'),
  img('slate', 'Slate', 'minimal', 'mid'),
  img('soft-gradient', 'Soft Gradient', 'minimal', 'light'),
  { id: 'anim-aurora', name: 'Aurora Drift', category: 'animated', tone: 'dark', kind: 'css', animated: true },
  { id: 'anim-spectrum', name: 'Slow Spectrum', category: 'animated', tone: 'dark', kind: 'css', animated: true },
  { id: 'anim-glow', name: 'Breathing Glow', category: 'animated', tone: 'dark', kind: 'css', animated: true },
];

export const wallpaperById = (id) => WALLPAPERS.find((w) => w.id === id) || null;
export const DEFAULT_WALLPAPER = 'aurora-night';
