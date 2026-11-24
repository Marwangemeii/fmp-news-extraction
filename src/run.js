/**
 * CLI entry: `npm start [-- --only <publisher>] [-- --limit <n>]`, optionally with CACHE=1.
 * Picks the entries to run, computes the window, runs the controller, writes the output + stats.
 */
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { publishers } from './publishers.js';
import { registry } from './blocks/index.js';
import { runAll } from './controller.js';
import { getWindow } from './lib/window.js';
import { writeJsonl } from './lib/jsonl.js';

const OUTPUT = 'output/articles.jsonl';
const STATS = 'output/stats.json';

const { values } = parseArgs({
  options: {
    only: { type: 'string' }, // dev: run one publisher by its schema name, e.g. --only "<name>"
    limit: { type: 'string' }, // dev: at most n articles per publisher
  },
});

// --only is matched here, not in the controller, so the controller never compares names (D20).
// This is the one allowed name comparison in src/: it compares against user input from the CLI,
// never against a hardcoded name (test/structure.test.js allows exactly this line).
let selected = publishers;
if (values.only) {
  selected = publishers.filter((p) => p.name.toLowerCase() === values.only.toLowerCase());
  if (selected.length === 0) {
    console.error(`--only "${values.only}" matches no publisher. Known: ${publishers.map((p) => p.name).join(', ')}`);
    process.exit(1);
  }
}

const limit = values.limit ? Number(values.limit) : undefined;
if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) {
  console.error(`--limit must be a positive integer, got "${values.limit}"`);
  process.exit(1);
}

const cache = process.env.CACHE === '1'; // D15: dev cache for article pages
const runAt = new Date();
const window = getWindow(runAt);
console.log(`Window: ${window.start.toISOString()} → ${window.end.toISOString()}${cache ? ' · CACHE=1' : ''}`);

const { records, stats } = await runAll(selected, { registry, window, limit, cache });
await writeJsonl(OUTPUT, records);
console.log(`Wrote ${records.length} articles to ${OUTPUT}`);

// runAt is the window's end; the validator reads it from here (D26).
const runStats = {
  runAt: runAt.toISOString(),
  window: { start: window.start.toISOString(), end: window.end.toISOString() },
  limit: limit ?? null,
  durationMs: Date.now() - runAt.getTime(),
  publishers: stats,
};
await writeFile(STATS, JSON.stringify(runStats, null, 2) + '\n', 'utf8');
console.log(`Wrote ${STATS} (${(runStats.durationMs / 1000).toFixed(0)} s)`);
