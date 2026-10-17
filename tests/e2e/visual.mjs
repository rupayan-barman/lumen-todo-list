import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const require = createRequire('/opt/npm-tools/node_modules/'); const { chromium } = require('playwright');
const OUT = process.env.SHOTS || '/tmp/lumen-shots'; import { mkdirSync } from 'node:fs'; mkdirSync(OUT, { recursive: true });
const srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: '5198' }, stdio: 'ignore' }); await new Promise((r) => setTimeout(r, 1200));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
async function shoot(name, viewport, mode, hash, theme = 'midnight') {
  const ctx = await b.newContext({ viewport, serviceWorkers: 'block' }); const p = await ctx.newPage();
  await p.goto(`http://127.0.0.1:5198/#/${hash}`); await p.waitForFunction(() => window.__lumen?.ready); await p.waitForTimeout(500);
  await p.evaluate(async ([mode, theme]) => { const { setPrefs } = await import('/js/services/prefs.js'); const T = await import('/js/services/tasks.js'); const N = await import('/js/services/notes.js'); const H = await import('/js/services/habits.js'); const P = await import('/js/services/projects.js'); const U = await import('/js/core/util.js'); const { app } = await import('/js/services/ctx.js');
    if (!app.store.count('tasks')) { const d = U.todayStr(); await T.createTask({ title: 'Finish quarterly report', priority: 'high', deadline: U.addDays(d, 2), estimateMin: 90 }); await T.createTask({ title: 'Team standup', scheduledDate: d, scheduledTime: '10:00', estimateMin: 30 }); await T.createTask({ title: 'Review pull requests', scheduledDate: d, scheduledTime: '10:15', priority: 'critical', estimateMin: 45 }); await T.createTask({ title: 'Overdue invoice', deadline: U.addDays(d, -3), priority: 'medium' }); await T.createTask({ title: 'Deep work block', focus: { enabled: true, durationMin: 50 }, subtasks: [{ id: 's1', title: 'Outline', done: true }, { id: 's2', title: 'Draft', done: false }] }); await N.createNote({ title: 'Meeting notes', body: '# Agenda\n- [x] intro\n- [ ] roadmap', pinned: true }); const h = await H.createHabit({ name: 'Read 20 pages', startDate: U.addDays(d, -20) }); for (let i = 0; i < 6; i++) await H.toggleLog(h.id, U.addDays(d, -i)); const pr = await P.createProject({ name: 'Website relaunch' }); await T.createTask({ title: 'Wireframes', projectId: pr.id, columnId: pr.columns[0].id }); await T.createTask({ title: 'Build header', projectId: pr.id, columnId: pr.columns[1].id }); }
    setPrefs({ mode, themeId: theme }, { persist: false }); }, [mode, theme]);
  await p.waitForTimeout(700); await p.screenshot({ path: `${OUT}/${name}.png` }); await ctx.close();
}
const D = { width: 1280, height: 800 }, M = { width: 390, height: 800 };
await shoot('dash-dark', D, 'dark', 'dashboard'); await shoot('dash-light', D, 'light', 'dashboard', 'ocean'); await shoot('tasks-dark', D, 'dark', 'tasks', 'cyberpunk'); await shoot('cal-dark', D, 'dark', 'calendar', 'emerald'); await shoot('proj-light', D, 'light', 'projects', 'lavender'); await shoot('mobile-dash', M, 'dark', 'dashboard'); await shoot('mobile-tasks', M, 'light', 'tasks', 'rose'); await shoot('appearance-dark', D, 'dark', 'settings/appearance');
await b.close(); srv.kill();
