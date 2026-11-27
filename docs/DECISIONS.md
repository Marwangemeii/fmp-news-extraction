# Decisions

Each entry: the decision, why, and what else was considered. Add new entries at the end; never delete one. If a decision changes, add a new entry that replaces it.

---

### D1. Plain JavaScript (ESM) on Node 22+
**Why:** Jack asked for JavaScript over TypeScript. Node is Marwan's daily stack, so the code is easy to defend and change live.
**Considered:** TypeScript (rejected per Jack), Python (stronger anti-bot tooling, but weaker fluency for live changes).

### D2. No Docker, plain scripts
**Why:** Jack: "simply having the scripting is fine. No need to overengineer it." Setup is `npm install` + `npx playwright install chromium` + `npm start`.

### D3. Minimal dependencies
**Planned:** `cheerio` (HTML parsing), `fast-xml-parser` (one parser for both RSS and sitemaps), `playwright` (browser fetcher), `@anthropic-ai/sdk` (LLM, Phase 3). Node built-ins for everything else: `fetch`, `node:test`, `fs`.
**Rule:** any other dependency needs a one-line reason and approval.

### D4. One schema, one controller, a registry of building blocks
- `src/publishers.js`: an array of plain objects, one per publisher, holding only what differs.
- `src/blocks/`: plain functions (fetchers, discoverers, clean-ups, labeller) exported in a registry object.
- `src/controller.js`: loops over the schema, looks up each entry's building blocks by name, runs discover → fetch → extract → label → write.

**Why:** the hard requirement. It's the Strategy pattern with plain objects, no classes.
**Enforced by:** a structure test (R-C4).

### D5. Fetching: HTTP by default, Playwright when needed
Each entry picks `fetcher: 'http'` or `fetcher: 'browser'`, and can pick differently for list pages and article pages.
**Why:** HTTP is fast and enough for most sites. A browser is needed only for pages built by JavaScript or protected by JavaScript challenges.

### D6. Polite and robust fetching
Limited concurrency per publisher, a delay between requests, a timeout, retries with backoff on 429/5xx, and a realistic User-Agent.
**Why:** thousands of requests, and sites that block aggressive clients.

### D7. Window, canonical URL, dedup
- Window start = 00:00 UTC of (run date − 14 days); end = run time.
- Canonical URL: `<link rel="canonical">` if present, else the fetched URL, with tracking params removed (`utm_*`, `fbclid`, `gclid`, etc.) and the fragment dropped.
- Dedup by canonical URL across all start URLs and pages.

### D8. LLM proposes, code proves
1. **Pre-filter:** a broad keyword check. Articles with no earnings, dividend, split or IPO vocabulary get `others` with no LLM call. It's kept broad so it rarely misses a real one.
2. **LLM:** returns labels plus values **exactly as written** (`"$412.5 million"`, `"December 15, 2026"`) and the evidence sentences, as strict JSON.
3. **Code converts** text → numbers and dates deterministically.
4. **Code checks:** each evidence sentence is found word for word in `fullText`; each value appears in its evidence; label rules (`others` alone). A value that fails becomes `null`, and the failure is logged in the trace.
5. **Measure:** compare against a hand-labelled gold set of ~50 articles and report the accuracy in the README.

**Why:** Jack allowed an LLM only if it's traceable and doesn't hallucinate.
**Model:** decided in Phase 3. A small, fast model for labelling; possibly a stronger one for extraction.

### D9. Traceability: a trace record per article
`output/traces.jsonl`, one line per article, keyed by url. It holds the model + prompt version, the LLM's raw response, and for each value: source text → converted value → rule applied, plus which checks passed or failed and why.
`npm run explain -- <url>` prints it readably.
**Why:** R-J1, "back derive the original logic". It's also the best interview demo.

### D10. `evidence` = every sentence the figures come from
Several sentences are joined with `\n`, in article order; each one must be found word for word in `fullText`. Each item in earnings `figures` (D12) also carries its own single evidence sentence.
**Why:** the PDF says "the exact sentence"; Jack said to retrieve everything.

### D11. Earnings `time`
- `time` stays `bmo` / `amc` / `null`, as the PDF specifies.
- An extra field, `timeExact` (ISO 8601 UTC), is filled when the article states an exact time with a timezone ("4:05 p.m. ET").
- `bmo`/`amc` comes from:
  - explicit wording ("before the market opens"), or
  - a stated time, for US listings (market hours 9:30–16:00 ET), or
  - the publish time of the company's **own** press release, which *is* the announcement.
- A news article's publish time is **not** used, since it's written after the fact.
- Otherwise `null`.

**Why:** R-J3, highest granularity without guessing.

### D12. Earnings: required fields + an all-figures list
The required fields stay as specified. A `figures` array lists every EPS and revenue figure stated:
```json
{ "metric": "eps", "value": 0.84, "basis": "GAAP", "kind": "actual", "evidence": "..." }
```
- `metric`: `eps` | `revenue`
- `basis`: `GAAP` | `IFRS` | `adjusted` | `null`
- `kind`: `actual` | `estimate` | `previous`

`epsActual` = the GAAP (or IFRS, for IFRS reporters) figure. If both diluted and basic EPS are given, use diluted, since analyst estimates are on a diluted basis.
**Why:** R-J4.

### D13. Blocked sites: an escalation ladder, free techniques only
For each blocked site, in order:
1. Alternative routes the site itself offers: other feeds, sitemap archives, AMP pages, the JSON API the page calls, data embedded in the HTML.
2. Realistic headers and cookies.
3. Playwright, with careful waits and human-like pacing.
4. Slower pacing, retries at another time.

Every attempt is logged in `docs/SITES.md` (what we tried, what we saw). The fetcher accepts an optional proxy setting via an env variable, so FMP's proxy network can be plugged in later.
**Why:** R-J2. Ramez expects real effort before declaring a site blocked.

### D14. `symbol` + `relatedSymbols`
- `symbol`: the main company. In a merger, the larger one, without over-investing in this.
- `relatedSymbols`: every company ticker mentioned, the main one included.
- Non-US tickers use FMP suffixes, mapped from the exchange in the text, e.g. TSX → `.TO`, TSXV → `.V`, CSE → `.CN`, LSE → `.L`. The mapping must be verified against FMP's docs in Phase 3.

**Why:** R-A10, R-J5.

