/**
 * The labeller with a fake LLM (no network, no key): the code-side proof decides what survives.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { labelLlm } from '../src/blocks/label-llm.js';
import { CLASSIFY_SYSTEM } from '../src/llm/prompts.js';

const entry = { name: 'Fake Wire', defaultType: 'pressReleases' };

const article = {
  url: 'https://wire.test/acme-q3',
  title: 'Acme Reports Third Quarter 2026 Results',
  text: 'Acme reports results.',
  publishedDate: '2026-11-05T21:05:00.000Z',
  fullText: [
    'NEW YORK, Nov. 5, 2026 -- Acme Corp. (NASDAQ: ACME) today reported financial results for its third quarter ended September 30, 2026.',
    'Revenue was $412.5 million, up 12%.',
    'GAAP net income per diluted share was $0.42, compared with $0.30 in the third quarter of 2025.',
    'Adjusted EPS was $0.57.',
    'Analysts expected EPS of $0.50.',
  ].join('\n\n'),
};

const v = (raw, evidence) => ({ raw, evidence });

/** Nested test data { earnings: { period: v(…), figures }, ipos: { action } } → the extractor's flat wire format. */
function flat(nested) {
  const values = [];
  for (const [label, obj] of Object.entries(nested)) {
    for (const [name, val] of Object.entries(obj ?? {})) {
      if (name === 'figures' || name === 'action') continue;
      if (val?.raw) values.push({ field: `${label}.${name}`, raw: val.raw, evidence: val.evidence });
    }
  }
  return {
    values,
    figures: nested.earnings?.figures ?? [],
    ipoAction: nested.ipos?.action ? { value: nested.ipos.action.value ?? 'none', evidence: nested.ipos.action.evidence ?? '' } : { value: 'none', evidence: '' },
  };
}

/** A fake `callJson`: answers classify and extract from canned JSON, and records the calls. */
function fakeLlm({ classify, extract: nestedExtract, classifyError }) {
  const extract = nestedExtract ? flat(nestedExtract) : undefined;
  const calls = [];
  const call = async (req) => {
    const stage = req.system === CLASSIFY_SYSTEM ? 'classify' : 'extract';
    calls.push({ stage, user: req.user });
    const usage = { inputTokens: 100, outputTokens: 10 };
    if (stage === 'classify' && classifyError) return { usage, fromCache: false, contentHash: 'h', error: classifyError };
    return { json: stage === 'classify' ? classify : extract, usage, stopReason: 'end_turn', fromCache: false, contentHash: 'h' };
  };
  return { call, calls };
}

const EARNINGS_EXTRACT = {
  earnings: {
    period: v('third quarter', 'NEW YORK, Nov. 5, 2026 -- Acme Corp. (NASDAQ: ACME) today reported financial results for its third quarter ended September 30, 2026.'),
    fiscalYear: v('2026', 'NEW YORK, Nov. 5, 2026 -- Acme Corp. (NASDAQ: ACME) today reported financial results for its third quarter ended September 30, 2026.'),
    fiscalDateEnding: v('September 30, 2026', 'NEW YORK, Nov. 5, 2026 -- Acme Corp. (NASDAQ: ACME) today reported financial results for its third quarter ended September 30, 2026.'),
    date: v('Nov. 5, 2026', 'NEW YORK, Nov. 5, 2026 -- Acme Corp. (NASDAQ: ACME) today reported financial results for its third quarter ended September 30, 2026.'),
    time: v(null, null),
    figures: [
      { metric: 'revenue', raw: '$412.5 million', evidence: 'Revenue was $412.5 million, up 12%.', basis: null, kind: 'actual', perShare: null },
      { metric: 'eps', raw: '$0.57', evidence: 'Adjusted EPS was $0.57.', basis: 'adjusted', kind: 'actual', perShare: null },
      { metric: 'eps', raw: '$0.42', evidence: 'GAAP net income per diluted share was $0.42, compared with $0.30 in the third quarter of 2025.', basis: 'GAAP', kind: 'actual', perShare: 'diluted' },
      { metric: 'eps', raw: '$0.30', evidence: 'GAAP net income per diluted share was $0.42, compared with $0.30 in the third quarter of 2025.', basis: 'GAAP', kind: 'previous', perShare: 'diluted' },
      // Hallucinated: this sentence is not in the article, so the estimate must come out null.
      { metric: 'eps', raw: '$0.50', evidence: 'Wall Street analysts had expected EPS of $0.50.', basis: null, kind: 'estimate', perShare: null },
    ],
  },
  dividends: null,
  splits: null,
  ipos: null,
};

