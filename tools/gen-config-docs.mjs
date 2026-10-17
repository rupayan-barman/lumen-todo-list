// Regenerates docs/JSON-IMPORT-GUIDE.md and docs/example-config.json from public/js/data/config-guide.js.
// Run: node tools/gen-config-docs.mjs   (a unit test fails if the docs are out of date)
import { writeFileSync, mkdirSync } from 'node:fs';
import { SCHEMA_GUIDE, EXAMPLE_CONFIG, AI_PROMPT_HEADER } from '../public/js/data/config-guide.js';

export const docText = () => `# Lumen JSON import guide

Lumen can create tasks, projects, notes, habits and more from a JSON configuration that you generate **outside** Lumen
(for example with ChatGPT or Claude) and paste into **Settings > Import configuration**.
Lumen contains no AI, needs no API key and makes no network request when importing.

## How to use it (Windows 11, Chrome or Edge)

1. Start Lumen (\`node server.js\`) and open http://localhost:5173.
2. Open **Settings > Import configuration**.
3. Click **Copy AI prompt**, paste it into ChatGPT or Claude, replace the bracketed line with what you want, send.
4. Copy the JSON the AI returns, paste it into the big box in Lumen.
5. Click **Validate** to see errors, then **Preview** to see what would be created. Nothing is saved yet.
6. Click **Import**. An automatic safety copy is saved first and everything is added in one step.
   Use **Undo** in the message that appears if you change your mind, or restore the safety copy under Settings > Backup & data.

If the AI returns something Lumen rejects, copy the error list from Lumen back into the chat and ask the AI to fix the JSON.

## Prompt to give an AI

\`\`\`text
${AI_PROMPT_HEADER.trimEnd()}
\`\`\`

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

${SCHEMA_GUIDE}
## Example

\`\`\`json
${JSON.stringify(EXAMPLE_CONFIG, null, 2)}
\`\`\`
`;

if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(new URL('../docs/', import.meta.url), { recursive: true });
  writeFileSync(new URL('../docs/JSON-IMPORT-GUIDE.md', import.meta.url), docText());
  writeFileSync(new URL('../docs/example-config.json', import.meta.url), JSON.stringify(EXAMPLE_CONFIG, null, 2) + '\n');
  console.log('Wrote docs/JSON-IMPORT-GUIDE.md and docs/example-config.json');
}
