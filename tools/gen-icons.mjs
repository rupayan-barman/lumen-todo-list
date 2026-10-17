// Renders PNG app icons from icons/icon.svg (needs `sharp` only to regenerate).
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let sharp; for (const p of ['sharp', '/opt/npm-tools/node_modules/sharp']) { try { sharp = require(p); break; } catch { /* next */ } }
if (!sharp) { console.error('Run: npm i --no-save sharp'); process.exit(1); }
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const svg = readFileSync(join(dir, 'icon.svg'));
for (const s of [192, 512]) { writeFileSync(join(dir, `icon-${s}.png`), await sharp(svg).resize(s, s).png().toBuffer()); console.log('icon', s); }