test('no vocabulary → others, no LLM call', async () => {
  const { call, calls } = fakeLlm({});
  const r = await labelLlm({ ...article, title: 'A blue phone', text: 'It is blue.', fullText: 'The phone is blue.' }, entry, { call });
  assert.deepEqual(r.labels, ['others']);
  assert.deepEqual(r.events, []);
  assert.equal(calls.length, 0);
  assert.equal(r.trace.prefilter.pass, false);
});

test('fullText null → others, no LLM call', async () => {
  const { call, calls } = fakeLlm({});
  const r = await labelLlm({ ...article, fullText: null }, entry, { call });
  assert.deepEqual(r.labels, ['others']);
  assert.equal(calls.length, 0);
});

test('earnings: values proven and converted; D12 picks GAAP diluted; a hallucinated sentence → null', async () => {
  const { call, calls } = fakeLlm({
    classify: {
      labels: [
        { label: 'earnings', evidence: 'NEW YORK, Nov. 5, 2026 -- Acme Corp. (NASDAQ: ACME) today reported financial results for its third quarter ended September 30, 2026.' },
        { label: 'dividends', evidence: 'The board declared a quarterly dividend of $0.10 per share.' }, // not in the article
      ],
      symbol: { ticker: 'ACME', exchange: 'NASDAQ', evidence: '…' },
      relatedSymbols: [],
    },
    extract: EARNINGS_EXTRACT,
  });
  const r = await labelLlm(article, entry, { call });

  assert.deepEqual(r.labels, ['earnings']); // dividends dropped by K4
  assert.match(calls[1].user, /Extract these event types: earnings$/);
  assert.equal(r.trace.classify.labelsDroppedByEvidence, 1);

  assert.equal(r.events.length, 1);
  const e = r.events[0];
  assert.equal(e.category, 'earnings');
  assert.equal(e.period, 'Q3');
  assert.equal(e.calendarYear, 2026);
  assert.equal(e.fiscalDateEnding, '2026-09-30');
  assert.equal(e.date, '2026-11-05');
  assert.equal(e.epsActual, 0.42); // GAAP diluted, not adjusted $0.57
  assert.equal(e.revenueActual, 412500000);
  assert.equal(e.epsEstimated, null); // its sentence was invented
  assert.equal(e.revenueEstimated, null);

  // Every evidence line is in the article, in article order.
  for (const line of e.evidence.split('\n')) assert.ok(article.fullText.includes(line), line);
  assert.ok(!e.evidence.includes('Wall Street'));

  const est = r.trace.values.find((x) => x.field === 'earnings.figures[4]');
  assert.equal(est.value, null);
  assert.match(est.reason, /not found in fullText/);
  assert.match(r.trace.values.find((x) => x.field === 'earnings.epsActual').rule, /GAAP.*skipped.*adjusted/);
  assert.equal(r.trace.usage.inputTokens, 200);
});

test('every proposed label fails its evidence check → others', async () => {
  const { call } = fakeLlm({
    classify: { labels: [{ label: 'earnings', evidence: 'Acme had a great quarter.' }], symbol: null, relatedSymbols: [] },
  });
  const r = await labelLlm(article, entry, { call });
  assert.deepEqual(r.labels, ['others']);
  assert.match(r.trace.result.why, /K4/);
});

test('an LLM error is never a silent others: it is in trace.llmError', async () => {
  const { call } = fakeLlm({ classifyError: { kind: 'error', message: 'HTTP 400: credit balance too low' } });
  const r = await labelLlm(article, entry, { call });
  assert.deepEqual(r.labels, ['others']);
  assert.deepEqual(r.trace.llmError, { stage: 'classify', kind: 'error', message: 'HTTP 400: credit balance too low' });
});

