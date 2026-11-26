/**
 * `npm run eval [-- --verbose] [-- --only <fixture-prefix>]`
 * Runs the real labeller (real LLM, with the disk cache always on) on the fixtures in test/fixtures/articles
 * and scores it against test/fixtures/gold.json (D42):
 *   - labels: per label TP / FP / FN, precision, recall, and exact label-set accuracy;
 *   - fields: correct / wrong / missed. "wrong" = a non-null value that isn't the gold one (the bad kind:
 *     something got through the checks); "missed" = null where the gold has a value;
 *   - article fields (M2): symbol, relatedSymbols (as a set), type;
 *   - earnings figures (M2): each KEY figure in the gold → found / mislabelled (right value, wrong
 *     period/basis/kind/perShare) / missed;
 *   - labels dropped by K4 (evidence) and K11 (not in the opening).
 * Compare models with e.g. `LLM_EXTRACT_MODEL=claude-sonnet-5-5 npm run eval`. Writes output/eval-<classify>__<extract>.json.
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { publishers } from '../src/publishers.js';
import { labelLlm } from '../src/blocks/label-llm.js';
import { assertApiKey } from '../src/llm/client.js';
import { MODELS, PROMPT_VERSION } from '../src/llm/config.js';

const DIR = 'test/fixtures/articles';
const { values } = parseArgs({ options: { verbose: { type: 'boolean' }, only: { type: 'string' } } });

const LABELS = ['earnings', 'dividends', 'splits', 'ipos', 'others'];
/** The fields scored per category (only those present in a gold event). */
const FIELDS = {
  earnings: ['calendarYear', 'period', 'fiscalDateEnding', 'date', 'time', 'timeExact', 'epsActual', 'epsEstimated', 'revenueActual', 'revenueEstimated'],
  dividends: ['dividend', 'declarationDate', 'date', 'recordDate', 'paymentDate'],
  splits: ['date', 'numerator', 'denominator', 'splitType'],
  ipos: ['company', 'exchange', 'date', 'actions', 'shares', 'priceRange', 'pricePerShare', 'marketCap'],
};

/** Output field → the trace entry it came from, where the names differ. */
const TRACE_FIELD = {
  'earnings.calendarYear': 'earnings.fiscalYear',
  'dividends.date': 'dividends.exDividendDate',
  'splits.date': 'splits.effectiveDate',
  'splits.numerator': 'splits.ratio',
  'splits.denominator': 'splits.ratio',
  'splits.splitType': 'splits.ratio',
  'ipos.date': 'ipos.firstTradingDate',
  'earnings.timeExact': 'earnings.time',
};

const gold = JSON.parse(await readFile('test/fixtures/gold.json', 'utf8'));
const files = (await readdir(DIR)).filter((f) => f.endsWith('.json') && (!values.only || f.startsWith(values.only))).sort();

try {
  assertApiKey();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const same = (a, b) =>
  typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)) : a === b;
/** Gold value can be { accept: [a, b] } for an ambiguous article. */
const matches = (pred, g) => (g && typeof g === 'object' && 'accept' in g ? g.accept.some((x) => same(pred, x)) : same(pred, g));
const goldHasValue = (g) => (g && typeof g === 'object' && 'accept' in g ? g.accept.some((x) => x !== null) : g !== null);

const labelScore = Object.fromEntries(LABELS.map((l) => [l, { tp: 0, fp: 0, fn: 0 }]));
const fieldScore = {}; // "earnings.epsActual" → { correct, wrong, missed }
const articleScore = Object.fromEntries(['symbol', 'relatedSymbols', 'type'].map((k) => [k, { correct: 0, wrong: 0, missed: 0 }]));
const figureScore = { found: 0, mislabelled: 0, missed: 0, output: 0 };
let notInOpening = 0;
const rows = [];
let exact = 0;
let proposed = 0;
let dropped = 0;
const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0, calls: 0, cacheHits: 0 };
const spend = { usd: 0 };

