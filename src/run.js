/**
 * CLI entry: `npm start [-- --only <publisher>] [-- --limit <n>]`, optionally with CACHE=1.
 * Picks the entries to run, computes the window, runs the controller, writes the output + stats.
 */
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { publishers } from './publishers.js';
import { registry, closeBlocks } from './blocks/index.js';
import { runAll, newLlmStats } from './controller.js';
import { assertApiKey } from './llm/client.js';
import { getWindow } from './lib/window.js';
import { writeJsonl } from './lib/jsonl.js';
import { applyHttpProxy } from './lib/proxy.js';

const OUTPUT = 'output/articles.jsonl';
const TRACES = 'output/traces.jsonl';
const STATS = 'output/stats.json';

const { values } = parseArgs({
  options: {
    only: { type: 'string' }, // dev: run one publisher by its schema name, e.g. --only "<name>"
    limit: { type: 'string' }, // dev: the newest n articles per publisher
    sample: { type: 'string' }, // dev: n articles per publisher, spread from the newest to the oldest day
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

/** A positive integer CLI option, or undefined if not given. */
function count(flag) {
  if (values[flag] === undefined) return undefined;
  const n = Number(values[flag]);
  if (!(Number.isInteger(n) && n > 0)) {
    console.error(`--${flag} must be a positive integer, got "${values[flag]}"`);
    process.exit(1);
  }
  return n;
}
const limit = count('limit');
const sample = count('sample');
if (limit && sample) {
  console.error('use --limit (newest n) or --sample (n spread over the window), not both');
  process.exit(1);
}

// Dev switch: LABEL=placeholder runs every entry with that labeller (no LLM calls, no API key needed).
// It applies to all entries alike, so no publisher is special-cased.
const labelOverride = process.env.LABEL || null;
if (labelOverride) selected = selected.map((p) => ({ ...p, label: labelOverride }));

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
// D63: PROXY_URL routes both fetchers through a proxy (FMP's proxy network). Unset = direct.
const proxy = applyHttpProxy();
if (proxy === 'unsupported') {
  console.warn('PROXY_URL: this Node has no http.setGlobalProxyFromEnv (Node 24+), so only the browser fetcher uses it.' +
    ' For HTTP on older Node, start with NODE_USE_ENV_PROXY=1 and HTTPS_PROXY set in the shell.');
}
const runAt = new Date();
const window = getWindow(runAt);
console.log(
  `Window: ${window.start.toISOString()} → ${window.end.toISOString()}${cache ? ' · CACHE=1' : ''}` +
    `${labelOverride ? ` · LABEL=${labelOverride}` : ''}${proxy !== 'off' ? ` · PROXY ${proxy}` : ''}${sample ? ` · --sample ${sample}` : ''}${limit ? ` · --limit ${limit}` : ''}`,
);

let result;
try {
  result = await runAll(selected, { registry, window, limit, sample, cache });
} finally {
  await closeBlocks(); // the browser would otherwise keep the process alive
}
const { records, traces, stats } = result;
await writeJsonl(OUTPUT, records);
await writeJsonl(TRACES, traces);
console.log(`Wrote ${records.length} articles to ${OUTPUT} and ${traces.length} traces to ${TRACES}`);

// LLM totals across publishers (D34): tokens billed this run, estimated cost, errors, K4 drop rate.
const llm = newLlmStats();
for (const s of Object.values(stats)) {
  if (!s.llm) continue;
  for (const k of ['prefilterPassed', 'prefilterSkipped', 'noticeRule', 'calls', 'cacheHits', 'inputTokens', 'outputTokens', 'costUsd', 'labelsProposed', 'labelsDropped', 'labelsNotInOpening']) llm[k] += s.llm[k];
  for (const [k, n] of Object.entries(s.llm.llmErrors)) llm.llmErrors[k] = (llm.llmErrors[k] ?? 0) + n;
  for (const [model, m] of Object.entries(s.llm.byModel)) {
    const t = (llm.byModel[model] ??= { calls: 0, cacheHits: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 });
    for (const k of Object.keys(t)) t[k] += m[k];
  }
}
llm.estimatedCostUsd = Number(llm.costUsd.toFixed(4));
delete llm.costUsd;
llm.labelDropRate = llm.labelsProposed ? Number((llm.labelsDropped / llm.labelsProposed).toFixed(3)) : 0;
console.log(`LLM: ${llm.noticeRule} law-firm notices skipped · ${llm.calls} calls (${llm.cacheHits} cached) · ${llm.inputTokens} in / ${llm.outputTokens} out · ~$${llm.estimatedCostUsd}` +
  ` · labels dropped: K4 ${llm.labelsDropped}, K11 ${llm.labelsNotInOpening}, of ${llm.labelsProposed} · errors ${JSON.stringify(llm.llmErrors)}`);

// runAt is the window's end; the validator reads it from here (D26).
const runStats = {
  runAt: runAt.toISOString(),
  window: { start: window.start.toISOString(), end: window.end.toISOString() },
  limit: limit ?? null,
  sample: sample ?? null,
  label: labelOverride, // null = each entry's own labeller
  proxy, // 'off' | 'on' | 'unsupported' (browser only), D63
  durationMs: Date.now() - runAt.getTime(),
  llm,
  publishers: stats,
};
await writeFile(STATS, JSON.stringify(runStats, null, 2) + '\n', 'utf8');
console.log(`Wrote ${STATS} (${(runStats.durationMs / 1000).toFixed(0)} s)`);
