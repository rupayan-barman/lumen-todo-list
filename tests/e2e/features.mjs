import { test, skip, open, shot, URL_ } from './harness.mjs';
import assert from 'node:assert/strict';
const reload = async (p) => { await p.reload(); await p.waitForFunction(() => window.__lumen?.ready === true); await p.waitForSelector('#main:not(:has(.loading))'); };
const st = (p, fn, arg) => p.evaluate(async ([src, a]) => { const { app } = await import('/js/services/ctx.js'); return (0, eval)(`(${src})`)(app, a); }, [fn.toString(), arg]).catch(() => null);

/* ============ habits ============ */
test('Habit: create, check in today, streak updates, persists', async (t) => {
  const p = await t.newPage(); await open(p, 'habits'); await p.click('button:has-text("Create your first habit")');
  await p.fill('dialog input[placeholder^="e.g."]', 'Read 20 pages'); await p.click('dialog button:has-text("Create habit")');
  await p.waitForSelector('.habit-card'); await p.click('.habit-card button:has-text("Mark done today")');
  await p.waitForFunction(() => /Done today/.test(document.querySelector('.habit-card')?.innerText || ''));
  assert.match(await p.locator('.habit-card .stat').first().innerText(), /1/);
  await reload(p); assert.match(await p.locator('.habit-card').innerText(), /Done today/);
});
test('Habit: schedule edit never erases history; archive keeps logs', async (t) => {
  const p = await t.newPage(); await open(p, 'habits');
  const r = await p.evaluate(async () => { const H = await import('/js/services/habits.js'); const { app } = await import('/js/services/ctx.js'); const h = await H.createHabit({ name: 'Run', startDate: '2026-01-01' }); await H.toggleLog(h.id, '2026-01-02'); await H.toggleLog(h.id, '2026-01-03'); await H.updateHabit(h.id, { schedule: { type: 'days', days: [1], perWeek: 3 } }); await H.setArchived(h.id, true); return { logs: H.logsFor(h.id).length, hist: app.store.get('habits', h.id).scheduleHistory.length, archived: app.store.get('habits', h.id).archived }; });
  assert.deepEqual(r, { logs: 2, hist: 2, archived: true });
});