for (const file of files) {
  const id = file.replace(/\.json$/, '');
  const g = gold.articles[id];
  if (!g) {
    console.log(`(no gold for ${id}, skipped)`);
    continue;
  }
  const article = JSON.parse(await readFile(join(DIR, file), 'utf8'));
  const entry = publishers.find((p) => p.name === article.publisher);
  const r = await labelLlm(article, entry, { cache: true, spend });

  // labels
  const pred = new Set(r.labels);
  const want = new Set(g.labels);
  for (const l of LABELS) {
    if (pred.has(l) && want.has(l)) labelScore[l].tp++;
    else if (pred.has(l)) labelScore[l].fp++;
    else if (want.has(l)) labelScore[l].fn++;
  }
  const labelsOk = pred.size === want.size && [...pred].every((l) => want.has(l));
  if (labelsOk) exact++;

  // fields: only for gold events whose category was predicted; a missing event counts every field as missed
  const fieldNotes = [];
  for (const ge of g.events) {
    const pe = r.events.find((e) => e.category === ge.category);
    for (const f of FIELDS[ge.category]) {
      if (!(f in ge)) continue;
      const key = `${ge.category}.${f}`;
      const s = (fieldScore[key] ??= { correct: 0, wrong: 0, missed: 0 });
      const p = pe ? pe[f] : null;
      let verdict;
      if (matches(p, ge[f])) verdict = 'correct';
      else if (p === null || p === undefined) verdict = goldHasValue(ge[f]) ? 'missed' : 'correct';
      else verdict = 'wrong';
      s[verdict]++;
      if (verdict !== 'correct') fieldNotes.push({ key, verdict, pred: p ?? null, gold: ge[f] });
    }
    if (ge.figures) scoreFigures(ge.figures, pe?.figures ?? [], fieldNotes);
  }

  // article fields: symbol and type exact, relatedSymbols as a set
  for (const k of ['symbol', 'relatedSymbols', 'type']) {
    if (!(k in g)) continue;
    const p = r[k] ?? null;
    let verdict;
    if (k === 'relatedSymbols') {
      const a = new Set(p ?? []);
      verdict = a.size === g[k].length && g[k].every((x) => a.has(x)) ? 'correct' : a.size === 0 ? 'missed' : 'wrong';
    } else verdict = matches(p, g[k]) ? 'correct' : p === null ? 'missed' : 'wrong';
    articleScore[k][verdict]++;
    if (verdict !== 'correct') fieldNotes.push({ key: k, verdict, pred: p, gold: g[k] });
  }

  for (const c of r.trace.calls) {
    usage.inputTokens += c.inputTokens;
    usage.outputTokens += c.outputTokens;
    usage.costUsd += c.costUsd;
    if (c.fromCache) usage.cacheHits++;
    else usage.calls++;
  }
  const checks = r.trace.classify?.labelChecks ?? [];
  proposed += checks.length;
  dropped += checks.filter((x) => x.evidenceInFullText === false).length;
  notInOpening += checks.filter((x) => x.inOpening === false).length;
  rows.push({ id, gold: g.labels, pred: r.labels, labelsOk, fieldNotes, llmError: r.trace.llmError, trace: r.trace });
}

// ---- report
/**
 * Gold key figures vs. output figures. A gold attribute can be an array of accepted values.
 * found = same metric + value and every listed attribute accepted; mislabelled = same metric + value only.
 */
