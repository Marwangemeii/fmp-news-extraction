# Handoff 03: Labeller, extractor, traces (M1)

> Written by Claude Code at the end of a session, for the orchestrator (Claude in a separate chat, who cannot see the code).

## 1. Goal of this session
Phase 3, milestone **M1**: pre-filter + LLM (classify, extract) + converters + checks + traces + `npm run explain`, plus fixtures and an eval (moved into M1 so M1 could be measured). Principle: the LLM proposes, the code proves. M2 (symbol/suffix, type rule, `figures[]` in the output, time/timeExact, Haiku-vs-Sonnet comparison) is next.

Plan-review changes from Marwan, all applied: Haiku 5.5 for **both** stages ($10 API credit), the classify input capped at ~6,000 body characters, no server-side model fallback, LLM failures traced and counted (never a silent `others`), the missing-year rule in DECISIONS, and the K4 label-drop rate tracked.

## 2. What was done
- `src/llm/config.js`: models, effort, max tokens, prompt version `v1`, prices, concurrency 4, the `LLM_BUDGET_USD` cap. Fails at startup if a model has no price.
- `src/llm/prompts.js`: the classify and extract system prompts, `topOfBody()` (the 6,000-char cut at a paragraph break), the user messages.
- `src/llm/schemas.js`: JSON Schemas for structured outputs; the extract schema is a **flat values list** (D35); `countUnions()`.
- `src/llm/client.js`: `callJson()`: one `messages.create` with `output_config.format`, the disk cache `.cache/llm/` (D36), the budget cap, and errors returned as `{ error: { kind } }` (never thrown).
- `src/lib/prefilter.js`: keyword lists per label → `{ pass, matched }`.
- `src/lib/convert.js`: `parseMoney`, `parsePerShare`, `parseShares`, `parseDate` (with `yearInferred`), `parseRatio`, `parsePeriod`, `parseFiscalYear`, `asText` (D37).
- `src/lib/checks.js`: `evidenceInText` (K1, with a "first N of M words match" hint), `rawInEvidence` (K2), `inArticleOrder`.
- `src/lib/symbols.js`: `normalizeExchange()` (M2 adds the FMP suffix table). `src/lib/pool.js`: `mapLimit()`.
- `src/blocks/label-llm.js`: the labeller (`labellers.llm`), the default in `DEFAULTS.label`.
- `src/controller.js`: labelling is now a second pass with `mapLimit(…, 4)`; returns `traces`; per-publisher `labels`, `llm` stats, `llmErrorUrls`; records get `relatedSymbols`; `symbol`/`type` come from the labeller.
- `src/run.js`: fails fast without `ANTHROPIC_API_KEY`; writes `output/traces.jsonl`; `stats.json` gets run-level `llm` totals.
- `scripts/validate.js`: R-E1 (evidence in fullText), R-E8, R-E9, required event fields, the R-J5 shape, and a warning per LLM-failed article.
- `scripts/explain.js`, `scripts/eval.js`, `scripts/make-fixture.js`.
- `package.json`: `@anthropic-ai/sdk` ^1.14.0 (planned in D3); `start`/`eval` load `.env` via `node --env-file-if-exists=.env`; new `explain` and `eval` scripts.
- Tests: `test/convert.test.js`, `test/checks.test.js` (incl. pre-filter, `topOfBody`, the schema union limit), `test/label-llm.test.js` (fake LLM, 10 cases). 54 tests total.
- Fixtures: `test/fixtures/articles/` (19), `test/fixtures/gold.json` (DRAFT), `test/fixtures/README.md` (sources).
- Docs: DECISIONS D34–D43, SITES (GlobeNewswire selectors + Akamai finding, Business Wire 403, CryptoPotato 403 on new pages), PLAN, CLAUDE.md commands, `.env.example`, `.gitignore` (`output/eval-*.json`).

