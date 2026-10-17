// Text the person gives to an external AI (ChatGPT, Claude, ...) so it can write a Lumen configuration.
// This file is the single source for the in-app "Copy AI prompt" button AND docs/JSON-IMPORT-GUIDE.md
// (regenerate the docs with: node tools/gen-config-docs.mjs).
// Dates in the example are written as fixed placeholders; the AI is told to replace them.

export const EXAMPLE_CONFIG = {
  format: 'lumen-config',
  version: 1,
  description: 'Example: a small exam-prep and fitness setup',
  categories: [
    { ref: 'cat-study', name: 'Study', color: '#7c9cff' },
    { name: 'Health', color: '#34d399' },
  ],
  tags: [{ name: 'exam' }, { name: 'quick-win', color: '#f59e0b' }],
  projects: [{
    ref: 'proj-thesis',
    name: 'Thesis',
    description: 'Final-year thesis project',
    deadline: '2027-03-31',
    color: '#c084fc',
    columns: ['Backlog', 'Writing', { name: 'Submitted', done: true }],
    milestones: [{ title: 'First draft', date: '2027-01-15' }, { title: 'Final submission', date: '2027-03-31' }],
  }],
  subjects: [{
    ref: 'subj-bio',
    name: 'Biology',
    color: '#34d399',
    examDate: '2027-02-10',
    examTime: '09:30',
    chapters: [
      { title: 'Cell structure', plannedMin: 120, topics: ['Organelles', { title: 'Membrane transport', done: false }] },
      { title: 'Genetics', plannedMin: 180, topics: ['Mendel', 'DNA replication'] },
    ],
  }],
  tasks: [
    {
      ref: 't-outline',
      title: 'Write thesis outline',
      description: 'Headings and a one-line summary per chapter.',
      priority: 'high',
      category: 'Study',
      tags: ['quick-win'],
      project: 'proj-thesis',
      column: 'Writing',
      startDate: '2026-11-01',
      deadline: '2026-11-10',
      deadlineTime: '17:00',
      estimateMin: 90,
      subtasks: ['Collect sources', { title: 'Draft headings', done: false }],
      focus: { enabled: true, durationMin: 45 },
    },
    {
      ref: 't-revise',
      title: 'Revise Cell structure',
      priority: 'medium',
      category: 'Study',
      tags: ['exam'],
      subject: 'subj-bio',
      chapter: 'Cell structure',
      scheduledDate: '2026-11-12',
      scheduledTime: '18:00',
      estimateMin: 60,
    },
    {
      title: 'Weekly review',
      priority: 'low',
      scheduledDate: '2026-11-15',
      scheduledTime: '10:00',
      estimateMin: 30,
      recurrence: { freq: 'weekly', interval: 1, byWeekday: [0], count: 12 },
    },
  ],
  notes: [{
    title: 'Thesis reading list',
    body: '# Reading list\n\n- Paper A\n- Paper B\n',
    pinned: true,
    category: 'Study',
    task: 't-outline',
    project: 'proj-thesis',
  }],
  habits: [
    { name: 'Morning walk', description: '20 minutes outside', color: '#34d399', schedule: { type: 'daily' }, startDate: '2026-11-01', reminderTime: '07:00' },
    { name: 'Gym', color: '#fb7185', schedule: { type: 'days', days: [1, 3, 5] }, startDate: '2026-11-01' },
    { name: 'Read', schedule: { type: 'weekly', perWeek: 4 } },
  ],
};