### D15. A dev cache for article pages
Fetched article HTML is cached on disk (`.cache/`, gitignored) when `CACHE=1`, to avoid re-fetching during development. List/feed pages are **never** cached, so discovery always sees fresh data.
**Why:** fast iteration on extraction and labelling, and politeness to the sites.

### D16. Outputs
- `output/articles.jsonl`: the deliverable
- `output/traces.jsonl`: per-article traces (D9)
- `output/stats.json`: per publisher: discovered, in window, fetched, blocked, errors, oldest date reached. It feeds the README table.

### D17. Workflow
- This chat (the orchestrator) owns the plan and the requirements and writes the session prompts.
- Claude Code implements, in plan mode first, and writes a handoff file per session.
- The repo is public, so the orchestrator can read it. It's made private after FMP has reviewed it.

### D18. Learning notes, private
`learning/` holds Marwan's notes: a glossary plus one note per session, written by Claude Code. It's gitignored, so it's not part of the submission.
**Why:** Marwan must understand, defend and modify every part live; the notes are his study material.

### D19. Schema defaults + extractor default selectors
- `src/publishers.js` has a `DEFAULTS` object (`enabled: false`, `fetcher: { list: 'http', article: 'http' }`, `extract: 'html'`, `label: 'placeholder'`, `delayMs: 1000`, `defaultType`, `selectors: {}`), shallow-merged into every entry.
- `src/blocks/extract-html.js` has `DEFAULT_SELECTORS` built on standard tags (`link[rel=canonical]`, `og:title`, `og:image`, `article:published_time`, `article`). An entry's `selectors` override any of them.
- A selector is a CSS string (use the element's text) or `{ css, attr }` (use an attribute).

**Why:** R-C2 says each entry holds only what differs. Without defaults, all 10 entries would repeat the same fetcher, labeller and meta selectors. Phase 3 swaps the labeller in one place.
**Considered:** fully explicit entries, which are clearer one by one but repetitive and easy to get out of sync; a deep merge, which isn't needed while the nested objects are small.

### D20. `--only` is matched in `run.js`, not in the controller
**Why:** the controller must never compare a publisher name (R-C4). Filtering the list before handing it over keeps the controller fully generic.
**Considered:** an `only` option inside the controller, which would need a `name ===` check in it.

### D21. A failed article is still written, from list data, with `fullText: null` (temporary)
If an article page still fails after the fetcher's retries, the record is built from the feed item (title, date, description), `fullText` is `null`, the error is logged, and the validator reports a **warning** (R-A9).
**Why:** losing the article silently is worse than a visible null. Phase 4 replaces this with the blocking ladder (D13).
**Considered:** skipping the article, which loses data with no trace in the output.

### D22. The validator takes the run time from the output file (replaced by D26)
The window is computed from the modification time of `output/articles.jsonl`, overridable with `--run-at <iso>`.
**Why:** validating hours after a run must not shift the window start and wrongly fail older articles.
**Considered:** a separate `output/run.json`, which means one more output file for one value.

### D23. `defaultType` per entry, placeholder until Phase 3
Every record gets `type: entry.defaultType` (default `general`).
**Why:** R-A11 needs a valid value now. Phase 3 settles the real rule (see the open question below); a per-publisher default is likely to stay as the fallback.

### D24. No `cleanups` registry slot yet
Phase 1 handles noise with declarative `remove` selectors. A `cleanups` registry group is added in Phase 2, when the first real clean-up function exists.
**Why:** don't build an empty extension point.

### D25. The R-C4 structure test scans all of `src/` except the schema
`test/structure.test.js` checks every `.js` file under `src/` except `src/publishers.js` (controller, `run.js`, `blocks/`, `lib/`). It fails on:
- any publisher name or domain (comments included), or
- any comparison on an entry's `name` or `site`, in either direction (`x.name === …`, `x.site.toLowerCase() !== …`, `… === x.name`).

**One allowed exception:** the `--only` line in `src/run.js` (D20), which compares schema names against **user input from the CLI** (`values.only`). Comparing against user input is fine; comparing against a hardcoded name is not. The exception is a single named rule in the test (`run.js` + `values.only`), not a general allowlist.
**Why:** per-site logic must live only in the schema. Checking only the controller would let a site-specific `if` hide in a building block or a helper.
**Considered:** scanning only `controller.js`, which is the R-C4 wording but too narrow for the intent of R-C1/R-C5.

### D26. The validator takes the run time from `output/stats.json` (replaces D22)
`run.js` writes `runAt` (the window's end) to `output/stats.json` in the same run as `articles.jsonl`. The validator reads it from there; `--run-at <iso>` still overrides. It also cross-checks the file: a publisher's `written` in stats must equal its row count in `articles.jsonl` (failure), and an enabled publisher with `windowStartReached: false`, or a `--limit` run, gives an R-D3 warning.
**Why:** a file's modification time changes when the file is copied, checked out or touched, so it's a fragile source for the run time. `stats.json` was needed anyway (D16).
**Considered:** keeping the mtime (D22); a separate `run.json` (one more file for one value).

### D27. CryptoPotato: the given feed is kept, and the WordPress REST API is added for paging back
The feed (`/feed`) ignores `?paged=N`: pages 2 and 3 are byte-identical to page 1 (36 items, ~2 days). A cache-busting param (`?paged=3&x=1`) got a **429 Cloudflare challenge**. The site's WordPress REST API (`/wp-json/wp/v2/posts?per_page=100&page=N`) pages correctly with dates, so it's a second source. The feed stays a source, with no query params added (R-D2: discovery starts from the URLs FMP gave us).
**Why:** R-D2 + R-D3. The REST API is JSON with `link`, `date_gmt`, `title`, `excerpt`: 3 pages cover 14 days.
**Considered:** HTML archive pages (`/page/N/`), which need list selectors and have no machine-readable dates; the Yoast sitemap, which has only `lastmod` (modified date, not published date).

### D28. Paging back: config in the schema, stop logic generic
A source's `paging: { param, maxPages }` says which query parameter holds the page number. `src/lib/paging.js` `discoverPages()` fetches page 1 (the URL as written), 2, 3… and stops on the first of: **window start reached** (the oldest item so far is older than `window.start`), **empty page**, **no new items** (every URL already seen on an earlier page: the site ignores the param), **page error** (page 2+ failed after retries; page 1 failing fails the publisher), or **max pages**. Each source's pages, stop reason and oldest date go to `stats.json`.
**Why:** R-D3, and R-C4 (no per-site code). "No new items" exists because of D27: a site that ignores the param would otherwise be fetched `maxPages` times for nothing.
**Considered:** a paging building block per site type in the registry: more code, and the loop is the same for every query-param site. Path-style paging (`/page/2/`) can be added as a second form of `paging` when a site needs it.

### D29. fullText: spaces at block boundaries, never around inline tags
`extract-html.js` reads each block's text with `textOf(node)`, which adds a space around block-level tags (`p`, `div`, `li`, `td`, `br`, …) and nothing around inline ones (`a`, `span`, `strong`, `sup`). `blockquote` is now a fullText block.
**Why:** cheerio's `.text()` joins text nodes as they are, so `line one<br>line two` → "line oneline two" and `<li><p>a</p><p>b</p></li>` → "ab". Inline tags keep the page's own spaces: adding one around `<a>` would break words split by styling (`x<span>y</span>`). The reported "fund intoAnthropic’s" couldn't be reproduced: the live HTML has a normal space there, and cheerio keeps it.
**Considered:** adding a space around every tag (breaks inline cases); replacing `<br>` before parsing (fixes only one of the cases).

### D30. Discovery per source: a `startUrls` item can override `discover` and `paging`
A `startUrls` item is either a URL string, which uses the entry's `discover` and `paging`, or an object `{ url, discover, paging }` that overrides them for that source. `toSources(entry)` in `src/lib/paging.js` normalizes both forms; `paging: null` on a source means one page only, even if the entry pages. A publisher's `windowStartReached` is true if **any** source reached the window start; dedup across sources is by canonical URL.
**Why:** CryptoPotato needs an RSS source and a REST source (D27), and Phase 4 sites mix source types across their start URLs (Benzinga sitemap + HTML, Newsfile RSS + homepage, Investing.com HTML + RSS). Marwan asked for it at plan review.
**Considered:** one discoverer per entry, with all start URLs of the same type: doesn't fit those sites.

### D31. Every null `fullText` carries a reason: `noBody`, `blocked` or `error`
Articles whose page has no text body (e.g. CryptoPotato `/video/` posts: a title and a JS video player) are **kept**, with `fullText: null`. The controller records why each written article's `fullText` is null:
- `noBody`: the page loaded, but the extractor found no text body.
- `blocked`: the fetch failed with HTTP 401, 403, 429 or 451 (the fetcher now sets `err.status`).
- `error`: any other fetch failure (5xx, timeout, network).

`stats.json` counts them per publisher (`"fullTextNull": { "noBody": 2, "blocked": 0, "error": 0 }`) and lists them (`fullTextNullUrls: [{ url, reason }]`). The validator shows the reason in each R-A9 warning, and **fails** on a null with no recorded reason. The reasons live in `stats.json`, not in `articles.jsonl`, so the deliverable's record shape stays as specified.
**Why:** Marwan: "every article" comes first, and skipping them silently loses data. A null must never be unexplained (R-A9), and the README needs the counts.
**Limit:** a block page served with status 200 (a challenge page) would be counted as `noBody`. Phase 4's blocking ladder (D13) detects those. **Closed by D53** (2026-11-27).
**Considered:** skipping body-less pages (silent data loss); a reason field in each record (changes the deliverable's shape).

### D32. `text` fallback chain: feed/API description → page meta description → first paragraph
`extract-html.js` gained a default `description` selector (`meta[property="og:description"], meta[name="description"]`). `text` is the first non-empty value of: the feed/API item's description, the page's meta description, then the first paragraph of `fullText`. If none exists, `text` is `""` (R-A7 warning).
**Why:** each is the publisher's own summary, never a guess. The meta description helps pages whose feed item has no description.
**Note:** the two CryptoPotato video posts have none of the three, so their `text` stays `""`.
**Considered:** using the title as `text` (that's not a summary, and it duplicates a field).

### D33. TechCrunch: the REST API is added as a second source, after the given feed
Same pattern as CryptoPotato (D27, D30), and schema-only: `startUrls` = the given feed (string, using the entry's `rss` + `?paged=N`), then `{ url: '…/wp-json/wp/v2/posts?per_page=100&_fields=…', discover: 'wp-json', paging: { param: 'page', maxPages: 10 } }`.
**Why:** a URL-by-URL diff against the REST API showed the RSS feed leaves out some posts (`5-desk-gadgets-that-can-make-your-workday-better`, Nov 21, was not in the feed). After the change, all 242 REST posts in the window are in our output, plus 1 feed-only `/video/` post. The cost is 3 extra list requests per run.
**Considered:** the REST API alone (would drop the given start URL, R-D2, and the feed-only video posts).

### D34. Labeller pipeline and models: Haiku 5.5 for both stages
`labellers.llm` (`src/blocks/label-llm.js`), the default in `DEFAULTS.label`:
pre-filter → **classify** (labels + the sentence proving each, symbols as written) → **K4** label check → **extract** (only for the surviving labels) → convert → check → event + trace.
- **Models:** `claude-haiku-5-5` for classify (effort `low`) **and** extract (effort `medium`), all in `src/llm/config.js` with the prompt version, max tokens, prices and concurrency (4 calls in flight per publisher). `LLM_CLASSIFY_MODEL` / `LLM_EXTRACT_MODEL` override them, so `npm run eval` can compare models.
- **Classify input:** title + summary + the first ~6,000 characters of the body, cut at a paragraph break (`topOfBody()`); the trace records `classifyInput: { bodyChars, sentChars, truncated }`. Extract always gets the full article.
- **Cost:** a full 10-site run is estimated at ~$7 (assumes ~15k articles, 50% pass the pre-filter, 20% get a real label). Measured on TechCrunch + CryptoPotato: ~$0.0003 per classify call, ~$0.001 per extract call. `LLM_BUDGET_USD` caps one run's spend; past it, articles get `llmError: budget`.

**Why:** Marwan's API credit is $10; Sonnet for extract would be ~$80 per full run. Labels depend on the subject, which is at the top of the article.
**Considered:** Sonnet 5.5 for extract (better on hard tables, 10× the price; compared in the M2 eval), Opus (2× Sonnet), the Batch API (−50% but async polling) and prompt caching (the ~1k-token system prompt is under the minimum cacheable size): both noted as production options for the README. No server-side model fallback (D38).

### D35. Strict JSON via structured outputs, with a flat extract schema
Both calls use `output_config: { format: { type: 'json_schema', schema } }` on `messages.create` (SDK 1.14), with hand-written schemas in `src/llm/schemas.js`. The reply is read from the `text` block **by type** (Haiku 5.5 thinks by default and can return thinking blocks first), after checking `stop_reason`.
Extract returns a **flat list** `values: [{ field: "dividends.recordDate", raw, evidence }]` (+ `figures[]`, + `ipoAction`) and leaves out what the article doesn't state.

**Why:** the API rejected three earlier shapes, and every failure was caught as `llmError` in the first runs: (1) `enum` + `type: ['string','null']` is invalid; (2) a schema may have at most **16 union-typed fields** (the nested schema had 46 nullable fields); (3) the nested, null-free version was refused as "compiled grammar too large". The flat list has 0 unions, is ~1.4 KB, and the model outputs fewer tokens (no placeholders for unstated fields). `test/checks.test.js` counts the unions so (2) can't come back.
**Considered:** zod + `messages.parse()` (one more dependency for the same guarantee), tool use with `strict: true` (same schema limits), one schema per label combination (more moving parts).

### D36. LLM response cache (CACHE=1)
`.cache/llm/<sha256>.json`, keyed by `model | promptVersion | url | sha256(system + user message + schema + effort + max_tokens)`. Only successful replies (`end_turn`, valid JSON) are cached. A hit costs 0 tokens and is marked `fromCache` in the trace.

**Why:** reruns during development cost nothing, and a run is reproducible: the model is not fully deterministic (fixture 16 flipped `ipos` → `others` when only `max_tokens` changed). Any change to a prompt, schema or setting misses the cache automatically.
**Considered:** keying by url only (stale answers after a prompt change); caching failures (a retry could never succeed).

### D37. Converters: rules that refuse rather than guess
`src/lib/convert.js`, pure functions, each returns `{ value, rule }` or `{ value: null, reason }`:
- `parseMoney` (revenue, market cap): scale words (thousand/k, million/m/mn/mm, billion/b/bn, trillion), currency recorded. A bare number needs a currency AND ≥ 1,000,000; otherwise it's refused, because table values are often "in thousands" (CMB.TECH's `2,026,505` would have been revenue of $2M instead of $2.0B).
- `parsePerShare` (EPS, dividend, offering price): `(0.12)`, `$(0.12)`, `-$0.12` and `loss of $0.12` are negative; `84 cents` → 0.84; a scale word → refused.
- `parseDate`: `December 15, 2026`, `Dec. 15, 2026`, `Sept. 30, 2026`, `15 December 2026`, ISO; slash dates only if unambiguous (`11/05/2026` → null); invalid calendar dates → null.
- **Missing year (`yearInferred`):** a date written without a year ("payable January 15") gets the year that puts it **nearest the article's publishedDate**, and the trace marks it `yearInferred: true` (`trace.result.yearInferred` lists the fields). Explicitly approved by Marwan. It's the only inference the converters make, it's deterministic, and it's always visible in the trace.
- `parseRatio`: N-for-M = N new for M old; number words (`one-for-ten`, `twenty-five`); `one (1) … for every ten (10)`; `3:1`. `splitType` comes from numerator vs denominator, not from the LLM.
- `parsePeriod` (Q1–Q4 / FY; halves and nine months → null), `parseFiscalYear` (`FY26` → 2026; `2025/26` → null).

**Why:** R-E4, R-E8, R-E9, R-E10. Each refusal is a traced null, which beats a plausible wrong number.

### D38. LLM failures are traced and counted, never a silent "others"
If a call still fails after the SDK's retries (API error, credits exhausted, timeout), is refused by the model, hits `max_tokens`, or is skipped by the budget cap, the article gets `labels: ['others']`, its trace has `llmError: { stage, kind: error|refusal|truncated|budget, message }`, `stats.json` counts `llmErrors` per publisher (+ `llmErrorUrls`), and the validator gives a **warning** per article. **No server-side fallback** to another model, so the trace always shows exactly which model produced each value.

**Why:** Marwan, at plan review. In the first run this caught 25 schema rejections, which were visible immediately instead of looking like 25 normal `others`.
**Amended in M2 (Marwan, 2026-11-25):** an **extract** failure keeps the labels classify proved (K4/K11), with one all-null event per label (its `evidence` = the label's own sentence); `llmError: { stage: "extract" }` is traced and counted as before, and the validator warns "labels kept, every event field null". Only a **classify** failure gives `others`. Why: the labels were proven without the extractor, so dropping them lost correct information.

### D39. The code-side checks (K1–K10)
- **K1** each evidence line is in `fullText` word for word (whitespace collapsed in both; nothing else normalized). **K2** each raw value is inside its evidence (case ignored since M2, D45). **K3** the converter can read it. A failure makes that value null, and the reason is traced, e.g. `evidence not found in fullText (first 6 of 22 words match)`.
- **K4** a label stays only if its proving sentence passes K1. The drop rate is in `stats.json` (`labelsProposed`, `labelsDropped`, `labelDropRate`) and in the eval.
- **K5** labels deduplicated and ordered; `others` is added by code, never by the LLM. **K6** exactly one event per label. **K8** the IPO action needs its wording in its sentence ("priced" ← "pric…"). **K9** a split ratio of 1:1 is refused. **K10** `stop_reason` must be `end_turn`.
- The event's `evidence` (D10) is **built by code** from the sentences of the values that passed, in article order, plus the label's own sentence. So every line of it has passed K1.
- Validator additions: R-E1 (every evidence line in fullText), R-E8, R-E9, required event fields, R-J5 shape, the D38 warnings.

### D40. Earnings figure selection by code (D12 in practice) + the figure's period
The extractor lists every EPS/revenue figure with `metric`, `period` (as written), `basis`, `kind`, `perShare`. Each one is proven on its own (K1–K3), then code picks:
- only figures for the event's proven period, or with no period stated; a stated match ranks first;
- `epsActual`: GAAP/IFRS, then basis not stated, never adjusted; diluted, then not stated, then basic. `revenueActual`: GAAP/IFRS, then not stated, then adjusted. Estimates: the first stated.
- **If the event's period is not proven and the figures span several periods → null** (no pick).

**Why:** HP and IES report the quarter AND the full year in one release, and HP lists the full year first. Without the period, the code picked the full-year EPS ($2.62) for a Q4 event (gold $0.84): a wrong value, the worst kind. With these rules the eval has 0 wrong values.
**Considered:** taking the first figure in article order (wrong for HP), asking the LLM to choose (not provable).

### D41. Articles with `fullText: null` are `others`, with no LLM call
There is nothing to check evidence against, so no value could be proven. Traced as `result.why`. **Revisit in Phase 4** for blocked sites, where the feed's title/description may be all we have.

### D42. Fixtures, gold set and eval
`test/fixtures/articles/*.json` = 19 real articles stored as extracted fields (title, text, fullText, publishedDate), not HTML, made with `scripts/make-fixture.js` (15 from GlobeNewswire, 4 from the TechCrunch/CryptoPotato page cache). `test/fixtures/gold.json` = the expected labels and converted values, **drafted by Claude Code by reading the articles, marked "to be verified by Marwan"**. A field can accept several answers (`{ "accept": [a, b] }`) where an article is ambiguous. `npm run eval` runs the real labeller (cache always on) and reports labels (TP/FP/FN, precision, recall, exact set), fields (correct / **wrong** / **missed**), the K4 drop rate, and tokens and cost. It writes `output/eval-<extract model>.json`.

**Why:** "wrong" (a non-null value that isn't the gold) is a hallucination that got through, so it's reported separately from "missed" (a null). The ~50-article gold set (D8) grows in Phase 5 by sampling real output; the script takes any number of fixtures.

### D43. `relatedSymbols` is written in every record (after `symbol`)
An array of strings (`[]` until M2). **Why:** R-J5 / D14. It's an added field; the required ones are unchanged.

### D44. K11, the "subject" rule: on news, a label's sentence must be in the first 3 paragraphs
For an article whose type is **not** `pressReleases`, a label survives only if its proving sentence is in the first 3 paragraphs of `fullText` (paragraphs = `\n\n`, D29). The check is K1 run on the opening text (`evidenceInOpening()` in `src/lib/checks.js`). A dropped label is traced (`labelChecks[].inOpening: false`, `reason: "not in opening (first 3 paragraphs)"`) and counted (`labelsNotInOpening` in stats and the eval). The classify message now starts with `<source>news</source>` or `<source>press release</source>`, and the prompt says: news → copy the sentence from the first three paragraphs, or give no label; press release → copy the sentence that announces the event, wherever it is.
**Why:** R-L1. K4 proves a sentence *exists*, not that it's the subject. In the M1 run, CryptoPotato recaps got `ipos` from sentences in paragraphs 2–10.
**Why news only (Marwan, plan review):** in a company's own release, everything it announces is its subject, and releases put highlights as one-line bullets, each its own paragraph. HP's dividend increase is in paragraph 11, and CMB.TECH's distribution in paragraph 6. Applied to every article, the rule would have dropped both gold `dividends` labels (recall 100% → 50%).
**Considered:** 3 paragraphs everywhere (the regression above); "the first ~1,500 characters" (keeps HP and CMB, but lets in more deep mentions on news).
**Measured (eval, 19 fixtures):** K11 dropped 0/21 labels, and the labels are unchanged (17/19). The opinion piece (fixture 19) still gets `ipos`, because its IPO sentence *is* in its opening, so this fixture is a judgment call for the prompt, not for K11. The effect on the real news run is in handoff 03 (M2).

### D45. Evidence comes from the body only; K2 ignores case
- The extract prompt says: copy evidence from the article body, never the title. K1 already rejects a title sentence, because the title isn't in `fullText`; the prompt now says so, so the value isn't lost (T3's period/year were lost this way in M1).
- **K2** (raw value inside its evidence) compares lowercased text. The model writes "fourth quarter" for "Fourth quarter" (HP in M1). **K1 stays exact** (whitespace only), so the sentence is still verbatim. The case-insensitive match only decides whether a value is *in* a sentence that is already proven.
**Why:** both were measured misses in M1 with no risk of a wrong value. Marwan's decision.

### D46. Symbols: K7, a ticker regex, the FMP suffix table
`src/lib/symbols.js`:
- **K7:** a ticker the classifier proposes is kept only if its sentence passes K1, the ticker is in that sentence as a whole word (case-sensitive), and the exchange, if given, is in it too. So "NVDA" for an article that never writes NVDA (fixture 18) → null.
- **Regex `findTickers()`:** `(Exchange: TICKER)` pairs inside brackets, including several listings in one bracket (`(NYSE: CMBT, Euronext Brussels: CMBT and Euronext Oslo Børs: CMBTO)`) and a bare ticker that keeps the previous exchange (`(Nasdaq: SENEA, SENEB)`). A pair counts only if the exchange is in the table.
- **symbol:** the classifier's K7-proven main ticker. With **no classifier answer** (pre-filter skip, no fullText, or a classify failure), the first regex ticker in the first 3 paragraphs (answers the open question on articles that skip the LLM). If the classifier says null ("not about one company") or its ticker fails K7 → null: the code doesn't override the subject judgment with a guess.
- **relatedSymbols:** the K7-proven classifier tickers + every regex ticker, main first, deduplicated.
- **FMP format:** exchange → code → suffix. US (NASDAQ, NYSE, NYSE American/Arca, Cboe, OTC): none. TSX `.TO`, TSXV `.V`, CSE `.CN`, Cboe Canada `.NE`, LSE `.L`, XETRA `.DE`, Frankfurt `.F`, Paris `.PA`, Amsterdam `.AS`, Brussels `.BR`, Milan `.MI`, SIX `.SW`, ASX `.AX`, HKEX `.HK`, Tokyo `.T`, NSE `.NS`, Oslo `.OL`, Stockholm `.ST`. A dot inside a ticker becomes `-` (`BRK.B` → `BRK-B`, `REI.UN` on TSX → `REI-UN.TO`). If the classifier gives no exchange, the exchange the regex found for the same ticker is used. No exchange written anywhere → the ticker as written. An unknown exchange → null (a ticker without its suffix would be a wrong symbol).
- **Verification status:** `.L`, `.DE`, `.MI` were checked in M1. **FMP's docs site returned 403 to our fetcher (2026-11-25), so the rest, and the `-` for share classes, are unverified**: they follow the Yahoo-style convention FMP uses. To verify: one FMP `search-symbol` call per suffix with an API key (Marwan / FMP).
**Why:** R-A10, R-J5, D14. **Considered:** trusting the LLM's symbol (it can name a ticker the article never writes); regex only (misses "under the ticker symbol "ANT"" in news).

### D47. The `type` rule
`src/lib/type.js`, `typeOf(entry, symbol)`: the publisher's `defaultType` decides (`pressReleases` for the wires GlobeNewswire, Business Wire and Newsfile, `crypto` for CryptoPotato), except that on a `general` publisher an article with a **proven main symbol** is `stock`.
**Why:** R-A11; the gold set (a TechCrunch IPO story with ticker ANT is `stock`, a CEO story with no ticker is `general`). The rule is deterministic and traced (`trace.type.rule`).
**Not yet:** forex. Investing.com's forex stories will need a URL-based override in its schema entry (Phase 4), added only when that entry is built.

### D48. Earnings `time` / `timeExact` in practice (D11)
`src/lib/time.js` + `earningsTime()` in the labeller, in this order:
1. **Stated in the article** (the extractor's `earnings.time`, proven by K1/K2): wording ("before the market opens", "pre-market", "after the close", …) → `bmo`/`amc`. A clock time with a timezone ("4:05 p.m. ET", EST/EDT/CT/PT/GMT/UTC/CET…) on the **proven** results date → `timeExact` in UTC (New York daylight saving time via `Intl`, no dependency). With no wording, a clock time gives `bmo`/`amc` only for a US listing (before 9:30 / from 16:00 ET). No proven date → `timeExact` null, traced.
2. **Press-release rule:** if nothing is stated, and the article is `pressReleases`, the main symbol is on a US exchange, at least one **actual** figure is proven (it reports results; it isn't a date announcement), and the results date is unstated or equals the publish day in ET → the publish time in ET gives `bmo`/`amc`, or null during market hours. `timeExact` stays null (D11: only stated times).
3. Otherwise null. A news article's publish time is never used.
**Why:** R-J3. Checked against the gold: IES 7:45 ET → bmo, T3 9:10 → bmo, HP 16:15 → amc, Johnson Outdoors "before market open" (its 12:48 ET publish time is a date announcement, so the rule doesn't apply). The eval scores `time` and `timeExact` 7/7.
**Considered:** applying the market-hours rule to Canadian listings too (same hours; not in D11, so left out).

### D49. `figures[]` in the earnings event, and how the eval scores it
Every **proven** figure (passed K1–K3) is written as `{ metric, value, period, basis, kind, perShare, evidence }`. `period` is converted (`Q1`–`Q4`/`FY`/null), and `basis`/`perShare` are null when not stated. The validator checks each figure's enums, its number and its evidence (R-E1). `parsePeriod` now reads a bare "fiscal 2026" as `FY` (like "FY2026"); "same quarter of fiscal 2025" stays null.
**Eval:** the gold lists **key** figures per earnings fixture (21 across 5 fixtures, DRAFT): each must be in the output with the same metric + value (found), else the value is there with a wrong period/basis/kind (mislabelled), else missed. A gold attribute can list several accepted values.
**Why:** R-J4 / D12. Listing every figure of a 400-paragraph release by hand would be slow and error-prone; the key figures are the ones a wrong label would hurt.

### D50. Haiku vs Sonnet for extract: Haiku stays
Same fixtures, same classify (Haiku), prompt v2:

| extract model | fields correct / wrong / missed | key figures found | extract cost (17 calls) |
|---|---|---|---|
| claude-haiku-5-5 | 126 / 0 / 4 | 20 / 21 | ~$0.03 |
| claude-sonnet-5-5 | 126 / 0 / 4 | 21 / 21 | $0.39 |

Sonnet gets Nvidia's `period`, `calendarYear` and figure period (Haiku misses them), but misses `calendarYear` on T3 and CMB.TECH (Haiku gets them). One run each; the models aren't fully deterministic. **Decision: Haiku for both stages (D34 stands).** About 13× the cost for one more key figure, with the same field accuracy, doesn't pay on a $10 budget.

### D51. Publishers run in parallel; one LLM limiter for the whole run
- `runAll` starts every enabled entry at once (`Promise.all`) and joins the results **in schema order** (records and `stats.json` keys), whatever order they finish in. Inside a publisher nothing changes: list pages and article pages are still fetched **one at a time** with the entry's `delayMs`, so each site sees exactly the same load as before.
- **One shared LLM limiter** (`createLimiter(LLM_CONCURRENCY)` in `src/lib/pool.js`, created once in `runAll`): at most `LLM_CONCURRENCY` articles (default 4, `src/llm/config.js`, env `LLM_CONCURRENCY`) are being labelled at once across **all** publishers. An article's calls (classify, then extract) run one after another, so that is also the maximum number of LLM calls in flight. It replaces the per-publisher `CONCURRENCY = 4`, which would have become 4 × 10 = 40 calls in flight with parallel publishers.
- A source whose page 1 fails (e.g. blocked) no longer fails the whole publisher: it's recorded in `stats.sources[].error` with `pagingStop: "page 1 failed"`, the other sources still run, and the validator shows a warning.

**Why:** the wires are thousands of articles each (GlobeNewswire ~6,000 in 14 days). Sequentially, three sites alone would take ~8 h; in parallel the run takes about as long as the slowest site. Marwan chose 1 request at a time per site (politeness unchanged) and asked for the global LLM limit now, because new API accounts have low rate limits.
**Considered:** 2 requests at a time per site (faster, more block risk; not now); a limiter per publisher (multiplies with parallel publishers).

### D52. Dev switches: `LABEL=placeholder` and `--sample N`
- `LABEL=<labeller>` (env) runs **every** selected entry with that labeller, so `LABEL=placeholder` makes a run with no LLM calls and no API key. It applies to all entries alike (no site is special-cased), is printed on the "Window:" line, written to `stats.json` (`label`), and the validator warns that labels aren't real.
- `--sample N`: after **full** discovery (every list page, so `windowStartReached` and `inWindow` are exact), only N articles are fetched, spread evenly over the date-sorted list (`spreadSample()`: the newest, the oldest, and evenly in between). `--limit N` still means "the newest N". `stats.json` gets `sample` and per-publisher `processed`; the validator warns that it's not a full collection.

**Why:** Phase 4 verifies each site's coverage and selectors without the cost of a full extraction (thousands of page fetches) or the LLM ($10 budget). Marwan: the full run of all sites happens once, in Phase 5. `--limit` alone can't show the oldest days.

### D53. Block and challenge pages are detected, even with status 200 (closes the D31 limit)
`src/lib/blocked.js` `blockReason({ status, headers, body })` says why a response is a block, or null:
- status 401/403/429/451;
- a vendor header that marks a challenge: `x-amzn-waf-action` (AWS WAF, e.g. Newsfile's 202 challenge), `cf-mitigated` (Cloudflare);
- on **small pages only** (< 30 KB, where challenge pages live), a block-page `<title>`: "Just a moment…", "Attention Required! | Cloudflare", "Access Denied", captcha / verify-you're-human wording, or the AWS WAF challenge script.

The fetcher throws with `err.blocked = true` (and doesn't retry a 200/202 challenge), so the controller counts the article as `blocked`, not `noBody`, and the dev cache never stores a challenge page. Generic: it names bot-protection vendors, never a publisher.
**Why:** D31's open limit; Phase 4 sites serve challenges with 202 (AWS WAF) and 403 (Cloudflare).
**Considered:** checking the whole body for "captcha" (an article about captchas would be flagged; the size limit prevents that).

### D54. An `html-list` discoverer, configured in the schema, and `parseListDate()`
`src/blocks/discover-html-list.js` reads any HTML page that lists articles. What to read comes from the schema: `list: { item, link, title?, date?, description?, dropQuery? }` (CSS selectors), on the entry or on one source (`toSources` passes `source.list`; discoverers now get `discover(body, url, source)`, the old ones ignore the third argument). `dropQuery` removes `?…` from links (Newsfile's search adds `?k=`, which would make the same release look like a second URL).
List dates go through `parseListDate()` in `src/lib/time.js`: a wall time **with a written zone** ("2026-11-27 11:05 AM EST", "November 27, 2026 10:30 ET") is converted with the zone tables D48 already uses (New York DST via `Intl`); an ISO/RFC date must carry its offset. A date with no zone → null, never guessed.
**Why:** Newsfile and GlobeNewswire both list releases only as HTML, and R-C4 forbids per-site code. **Considered:** one discoverer per site (per-site code); regex over the HTML (fragile).

### D55. A browser fetcher (Playwright), chosen per entry or per source
`src/blocks/fetch-browser.js`, `fetchers.browser`: one headless Chromium for the run (launched on first use, closed by `run.js` via `closeBlocks()`), one context (cookie jar) and tab per entry. It sends a normal Chrome User-Agent, loads the page, and waits up to 20 s while `blockReason()` (D53) says it's a challenge; challenge pages solve themselves and reload. An empty body means "still reloading", never "empty page"; after a challenge it waits for the full `load` and reads again. Still blocked → `err.blocked`; retries with backoff like http.
A source may now set `fetcher` (default: the entry's `fetcher.list`), so one publisher can read its feed over HTTP and its HTML lists through the browser.
**Why:** D13 step 3. Newsfile's `www` answers every plain request with an AWS WAF JavaScript challenge (202). (Benzinga's Cloudflare blocks plain HTTP and, after one page, the browser too: D62. The browser is still used for its `/news` list page.) Playwright was planned in D3 and approved by Marwan on 2026-11-27.
**Found while building it:** (1) Benzinga's Cloudflare blocks headless Chromium when it says "HeadlessChrome" in its User-Agent; with a normal Chrome UA it lets the first page of a session through and then blocks the session (D62). (2) Reading the page while the challenge reloads it returned an empty body, which the list discoverer would read as "no items" (seen on a fresh session's first search page); fixed as above. Newsfile's early paging stop at page ~37 had a second cause, a rate limit (D59).
**Considered:** solving the challenge once in the browser and reusing its cookie over plain HTTP (the WAF also checks the client fingerprint, and it mixes two fetchers in one request path); a headed browser (opens windows; kept as a debug switch, `BROWSER_HEADED=1`).

### D56. Newsfile: the site's keyword-less search pages back 14 days
Sources: the given feed (`rss`, 25 releases ≈ 2 hours, English and French, HTTP), the given homepage ("Today's Top Releases", 5 items, browser), and the added `https://www.newsfilecorp.com/search?k=` (browser, `html-list`, `paging: { param: 'pg', maxPages: 150 }`): every release, newest first, 25 per page, with "2026-11-27 11:05 AM EST" dates. Article pages through the browser.
**The release page has no machine-readable publish date** (no `article:published_time`, no JSON-LD; only the dateline "November 27, 2026"), so `publishedDate` is the list date (feed `pubDate` or the search list time), with `selectors.publishedDate: null`. French releases are kept, like GlobeNewswire's other languages (Marwan, 2026-11-27).
**Why:** the feed covers ~2 hours. **Considered:** `/sitemap-news.php` (5,000 release URLs but no dates, so paging can't stop at the window start and every URL would need a page fetch); `/news/<industry>?pg=N` (one industry each); release IDs (sparse: 476 IDs for 25 releases).

### D57. GlobeNewswire: page the unfiltered search, despite robots.txt
Sources: the two given URLs fetched exactly as written (`paging: null`: `24HOURS?pageSize=10` = 10 releases, `subject/prs` = 10), plus the added date-range search `…/en/search/date/[{from} TO {to}]?pageSize=50` in 3-day slices (D60): every release in every language, newest first, 50 per page (the site's maximum). All three use `html-list` (same page layout). HTTP works (Node's fetch gets 200; curl gets Akamai 403). Article date: `og:article:published_time`; body `[itemprop="articleBody"]`, which holds only the release text.
**robots.txt says `Disallow: /en/search`**, and FMP's given start URLs are `/en/search` pages. Marwan's decision (2026-11-27): page `/en/search`, because FMP gave those URLs, at 1 request a second, one at a time, and log the conflict (SITES.md, README).
**All languages** (Marwan): the given 24-hour URL lists them (~7% are French, German, Indonesian…). Most fail the English pre-filter and become `others` with no LLM call: a known limit for the README.
**Why:** R-D2 + R-D3. **Considered:** `7DAYS` (stops at 7 days); a date range in the URL (not supported: `/en/search/date/2026-11-13` → 0 results); the sitemaps (robots-allowed, but the current month's file is empty until the month ends, `latest.xml` holds ~1 day and the Google News sitemap 2 days); `/en/search/lang/en` (English only).

### D58. A `sitemap` discoverer; `lastmod` is a list date, never a publish date
`src/blocks/discover-sitemap.js` reads a `<urlset>`: `publishedDate` only from a Google News `<news:publication_date>`, `title` from `<news:title>`. `<lastmod>` goes to `listDate`. `listDateOf(item)` (= `publishedDate ?? listDate`, `src/lib/paging.js`) decides paging stops and the window pre-filter; the article page's own date decides at the end.
- lastmod ≥ the publish date, so a pre-filter on it never drops an in-window article. It can let in an old article edited recently: fetched, then dropped by its page date (`droppedOutsideWindow` in stats).
- An article with **no provable publish date** (e.g. blocked, and listed only with a lastmod) is **not written** (a guessed date would break R-D1 silently), but it is counted and listed (`droppedNoDate`, `droppedNoDateUrls`) and the validator shows each one.

Benzinga sources: the given Google News sitemap (~340 articles, 2 days, publish dates), the given `/news` (browser, `html-list`, ~25 cards without dates), and the added `latest.xml` from robots.txt (10,000 URLs ≈ 5 weeks, sorted by lastmod, one HTTP request). Articles through the browser with `delayMs: 2000`.
**Why:** R-D3; the Google News sitemap covers 2 days by design. **Considered:** the monthly archive sitemaps (no dates at all); `/feed` (full bodies, but 25 "top stories" and it ignores `?page`); paging `/news` (cards have no dates, and it needs the browser for every page).

### D59. Rate-limited list pages: recognized, paced, retried after a pause
Newsfile's search answers ~37 quick requests (~1 a second), then serves a normal-looking page with **no results** and the text "Our public search function is currently experiencing unusually high demand. Please try again in a few minutes." Paging read it as an empty page (= the end of the list) and stopped at Nov 21, short of the window start. Three generic, schema-driven fixes:
- `list.blockedText` (html-list): a page containing that text throws `{ blocked, rateLimited }`, so it is never "empty".
- A source can set its own `delayMs` for its list pages (fetchers take an optional `opts.delayMs`): Newsfile's search uses 4,000 ms; its article pages keep the entry's pace.
- `discoverPages` retries a **rate-limited** page (HTTP 429 or `rateLimited`) after a 90 s pause, up to 3 times (D13 step 4), counted as `blockedRetries`; then it stops with `page error`, never `empty page`. A hard block (e.g. Cloudflare 403) is not retried: it isn't lifted in minutes.
**Why:** R-D3; it also stops a silent coverage loss from looking like a normal end of list. **Considered:** treating every empty page after page 1 as an error (true for these lists, but a real last page would then look like a failure); a fixed long delay for every source (slows every site for one site's limit).

### D60. Date-sliced sources, for searches that cap their results
A source may set `sliceDays: n` and put `{from}` / `{to}` (YYYY-MM-DD, UTC days, both inclusive) in its URL. `toSources(entry, window)` turns it into one source per n-day slice of **this run's** window, newest first (`sliceByDate()` in `src/lib/paging.js`); each slice pages on its own. A slice is **complete** only if its paging ran out of results (`empty page`); any other stop (the site's result cap shows as `no new items`, `max pages`, an error) is a hole, logged, recorded per source (`slice`, `sliceComplete` in `stats.json`), and makes `windowStartReached` false.
**Why:** GlobeNewswire's search returns at most **5,000 results (100 pages of 50)**; page 101 repeats earlier results. The unfiltered search therefore reached only 2026-11-19 (8 days), and 14 days hold ~9,900 releases. Its date filter takes a custom range, `/en/search/date/[2026-11-13 TO 2026-11-20]`, so 3-day slices (874–3,323 each on 2026-11-27) cover the window under the cap. The window moves with the run time, so the dates can't be written into the schema: hence the template.
**Considered:** 2-day slices (more requests; 3 days leaves a 1.5× margin on the busiest days, and the completeness check catches an overflow); filtering by language or subject (overlapping facets, and no way to prove they cover everything); the sitemaps (D57).

### D61. A circuit breaker for blocked article pages
After **5 article pages blocked in a row**, a publisher's remaining articles are not requested: each is written from its list data with `fullText: null`, reason `blocked` (as if fetched and refused), and counted in `notFetchedAfterBlocks` (stats, log line, one validator warning). Any successful page resets the count.
**Why:** CLAUDE.md rule 7 (be polite). With Benzinga's articles blocked, a run would otherwise send ~2,800 requests that all get 403, for nothing. **Considered:** fetching everything anyway (load on the site, ~1.5 h of 403s); a per-site "don't fetch articles" schema flag (hides the block instead of showing it each run).

### D62. Benzinga: stop at the legitimate ladder; articles are written from sitemap data
Ladder (all logged in SITES.md): plain HTTP → 403 (Cloudflare "Sorry, you have been blocked"), also with full browser headers and on AMP; headless Chromium with its default UA → 403; with a normal Chrome UA → **the first page of a session loads, then every page is 403**: Cloudflare's script runs on that first page, sees `navigator.webdriver = true`, sets `cf_clearance`/`__cf_bm`, and the session is blocked (also 75 s later). A 15-minute search for other official routes with publish dates found none beyond the Google News sitemap's 2 days (details in SITES.md).
**Decision (Marwan, 2026-11-27):** no stealth (hiding `navigator.webdriver` / `AutomationControlled`) and no fresh browser session per article. Both were considered and **rejected**: they deliberately defeat a block the site set on purpose. Articles go over plain HTTP (blocked fast, then the D61 breaker), and each is written from sitemap data: url, title, publish date, image (`<image:loc>`, now read by the sitemap discoverer; the extractor falls back to the list's image), `fullText: null`, reason `blocked`, `others` with no LLM call (D41).
- Only articles with a **provable publish date** are written: those in the Google News sitemap (~340, the last ~2 days). The ~2,400 other in-window URLs come from `latest.xml` with only a `lastmod`; they are counted and listed (`droppedNoDate`, D58), never written with a guessed date.
- **The production approach** is FMP's proxy network (D13 mentions a proxy setting) or Benzinga's licensed news API. The schema keeps the article selectors (`h1.article-title`, `.article-content-body-only`, remove list), verified on pages loaded before the block, so switching the article fetcher is a one-line change.
**Why:** R-J2 asks for real effort, and this is it, documented; CLAUDE.md rule 7 and Marwan's call set the limit.

---

## Open questions (decide in the phase noted)
- ~~**Phase 3:** which Claude model(s); prompt structure.~~ Decided: D34, D35.
- ~~**Phase 3:** `symbol` and `type` for articles that skip the LLM.~~ Decided: D46 (regex in the opening), D47.
- ~~**Phase 3:** the `type` rule.~~ Decided: D47. Forex override: Phase 4, with the Investing.com entry.
