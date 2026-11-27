# Handoff 04: Remaining sites, session A (Newsfile, GlobeNewswire, Benzinga)

> Written by Claude Code, for the orchestrator (Claude in a separate chat, who cannot see the code). Updated per site.

## 1. Goal of this session
Phase 4, session A: Newsfile, GlobeNewswire, Benzinga, in that order. For each: a route covering 14 days (given start URLs kept, added routes as extra sources, D30), schema config, the blocking ladder (D13) logged, verification by **full discovery + a 100-article sample** (`--sample 100`, `LABEL=placeholder`), and one `--limit 10` labelled sample (`LLM_BUDGET_USD=0.3`). Marwan's plan review: publishers in parallel at 1 request/site, **one global LLM limiter** (4), Playwright approved, GlobeNewswire in all languages and via `/en/search` despite robots.txt, no full extraction runs (Phase 5 does one).

## 2. What was done
**Step 0 (engine, commit `e76acff`):**
- `src/controller.js`: publishers run in parallel (`Promise.all`), results and stats in schema order; a source whose page 1 fails is isolated (`pagingStop: "page 1 failed"`); `--sample` via `spreadSample()`; `processed` count; the run-wide LLM limiter.
- `src/lib/pool.js`: `createLimiter(max)` replaces `mapLimit`. `src/llm/config.js`: `LLM_CONCURRENCY` (default 4, env override) replaces the per-publisher `CONCURRENCY`.
- `src/lib/blocked.js` (new): `blockReason({ status, headers, body })` + `BLOCKED_STATUSES`. `src/blocks/fetch-http.js` throws `err.blocked` on challenge pages served with 200/202 and doesn't retry them.
- `src/run.js`: `LABEL=<labeller>` env switch, `--sample N`, `stats.json` gets `sample` and `label`. `scripts/validate.js`: warnings for sample/label runs and for failed sources.
- Tests: `test/blocked.test.js` (new, 6), `test/controller.test.js` (+4).

