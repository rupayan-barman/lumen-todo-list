// Tiny Playwright harness: starts the real server on its own port, gives every test a clean browser profile.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const load = () => { for (const base of [process.env.PLAYWRIGHT_MODULES, new URL('../../', import.meta.url).pathname + '/', '/opt/npm-tools/node_modules/'].filter(Boolean)) { try { return createRequire(base.endsWith('/') ? base : base + '/')('playwright'); } catch { /* try next */ } } throw new Error('Playwright not found. Run: npm i -D playwright && npx playwright install chromium'); };
const { chromium } = load();
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SHOTS = process.env.SHOTS || '/tmp/lumen-shots';
export const PORT = process.env.E2E_PORT || '5199';
export const URL_ = `http://127.0.0.1:${PORT}`;
const results = []; const tests = [];
export const test = (name, fn, opts = {}) => tests.push({ name, fn, opts });
export const skip = (name, why) => tests.push({ name, skip: why });

let server, browser;
export async function start() {
  server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('server did not start')), 8000); server.stdout.on('data', (d) => { if (/listening|http:/i.test(String(d))) { clearTimeout(t); res(); } }); server.on('exit', () => rej(new Error('server exited'))); });
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] }).catch(() => chromium.launch({ args: ['--no-sandbox'] }));
}
export async function stop() { await browser?.close(); server?.kill(); }

export async function newPage({ viewport = { width: 1280, height: 800 }, sw = false, reducedMotion, colorScheme, acceptDownloads = true, context: reuse } = {}) {
  const ctx = reuse || await browser.newContext({ viewport, serviceWorkers: sw ? 'allow' : 'block', reducedMotion, colorScheme, acceptDownloads });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource.*(404|503)/.test(m.text())) errors.push(`console: ${m.text()}`); });
  page.errors = errors; page.ctx = ctx;
  return page;
}
export async function open(page, hash = 'dashboard') { await page.goto(`${URL_}/#/${hash}`); await page.waitForFunction(() => window.__lumen?.ready === true, null, { timeout: 10000 }); await page.waitForSelector('#main:not(:has(.loading))', { timeout: 8000 }); }
export async function shot(page, name) { try { const { mkdirSync } = await import('node:fs'); mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/${name}.png` }); } catch { /* best effort */ } }

export async function run() {
  await start();
  const only = process.env.ONLY ? new RegExp(process.env.ONLY, 'i') : null;
  for (const t of tests) {
    if (only && !only.test(t.name)) continue;
    if (t.skip) { results.push({ name: t.name, status: 'skipped', detail: t.skip }); continue; }
    const started = Date.now(); let page;
    try {
      const ctx = { newPage: async (o) => { page = await newPage(o); return page; } };
      await Promise.race([t.fn(ctx), new Promise((_, rej) => setTimeout(() => rej(new Error('timed out after 60s')), 60000))]);
      if (page?.errors?.length && !t.opts.allowErrors) throw new Error(`console/page errors: ${page.errors.slice(0, 3).join(' | ')}`);
      results.push({ name: t.name, status: 'passed', ms: Date.now() - started });
    } catch (e) {
      results.push({ name: t.name, status: 'failed', detail: String(e.message || e).split('\n').slice(0, 4).join(' ⏎ '), ms: Date.now() - started });
      if (page) await shot(page, `FAIL-${t.name.replace(/\W+/g, '_').slice(0, 50)}`);
    } finally { try { await page?.ctx.close(); } catch { /* closed */ } }
    const r = results[results.length - 1]; console.log(`${r.status === 'passed' ? '✓' : r.status === 'failed' ? '✗' : '-'} ${r.name}${r.detail ? `\n    ${r.detail}` : ''}`);
  }
  await stop();
  const sum = ['passed', 'failed', 'skipped'].map((s) => `${results.filter((r) => r.status === s).length} ${s}`).join(', ');
  console.log(`\n${sum}`);
  writeFileSync(path.join(ROOT, 'tests/e2e/results.json'), JSON.stringify({ at: new Date().toISOString(), summary: sum, results }, null, 2));
  process.exit(results.some((r) => r.status === 'failed') ? 1 : 0);
}
