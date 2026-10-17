# Lumen — offline-first planner (tasks, focus timers, calendar, notes, habits, projects, study)

Plain HTML/CSS/JavaScript (ES modules). **No build step, no npm dependencies, no CDN, no remote fonts, no accounts, no network calls for your data.**
Everything is stored in your browser's IndexedDB on your own computer.

> **Privacy honesty:** data is **not encrypted**. Anyone who can use your browser profile, or open an exported backup file, can read it.

## Run it on Windows 11 (PowerShell)

1. Install Node.js 18 or newer (LTS) from https://nodejs.org (one time).
2. Open PowerShell in the project folder:
   ```powershell
   cd C:\path\to\lumen
   node server.js
   ```
   (or `npm start`). Then open **http://localhost:5173** in Edge or Chrome.
3. Different port: `$env:PORT=5200; node server.js`. If the port is busy the server tells you.
4. Stop with `Ctrl+C`.

**Important:** your data belongs to the exact address you use. `http://localhost:5173` and `http://127.0.0.1:5173` are *different* storage areas. Always open the same address (and keep the same port).

## Use it offline
Open the app once while the server runs. The service worker then caches the whole app (all code, icons and the 21 bundled wallpapers). Afterwards the page loads with no server and no internet (open the same address; if the server is not running the browser serves the cached copy). Settings → About & privacy shows the offline status. Uploaded wallpapers live in IndexedDB and are always available offline. Changes you make are saved locally immediately.
To install as an app: in Edge/Chrome use the address-bar install icon (works on `localhost`).

## Backup and restore
Settings → **Backup & data**.
* **Download backup** → one JSON file (tasks, notes, habits, projects, subjects, timer history, themes, presets, uploaded images up to 40 MB total, optional).
* **Restore**: choose the file → a review screen shows exactly what is new / already present / different / unreadable and possible duplicates **before** anything changes. Modes: merge (keep mine), merge (backup wins), replace all (extra confirmation). Existing data is never silently overwritten. An automatic safety copy (last 3, no images) is stored inside the app before every import and can be re-imported from the same page.
* Files are validated: size limit, JSON structure, format/version marker, schema validation and repair of every record, prototype-pollution keys stripped, embedded images checked by their real bytes. A newer-format file is refused with a message.
* **Delete data**: per-section deletion and "Delete all my data" (type DELETE).
Back up regularly: clearing browser data, private windows, or disk-pressure eviction can remove IndexedDB.

## Import a setup from JSON (written by ChatGPT, Claude, ...)
Settings > **Import configuration**. Lumen has no AI inside and makes no network request: you ask an external AI for JSON, paste it, then **Validate**, **Preview** and **Import**.
Importing only adds items (tasks, calendar items, projects, categories, tags, notes, habits, study subjects). Existing data is never overwritten or deleted, an automatic safety copy is saved first, everything is written in one atomic step, and **Undo** is offered afterwards. Format, duplicate rules, the AI prompt and an example: `docs/JSON-IMPORT-GUIDE.md`, `docs/example-config.json`. After editing `public/js/data/config-guide.js`, run `node tools/gen-config-docs.mjs`.

## Features
Tasks (CRUD, duplicate, priorities, categories, tags, dates, estimates, subtasks, recurrence, search/sort/group/filter, bulk actions, archive, overdue badges with text, history, undo, drag + keyboard reorder, quick-add syntax `!high #tag @Category tomorrow ~30m`) ·
**Task-locked focus timer** (completion is refused while a locked session runs; only an emergency interrupt ends it early and is recorded; timer end does not auto-complete the task; timestamps are persisted; planned vs elapsed vs credited time are kept separate; unobserved gaps are not credited; no claim a timer proves studying) ·
Countdown / stopwatch / Pomodoro (custom intervals, auto-next, sounds, history, daily totals) ·
Calendar day/week/month with drag-to-reschedule, overlap warnings, deadlines, recurring occurrences, exams, revisions, habits ·
Markdown notes (safe renderer, autosave, pinned, tags/categories, task/subject links) ·
Habits (daily/specific days/N per week, streaks, 26-week heatmap, notes, history never erased) ·
Projects (kanban, custom columns, "done" columns, milestones, archive) ·
Study planner (subjects, chapters, topics, spaced revisions, exam countdown, planned vs timer-recorded time) ·
Dashboard (9 widgets, show/hide/reorder/resize, General/Study/Coding/Custom presets) · Analytics · Global search (`/`) · Command palette (`Ctrl+K`) · Notification centre · keyboard shortcuts (`?`).
**Appearance Studio**: Light/Dark/System, 8 preset themes, random theme, custom themes (create/rename/duplicate/delete), colour overrides, glass controls, fonts, density, motion, live preview with Apply/Cancel/Reset, automatic contrast guarding.
**Wallpaper Studio**: 21 bundled wallpapers + 3 animated CSS backgrounds, categories, favourites, recents, PNG/JPEG/WebP upload (validated by file bytes, downscaled to 2560 px, stored in IndexedDB), brightness/blur/opacity/zoom/fit/position/overlay/vignette/RGB glow, per-area backgrounds (sidebar, task cards, focus, calendar, notes, projects), Random Wallpaper / Random Theme / Randomize Appearance (all undoable), named visual presets, Focus-mode appearance that restores afterwards.