**Step 1 (Newsfile):**
- `src/blocks/fetch-browser.js` (new): Playwright fetcher, `fetchers.browser`; `closeBlocks()` in `src/blocks/index.js`, called by `run.js` in a `finally`.
- `src/blocks/discover-html-list.js` (new): `discoverers['html-list']`, schema-configured (`list: { item, link, title, date, description, dropQuery, blockedText }`).
- `src/blocks/discover-sitemap.js` (new, used by Benzinga): `discoverers.sitemap`.
- `src/lib/time.js`: `parseListDate()` (uses the existing `toUtc`). `src/lib/paging.js`: sources carry `fetcher`, `list`, `delayMs`; `listDateOf()`; discoverers get `(body, url, source)`; rate-limited list pages are paused and retried.
- `src/controller.js`: per-source list fetcher; `listDateOf` for the window pre-filter; `droppedOutsideWindow`, `droppedNoDate(+Urls)`.
- `src/publishers.js`: Newsfile entry enabled.
- `package.json`: `playwright` ^1.65.1.
- Tests: `test/discover-list.test.js` (new), `test/paging.test.js` (+3), `test/controller.test.js` (+1), `test/structure.test.js` (each source's fetcher must exist). **91 tests.**
- Docs: DECISIONS D51–D59 (+ D31 closed), SITES (Newsfile; a CryptoPotato 403 note), GLOSSARY, CLAUDE.md commands.

**Step 2 (GlobeNewswire):**
- `src/lib/paging.js`: `toSources(entry, window)` expands **date-sliced sources** (`sliceDays`, `{from}`/`{to}` in the URL) via `sliceByDate()` (D60).
- `src/controller.js`: per-slice `slice` + `sliceComplete` in stats; `windowStartReached` is false if any slice is incomplete.
- `src/blocks/fetch-browser.js`: a 4xx block page no longer waits 20 s or retries (only uncleared challenges, 429 and 5xx are retried). Found on Benzinga: each 403 cost 75 s.
- `src/publishers.js`: GlobeNewswire enabled: given URLs (one page each) + 3-day date slices; `remove` for the attachments list.
- Tests: `test/paging.test.js` (+1 slices), `test/controller.test.js` (+1 incomplete slice). **93 tests.**
- Docs: D57 updated, D60, SITES (GlobeNewswire).

## 3. How it works
**Parallel publishers, one LLM limiter (`controller.js`):**
```js
const llmLimit = createLimiter(LLM_CONCURRENCY);                 // shared by every publisher
const outs = await Promise.all(publishers.map(async (entry) => { … runPublisher(entry, { …, llmLimit }) … }));
// inside runPublisher, labelling:
const results = await Promise.all(articles.map((article) => llmLimit(async () => label(article, entry, ctx))));
```
**Challenge pages (`lib/blocked.js`):** status 401/403/429/451 → blocked; header `x-amzn-waf-action` / `cf-mitigated` → blocked; on pages < 30 KB, a block-page `<title>` ("Just a moment", "Attention Required", "Access Denied", captcha…) or the AWS WAF script → blocked.

**Browser fetcher (core loop):**
```js
await tab.page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
await read();                                         // waitForLoadState + content() + blockReason()
while ((blocked || !body) && Date.now() < deadline) { waited = true; await sleep(500); await read(); }
if (waited && !blocked) { await tab.page.waitForLoadState('load'); await read(); }   // after the challenge's reload
if (!body) throw new Error('no page content …');      // never "a page with no items"
if (!blocked && status < 400) return { url: tab.page.url(), body };
```
One Chromium per run, one context + tab per entry (cookie jar keeps the WAF token), normal Chrome User-Agent.

**Newsfile schema entry (shortened):**
```js
{ name: 'Newsfile', enabled: true, defaultType: 'pressReleases',
  fetcher: { list: 'http', article: 'browser' },
  startUrls: [
    { url: 'https://feeds.newsfilecorp.com/global/Last25Stories', discover: 'rss', paging: null },
    { url: 'https://www.newsfilecorp.com/', fetcher: 'browser', discover: 'html-list', paging: null,
      list: { item: 'section.nf-section-skytint figure.nf-tiles-logo', link: 'a', title: 'h5', date: 'p' } },
    { url: 'https://www.newsfilecorp.com/search?k=', fetcher: 'browser', discover: 'html-list',
      paging: { param: 'pg', maxPages: 150 }, delayMs: 4000,
      list: { item: 'article.nf-tiles figure', link: 'h3 a', date: 'p.date:last-of-type', description: 'p[lang]',
              dropQuery: true, blockedText: 'Our public search function is currently experiencing unusually high demand' } },
  ],
  selectors: { body: 'article#release', publishedDate: null /* no date on the page: list date */, remove: [ … 6 rules ] } }
```
**GlobeNewswire entry + date slices (D60):**
```js
startUrls: [
  { url: 'https://www.globenewswire.com/en/search/date/24HOURS?pageSize=10&page=1', paging: null },
  { url: 'https://www.globenewswire.com/en/search/subject/prs', paging: null },
  { url: 'https://www.globenewswire.com/en/search/date/%5B{from}%20TO%20{to}%5D?pageSize=50',
    sliceDays: 3, paging: { param: 'page', maxPages: 100 } },
],
discover: 'html-list',
list: { item: '.recentNewsH li', link: '.mainLink a', date: '.date-source span:first-child', description: '.newsTxt' },
// toSources(entry, window) → [2026-11-25 TO 2026-11-27], [2026-11-22 TO 2026-11-24], …, [2026-11-13 TO 2026-11-15]
// a slice counts as complete only if its paging ends on "empty page"; otherwise windowStartReached = false
```
**Paging retry on a rate limit (`lib/paging.js`):**
```js
const { body } = await fetchList(url, entry, { delayMs: source.delayMs });
found = discover(body, url, source);                  // throws { blocked, rateLimited } on blockedText
… catch (err) { if ((err.rateLimited || err.status === 429) && attempt < 3) { await sleep(90_000); continue; } … }
```

## 4. Decisions made (all in `docs/DECISIONS.md`)
- **D51** parallel publishers + one global LLM limiter + isolated sources (Marwan's review: the global limit now).
- **D52** `LABEL=placeholder`, `--sample N` (Marwan's review: sample extraction, full discovery).
- **D53** block/challenge detection with 200/202 (closes D31's limit).
- **D54** `html-list` discoverer + `parseListDate()` (no zone → null).
- **D55** browser fetcher (Playwright, approved), per-source fetcher.
- **D56** Newsfile route: keyword-less search, list date as publish date (the page has none).
- **D57** GlobeNewswire: `/en/search` despite robots.txt, all languages (Marwan).
- **D58** `sitemap` discoverer; lastmod only as a list date; `droppedNoDate`.
- **D59** rate-limited list pages: `blockedText`, per-source `delayMs`, 90 s pause × 3.
- **D60** date-sliced sources (GlobeNewswire's search caps at 5,000 results).
Numbering differs from the plan (it said D52 = GNW route, D53 = browser): dev switches and block detection got their own entries.

## 5. Deviations from the plan or the docs
- **Newsfile needed a rate-limit fix the plan didn't foresee** (D59): its search stops answering after ~37 quick pages. Found because paging "ended" at Nov 21 with `windowStartReached: false`.
- `mapLimit` was removed (nothing else used it); `createLimiter` replaces it.
- Two browser-fetcher bugs found and fixed during the Newsfile run (empty body during the challenge reload; half-loaded page). See D55.
- **GlobeNewswire needed date slices** (D60), not one paged search: the search caps at 5,000 results, and the window holds ~9,900 releases (more than the ~6,000 estimated at plan time).

## 6. Requirements covered
- **R-D2/R-D3** (M + stats): Newsfile given URLs kept, `windowStartReached: true`, oldest 2026-11-12T22:55Z.
- **R-D4** (M): a failing source/publisher no longer stops others (test).
- **R-A9 / D31** (T + V): challenge pages → `blocked` (tests).
- **R-C4** (T): structure test passes with 4 new building blocks; each source's fetcher is checked.
- **R-J1/R-E\*** unchanged; the labelled sample validates with 0 failures.

## 7. How to verify
```
npm test                                                     # 91 pass
$env:CACHE=1; $env:LABEL='placeholder'; npm start -- --only Newsfile --sample 100   # ~9 min (83 search pages at 4 s)
npm run validate                                             # PASS, warnings: --sample, LABEL
$env:LABEL=''; $env:LLM_BUDGET_USD='0.3'; npm start -- --only Newsfile --limit 10
```

## 8. Results
**Newsfile (2026-11-27, window 2026-11-13T00:00Z → run):**
- Sources: feed 25 (oldest 11-27 13:49Z), homepage 5, search **83 pages → window start reached**, 2,075 items. **Discovered 2,082, in window 2,068.** Discovery ~8 min.
- Sample 100 (spread newest → oldest): 100 written, **0 fullText null**, 0 errors, 0 no-date; fullText 1,072–20,692 chars (median 4,661). Spot-checked newest (Nov 27, Rosen/ENSG, Kaplan Fox/FMC) and oldest (Nov 13 00:00Z Gold Springs, Nov 13 03:52Z Rosen/Everest): clean start at the dateline, clean end. One extra clean-up rule added after the check (`p:contains("To view the source version…")`).
- Validate: PASS, 0 failures (warnings: sample, LABEL).
- Labelled `--limit 10`: pre-filter passed 8/10, labels earnings 2 (Trans Mountain Q3, EN + FR), others 8, K4/K11 drops 0, LLM errors 0, **$0.0087** (10 calls). Symbols with FMP suffixes: `BEZ.AX`, `PCD-UN.TO`, `ENSG`, `AMD`.
- **Full-run LLM estimate for Newsfile:** 2,068 × ~$0.00087 ≈ **$1.8** (wire pre-filter pass rate 80% here vs 43% on news sites).

**GlobeNewswire (2026-11-27):**
- Sources: 24HOURS 10, subject/prs 10, 5 date slices all **complete** (35/46/39/69/19 pages; 1,649 / 2,189 / 1,847 / 3,323 / 874 releases). **Discovered 9,882, in window 9,882**, `windowStartReached: true`. Discovery ~210 pages, ~6 min, no blocking.
- Sample 100: 100 written, 0 fullText null, 0 errors; 84–43,646 chars (median 5,667); en 92, fr 5, da 1, de 1, ko 1. Spot-checked newest (Vallourec, ResearchAndMarkets) and oldest (TEMAI, Condor Q3): clean. Attachment lists removed after the check (12 of 100 changed).
- Validate PASS (warnings: sample, LABEL).
- Labelled `--limit 10` (Thanksgiving Friday's newest): pre-filter 4/10, all `others`, 0 errors, **$0.0016**.
- **Full-run LLM estimate for GlobeNewswire:** the two samples disagree (Newsfile $0.00087/article, GNW $0.00016/article on a holiday). With Phase 3's measured unit costs (classify ~$0.00032, extract ~$0.0009) and an assumed 55% pre-filter pass and 15% labelled: 9,882 × (0.55 × 0.00032 + 0.15 × 0.0009) ≈ **$3.1** (range ~$1.6–8.6 for the two samples' rates). **This is the biggest single cost of Phase 5.**

## 9. Known issues / open questions for the orchestrator
1. **French releases** (Newsfile feed, GlobeNewswire): the French Trans Mountain release got `earnings` with a French evidence sentence; prompts are English. Fine by the rules (evidence is verbatim), but worth a look in Phase 5.
2. **Newsfile's search list may be English-only** (its form carries a hidden `l=en`); French releases beyond the feed's 2 hours may be missing. Check in Phase 5 (`/search?k=&l=fr`?).
3. **Full-run time:** Newsfile ~1.5–2 h of article fetches through the browser.
4. CryptoPotato: an uncached article page returned 403 from the usual network too (not only the hotspot). The browser fetcher may fix it; not tried (out of scope).

5. **LLM budget for Phase 5:** GlobeNewswire alone is ~9,900 articles (~$3, maybe more on earnings-heavy days). Newsfile ~$1.8. Before the full run, decide whether to measure a `--sample 100` labelled run per wire first (~$0.03–0.09 each) to pin the rate.
6. GlobeNewswire's busiest 3-day slice was 3,323 of a 5,000 cap; an earnings peak could exceed it. The run would show it (`sliceComplete: false`, `windowStartReached: false`); the fix is `sliceDays: 2`.

## 10. Suggested next step
Benzinga (sitemaps + browser): see the Benzinga section once done.
