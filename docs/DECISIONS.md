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
**Limit:** a block page served with status 200 (a challenge page) would be counted as `noBody`. Phase 4's blocking ladder (D13) detects those.
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
**Note:** an extract failure also gives `others`, even though the classify labels were proven. That follows Marwan's rule, and it's listed as an open question in handoff 03.

### D39. The code-side checks (K1–K10)
- **K1** each evidence line is in `fullText` word for word (whitespace collapsed in both; nothing else normalized). **K2** each raw value is inside its evidence. **K3** the converter can read it. A failure makes that value null, and the reason is traced, e.g. `evidence not found in fullText (first 6 of 22 words match)`.
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

---

## Open questions (decide in the phase noted)
- ~~**Phase 3:** which Claude model(s); prompt structure.~~ Decided: D34, D35.
- **Phase 3:** `symbol` and `type` for articles that skip the LLM: from site metadata and ticker patterns like `(NASDAQ: ABC)`, or `null`.
- **Phase 3:** the `type` rule: a default per publisher in the schema, overridden by content (e.g. a forex story on Investing.com).
