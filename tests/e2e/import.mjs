import { test, open, shot } from './harness.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const EXAMPLE = readFileSync(new URL('../../docs/example-config.json', import.meta.url), 'utf8');
const btn = (p, name) => p.getByRole('button', { name, exact: true });
const counts = (p) => p.evaluate(async () => { const { app } = await import('/js/services/ctx.js'); const c = {}; for (const s of ['tasks', 'projects', 'categories', 'tags', 'notes', 'habits', 'subjects', 'backups', 'taskHistory']) c[s] = app.store.count(s); return c; });
const paste = async (p, text) => { await p.fill('#cfg-text', text); };

test('Import config: paste example, validate, preview, import; data saved, safety copy made, survives reload', async (t) => {
  const p = await t.newPage(); const external = [];
  p.on('request', (r) => { if (!/^(http:\/\/127\.0\.0\.1|data:|blob:)/.test(r.url())) external.push(r.url()); });
  await open(p, 'dashboard');
  await p.evaluate(async () => { const T = await import('/js/services/tasks.js'); await T.createTask({ title: 'My own task', deadline: '2030-01-01' }); const N = await import('/js/services/notes.js'); await N.createNote({ title: 'My own note', body: 'keep me' }); });
  const before = await counts(p);
  await open(p, 'settings/import');
  assert.equal(await btn(p, 'Import').isDisabled(), true);
  await paste(p, EXAMPLE);
  await btn(p, 'Validate').click(); await p.waitForSelector('text=Valid.');
  assert.equal(await btn(p, 'Import').isDisabled(), true, 'Import must stay disabled until Preview');
  await btn(p, 'Preview').click(); await p.waitForSelector('text=Nothing has been saved yet');
  assert.match(await p.locator('table.md-table').innerText(), /Tasks/);
  assert.deepEqual(await counts(p), before, 'preview must not write anything');
  await shot(p, 'import-preview');
  await btn(p, 'Import').click(); await p.waitForSelector('text=Import finished');
  const after = await counts(p);
  assert.equal(after.tasks, before.tasks + 3); assert.equal(after.projects, before.projects + 1); assert.equal(after.habits, 3); assert.equal(after.subjects, 1);
  assert.equal(after.notes, before.notes + 1); assert.equal(after.backups, before.backups + 1, 'safety copy');
  assert.equal(after.taskHistory, before.taskHistory + 3, 'one history entry per imported task');
  const rel = await p.evaluate(async () => { const { app } = await import('/js/services/ctx.js'); const s = app.store; const t = s.all('tasks').find((x) => x.title === 'Write thesis outline'); const pr = s.get('projects', t.projectId); const n = s.all('notes').find((x) => x.title === 'Thesis reading list'); const rev = s.all('tasks').find((x) => x.title === 'Revise Cell structure'); const subj = s.get('subjects', rev.subjectId);
    return { col: pr.columns.find((c) => c.id === t.columnId)?.name, noteTask: s.get('tasks', n.taskId)?.title, notePinned: n.pinned, cat: s.get('categories', t.categoryId)?.name, tags: t.tagIds.map((i) => s.get('tags', i).name), chap: subj.chapters.find((c) => c.id === rev.chapterId)?.title, focus: t.focus, sub: t.subtasks.length, rec: s.all('tasks').find((x) => x.title === 'Weekly review').recurrence, mine: !!s.all('tasks').find((x) => x.title === 'My own task'), mineNote: s.all('notes').find((x) => x.title === 'My own note')?.body, quarantined: s.count('quarantine') }; });
  assert.deepEqual({ ...rel, rec: undefined }, { col: 'Writing', noteTask: 'Write thesis outline', notePinned: true, cat: 'Study', tags: ['quick-win'], chap: 'Cell structure', focus: { enabled: true, durationMin: 45 }, sub: 2, rec: undefined, mine: true, mineNote: 'keep me', quarantined: 0 });
  assert.equal(rel.rec.freq, 'weekly');
  // the imported items appear in the real views
  await open(p, 'tasks'); await p.waitForSelector('text=Write thesis outline'); assert.ok(await p.locator('text=My own task').count());
  await open(p, 'habits'); await p.waitForSelector('text=Morning walk');
  await open(p, 'calendar'); await p.waitForSelector('.cal, .calendar, [class*="cal"]');
  // reload: persisted
  await p.reload(); await p.waitForFunction(() => window.__lumen?.ready === true);
  assert.equal((await counts(p)).tasks, before.tasks + 3);
  // same config again: recognised, nothing new, import disabled
  await open(p, 'settings/import'); await paste(p, EXAMPLE); await btn(p, 'Preview').click(); await p.waitForSelector('text=already imported');
  assert.equal(await btn(p, 'Import').isDisabled(), true); assert.deepEqual(await counts(p), { ...after });
  assert.deepEqual(external, [], `no external requests, saw: ${external.join(', ')}`);
});

