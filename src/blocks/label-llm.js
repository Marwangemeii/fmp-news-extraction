/**
 * The labeller (D8, D34): the LLM proposes, the code proves.
 *
 *   pre-filter → CLASSIFY (labels + the sentence proving each) → K4: sentence in fullText?
 *              → EXTRACT (values as written + their sentences) → K1/K2 checks → convert → event
 *
 * Every step is written to `trace` (D9), one per article, so any output value can be traced
 * back to the sentence it came from and the rule that converted it. A value that fails any
 * check becomes null, with the reason in the trace. An LLM failure is never a silent "others":
 * it is recorded in `trace.llmError` and counted in stats (D38).
 */
import { MODELS, EFFORT, MAX_TOKENS, PROMPT_VERSION, costUsd } from '../llm/config.js';
import { CLASSIFY_SYSTEM, EXTRACT_SYSTEM, topOfBody, classifyMessage, extractMessage } from '../llm/prompts.js';
import { CLASSIFY_SCHEMA, EXTRACT_SCHEMA } from '../llm/schemas.js';
import { callJson } from '../llm/client.js';
import { prefilter } from '../lib/prefilter.js';
import { evidenceInText, rawInEvidence, inArticleOrder } from '../lib/checks.js';
import { parseMoney, parsePerShare, parseShares, parseDate, parseRatio, parsePeriod, parseFiscalYear, asText } from '../lib/convert.js';
import { normalizeExchange } from '../lib/symbols.js';

const LABEL_ORDER = ['earnings', 'dividends', 'splits', 'ipos'];

/**
 * @param {{ url: string, title: string, text: string, fullText: string|null, publishedDate: string }} article
 * @param {{ name: string, defaultType: string }} entry the schema entry
 * @param {{ cache?: boolean, spend?: { usd: number }, call?: typeof callJson }} [ctx]
 *   `call` can be replaced by a fake in tests; `spend` is shared by the whole run (budget cap).
 * @returns {Promise<{ labels: string[], events: object[], symbol: string|null, relatedSymbols: string[], type: string, trace: object }>}
 */
export async function labelLlm(article, entry, ctx = {}) {
  const { cache = false, spend = { usd: 0 }, call = callJson } = ctx;
  const trace = {
    url: article.url,
    publisher: entry.name,
    title: article.title,
    publishedDate: article.publishedDate,
    promptVersion: PROMPT_VERSION,
    prefilter: null,
    classifyInput: null,
    classify: null,
    extract: null,
    values: [],
    symbol: { value: null, rule: 'symbol rule comes in M2' },
    type: { value: entry.defaultType, rule: 'entry.defaultType (type rule comes in M2)' },
    result: null,
    llmError: null,
    calls: [], // one per LLM call: { stage, model, fromCache, inputTokens, outputTokens, costUsd }
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  };
  const base = { symbol: null, relatedSymbols: [], type: entry.defaultType };
  const others = (why) => {
    trace.result = { labels: ['others'], why };
    return { ...base, labels: ['others'], events: [], trace };
  };

  if (!article.fullText) return others('fullText is null: nothing to check evidence against, no LLM call');
  trace.prefilter = prefilter(article);
  if (!trace.prefilter.pass) return others('pre-filter: no earnings/dividend/split/IPO vocabulary, no LLM call');

  // ---- 1. Classify: the top of the body is enough to tell what the article is about.
  const top = topOfBody(article.fullText);
  trace.classifyInput = { bodyChars: top.bodyChars, sentChars: top.sentChars, truncated: top.truncated };
  const c = await call({
    model: MODELS.classify, effort: EFFORT.classify, maxTokens: MAX_TOKENS.classify,
    system: CLASSIFY_SYSTEM, user: classifyMessage(article, top.text), schema: CLASSIFY_SCHEMA,
    url: article.url, cache, spend,
  });
  trace.classify = stageTrace('classify', MODELS.classify, c, trace);
  if (c.error) {
    trace.llmError = { stage: 'classify', ...c.error };
    return others(`LLM ${c.error.kind} in classify: labelled others, see llmError`);
  }

  // ---- 2. K4: a label stays only if the sentence proving it is in the article word for word.
  const kept = [];
  const labelChecks = [];
  for (const { label, evidence } of c.json.labels) {
    if (kept.some((k) => k.label === label)) {
      labelChecks.push({ label, kept: false, reason: 'duplicate label' });
      continue;
    }
    const k1 = evidenceInText(evidence, article.fullText);
    labelChecks.push({ label, evidence, evidenceInFullText: k1.ok, kept: k1.ok, ...(k1.ok ? {} : { reason: k1.reason }) });
    if (k1.ok) kept.push({ label, evidence });
  }
  trace.classify.labelChecks = labelChecks;
  trace.classify.labelsDroppedByEvidence = labelChecks.filter((x) => x.evidenceInFullText === false).length;
  if (kept.length === 0) {
    return others(labelChecks.length ? 'every proposed label failed its evidence check (K4)' : 'the classifier proposed no label');
  }
  kept.sort((a, b) => LABEL_ORDER.indexOf(a.label) - LABEL_ORDER.indexOf(b.label));
  const labels = kept.map((k) => k.label);

  // ---- 3. Extract: the full article, only for the proven labels.
  const x = await call({
    model: MODELS.extract, effort: EFFORT.extract, maxTokens: MAX_TOKENS.extract,
    system: EXTRACT_SYSTEM, user: extractMessage(article, labels), schema: EXTRACT_SCHEMA,
    url: article.url, cache, spend,
  });
  trace.extract = stageTrace('extract', MODELS.extract, x, trace);
  if (x.error) {
    trace.llmError = { stage: 'extract', ...x.error };
    return others(`LLM ${x.error.kind} in extract: proven labels [${labels}] not written, see llmError`);
  }

  // ---- 4. Convert + check every value, one event per label (K6).
  const byLabel = nest(x.json, trace);
  const events = kept.map(({ label, evidence }) => buildEvent(label, byLabel[label], evidence, article, trace, base.symbol));
  trace.result = {
    labels,
    nullValues: trace.values.filter((v) => v.raw !== null && v.value === null).length,
    yearInferred: trace.values.filter((v) => v.yearInferred).map((v) => v.field),
  };
  return { ...base, labels, events, trace };
}