test('one event per proven label, even when the extractor returns none (all fields null)', async () => {
  const sentence = 'NEW YORK, Nov. 5, 2026 -- Acme Corp. (NASDAQ: ACME) today reported financial results for its third quarter ended September 30, 2026.';
  const { call } = fakeLlm({
    classify: { labels: [{ label: 'earnings', evidence: sentence }, { label: 'earnings', evidence: sentence }], symbol: null, relatedSymbols: [] },
    extract: { earnings: null, dividends: null, splits: null, ipos: null },
  });
  const r = await labelLlm(article, entry, { call });
  assert.deepEqual(r.labels, ['earnings']); // the duplicate is ignored
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].epsActual, null);
  assert.equal(r.events[0].evidence, sentence); // the label's own proof
});

test('splits and IPOs: ratio → numerator/denominator, IPO action backed by its wording', async () => {
  const text = [
    'Beta Inc. announced a 1-for-20 reverse stock split, effective December 1, 2026.',
    'Gamma Ltd. today announced the pricing of its initial public offering of 5,000,000 shares at $15.00 per share.',
    'The shares are expected to begin trading on the Nasdaq Global Market on November 20, 2026.',
  ].join('\n\n');
  const a = { ...article, fullText: text };
  const { call } = fakeLlm({
    classify: {
      labels: [
        { label: 'ipos', evidence: 'Gamma Ltd. today announced the pricing of its initial public offering of 5,000,000 shares at $15.00 per share.' },
        { label: 'splits', evidence: 'Beta Inc. announced a 1-for-20 reverse stock split, effective December 1, 2026.' },
      ],
      symbol: null, relatedSymbols: [],
    },
    extract: {
      earnings: null, dividends: null,
      splits: { ratio: v('1-for-20', 'Beta Inc. announced a 1-for-20 reverse stock split, effective December 1, 2026.'), effectiveDate: v('December 1, 2026', 'Beta Inc. announced a 1-for-20 reverse stock split, effective December 1, 2026.') },
      ipos: {
        company: v('Gamma Ltd.', 'Gamma Ltd. today announced the pricing of its initial public offering of 5,000,000 shares at $15.00 per share.'),
        exchange: v('Nasdaq Global Market', 'The shares are expected to begin trading on the Nasdaq Global Market on November 20, 2026.'),
        firstTradingDate: v('November 20, 2026', 'The shares are expected to begin trading on the Nasdaq Global Market on November 20, 2026.'),
        action: { value: 'priced', evidence: 'Gamma Ltd. today announced the pricing of its initial public offering of 5,000,000 shares at $15.00 per share.' },
        shares: v('5,000,000 shares', 'Gamma Ltd. today announced the pricing of its initial public offering of 5,000,000 shares at $15.00 per share.'),
        priceRange: v(null, null),
        pricePerShare: v('$15.00', 'Gamma Ltd. today announced the pricing of its initial public offering of 5,000,000 shares at $15.00 per share.'),
        marketCap: v(null, null),
      },
    },
  });
  const r = await labelLlm(a, entry, { call });
  assert.deepEqual(r.labels, ['splits', 'ipos']); // fixed order
  const [split, ipo] = r.events;
  assert.deepEqual([split.date, split.numerator, split.denominator, split.splitType], ['2026-12-01', 1, 20, 'reverse']);
  assert.deepEqual(
    [ipo.company, ipo.exchange, ipo.date, ipo.actions, ipo.shares, ipo.pricePerShare, ipo.priceRange],
    ['Gamma Ltd.', 'NASDAQ', '2026-11-20', 'priced', 5000000, 15, null],
  );
});