export const SCHEMA_GUIDE = `# Lumen configuration format (lumen-config, version 1)

You write ONE JSON object that the Lumen planner app can import. Output ONLY the JSON, with no explanation before or after it and no comments. Use straight double quotes. Do not use trailing commas.

## Rules
- Top level: "format": "lumen-config" (exactly) and "version": 1 (a number) are required.
- Optional top-level lists: categories, tags, projects, subjects, tasks, notes, habits. Include only what is needed. At least one item overall.
- Never invent ids. Lumen creates them. To link items inside the file use "ref": a short unique label you choose (letters, digits, - or _). Refs are unique within their own list.
- Dates are "YYYY-MM-DD" and must be real dates (no 2027-02-30). Times are 24-hour "HH:mm" (09:30, 18:00). A time needs its date.
- Weekday numbers: 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday.
- Colours are hex like "#7c9cff". Optional everywhere.
- Fields not listed below are ignored with a warning. Do not add fields.
- Lumen has no separate "events" or "lists". A calendar event is a task with scheduledDate (and optionally scheduledTime and estimateMin). A to-do list is a category, a tag, or a project.

## categories[] and tags[]
{ "ref"?, "name" (required, max 60), "color"? }
A category or tag that already exists in Lumen (same name, ignoring case) is reused, never changed.

## projects[]
{ "ref"?, "name" (required, max 120), "description"?, "notes"?, "deadline"? (date), "color"?,
  "columns"? : list of "Column name" or { "name", "done"? } (max 12, names unique; default To do / In progress / Done),
  "milestones"? : list of { "title" (required), "date"? (date), "done"? } }
A project with the same name that already exists is reused and NOT modified.

## subjects[] (study planner)
{ "ref"?, "name" (required), "color"?, "examDate"? (date), "examTime"? (time),
  "chapters"? : list of { "title" (required), "plannedMin"? (whole minutes), "topics"? : list of "Topic title" or { "title", "done"? } } }
A subject with the same name that already exists is reused and NOT modified.

## tasks[] (also used for calendar events)
{ "ref"?, "title" (required, max 300), "description"?,
  "priority"? : "low" | "medium" | "high" | "critical" (default medium),
  "status"? : "todo" | "done" (default todo),
  "category"? : a category name or ref, "tags"? : list of tag names or refs
    (names that do not exist yet are created automatically),
  "project"? : a project ref or the exact name of an existing project,
  "column"? : a column name of that project (needs "project"; default is the first column),
  "subject"? : a subject ref or name, "chapter"? : a chapter title of that subject (needs "subject"),
  "startDate"?, "deadline"?, "scheduledDate"? : dates, "deadlineTime"?, "scheduledTime"? : times,
  "estimateMin"? : whole minutes,
  "subtasks"? : list of "Step title" or { "title", "done"? },
  "recurrence"? : { "freq": "daily"|"weekly"|"monthly"|"yearly" (required), "interval"? (1-365), "byWeekday"? (list of 0-6, weekly only), "endDate"? (date), "count"? (1-1000) }
    - a recurring task needs at least one of startDate, deadline or scheduledDate,
  "focus"? : { "enabled": true|false, "durationMin"? : 1-720 } }
Rules: deadline must not be before startDate. A deadlineTime needs a deadline; a scheduledTime needs a scheduledDate.

## notes[]
{ "ref"?, "title"?, "body"? (Markdown text; use \\n for new lines), "pinned"? (true|false),
  "category"?, "tags"?, "task"? : the ref of a task in this same file, "project"?, "subject"? }
A note needs a title or a body.

## habits[]
{ "name" (required, max 100), "description"?, "color"?, "startDate"? (date, default today), "reminderTime"? (time), "notes"?,
  "schedule"? : { "type": "daily" } | { "type": "days", "days": [1,3,5] } | { "type": "weekly", "perWeek": 3 } }
Default schedule is daily. "days" needs at least one weekday number.

## Safety behaviour you should know about
Importing only ADDS items. Existing items are never changed or deleted. Items that look like duplicates of existing ones (same title and dates, same habit name, same note text) are skipped by default.
`;

export const AI_PROMPT_HEADER = `I use a planner app called Lumen. Create a configuration for me in the exact JSON format described below. Reply with ONLY the JSON (a single code block is fine), so I can paste it into Lumen's Settings > Import configuration.

What I want set up:
[DESCRIBE YOUR PLAN HERE: for example your projects, deadlines, study subjects, weekly routines and habits. Today's date is YYYY-MM-DD, so use real dates from today onward.]

`;

export const buildAiPrompt = () => `${AI_PROMPT_HEADER}${SCHEMA_GUIDE}\n## Example\n\n${JSON.stringify(EXAMPLE_CONFIG, null, 2)}\n`;