function scoreFigures(goldFigs, predFigs, notes) {
  figureScore.output += predFigs.length;
  const ok = (want, got) => (Array.isArray(want) ? want.includes(got) : want === got);
  for (const gf of goldFigs) {
    const sameValue = predFigs.filter((f) => f.metric === gf.metric && same(f.value, gf.value));
    const full = sameValue.find((f) => ['period', 'basis', 'kind', 'perShare'].every((k) => !(k in gf) || ok(gf[k], f[k])));
    const verdict = full ? 'found' : sameValue.length ? 'mislabelled' : 'missed';
    figureScore[verdict]++;
    if (verdict !== 'found') {
      const got = sameValue.map((f) => `${f.period}/${f.basis}/${f.kind}/${f.perShare}`).join(' | ');
      notes.push({ key: 'earnings.figures', verdict, pred: got || null, gold: `${gf.metric} ${gf.value} ${JSON.stringify(gf.period)}/${JSON.stringify(gf.basis)}/${gf.kind}` });
    }
  }
}

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(0)}%` : '-');
console.log(`Eval: ${rows.length} fixtures · classify ${MODELS.classify} · extract ${MODELS.extract} · prompt ${PROMPT_VERSION}\n`);
for (const row of rows) {
  const mark = row.labelsOk && row.fieldNotes.length === 0 ? '✔' : row.labelsOk ? '~' : '✖';
  console.log(`${mark} ${row.id.padEnd(42)} gold [${row.gold}]  got [${row.pred}]${row.fieldNotes.length ? `  ${row.fieldNotes.length} field issue(s)` : ''}${row.llmError ? `  LLM ${row.llmError.kind}: ${row.llmError.message.slice(0, 80)}` : ''}`);
  if (values.verbose) {
    for (const n of row.fieldNotes) {
      const field = TRACE_FIELD[n.key] ?? n.key;
      // "time" not stated in the text → show why the press-release rule did or didn't apply
      const tv = row.trace.values?.filter((v) => v.field === field || v.field === `${field} (publish time)`).at(-1);
      const why = tv ? `  ← raw ${JSON.stringify(tv.raw ?? null)} ${tv.reason ?? tv.rule ?? ''}` : '';
      console.log(`      ${n.verdict.padEnd(7)} ${n.key}: got ${JSON.stringify(n.pred)}, gold ${JSON.stringify(n.gold)}${why}`);
    }
  }
}

console.log('\nLabels               TP  FP  FN  precision  recall');
for (const l of LABELS) {
  const s = labelScore[l];
  console.log(`  ${l.padEnd(18)} ${String(s.tp).padStart(3)} ${String(s.fp).padStart(3)} ${String(s.fn).padStart(3)}  ${pct(s.tp, s.tp + s.fp).padStart(9)}  ${pct(s.tp, s.tp + s.fn).padStart(6)}`);
}
console.log(`  exact label set: ${exact}/${rows.length} (${pct(exact, rows.length)})`);
console.log(`  labels dropped: evidence not in fullText (K4) ${dropped}/${proposed}, not in the opening (K11) ${notInOpening}/${proposed}`);

console.log('\nArticle fields          correct  wrong  missed');
for (const [k, s] of Object.entries(articleScore)) {
  console.log(`  ${k.padEnd(22)} ${String(s.correct).padStart(7)} ${String(s.wrong).padStart(6)} ${String(s.missed).padStart(7)}`);
}

console.log('\nFields                          correct  wrong  missed');
const totals = { correct: 0, wrong: 0, missed: 0 };
for (const [key, s] of Object.entries(fieldScore).sort()) {
  for (const k of Object.keys(totals)) totals[k] += s[k];
  console.log(`  ${key.padEnd(30)} ${String(s.correct).padStart(7)} ${String(s.wrong).padStart(6)} ${String(s.missed).padStart(7)}`);
}
const n = totals.correct + totals.wrong + totals.missed;
console.log(`  ${'TOTAL'.padEnd(30)} ${String(totals.correct).padStart(7)} ${String(totals.wrong).padStart(6)} ${String(totals.missed).padStart(7)}   accuracy ${pct(totals.correct, n)}, wrong ${pct(totals.wrong, n)}`);
const fig = figureScore;
console.log(`\nEarnings key figures: ${fig.found} found, ${fig.mislabelled} mislabelled, ${fig.missed} missed (of ${fig.found + fig.mislabelled + fig.missed}) · ${fig.output} figures output in total`);
console.log(`\nLLM: ${usage.calls} calls (${usage.cacheHits} cached) · ${usage.inputTokens} in / ${usage.outputTokens} out · $${usage.costUsd.toFixed(4)} billed this run`);

await mkdir('output', { recursive: true });
const out = `output/eval-${MODELS.classify}__${MODELS.extract}.json`;
await writeFile(out, JSON.stringify({ models: MODELS, promptVersion: PROMPT_VERSION, labelScore, exact, fixtures: rows.length, dropped, notInOpening, proposed, fieldScore, totals, articleScore, figureScore, usage,
  rows: rows.map(({ trace, ...rest }) => rest) }, null, 2) + '\n');
console.log(`Wrote ${out}`);