test('K8: an IPO action with no matching wording in its sentence → null', async () => {
  const text = 'Gamma Ltd. filed a registration statement for a proposed initial public offering.';
  const { call } = fakeLlm({
    classify: { labels: [{ label: 'ipos', evidence: text }], symbol: null, relatedSymbols: [] },
    extract: {
      earnings: null, dividends: null, splits: null,
      ipos: { company: v(null, null), exchange: v(null, null), firstTradingDate: v(null, null),
        action: { value: 'priced', evidence: text }, shares: v(null, null), priceRange: v(null, null), pricePerShare: v(null, null), marketCap: v(null, null) },
    },
  });
  const r = await labelLlm({ ...article, fullText: text }, entry, { call });
  assert.equal(r.events[0].actions, null);
  assert.match(r.trace.values.find((x) => x.field === 'ipos.actions').reason, /no "priced" wording/);
});

test('D12 + figure period: a full-year EPS never fills a Q4 event; "" / "unknown" mean not stated', async () => {
  const text = [
    'Fiscal 2026 GAAP diluted EPS of $2.62.',
    'Fourth quarter GAAP diluted EPS of $0.84.',
    'Fourth quarter non-GAAP diluted EPS of $0.83.',
  ].join('\n\n');
  const fig = (period, raw, evidence, basis) => ({ metric: 'eps', period, raw, evidence, basis, kind: 'actual', perShare: 'diluted' });
  const { call } = fakeLlm({
    classify: { labels: [{ label: 'earnings', evidence: 'Fourth quarter GAAP diluted EPS of $0.84.' }], symbol: null, relatedSymbols: [] },
    extract: {
      earnings: {
        period: v('Fourth quarter', 'Fourth quarter GAAP diluted EPS of $0.84.'),
        fiscalYear: v('', ''), fiscalDateEnding: v('', ''), date: v('', ''), time: v('', ''),
        figures: [
          fig('Fiscal 2026', '$2.62', 'Fiscal 2026 GAAP diluted EPS of $2.62.', 'GAAP'),
          fig('Fourth quarter', '$0.83', 'Fourth quarter non-GAAP diluted EPS of $0.83.', 'adjusted'),
          fig('Fourth quarter', '$0.84', 'Fourth quarter GAAP diluted EPS of $0.84.', 'GAAP'),
        ],
      },
      dividends: { dividend: v('', ''), declarationDate: v('', ''), exDividendDate: v('', ''), recordDate: v('', ''), paymentDate: v('', '') },
      splits: { ratio: v('', ''), effectiveDate: v('', '') },
      ipos: { company: v('', ''), exchange: v('', ''), firstTradingDate: v('', ''), action: { value: 'none', evidence: '' },
        shares: v('', ''), priceRange: v('', ''), pricePerShare: v('', ''), marketCap: v('', '') },
    },
  });
  const r = await labelLlm({ ...article, fullText: text }, entry, { call });
  const e = r.events[0];
  assert.equal(e.period, 'Q4');
  assert.equal(e.epsActual, 0.84); // not the FY $2.62 (wrong period), not the adjusted $0.83
  assert.equal(e.calendarYear, null);
  assert.equal(r.trace.values.find((x) => x.field === 'earnings.date').reason, 'not stated');
});

test('D12: no proven event period and figures for several periods → null, never a pick', async () => {
  const text = 'Fiscal 2026 GAAP diluted EPS of $2.62.\n\nFourth quarter GAAP diluted EPS of $0.84.';
  const fig = (period, raw, evidence) => ({ metric: 'eps', period, raw, evidence, basis: 'GAAP', kind: 'actual', perShare: 'diluted' });
  const { call } = fakeLlm({
    classify: { labels: [{ label: 'earnings', evidence: 'Fourth quarter GAAP diluted EPS of $0.84.' }], symbol: null, relatedSymbols: [] },
    extract: {
      earnings: {
        period: v('fourth quarter', 'Fourth quarter GAAP diluted EPS of $0.84.'), // wrong case → fails K2 → no proven period
        figures: [fig('', '$2.62', 'Fiscal 2026 GAAP diluted EPS of $2.62.'), fig('Fourth quarter', '$0.84', 'Fourth quarter GAAP diluted EPS of $0.84.')],
      },
    },
  });
  const r = await labelLlm({ ...article, fullText: text }, entry, { call });
  assert.equal(r.events[0].period, null);
  assert.equal(r.events[0].epsActual, null);
  assert.match(r.trace.values.find((x) => x.field === 'earnings.epsActual').reason, /several periods/);
});