/**
 * The extractor's flat list ({ field: "dividends.recordDate", raw, evidence }, …) → one object per event type.
 * If a field comes twice, the first one is used and the second is traced.
 */
function nest(json, trace) {
  const byLabel = { earnings: {}, dividends: {}, splits: {}, ipos: {} };
  for (const { field, raw, evidence } of json.values ?? []) {
    const [label, name] = field.split('.');
    if (!byLabel[label]) continue;
    if (byLabel[label][name]) {
      trace.values.push({ field, raw, evidence, value: null, reason: 'duplicate field: the first one is used' });
      continue;
    }
    byLabel[label][name] = { raw, evidence };
  }
  byLabel.earnings.figures = json.figures ?? [];
  byLabel.ipos.action = json.ipoAction ?? null;
  return byLabel;
}

/** The part of the trace about one LLM call, plus usage accounting. */
function stageTrace(stage, model, r, trace) {
  const cost = costUsd(model, r.usage);
  trace.calls.push({ stage, model, fromCache: r.fromCache, ...r.usage, costUsd: cost });
  trace.usage.inputTokens += r.usage.inputTokens;
  trace.usage.outputTokens += r.usage.outputTokens;
  trace.usage.costUsd += cost;
  return {
    model,
    fromCache: r.fromCache,
    stopReason: r.stopReason ?? null,
    usage: r.usage,
    ...(r.cachedUsage ? { cachedUsage: r.cachedUsage } : {}),
    contentHash: r.contentHash,
    raw: r.json ?? null,
  };
}

/**
 * K1 + K2 + K3 for one value: its evidence is in fullText, its raw text is in its evidence,
 * and the converter can read it. Writes one trace entry; returns the value or null.
 *
 * @param {string} field e.g. "earnings.date"
 * @param {{ raw: string|null, evidence: string|null }|null} v as the LLM returned it
 * @param {(raw: string) => { value: any, rule?: string, reason?: string }} conv
 * @param {{ article: object, trace: object, evidences: string[] }} c
 * @param {object} [extra] more fields for the trace entry (e.g. a figure's metric/basis/kind)
 */