## 3. How it works
For each article: no fullText → `others`. No vocabulary → `others`. Otherwise **classify** (Haiku, top 6,000 chars) returns labels, each with one proving sentence. Code keeps a label only if that sentence is in fullText (K4). **Extract** (Haiku, full article) returns values exactly as written, each with its sentence. Code checks each value (K1 sentence in fullText, K2 value in sentence), converts it (K3), and builds one event per label. The event's `evidence` is assembled by code from the sentences that passed. Every step goes into one trace line.

**The labeller's core (`src/blocks/label-llm.js`, shortened):**
```js
if (!article.fullText) return others('fullText is null: nothing to check evidence against, no LLM call');
trace.prefilter = prefilter(article);
if (!trace.prefilter.pass) return others('pre-filter: no earnings/dividend/split/IPO vocabulary, no LLM call');

const top = topOfBody(article.fullText);                       // ≤ 6,000 chars, cut at "\n\n"
const c = await call({ model: MODELS.classify, effort: 'low', system: CLASSIFY_SYSTEM,
  user: classifyMessage(article, top.text), schema: CLASSIFY_SCHEMA, url: article.url, cache, spend });
if (c.error) { trace.llmError = { stage: 'classify', ...c.error }; return others(`LLM ${c.error.kind} in classify…`); }

for (const { label, evidence } of c.json.labels) {             // K4
  const k1 = evidenceInText(evidence, article.fullText);
  labelChecks.push({ label, evidence, evidenceInFullText: k1.ok, kept: k1.ok, ...(k1.ok ? {} : { reason: k1.reason }) });
  if (k1.ok) kept.push({ label, evidence });
}
// … extract only the kept labels, then:
const byLabel = nest(x.json, trace);                            // flat values list → { earnings: {period: {raw, evidence}}, … }
const events = kept.map(({ label, evidence }) => buildEvent(label, byLabel[label], evidence, article, trace, symbol));
```
**One value (K1 + K2 + K3), `prove()`:**
```js
const k1 = evidenceInText(v.evidence, article.fullText);        // sentence in the article, whitespace-normalized only
const k2 = rawInEvidence(v.raw, v.evidence);                    // value inside its sentence
if (!k1.ok || !k2.ok) { t.value = null; t.reason = …; return null; }
const r = conv(v.raw);                                          // e.g. parseMoney("$412.5 million")
if (r.value === null) { t.reason = `conversion failed: ${r.reason}`; return null; }
t.rule = r.rule; t.value = r.value;                             // "parseMoney: "412.5" → 412.5, × million (USD?)"
```
**Earnings figure choice by code (D40):** only figures for the event's proven period (or no period stated); `epsActual` = GAAP/IFRS, then basis not stated (never adjusted), diluted over basic. If the event's period isn't proven and the figures span several periods → null.

