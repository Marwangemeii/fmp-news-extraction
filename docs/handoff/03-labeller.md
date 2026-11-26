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

---

# M2 (2026-11-25): Marwan's decisions on M1, symbols, type, time, figures, model comparison

## M2.1 Goal
Put Marwan's answers to §9 items 1–4 into code (prompt v2), then build M2: `symbols.js` (K7, ticker regex, FMP suffix table), `type.js`, `figures[]` in the earnings event, `parseTime` + `timeExact` + the press-release rule, an extended eval, and Haiku vs Sonnet for extract.

## M2.2 What was done
- `src/lib/checks.js`: K2 ignores case (D45); `OPENING_PARAGRAPHS = 3`, `opening()`, `evidenceInOpening()` (K11, D44).
- `src/lib/symbols.js`: `exchangeCode()`, `FMP_SUFFIX`, `toFmpSymbol()`, `findTickers()`, `proveTicker()` (K7), `resolveSymbols()` (D46). `normalizeExchange()` unchanged in behaviour.
- `src/lib/type.js`: `typeOf(entry, symbol)` (D47).
- `src/lib/time.js`: `parseTime()`, `timeFromPublishTime()`, `etParts()` (D48), using `Intl` with `America/New_York`.
- `src/lib/convert.js`: `parsePeriod("fiscal 2026")` → `FY` (whole text only).
- `src/blocks/label-llm.js`: order is now classify → symbols (K7) → type → K4 + K11 → extract; an extract failure keeps the labels with all-null events (D38 amended); `earningsTime()`; `figures[]` in the event.
- `src/llm/prompts.js` + `config.js`: `PROMPT_VERSION = 'v2'`; classify gets `<source>news|press release</source>` and the opening rule; extract gets "evidence from the body only, never the title".
- `src/publishers.js`: `defaultType: 'pressReleases'` on GlobeNewswire, Business Wire, Newsfile (still disabled).
- `src/controller.js`, `src/run.js`: the `labelsNotInOpening` count.
- `scripts/validate.js`: figure checks (enums, number, evidence in fullText), `timeExact` ISO check, the new wording for an extract failure.
- `scripts/explain.js`: K11 marks, each proposed ticker with K7 ✔/✖ and its FMP rule, the regex tickers.
- `scripts/eval.js`: symbol / relatedSymbols (as a set) / type; `time` + `timeExact`; key figures (found / mislabelled / missed); K11 count; output `output/eval-<classify>__<extract>.json`.
- `test/fixtures/gold.json`: `_m2` removed; `timeExact: null` on all 7 earnings events; 21 key figures on fixtures 01, 02, 05, 12, 18 (DRAFT).
- Tests: new `test/symbols.test.js` (7), `test/time.test.js` (5); `checks.test.js` (K2 case, K11), `label-llm.test.js` (+4: extract failure, K11 news vs wire, K7 + type, stated time). **71 tests** (54 before).

## M2.3 How it works
**Order in `labelLlm` (shortened):**
```js
const pressRelease = entry.defaultType === 'pressReleases';    // K11 doesn't apply to a company's own release
const c = await call({ … user: classifyMessage(article, top.text, pressRelease) … });
if (c.error) { …; setSymbols(null); return others(…); }       // no answer → regex fallback for the symbol
setSymbols(c.json);                                            // resolveSymbols (K7) + typeOf, before the labels
for (const { label, evidence } of c.json.labels) {
  const k1 = evidenceInText(evidence, article.fullText);                                  // K4
  const k11 = k1.ok && !pressRelease ? evidenceInOpening(evidence, article.fullText) : null; // K11
  const ok = k1.ok && (k11?.ok ?? true);
  …
}
const x = await call({ … extract … });
if (x.error) {                                                 // D38 amended: labels proven, so they stay
  trace.llmError = { stage: 'extract', ...x.error };
  const events = kept.map(({ label, evidence }) => buildEvent(label, null, evidence, eventCtx, missing));
  return { ...base, labels, events, trace };
}
```
**K7 (`proveTicker`):**
```js
const k1 = evidenceInText(p.evidence, text);                    // the quoted sentence is in the article
if (!new RegExp(`(^|[^A-Za-z0-9])${escapeRe(p.ticker)}($|[^A-Za-z0-9])`).test(ev)) → "ticker not in its sentence"
if (p.exchange && !ev.toLowerCase().includes(p.exchange.toLowerCase()))               → "exchange not in its sentence"
```
**symbol rule:** the classifier's K7-proven main ticker; with no classifier answer, the first `(Exchange: TICKER)` in the opening; a classifier null or a K7 failure → null. relatedSymbols = proven classifier tickers ∪ regex tickers, main first.

