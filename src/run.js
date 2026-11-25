/**
 * CLI entry: `npm start [-- --only <publisher>] [-- --limit <n>]`, optionally with CACHE=1.
 * Picks the entries to run, computes the window, runs the controller, writes the output + stats.
 */
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { publishers } from './publishers.js';
import { registry } from './blocks/index.js';
import { runAll, newLlmStats } from './controller.js';
import { assertApiKey } from './llm/client.js';
import { getWindow } from './lib/window.js';
import { writeJsonl } from './lib/jsonl.js';

const OUTPUT = 'output/articles.jsonl';
const TRACES = 'output/traces.jsonl';
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

// Fail fast, before a long crawl, if the LLM labeller will run without a key. The key itself is never printed.
if (selected.some((p) => p.enabled && p.label === 'llm')) {
  try {
    assertApiKey();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

const cache = process.env.CACHE === '1'; // D15: dev cache for article pages
const runAt = new Date();
const window = getWindow(runAt);
console.log(`Window: ${window.start.toISOString()} → ${window.end.toISOString()}${cache ? ' · CACHE=1' : ''}`);

const { records, traces, stats } = await runAll(selected, { registry, window, limit, cache });
await writeJsonl(OUTPUT, records);
await writeJsonl(TRACES, traces);
console.log(`Wrote ${records.length} articles to ${OUTPUT} and ${traces.length} traces to ${TRACES}`);

// LLM totals across publishers (D34): tokens billed this run, estimated cost, errors, K4 drop rate.
const llm = newLlmStats();
for (const s of Object.values(stats)) {
  if (!s.llm) continue;
  for (const k of ['prefilterPassed', 'prefilterSkipped', 'calls', 'cacheHits', 'inputTokens', 'outputTokens', 'costUsd', 'labelsProposed', 'labelsDropped']) llm[k] += s.llm[k];
  for (const [k, n] of Object.entries(s.llm.llmErrors)) llm.llmErrors[k] = (llm.llmErrors[k] ?? 0) + n;
  for (const [model, m] of Object.entries(s.llm.byModel)) {
    const t = (llm.byModel[model] ??= { calls: 0, cacheHits: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 });
    for (const k of Object.keys(t)) t[k] += m[k];
  }
}
llm.estimatedCostUsd = Number(llm.costUsd.toFixed(4));
delete llm.costUsd;
llm.labelDropRate = llm.labelsProposed ? Number((llm.labelsDropped / llm.labelsProposed).toFixed(3)) : 0;
console.log(`LLM: ${llm.calls} calls (${llm.cacheHits} cached) · ${llm.inputTokens} in / ${llm.outputTokens} out · ~$${llm.estimatedCostUsd}` +
  ` · label drop rate ${llm.labelsDropped}/${llm.labelsProposed} · errors ${JSON.stringify(llm.llmErrors)}`);

// runAt is the window's end; the validator reads it from here (D26).
const runStats = {
  runAt: runAt.toISOString(),
  window: { start: window.start.toISOString(), end: window.end.toISOString() },
  limit: limit ?? null,
  durationMs: Date.now() - runAt.getTime(),
  llm,
  publishers: stats,
};
await writeFile(STATS, JSON.stringify(runStats, null, 2) + '\n', 'utf8');
console.log(`Wrote ${STATS} (${(runStats.durationMs / 1000).toFixed(0)} s)`);
