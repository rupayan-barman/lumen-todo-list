# Lumen JSON import guide

Lumen can create tasks, projects, notes, habits and more from a JSON configuration that you generate **outside** Lumen
(for example with ChatGPT or Claude) and paste into **Settings > Import configuration**.
Lumen contains no AI, needs no API key and makes no network request when importing.

## How to use it (Windows 11, Chrome or Edge)

1. Start Lumen (`node server.js`) and open http://localhost:5173.
2. Open **Settings > Import configuration**.
3. Click **Copy AI prompt**, paste it into ChatGPT or Claude, replace the bracketed line with what you want, send.
4. Copy the JSON the AI returns, paste it into the big box in Lumen.
5. Click **Validate** to see errors, then **Preview** to see what would be created. Nothing is saved yet.
6. Click **Import**. An automatic safety copy is saved first and everything is added in one step.
   Use **Undo** in the message that appears if you change your mind, or restore the safety copy under Settings > Backup & data.

If the AI returns something Lumen rejects, copy the error list from Lumen back into the chat and ask the AI to fix the JSON.

## Prompt to give an AI

```text
I use a planner app called Lumen. Create a configuration for me in the exact JSON format described below. Reply with ONLY the JSON (a single code block is fine), so I can paste it into Lumen's Settings > Import configuration.

What I want set up:
[DESCRIBE YOUR PLAN HERE: for example your projects, deadlines, study subjects, weekly routines and habits. Today's date is YYYY-MM-DD, so use real dates from today onward.]
```

(The in-app "Copy AI prompt" button adds the full schema below and the example to this text.)

## Duplicate detection

- Categories, tags, projects, study subjects: matched by name, ignoring capital letters. An existing one is reused and never changed.
- Tasks: skipped when an existing task has the same title, deadline, scheduled date and project.
- Notes: skipped when title and text are identical. Habits: skipped when the name matches.
- The same pasted configuration is recognised (a content fingerprint is kept in Lumen's settings) and flagged on a second import.
- Limits: renamed or edited items count as new; this prevents accidental repeats, not every possible overlap.
- Options let you import "duplicates" anyway, or skip items with errors and import the rest.

## Partial failures

By default one error blocks the whole import and every problem is listed with its item number, title and field.
With "Skip items with errors" the valid items are imported and the report lists what was created, reused, skipped and failed.
Items that depend on a failed item (for example a task whose project has errors) are skipped too.
All chosen items are written in a single transaction: a storage error saves nothing.

## What cannot be imported

Timer history, task history, themes, wallpapers and notification settings are not part of this format.
Existing items are never overwritten, updated or deleted by an import.

# Lumen configuration format (lumen-config, version 1)

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
{ "ref"?, "title"?, "body"? (Markdown text; use \n for new lines), "pinned"? (true|false),
  "category"?, "tags"?, "task"? : the ref of a task in this same file, "project"?, "subject"? }
A note needs a title or a body.

## habits[]
{ "name" (required, max 100), "description"?, "color"?, "startDate"? (date, default today), "reminderTime"? (time), "notes"?,
  "schedule"? : { "type": "daily" } | { "type": "days", "days": [1,3,5] } | { "type": "weekly", "perWeek": 3 } }
Default schedule is daily. "days" needs at least one weekday number.

## Safety behaviour you should know about
Importing only ADDS items. Existing items are never changed or deleted. Items that look like duplicates of existing ones (same title and dates, same habit name, same note text) are skipped by default.

## Example

```json
{
  "format": "lumen-config",
  "version": 1,
  "description": "Example: a small exam-prep and fitness setup",
  "categories": [
    {
      "ref": "cat-study",
      "name": "Study",
      "color": "#7c9cff"
    },
    {
      "name": "Health",
      "color": "#34d399"
    }
  ],
  "tags": [
    {
      "name": "exam"
    },
    {
      "name": "quick-win",
      "color": "#f59e0b"
    }
  ],
  "projects": [
    {
      "ref": "proj-thesis",
      "name": "Thesis",
      "description": "Final-year thesis project",
      "deadline": "2027-03-31",
      "color": "#c084fc",
      "columns": [
        "Backlog",
        "Writing",
        {
          "name": "Submitted",
          "done": true
        }
      ],
      "milestones": [
        {
          "title": "First draft",
          "date": "2027-01-15"
        },
        {
          "title": "Final submission",
          "date": "2027-03-31"
        }
      ]
    }
  ],
  "subjects": [
    {
      "ref": "subj-bio",
      "name": "Biology",
      "color": "#34d399",
      "examDate": "2027-02-10",
      "examTime": "09:30",
      "chapters": [
        {
          "title": "Cell structure",
          "plannedMin": 120,
          "topics": [
            "Organelles",
            {
              "title": "Membrane transport",
              "done": false
            }
          ]
        },
        {
          "title": "Genetics",
          "plannedMin": 180,
          "topics": [
            "Mendel",
            "DNA replication"
          ]
        }
      ]
    }
  ],
  "tasks": [
    {
      "ref": "t-outline",
      "title": "Write thesis outline",
      "description": "Headings and a one-line summary per chapter.",
      "priority": "high",
      "category": "Study",
      "tags": [
        "quick-win"
      ],
      "project": "proj-thesis",
      "column": "Writing",
      "startDate": "2026-11-01",
      "deadline": "2026-11-10",
      "deadlineTime": "17:00",
      "estimateMin": 90,
      "subtasks": [
        "Collect sources",
        {
          "title": "Draft headings",
          "done": false
        }
      ],
      "focus": {
        "enabled": true,
        "durationMin": 45
      }
    },
    {
      "ref": "t-revise",
      "title": "Revise Cell structure",
      "priority": "medium",
      "category": "Study",
      "tags": [
        "exam"
      ],
      "subject": "subj-bio",
      "chapter": "Cell structure",
      "scheduledDate": "2026-11-12",
      "scheduledTime": "18:00",
      "estimateMin": 60
    },
    {
      "title": "Weekly review",
      "priority": "low",
      "scheduledDate": "2026-11-15",
      "scheduledTime": "10:00",
      "estimateMin": 30,
      "recurrence": {
        "freq": "weekly",
        "interval": 1,
        "byWeekday": [
          0
        ],
        "count": 12
      }
    }
  ],
  "notes": [
    {
      "title": "Thesis reading list",
      "body": "# Reading list\n\n- Paper A\n- Paper B\n",
      "pinned": true,
      "category": "Study",
      "task": "t-outline",
      "project": "proj-thesis"
    }
  ],
  "habits": [
    {
      "name": "Morning walk",
      "description": "20 minutes outside",
      "color": "#34d399",
      "schedule": {
        "type": "daily"
      },
      "startDate": "2026-11-01",
      "reminderTime": "07:00"
    },
    {
      "name": "Gym",
      "color": "#fb7185",
      "schedule": {
        "type": "days",
        "days": [
          1,
          3,
          5
        ]
      },
      "startDate": "2026-11-01"
    },
    {
      "name": "Read",
      "schedule": {
        "type": "weekly",
        "perWeek": 4
      }
    }
  ]
}
```