**time (`earningsTime`):**
```js
const stated = prove('earnings.time', v, (raw) => parseTime(raw, { date, usListing: c.usListing }), c);
if (stated) return stated;                                     // wording → bmo/amc; "4:05 p.m. ET" + proven date → timeExact
// press-release rule: pressReleases + US listing + a proven actual figure + results dated the publish day (ET) or undated
const r = timeFromPublishTime(c.article.publishedDate);        // 16:15 ET → amc; 12:48 ET → null (market hours)
return { time: r.value, timeExact: null };
```
**A figure in the output event:**
```json
{ "metric": "eps", "value": 0.84, "period": "Q4", "basis": "GAAP", "kind": "actual", "perShare": "diluted",
  "evidence": "Fourth quarter GAAP diluted net EPS of $0.84, inclusive of tariff refunds, and flat from the prior year period" }
```

## M2.4 Decisions (all in `docs/DECISIONS.md`)
- **D44** K11 subject rule, **news only** (Marwan chose this at plan review after seeing that 3 paragraphs everywhere drops HP's and CMB.TECH's dividends).
- **D45** evidence from the body only; K2 ignores case, K1 stays exact.
- **D38 amended:** an extract failure keeps the proven labels with all-null events.
- **D46** symbols: K7, the regex, the FMP suffix table (**unverified** apart from .L/.DE/.MI: FMP's docs site returned 403), `-` for share classes.
- **D47** type rule. **D48** time/timeExact + the press-release rule. **D49** figures in the output + key-figure scoring. **D50** Haiku stays for extract.
- Open questions on symbol/type for non-LLM articles and on the type rule: closed.

## M2.5 Deviations
- **K11 applies to news only**, not to every article as first decided: Marwan's choice at plan review (data above).
- **`parsePeriod("fiscal 2026")` → FY:** a converter gap the figures eval exposed (9 figures had `period: null`).
- **Gold changes:** key figures added (new), and the two IES "same quarter of fiscal 2025" previous figures accept a null period (the text doesn't name the quarter).
- **FMP suffixes not verified** (403 on FMP's docs). Needs an FMP API key or FMP's confirmation.

## M2.6 Requirements covered
- **R-A10** (T + eval): `test/symbols.test.js`; eval symbol 19/19. **R-J5** (eval): relatedSymbols 19/19 (as sets). **R-A11** (V + eval): type 19/19.
- **R-J3** (T + eval): `test/time.test.js`; eval `time` 7/7, `timeExact` 7/7. **R-J4** (V + eval): figures in the output, validator checks them, key figures 20/21.
- **R-L1** (eval + stats): K11 count. **R-E1** (V): figure evidence checked too. **R-E10**: still **0 wrong values**.

## M2.7 How to verify
```
npm test                                         # 71 pass
$env:CACHE=1; $env:LLM_BUDGET_USD=1; npm start   # both sites; v2 answers are now in .cache/llm/
npm run validate                                 # PASS, 0 failures
npm run eval -- --verbose                        # cached, $0
$env:LLM_EXTRACT_MODEL='claude-sonnet-5-5'; npm run eval   # cached now, $0
npm run explain -- anthropic-reportedly-prices-ipo
npm run explain -- 2026/11/19/nvidia-ceo-jensen-huangs-affair
```

## M2.8 Results (2026-11-25)
- `npm test`: **71 passed**, 0 failed.
- **Eval before / after (19 fixtures, Haiku/Haiku):**

| | before (v1, M1) | after (v2, M2) |
|---|---|---|
| exact label set | 17/19 | 17/19 (same two: VitaCig `dividends`, the CryptoPotato opinion piece `ipos`) |
| K4 / K11 drops | 0/20 / – | 0/21 / 0/21 |
| fields correct / **wrong** / missed | 104 / **0** / 12 | 126 / **0** / 4 (more fields scored: time, timeExact) |
| symbol / relatedSymbols / type | – | 19/19 · 19/19 · 19/19 |
| time / timeExact | – | 7/7 · 7/7 |
| key figures | – | 20 found, 1 mislabelled (Nvidia revenue: no period), 0 missed of 21 |

  M1 misses now fixed: T3 period/year (body-only evidence), HP period (K2 case) → HP EPS + revenue, INLIF ratio, QNB declaration date. Still missed: HP `fiscalDateEnding` (only in a table header), CMB.TECH revenue (table "in thousands", refused by D37 on purpose), Nvidia `period` + `calendarYear` (not extracted).
- **Haiku vs Sonnet (extract):** same 126 / 0 / 4; key figures 20 vs 21; extract cost ~$0.03 vs **$0.39** → Haiku stays (D50).
- **Run, TechCrunch + CryptoPotato (CACHE=1, LLM_BUDGET_USD=1):** 503 articles (TechCrunch 248, CryptoPotato 255); pre-filter passed 216; 228 LLM calls, 622,793 in / 47,143 out, **~$0.086**; **LLM errors 0**; labels dropped K4 0, **K11 1**, of 18 proposed.
  - Labels: TechCrunch earnings 2, ipos 5 (M1: 5, 6); CryptoPotato earnings 4, ipos 6 (M1: 4, 10). Labelled articles 26 → 17. Most of the drop comes from the v2 classify prompt (news: sentence from the first three paragraphs or no label); the K11 code check dropped 1 (the Jensen Huang scandal timeline, whose earnings sentence is deep in the article: correct).
  - Types: TechCrunch general 246, stock 2; CryptoPotato crypto 255. 13 articles have a symbol, 25 have relatedSymbols.
- `npm run validate`: **PASS**, 0 failures, 24 warnings (22 R-A9: CryptoPotato 403 on uncached pages; 2 R-A7: video posts).
- **Spend this session:** eval Haiku $0.040 + eval Sonnet $0.389 + run $0.086 = **~$0.51**. Total so far ~$0.72 of $10.

**Trace 1 (TechCrunch IPO, symbol + type):**
```
classify    claude-haiku-5-5 · from cache (was 2633 in / 738 out) · stop end_turn
  ✔ ipos       "Anthropic has priced its long-awaited IPO at $83 per share, above its initial range of $7…" [K11 in opening]
  ✔ main ANT (Nasdaq)          → ANT            "ANT" on "Nasdaq" → NASDAQ → ANT
extract     claude-haiku-5-5 · from cache (was 3671 in / 1792 out) · stop end_turn
  ✖ ipos.firstTradingDate      "Thursday"                       → null           conversion failed: no date found in "Thursday"
  ✔ ipos.pricePerShare         "$83"                            → 83             parsePerShare: "83" → 83 (USD?)
result      ["ipos"]
symbol      ANT  the classifier's main ticker, proven by K7
type        stock  general-news publisher + a proven main symbol (ANT) → stock
```
**Trace 2 (K11 drop):**
```
The unfolding Jensen Huang scandal: a timeline
classify    claude-haiku-5-5 · 3581 in / 99 out · stop end_turn
            body cut for classify: 5918 of 17218 chars
  ✖ earnings   "Nvidia reported its quarterly earnings on Tuesday, which beat Wall Street expectations wi…"  → dropped: not in opening (first 3 paragraphs)
result      ["others"]  (every proposed label failed its evidence check (K4) or the opening check (K11), see classify.labelChecks)
symbol      null  the classifier found no single main company with a written ticker: null
```

## M2.9 Known issues / open questions
1. **K7 is per sentence.** A CryptoPotato story writes "…on Nasdaq tomorrow, November 19. This will happen under the ticker ANT": the exchange is in the previous sentence, so K7 rejects it → symbol null (not wrong). Option: when the exchange isn't in the ticker's sentence, accept the ticker with no exchange (= no suffix). Safe for US tickers, wrong for non-US ones. Needs Marwan's call.
2. **FMP suffixes unverified** except .L/.DE/.MI (FMP docs: 403). One `search-symbol` call per suffix with an FMP key would settle it.
3. **Label precision on the two open fixtures** is unchanged: VitaCig (`dividends` on a share-dividend spin-off) and the CryptoPotato opinion piece (its IPO sentence *is* in the opening, so K11 can't catch it). The gold for 11, 12 and 19 still needs Marwan's call (M1 item 5).
4. **News articles mostly write no ticker** (TechCrunch's Anthropic stories), so `symbol` is null for them by rule. A name → ticker lookup (FMP search) would be a production option, kept out (it isn't stated in the article).
5. **Gold is still DRAFT**, now including the 21 key figures. CryptoPotato 403 on new pages is unchanged (M1 item 6).

## M2.10 Suggested next step
Phase 4: Newsfile and GlobeNewswire first (the press-release rules, K11 exemption and ticker regex are built for them), then the rest in PLAN order.

## M2.8b v1 → v2 label changes on the run (cache replay, $0)
The committed v1 labeller was replayed from `.cache/llm/` (no API key, budget 0) on the same 503 articles: **25 labelled in v1, 17 in v2**. One article had no v1 answer cached (BitMine, `others` in v2). The 14 other v1 answers with labels whose URLs aren't in this run's output are eval fixtures.

| # | title | publisher | v1 | v2 | v2 reason | v1 evidence ¶ |
|---|---|---|---|---|---|---|
| 1 | A tale of two Nvidias | TechCrunch | earnings | others | classify proposed no label | 0 |
| 2 | Amazon and Google will together own nearly 30% of Anthropic after its IPO | TechCrunch | ipos | others | classify proposed no label | 3 |
| 3 | Nebius tests the neocloud playbook with $40 billion in planned spending | TechCrunch | earnings | others | classify proposed no label | 0 |
| 4 | SoftBank's billion-dollar loss may have put a cap on AI's natural gas ambitions | TechCrunch | earnings | others | classify proposed no label | 6 |
| 5 | Short Traders Get Wrecked Too as Bitcoin Climbs Past $60K in Whipsaw Move | CryptoPotato | ipos | others | classify proposed no label | 2 |
| 6 | Solana Beats Robinhood With 10x ANT Trades as Anthropic Stock Went Wild | CryptoPotato | ipos | others | classify proposed no label | 7 |
| 7 | Bitcoin (BTC) Drops Under $64K, Pi Network (PI) Falls to New ATL: Market Watch | CryptoPotato | ipos | others | classify proposed no label | 5 |
| 8 | Another Brutal Week Ahead for Bitcoin? 4 Catalysts Traders Can't Ignore | CryptoPotato | ipos | others | classify proposed no label | 1 |
| 9 | 3 Surprising Factors Behind Bitcoin's Brutal $8K Weekly Drop | CryptoPotato | ipos | others | classify proposed no label | 10 |

Added in v2: "Ripple CEO Sees Crypto Comeback After Anthropic IPO" (CryptoPotato), others → **ipos** (likely wrong: an opinion piece, like fixture 19).
All 9 drops come from the v2 classify prompt. The K11 code check dropped one label (the Jensen Huang timeline, `others` in v1 too), and K4 dropped none. Assessment: 7 correct drops (passing mentions in recaps and an ownership story), #1 correct (analysis piece, R-L2), **#3 Nebius arguable** (its opening sentence is about the Q3 earnings call).