function prove(field, v, conv, c, extra = {}) {
  const t = { field, raw: known(v?.raw) ?? null, evidence: known(v?.evidence) ?? null, ...extra };
  c.trace.values.push(t);
  if (t.raw === null || !String(t.raw).trim()) {
    t.value = null;
    t.reason = 'not stated';
    return null;
  }
  const k1 = evidenceInText(v.evidence, c.article.fullText);
  const k2 = v.evidence ? rawInEvidence(v.raw, v.evidence) : { ok: false, reason: 'no evidence given' };
  t.checks = { evidenceInFullText: k1.ok, rawInEvidence: k2.ok };
  if (!k1.ok || !k2.ok) {
    t.value = null;
    t.reason = [k1.reason, k2.reason].filter(Boolean).join('; ');
    return null;
  }
  const r = conv(v.raw);
  if (r.value === null) {
    t.value = null;
    t.reason = `conversion failed: ${r.reason}`;
    return null;
  }
  t.rule = r.rule;
  t.value = r.value;
  if (r.yearInferred) t.yearInferred = true;
  c.evidences.push(v.evidence);
  return r.value;
}

/** One event for one proven label. `data` is the extractor's object for that label (or null). */
function buildEvent(label, data, labelEvidence, article, trace, symbol) {
  const c = { article, trace, evidences: [labelEvidence] };
  const date = (raw) => parseDate(raw, { publishedDate: article.publishedDate });
  if (!data) trace.values.push({ field: label, value: null, reason: 'the extractor returned no event for this label: all fields null' });
  const d = data ?? {};
  const f = (name, conv) => prove(`${label}.${name}`, d[name], conv, c);

  let fields;
  if (label === 'earnings') fields = earningsFields(d, c, f, date);
  else if (label === 'dividends') {
    fields = {
      dividend: f('dividend', parsePerShare),
      declarationDate: f('declarationDate', date),
      date: f('exDividendDate', date), // R-E5: `date` is the ex-dividend date
      recordDate: f('recordDate', date),
      paymentDate: f('paymentDate', date),
    };
  } else if (label === 'splits') {
    const ratio = f('ratio', parseRatio);
    fields = {
      date: f('effectiveDate', date),
      numerator: ratio?.numerator ?? null,
      denominator: ratio?.denominator ?? null,
      splitType: ratio?.splitType ?? null,
    };
  } else {
    fields = {
      company: f('company', asText),
      exchange: f('exchange', (raw) => ({ value: normalizeExchange(raw), rule: `normalizeExchange: "${raw}" → ${normalizeExchange(raw)}` })),
      date: f('firstTradingDate', date),
      actions: proveAction(d.action, c),
      shares: f('shares', parseShares),
      priceRange: f('priceRange', asText),
      pricePerShare: f('pricePerShare', parsePerShare),
      marketCap: f('marketCap', parseMoney),
    };
  }
  // D10: every sentence the values come from (all passed K1), in article order.
  const evidence = inArticleOrder(c.evidences, article.fullText).join('\n');
  return { category: label, symbol, evidence, ...fields };
}

function earningsFields(d, c, f, date) {
  const fields = {
    calendarYear: f('fiscalYear', parseFiscalYear),
    period: f('period', parsePeriod),
    fiscalDateEnding: f('fiscalDateEnding', date),
    date: f('date', date),
    time: null,
    timeExact: null,
  };
  // D11 time conversion comes in M2; the raw text is already in the trace.
  c.trace.values.push({ field: 'earnings.time', raw: known(d.time?.raw) ?? null, evidence: known(d.time?.evidence) ?? null, value: null, reason: 'time is converted in M2' });

  // Every EPS/revenue figure is proven on its own; then D12 picks which one fills each field.
  const figures = (d.figures ?? []).map((fig, i) => {
    const conv = fig.metric === 'eps' ? parsePerShare : parseMoney;
    const meta = {
      metric: fig.metric,
      period: fig.period ? parsePeriod(fig.period).value : null, // "fourth quarter" → Q4; "nine months" → null
      basis: known(fig.basis),
      kind: fig.kind,
      perShare: known(fig.perShare),
    };
    const value = prove(`earnings.figures[${i}]`, fig, conv, c, meta);
    return { i, ...meta, raw: fig.raw, value };
  });
  const proven = figures.filter((x) => x.value !== null);
  return {
    ...fields,
    ...pickFigures(proven, fields.period, c.trace),
  };
}

/** The extract schema has no nulls (API limit on nullable fields): "", "unknown" and "none" mean not stated. */
const known = (x) => (x === '' || x === 'unknown' || x === 'none' || x === undefined ? null : x);

const describe = (x) =>
  `figures[${x.i}] ${x.metric}/${x.period ?? 'period not stated'}/${x.kind}/${x.basis ?? 'basis not stated'}${x.perShare ? `/${x.perShare}` : ''} (${x.raw})`;