/* ============ notes ============ */
test('Notes: create, type Markdown, autosave persists after reload, preview is safe', async (t) => {
  const p = await t.newPage(); await open(p, 'notes'); await p.click('button:has-text("New note")'); await p.waitForSelector('.note-editor textarea');
  await p.fill('.note-title', 'Plan'); await p.fill('.note-editor textarea', '# Heading\n\n**bold** <script>window.__x=1</script> <img src=x onerror="window.__y=1">\n\n- [ ] item');
  await p.waitForTimeout(1200);
  assert.ok(await p.locator('.note-preview h2').count() >= 1);
  assert.equal(await p.locator('.note-preview script, .note-preview img').count(), 0);
  assert.equal(await p.evaluate(() => window.__x || window.__y || 0), 0);
  await reload(p); await p.waitForSelector('.note-item'); assert.match(await p.locator('.note-item').first().innerText(), /Plan/);
  await p.locator('.note-item').first().click(); await p.waitForSelector('.note-editor textarea'); assert.match(await p.inputValue('.note-editor textarea'), /# Heading/);
});
test('Notes: pin, tag and delete with undo', async (t) => {
  const p = await t.newPage(); await open(p, 'notes');
  const r = await p.evaluate(async () => { const N = await import('/js/services/notes.js'); const { undo } = await import('/js/services/undo.js'); const { app } = await import('/js/services/ctx.js'); const a = await N.createNote({ title: 'A' }); const b = await N.createNote({ title: 'B' }); await N.togglePin(b.id); const first = N.sorted()[0].title; await N.deleteNote(a.id); const gone = !app.store.get('notes', a.id); await undo.run(); return { first, gone, back: !!app.store.get('notes', a.id) }; });
  assert.deepEqual(r, { first: 'B', gone: true, back: true });
});

/* ============ projects ============ */
test('Projects: create board, add card, move between columns incl. a done column; milestone toggles', async (t) => {
  const p = await t.newPage(); await open(p, 'projects');
  const r = await p.evaluate(async () => { const P = await import('/js/services/projects.js'); const T = await import('/js/services/tasks.js'); const { app } = await import('/js/services/ctx.js');
    const pr = await P.createProject({ name: 'Website' }); const [todo, , done] = pr.columns; const t1 = await T.createTask({ title: 'Design', projectId: pr.id, columnId: todo.id });
    await P.moveCard(t1.id, done.id); const afterDone = app.store.get('tasks', t1.id).status; await P.moveCard(t1.id, todo.id); const afterBack = app.store.get('tasks', t1.id).status;
    await P.addMilestone(pr.id, { title: 'Launch', date: '2030-01-01' }); const ms = app.store.get('projects', pr.id).milestones[0]; await P.updateMilestone(pr.id, ms.id, { done: true });
    await P.deleteColumn(pr.id, todo.id); const moved = app.store.get('tasks', t1.id).columnId; const stillThere = !!app.store.get('tasks', t1.id);
    return { afterDone, afterBack, ms: app.store.get('projects', pr.id).milestones[0].done, movedToFirst: moved === app.store.get('projects', pr.id).columns[0].id, stillThere }; });
  assert.deepEqual(r, { afterDone: 'done', afterBack: 'todo', ms: true, movedToFirst: true, stillThere: true });
  await open(p, 'projects'); await p.waitForSelector('a:has-text("Website")'); await p.click('a:has-text("Website")'); await p.waitForSelector('.kanban'); assert.ok(await p.locator('.kcol').count() >= 2);
});
test('Projects: kanban drag and drop moves a card (real mouse drag)', async (t) => {
  const p = await t.newPage(); await open(p, 'projects');
  await p.evaluate(async () => { const P = await import('/js/services/projects.js'); const T = await import('/js/services/tasks.js'); const pr = await P.createProject({ name: 'DnD' }); await T.createTask({ title: 'Drag me', projectId: pr.id, columnId: pr.columns[0].id }); location.hash = `#/projects?id=${pr.id}`; });
  await p.waitForSelector('.kcard'); const src = p.locator('.kcard'); const dst = p.locator('.kcol').nth(1);
  await src.dragTo(dst); await p.waitForTimeout(500);
  const col = await p.evaluate(async () => { const { app } = await import('/js/services/ctx.js'); const t = app.store.all('tasks')[0]; const pr = app.store.all('projects')[0]; return pr.columns.findIndex((c) => c.id === t.columnId); });
  assert.equal(col, 1);
});

/* ============ study ============ */
test('Study: chapter completion schedules spaced revisions; exam countdown; planned vs actual', async (t) => {
  const p = await t.newPage(); await open(p, 'study');
  const r = await p.evaluate(async () => { const S = await import('/js/services/study.js'); const { app } = await import('/js/services/ctx.js'); const s = await S.createSubject({ name: 'Chem', examDate: '2099-01-01' }); await S.addChapter(s.id, 'Bonding', 60); const c = app.store.get('subjects', s.id).chapters[0];
    await S.setChapterDone(s.id, c.id, true); const revs = app.store.get('subjects', s.id).chapters[0].revisions.length; await S.setChapterDone(s.id, c.id, false); const after = app.store.get('subjects', s.id).chapters[0].revisions.length;
    return { revs, after, cd: S.examCountdown(app.store.get('subjects', s.id)).days > 1000, pva: S.plannedVsActual(app.store.get('subjects', s.id)).plannedMin }; });
  assert.deepEqual(r, { revs: 5, after: 0, cd: true, pva: 60 });
});
test('Study UI: create subject through the dialog', async (t) => {
  const p = await t.newPage(); await open(p, 'study'); await p.click('button:has-text("New subject")'); await p.fill('dialog input[placeholder^="e.g."]', 'Physics'); await p.click('dialog button:has-text("Create subject")');
  await p.waitForSelector('h1:has-text("Physics")'); await p.fill('input[aria-label="New chapter title"]', 'Optics'); await p.press('input[aria-label="New chapter title"]', 'Enter'); await p.waitForSelector('details:has-text("Optics")');
});

/* ============ calendar ============ */
test('Calendar: scheduled task, deadline, overlap warning and reschedule', async (t) => {
  const p = await t.newPage(); await open(p, 'calendar');
  const today = await p.evaluate(async () => { const T = await import('/js/services/tasks.js'); const { todayStr } = await import('/js/core/util.js'); const d = todayStr(); await T.createTask({ title: 'Meeting A', scheduledDate: d, scheduledTime: '10:00', estimateMin: 60 }); await T.createTask({ title: 'Meeting B', scheduledDate: d, scheduledTime: '10:30', estimateMin: 30 }); await T.createTask({ title: 'Due thing', deadline: d }); return d; });
  await p.waitForSelector('.cal-ev'); assert.ok(await p.locator('.cal-ev.is-conflict').count() >= 2, 'overlap flagged'); assert.match(await p.locator('.banner--warn').first().innerText(), /overlap/);
  assert.ok(await p.locator('.cal-ev.is-deadline').count() >= 1);
  const moved = await p.evaluate(async () => { const T = await import('/js/services/tasks.js'); const { app } = await import('/js/services/ctx.js'); const a = app.store.all('tasks').find((x) => x.title === 'Meeting B'); await T.reschedule(a.id, { scheduledDate: a.scheduledDate, scheduledTime: '14:00' }); return app.store.get('tasks', a.id).scheduledTime; });
  assert.equal(moved, '14:00'); await p.waitForTimeout(300); assert.equal(await p.locator('.cal-ev.is-conflict').count(), 0, 'conflict gone');
  for (const v of ['Week', 'Day', 'Month']) { await p.click(`label:has-text("${v}")`); await p.waitForTimeout(150); assert.ok(await p.locator('.cal-grid, .cal-month').count() > 0); }
});
test('Calendar: drag a task to another day in month view reschedules it', async (t) => {
  const p = await t.newPage(); await open(p, 'calendar');
  const { d, target } = await p.evaluate(async () => { const T = await import('/js/services/tasks.js'); const U = await import('/js/core/util.js'); const d = U.todayStr(); await T.createTask({ title: 'Move me', scheduledDate: d }); return { d, target: U.addDays(d, 1) }; });
  await p.waitForSelector(`.cal-ev[data-kind="task"]`); await p.locator('.cal-ev[data-kind="task"]').first().dragTo(p.locator(`.cal-cell[data-date="${target}"]`)); await p.waitForTimeout(500);
  const after = await p.evaluate(async () => { const { app } = await import('/js/services/ctx.js'); return app.store.all('tasks')[0].scheduledDate; }); assert.equal(after, target);
});
test('Recurring task: completing spawns the next occurrence', async (t) => {
  const p = await t.newPage(); await open(p, 'tasks');
  const r = await p.evaluate(async () => { const T = await import('/js/services/tasks.js'); const { app } = await import('/js/services/ctx.js'); const x = await T.createTask({ title: 'Weekly', deadline: '2026-03-02', recurrence: { freq: 'weekly', interval: 1, byWeekday: [], endDate: null, count: null, anchor: '2026-03-02' } }); await T.completeTask(x.id); return app.store.all('tasks').map((y) => `${y.status}:${y.deadline}`).sort(); });
  assert.deepEqual(r, ['done:2026-03-02', 'todo:2026-03-09']);
});

/* ============ dashboard ============ */
test('Dashboard: switching presets changes widgets; edit mode hides a widget and persists', async (t) => {
  const p = await t.newPage(); await open(p, 'dashboard'); const n0 = await p.locator('.widget').count();
  await p.click('label:has-text("Study")'); await p.waitForTimeout(300);
  await p.click('button:has-text("Edit layout")'); await p.waitForSelector('.dash-edit'); await p.locator('.widget[data-widget="summary"] input[type="checkbox"]').uncheck(); await p.click('button:has-text("Done editing")'); await p.waitForTimeout(200);
  assert.equal(await p.locator('.widget[data-widget="summary"]').count(), 0);
  await reload(p); assert.equal(await p.locator('.widget[data-widget="summary"]').count(), 0, 'hidden widget stays hidden');
  await p.click('button:has-text("Reset this layout")'); await p.waitForTimeout(300); assert.equal(await p.locator('.widget[data-widget="summary"]').count(), 1);
});
