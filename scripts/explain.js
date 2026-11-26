/**
 * `npm run explain -- <url> [--json]`
 * Prints the trace of one article (D9): how every label and value was proposed, checked and converted.
 * Reads output/traces.jsonl from the last run. The url can be the exact one or any unique part of it.
 */
import { parseArgs } from 'node:util';
import { readJsonl } from '../src/lib/jsonl.js';

const TRACES = 'output/traces.jsonl';
const { values, positionals } = parseArgs({ allowPositionals: true, options: { json: { type: 'boolean' } } });
const query = positionals[0];
if (!query) {
  console.error('Usage: npm run explain -- <url or part of it> [--json]');
  process.exit(1);
}

let rows;
try {
  rows = (await readJsonl(TRACES)).map((x) => x.record).filter(Boolean);
} catch (err) {
  console.error(`Can't read ${TRACES} (${err.code ?? err.message}). Run \`npm start\` first.`);
  process.exit(1);
}
const exact = rows.filter((t) => t.url === query);
const matches = exact.length ? exact : rows.filter((t) => t.url?.includes(query));
if (matches.length !== 1) {
  console.error(matches.length ? `${matches.length} traces match "${query}":\n${matches.slice(0, 10).map((t) => `  ${t.url}`).join('\n')}` : `No trace for "${query}" in ${TRACES}.`);
  process.exit(1);
}
const t = matches[0];
if (values.json) {
  console.log(JSON.stringify(t, null, 2));
  process.exit(0);
}

const short = (s, n = 90) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s ?? '');
const show = (x) => (x === null || x === undefined ? 'null' : typeof x === 'object' ? JSON.stringify(x) : String(x));
const pad = (s, n) => String(s).padEnd(n);

console.log(`${t.title ?? ''}`);
console.log(`${t.url}  (${t.publisher ?? '?'}, ${t.publishedDate ?? '?'}, prompt ${t.promptVersion ?? '?'})\n`);

if (t.prefilter) {
  const hits = Object.entries(t.prefilter.matched).filter(([, w]) => w.length).map(([l, w]) => `${l}: ${w.join(', ')}`);
  console.log(`pre-filter  ${t.prefilter.pass ? 'PASS' : 'no match'}  ${hits.join(' · ')}`);
}

const stage = (name, s) => {
  if (!s) return;
  const u = s.fromCache ? `from cache${s.cachedUsage ? ` (was ${s.cachedUsage.inputTokens} in / ${s.cachedUsage.outputTokens} out)` : ''}` : `${s.usage.inputTokens} in / ${s.usage.outputTokens} out`;
  console.log(`${pad(name, 11)} ${s.model} · ${u} · stop ${s.stopReason ?? '-'}`);
};

stage('classify', t.classify);
if (t.classifyInput?.truncated) console.log(`            body cut for classify: ${t.classifyInput.sentChars} of ${t.classifyInput.bodyChars} chars`);
for (const c of t.classify?.labelChecks ?? []) {
  const k11 = c.inOpening === undefined ? '' : c.inOpening ? ' [K11 in opening]' : '';
  console.log(`  ${c.kept ? '✔' : '✖'} ${pad(c.label, 10)} "${short(c.evidence)}"${k11}${c.kept ? '' : `  → dropped: ${c.reason}`}`);
}
// Symbols: each ticker the classifier proposed (K7), then what the "(Exchange: TICKER)" regex found.
for (const r of t.symbol?.related ?? []) {
  const ex = r.exchange ? ` (${r.exchange})` : '';
  console.log(`  ${r.symbol ? '✔' : '✖'} ${pad(`${r.role} ${r.ticker}${ex}`, 26)} → ${pad(show(r.symbol ?? null), 14)} ${r.symbol ? r.rule : r.reason}`);
}
if (t.symbol?.regex?.length) console.log(`  regex "(Exchange: TICKER)": ${t.symbol.regex.join(', ')}`);

stage('extract', t.extract);
for (const v of t.values ?? []) {
  const ok = v.value !== null && v.value !== undefined;
  const mark = ok ? '✔' : v.raw === null || v.raw === undefined ? '·' : '✖';
  const raw = v.raw === null || v.raw === undefined ? '' : `"${short(String(v.raw), 30)}"`;
  console.log(`  ${mark} ${pad(v.field, 26)} ${pad(raw, 32)} → ${pad(show(v.value), 14)} ${ok ? v.rule ?? '' : v.reason ?? ''}${v.yearInferred ? '  [year inferred]' : ''}`);
}

if (t.llmError) console.log(`\nLLM ERROR (${t.llmError.kind} in ${t.llmError.stage}): ${t.llmError.message}`);
console.log(`\nresult      ${show(t.result?.labels)}${t.result?.why ? `  (${t.result.why})` : ''}`);
console.log(`symbol      ${show(t.symbol?.value)}  ${t.symbol?.rule ?? t.symbol?.reason ?? ''}`);
console.log(`type        ${show(t.type?.value)}  ${t.type?.rule ?? ''}`);
if (t.usage) console.log(`usage       ${t.usage.inputTokens} in / ${t.usage.outputTokens} out · $${t.usage.costUsd.toFixed(5)} billed this run`);