/**
 * D12, decided by code: which proven figure fills each earnings field.
 * Only figures for the event's period (or with no period stated): a full-year EPS never fills a Q4 event.
 * epsActual: GAAP/IFRS first, then basis not stated; never adjusted. Diluted over not stated over basic.
 * revenueActual: GAAP/IFRS, then not stated, then adjusted. Estimates: the first one stated.
 */
function pickFigures(proven, eventPeriod, trace) {
  const periodOk = (x) => !eventPeriod || !x.period || x.period === eventPeriod;
  const periodRank = (x) => (eventPeriod && x.period === eventPeriod ? 0 : 1); // a stated match beats "not stated"
  const basisRank = (x) => (x.basis === 'GAAP' || x.basis === 'IFRS' ? 0 : x.basis === null ? 1 : 2);
  const shareRank = (x) => (x.perShare === 'diluted' ? 0 : x.perShare === null ? 1 : 2);

  /** The best-ranked proven figure of this metric + kind (that `allowed` accepts), traced with what was skipped. */
  const choose = (field, metric, kind, allowed, rank, why) => {
    const same = proven.filter((x) => x.metric === metric && x.kind === kind);
    // No proven event period, but the figures are for different periods (e.g. Q4 and full year):
    // picking one would be a guess (eval fixture 05), so the field stays null.
    const periods = new Set(same.map((x) => x.period));
    if (!eventPeriod && periods.size > 1) {
      trace.values.push({ field, value: null, reason: `figures for several periods (${[...periods].map((p) => p ?? 'not stated').join(', ')}) and no proven event period to choose by` });
      return null;
    }
    const fit = (x) => periodOk(x) && allowed(x);
    const chosen = same.filter(fit).sort((a, b) => periodRank(a) - periodRank(b) || rank(a) - rank(b) || a.i - b.i)[0] ?? null;
    const skipped = same.filter((x) => x !== chosen);
    trace.values.push({
      field,
      value: chosen?.value ?? null,
      rule: chosen
        ? `D12: ${describe(chosen)} chosen (${why})${skipped.length ? `; skipped ${skipped.map(describe).join(', ')}` : ''}`
        : undefined,
      reason: chosen ? undefined : `no proven figure fits (${why})`,
    });
    return chosen?.value ?? null;
  };

  const any = () => true;
  const first = () => 0; // ties are broken by article order
  return {
    epsActual: choose('earnings.epsActual', 'eps', 'actual', (x) => x.basis !== 'adjusted',
      (x) => basisRank(x) * 3 + shareRank(x), 'GAAP/IFRS over basis not stated, diluted over basic; adjusted never used'),
    epsEstimated: choose('earnings.epsEstimated', 'eps', 'estimate', any, first, 'first estimate stated'),
    revenueActual: choose('earnings.revenueActual', 'revenue', 'actual', any, basisRank, 'GAAP/IFRS over not stated over adjusted'),
    revenueEstimated: choose('earnings.revenueEstimated', 'revenue', 'estimate', any, first, 'first estimate stated'),
  };
}

/** K8: the IPO action enum must be backed by a word in its sentence. */
const ACTION_WORDS = {
  filed: /fil(e|ed|es|ing)\b|registration statement|confidentially submitted|submitted a draft/i,
  expected: /expect|anticipat|plan(s|ned)? to|intend/i,
  priced: /pric(e|ed|ing)\b/i,
  postponed: /postpon|delay/i,
  withdrawn: /withdr[ae]w/i,
};

function proveAction(action, c) {
  const t = { field: 'ipos.actions', raw: known(action?.value) ?? null, evidence: known(action?.evidence) ?? null };
  c.trace.values.push(t);
  if (!known(action?.value)) {
    t.value = null;
    t.reason = 'not stated';
    return null;
  }
  const k1 = evidenceInText(action.evidence, c.article.fullText);
  const k8 = ACTION_WORDS[action.value]?.test(action.evidence ?? '') ?? false;
  t.checks = { evidenceInFullText: k1.ok, actionWordInEvidence: k8 };
  if (!k1.ok || !k8) {
    t.value = null;
    t.reason = [k1.reason, k8 ? null : `no "${action.value}" wording in the evidence`].filter(Boolean).join('; ');
    return null;
  }
  t.value = action.value;
  t.rule = `K8: "${action.value}" wording found in the evidence`;
  c.evidences.push(action.evidence);
  return action.value;
}