**Extract schema (flat, 0 unions):**
```js
export const EXTRACT_SCHEMA = object({
  values:  { type: 'array', items: object({ field: enumOf(FIELD_NAMES), raw: str, evidence: str }) },  // "dividends.recordDate", …
  figures: { type: 'array', items: object({ metric, period, raw, evidence, basis, kind, perShare }) },  // enums incl. "unknown"
  ipoAction: object({ value: enumOf(['filed', 'expected', 'priced', 'postponed', 'withdrawn', 'none']), evidence: str }),
});
```
**Classify returns** `{ labels: [{ label, evidence }], symbol: { ticker, exchange, evidence } | null, relatedSymbols: [...] }` (the symbols are recorded in the trace; they're used in M2).

**A real trace, via explain (TechCrunch, IPO):**
```
classify    claude-haiku-5-5 · from cache (was 2507 in / 374 out) · stop end_turn
  ✔ ipos       "Anthropic has priced its long-awaited IPO at $83 per share, above its initial range of $7…"
  proposed symbol ANT (Nasdaq), related: ANT
extract     claude-haiku-5-5 · from cache (was 3622 in / 1197 out) · stop end_turn
  ✔ ipos.company               "Anthropic"            → Anthropic      text as written
  ✔ ipos.exchange              "Nasdaq"               → NASDAQ         normalizeExchange
  ✖ ipos.firstTradingDate      "Thursday"             → null           conversion failed: no date found in "Thursday"
  ✔ ipos.actions               "priced"               → priced         K8: "priced" wording found in the evidence
  ✔ ipos.shares                "980 million shares"   → 980000000      parseShares: "980" → 980, × million
  ✔ ipos.pricePerShare         "$83 per share"        → 83             parsePerShare
  ✔ ipos.marketCap             "$1.5 trillion"        → 1500000000000  parseMoney: × trillion
```

## 4. Decisions made (all in `docs/DECISIONS.md`)
- **D34** Haiku 5.5 for classify (effort low) + extract (effort medium); the classify input is capped at 6,000 chars; `LLM_BUDGET_USD`. Why: $10 credit.
- **D35** structured outputs with a flat extract schema. Why: the API rejected nullable enums, more than 16 union fields, and a too-large grammar (all three were caught by D38 in real runs).
- **D36** LLM cache keyed by model + prompt version + url + content hash. Why: free reruns, and reproducibility (the model isn't fully deterministic).
- **D37** converters that refuse rather than guess, incl. the explicit **missing-year rule** (`yearInferred`, nearest publishedDate) and "a bare money number needs a currency and ≥ 1M".
- **D38** LLM failures → `others` + `llmError` + stats count + validator warning; no model fallback.
- **D39** checks K1–K10; the event `evidence` is built by code.
- **D40** figure selection by code, including the figure's period (fixes HP's FY-vs-Q4 mix-up).
- **D41** fullText null → `others` without an LLM call (revisit in Phase 4).
- **D42** fixtures + gold (draft) + eval with wrong-vs-missed.
- **D43** `relatedSymbols` in every record.

## 5. Deviations from the plan or the docs
- **Eval and fixtures moved into M1** (the plan had them in M2) so M1 could be measured as asked. M2 extends the eval.
- **The extract output shape changed** from the planned nested object to a flat `values` list (D35), forced by API limits found at run time. Same information; the prompt text was updated to match. Figures gained a `period` field (D40).
- **Fixtures:** 19, not 12. Business Wire is blocked (403), so its slots went to GlobeNewswire. 4 fixtures come from the TechCrunch/CryptoPotato cache (hard negatives found in this window: Anthropic IPO coverage). Not covered yet: an earnings preview and a Newsfile TSXV/CSE issuer (see `test/fixtures/README.md`).
- **`max_tokens` for classify raised from 2,000 to 4,000** after one fixture was truncated (traced as `llmError: truncated`).
- **The extract `figures[]` list is in the trace but not yet in the output event** (M2, as planned). `symbol` stays null and `type` = schema default until M2.

## 6. Requirements covered
- **R-J1** (traceability): one trace per article in `output/traces.jsonl` + `npm run explain` (M).
- **R-E1** (V): the validator checks every evidence line against fullText; the code checks it before writing.
- **R-E4, R-E8, R-E9** (T + V): `test/convert.test.js` (12 tests) + validator.
- **R-E10** (T + eval): failed checks → null; the eval reports **0 wrong values**.
- **R-E3** (T + eval): GAAP over adjusted (`test/label-llm.test.js`, fixtures 01/05).
- **R-L1–R-L6** (eval): label precision/recall on 19 fixtures.
- **R-A12/R-A13/R-L6** (V): labels and one event per label.

## 7. How to verify
```
npm test                                    # 54 pass
$env:CACHE=1; npm start                     # PowerShell; both enabled publishers, LLM answers from .cache/llm/
npm run validate                            # PASS, 0 failures; warnings: 21 R-A9 (CryptoPotato blocked), 2 R-A7 (video posts)
npm run eval -- --verbose                   # 19 fixtures, cached → $0
npm run explain -- nvidia-promises-that-revenue
LLM_EXTRACT_MODEL=claude-sonnet-5-5 npm run eval    # M2: model comparison (~$0.25)
```

## 8. Results (2026-11-25, window 2026-11-11T00:00Z → run time)
- `npm test`: **54 passed**, 0 failed.
- **Run, TechCrunch + CryptoPotato (CACHE=1):** 501 articles; the pre-filter passed 216 (43%); labels: TechCrunch `earnings 5, ipos 6, others 236`; CryptoPotato `earnings 4, ipos 10, others 240`. **K4 drop rate 0/26.** **LLM errors 0** (25 earlier, all from schema rejections, fixed). Last full run: 216 calls (25 cached), 553,081 in / 27,923 out tokens, **~$0.069**. Measured: ~$0.00032 per classify call, ~$0.0009 per extract call.
- **Total spent this session:** ~$0.21 (all runs + evals).
- **Updated full-run estimate:** ~$5–7 (15k articles; 43% pass the pre-filter, as measured; wires will have more labels and longer releases).
- `npm run validate`: **PASS**, 0 failures, 23 warnings (21 R-A9: CryptoPotato pages not yet cached returned 403 on the hotspot; 2 R-A7: video posts).
- **Eval (Haiku/Haiku, 19 fixtures):** exact label set **17/19 (89%)**; earnings, splits 100%/100%; dividends P 80% / R 100%; ipos P 75% / R 100%; others P 100% / R 67%. **Fields: 104 correct, 0 wrong, 12 missed (90%)**. K4 drops 0/20.
  - Misses, all traced: T3 period/year (the model quoted the **title**, which isn't in fullText); HP period (the model wrote "fourth quarter" for "Fourth quarter", so K2 failed), so EPS/revenue → null by D40; INLIF ratio (the model paraphrased "its" as "The Company's" in the sentence, so K1 failed); QNB declaration date (not extracted); CMB.TECH revenue (table "in thousands", refused by D37).
  - Label errors: VitaCig also got `dividends` (a share dividend in a spin-off: arguable); an Anthropic IPO opinion piece got `ipos`.

## 9. Known issues / open questions for the orchestrator
1. **Label precision on news sites.** K4 proves a sentence *exists*, not that it's the *subject*. In the run, CryptoPotato market recaps and stake stories got `ipos` from a sentence deep in the article. Data: correct labels have their evidence in paragraph 0–1; the doubtful ones in paragraph 2–10. **Proposal for M2:** a deterministic K11, "label evidence must be in the first 2 paragraphs", or a stricter classify prompt. Needs Marwan's OK (a new rule; a re-classify costs ~$0.07).
2. **Title as evidence?** The model sometimes quotes the headline, which is not in `fullText`, so the value is dropped (T3). Options: accept the title as an evidence source, or tell the extractor "body only" (as classify already says).
3. **K2 is case-sensitive.** "fourth quarter" vs "Fourth quarter" fails. Keep strict (spec: whitespace only), or allow case-insensitive matching for K2 only?
4. **Extract failure → `others`** even when classify proved the labels (D38, Marwan's rule). Alternative: keep the proven labels with all-null events + llmError.
5. **Gold is a draft:** fixture 11 (VitaCig dividends?), 12 (dividend 0.21 vs 0.65; ex-date by exchange), 19 (`others` vs `ipos`) need Marwan's call.
6. **CryptoPotato 403** on new article pages from the hotspot (19); retry from the usual network.
7. **FMP suffixes** still unverified except `.L`, `.DE`, `.MI` (M2).

## 10. Suggested next step
M2: `symbols.js` (K7 ticker-in-text, regex fallback, FMP suffix table), the `type` rule, `figures[]` in the output, `parseTime` + timeExact (D11), the eval on those fields, and `LLM_EXTRACT_MODEL=claude-sonnet-5-5 npm run eval` for the model comparison. Decide items 1–4 above first, since they change prompts or rules and so the cached answers.