test('Import config: invalid JSON and field errors are readable; skip-invalid imports only the good items', async (t) => {
  const p = await t.newPage(); await open(p, 'settings/import');
  await paste(p, '{ "format": "lumen-config", "version": 1, "tasks": [ { "title": "x", } ] }'); await btn(p, 'Validate').click();
  await p.waitForSelector('text=not valid JSON'); assert.match(await p.locator('[role=alert]').first().innerText(), /line 1/);
  const bad = { format: 'lumen-config', version: 1, tasks: [{ title: 'Good one' }, { title: 'Bad date', deadline: '2026-02-31' }, { title: 'Bad prio', priority: 'urgent' }] };
  await paste(p, JSON.stringify(bad)); await btn(p, 'Preview').click(); await p.waitForSelector('text=Errors');
  const txt = await p.locator('details').filter({ hasText: 'Errors' }).first().innerText();
  assert.match(txt, /Task #2 “Bad date” → deadline/); assert.match(txt, /Task #3 “Bad prio” → priority/);
  assert.equal(await btn(p, 'Import').isDisabled(), true);
  const before = await counts(p); await p.getByText('Skip items with errors and import the rest').click();
  await btn(p, 'Preview').click(); await p.waitForSelector('text=Nothing has been saved yet'); assert.equal(await btn(p, 'Import').isDisabled(), false);
  await btn(p, 'Import').click(); await p.waitForSelector('text=Import finished');
  const body = await p.locator('#main').innerText(); assert.match(body, /1 created/); assert.match(body, /2 failed/); assert.match(body, /Bad date/);
  assert.equal((await counts(p)).tasks, before.tasks + 1);
  const titles = await p.evaluate(async () => (await import('/js/services/ctx.js')).app.store.all('tasks').map((x) => x.title)); assert.deepEqual(titles, ['Good one']);
});

test('Import config: undo removes exactly the imported items; editing the box hides stale preview; duplicates option works', async (t) => {
  const p = await t.newPage(); await open(p, 'settings/import');
  const one = JSON.stringify({ format: 'lumen-config', version: 1, tasks: [{ title: 'Once', deadline: '2030-05-05' }], categories: [{ name: 'Z' }] });
  await paste(p, one); await btn(p, 'Preview').click(); await btn(p, 'Import').click(); await p.waitForSelector('text=Import finished');
  assert.equal((await counts(p)).tasks, 1);
  await p.locator('.toast__action', { hasText: 'Undo' }).click(); await p.waitForFunction(async () => (await import('/js/services/ctx.js')).app.store.count('tasks') === 0);
  const c = await counts(p); assert.equal(c.categories, 0); assert.equal(c.tasks, 0);
  await paste(p, one); await btn(p, 'Preview').click(); await btn(p, 'Import').click(); await p.waitForSelector('text=Import finished');
  await paste(p, one); assert.equal(await btn(p, 'Import').isDisabled(), true, 'editing the text invalidates the preview');
  await btn(p, 'Preview').click(); await p.waitForSelector('text=1 duplicate'); assert.equal(await btn(p, 'Import').isDisabled(), true);
  await p.getByText('Import items even if they look like duplicates of existing ones').click(); await btn(p, 'Preview').click(); await p.waitForSelector('text=Nothing has been saved yet');
  await btn(p, 'Import').click(); await p.waitForSelector('text=Import finished'); assert.equal((await counts(p)).tasks, 2);
});

test('Import config: page fits a 390px phone screen and has no console errors; AI prompt text is complete', async (t) => {
  const p = await t.newPage({ viewport: { width: 390, height: 800 } }); await open(p, 'settings/import');
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'no horizontal overflow');
  await shot(p, 'import-mobile');
  const prompt = await p.evaluate(async () => (await import('/js/data/config-guide.js')).buildAiPrompt());
  for (const w of ['lumen-config', 'recurrence', 'focus', 'habits', 'subjects', 'critical', 'YYYY-MM-DD', '0=Sunday']) assert.ok(prompt.includes(w), w);
});