## Notifications
Reminders and desktop notifications work **only while Lumen is open in a browser tab**. Nothing can notify you after the tab/browser is closed (there is no server or push service). Permission is requested only when you press the button in Settings → Notifications & sound.

## Tests (actually executed)
```powershell
npm test                 # 140 unit tests (Node's built-in runner)
npm i -D playwright      # once, for browser tests (plus: npx playwright install chromium)
npm run test:e2e         # 70 real-browser tests; results written to tests/e2e/results.json
```
Last run in this environment (Linux, headless Chromium via Playwright 1.56): **140/140 unit passed, 70/70 browser tests passed.**

Covered by browser tests: boot and all 15 routes without console errors · quick-add parsing and persistence across reload · form validation · complete/undo · search/filter · task lock (refusal, lock chip, interrupt recorded) · locked sessions cannot be paused · countdown/stopwatch persistence and credited time · palette, global search, shortcuts (and not firing while typing) · habits/streaks/archive keeps history · notes autosave + XSS-inert Markdown · kanban incl. real drag-and-drop and done columns · study revisions/countdown · calendar overlap detection, reschedule, drag to another day, week/day/month · recurring tasks · dashboard presets/edit/persist · mode switching (incl. OS dark), all 8 themes, Appearance Studio apply/cancel/reset/discard-on-leave, custom themes, random-theme contrast ≥ 4.5:1, text contrast ≥ 4.5:1 for every theme in light and dark, sidebar state, reduced motion · wallpaper gallery/favourites/recents, upload validation (accepts PNG; rejects text, SVG, empty), image stored in IndexedDB not localStorage, deletion fallbacks, per-area backgrounds, undoable randomisers, Focus-mode appearance · backup round trip with image, rejection of bad/unknown/newer files, merge-keep, duplicates, safety copy, prototype-pollution stripping, replace + restore from safety copy, delete-all · corrupt-record quarantine · two-tab sync · one-session-across-tabs lock · timer survives reload · **service worker + offline load with the network disabled (including bundled wallpapers)** · 390 px layout without horizontal scroll · keyboard focus trap/skip link/visible focus · accessible names on all controls · notification permission never auto-requested · CSP and security headers.

### NOT tested / known limitations (please read)
* Only Chromium (headless, Linux) was driven. **Not tested:** real Windows 11, Edge, Firefox, Safari, mobile browsers/touch drag-and-drop (kanban/calendar drag uses mouse DnD; use the "Move to…" menus on touch).
* **Not tested:** actual sound output, actual OS desktop notifications appearing (logic and permission flow are tested, delivery is not), screen readers (only automated name/landmark checks were run), print layout, PWA install prompt, very long timers (hours) in a throttled background tab (logic is unit-tested with simulated clocks), IndexedDB quota-exceeded in a real full disk, upgrading from a real older database file (migrations are unit-tested only), imports in the tens of MB.
* Imported records that reference a missing category/tag/project are kept but the reference simply shows as empty.
* The timer measures that the timer ran and Lumen was open; it cannot prove studying or working.
* No encryption, no sync between devices (use backup files), no recurring-event exceptions/edit-single-occurrence.
* Two different origins (localhost vs 127.0.0.1, or different ports) do not share data.

## Project layout
`server.js` (zero-dependency static server with CSP, path-traversal protection) · `public/` (the app) · `public/js/core` (pure logic: schema, validation, timer engine, recurrence, theme/contrast, backup planning) · `public/js/services` (business rules and storage) · `public/js/ui` + `views` (interface) · `public/sw.js` + generated `precache-manifest.js` · `tools/` (optional generators for wallpapers/icons; need `npm i --no-save sharp`) · `tests/unit`, `tests/e2e`.
