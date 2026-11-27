# Handoff 04: Remaining sites (session A: Newsfile, GlobeNewswire, Benzinga; session B: Business Wire, Zacks, Fox Business, Investing.com, Reuters)

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

**Step 3 (Benzinga):**
- `src/controller.js`: **circuit breaker**: after 5 article pages blocked in a row, the rest are written from list data without a request (`notFetchedAfterBlocks`, D61).
- `src/blocks/discover-sitemap.js`: reads `<image:loc>`; `src/blocks/extract-html.js`: image falls back to the list item's image.
- `scripts/validate.js`: one grouped R-D1 warning per publisher for `droppedNoDate`, one R-A9 warning for `notFetchedAfterBlocks`.
- `src/publishers.js`: Benzinga enabled: Google News sitemap + `/news` (browser) + `latest.xml`; articles over HTTP (blocked); selectors kept for when access exists.
- Tests: `test/controller.test.js` (+1 breaker), `test/discover-list.test.js` (sitemap image). **94 tests.**
- Docs: D61, D62, D55 corrected, SITES (Benzinga, full ladder).

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
- **D61** circuit breaker: 5 blocked articles in a row → stop requesting that publisher's articles.
- **D62** Benzinga: stop at the legitimate ladder (Marwan): no stealth, no fresh session per article; written from sitemap data; production = FMP's proxy network or Benzinga's licensed API.
Numbering differs from the plan (it said D52 = GNW route, D53 = browser): dev switches and block detection got their own entries.

## 5. Deviations from the plan or the docs
- **Newsfile needed a rate-limit fix the plan didn't foresee** (D59): its search stops answering after ~37 quick pages. Found because paging "ended" at Nov 21 with `windowStartReached: false`.
- `mapLimit` was removed (nothing else used it); `createLimiter` replaces it.
- Two browser-fetcher bugs found and fixed during the Newsfile run (empty body during the challenge reload; half-loaded page). See D55.
- **Benzinga articles are blocked** (D62): the plan expected the browser to get them; the first page of a session loads, then Cloudflare blocks the session. Marwan chose to stop at the legitimate ladder.
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

**Benzinga (2026-11-27):**
- Sources: Google News sitemap 335 (2 days, publish dates), `/news` 22 (browser, no dates), `latest.xml` 10,000 (oldest lastmod 2026-10-21 → `windowStartReached: true`). **In window 2,804.** Discovery 3 requests, ~20 s.
- Articles: 403 over HTTP; the breaker stopped after 5 (95 of the 100-sample not requested). Sample 100: **11 written** (in the Google News sitemap: title, date, image, `fullText: null` blocked), **89 not written** (`droppedNoDate`: lastmod only).
- Validate PASS (warnings: R-A9 per blocked record, 1 grouped R-D1, sample, LABEL). Labelled `--limit 10`: 9 written, 0 LLM calls (fullText null → others, D41), **$0**.
- **Full run expectation:** ~340 written (2 days), ~2,460 counted as not written; LLM $0.

**Session totals:** LLM spend **~$0.010** (Newsfile $0.0087 + GlobeNewswire $0.0016 + Benzinga $0). In-window counts: **Newsfile 2,068 · GlobeNewswire 9,882 · Benzinga 2,804** (of which ~340 writable). Full-run LLM estimate for the three: Newsfile ~$1.8 + GlobeNewswire ~$3.1 (range $1.6–8.6) + Benzinga $0 ≈ **$5** (range $3.4–10.4).

## 9. Known issues / open questions for the orchestrator
1. **French releases** (Newsfile feed, GlobeNewswire): the French Trans Mountain release got `earnings` with a French evidence sentence; prompts are English. Fine by the rules (evidence is verbatim), but worth a look in Phase 5.
2. **Newsfile's search list may be English-only** (its form carries a hidden `l=en`); French releases beyond the feed's 2 hours may be missing. Check in Phase 5 (`/search?k=&l=fr`?).
3. **Full-run time:** Newsfile ~1.5–2 h of article fetches through the browser.
4. CryptoPotato: an uncached article page returned 403 from the usual network too (not only the hotspot). The browser fetcher may fix it; not tried (out of scope).

5. **LLM budget for Phase 5:** GlobeNewswire alone is ~9,900 articles (~$3, maybe more on earnings-heavy days). Newsfile ~$1.8. Before the full run, decide whether to measure a `--sample 100` labelled run per wire first (~$0.03–0.09 each) to pin the rate.
6. GlobeNewswire's busiest 3-day slice was 3,323 of a 5,000 cap; an earnings peak could exceed it. The run would show it (`sliceComplete: false`, `windowStartReached: false`); the fix is `sliceDays: 2`.

7. **Benzinga writes only ~340 of ~2,800 in-window articles** (those with a publish date in the Google News sitemap), all with `fullText: null`. The README must say so, with the ladder (D62). The D13 "proxy setting via an env variable" is **not built yet**; with FMP's proxy, Benzinga is a one-line fetcher change.
8. **Budget:** the three-site estimate (~$5, up to ~$10 if GlobeNewswire labels like Newsfile) plus TechCrunch/CryptoPotato (~$0.1) and session B's sites could exceed the ~$9.27 left. Measuring a labelled `--sample 100` per wire before Phase 5 (~$0.02–0.09 each) would pin it; a cheaper pre-filter for wire releases (e.g. skip law-firm class-action notices, ~1/3 of Newsfile) is an option.
9. Runtime for Phase 5 (parallel): GlobeNewswire ~9,900 articles over HTTP at ~1.3 s ≈ 3.5 h is now the slowest site; Newsfile ~2,070 through the browser ≈ 1.5–2 h; Benzinga ~1 min.

## 10. Suggested next step
Session B: Business Wire, Zacks, Fox Business, Investing.com, Reuters. The building blocks from this session (browser fetcher, html-list, sitemap, date slices, rate-limit handling, circuit breaker) should cover most of them as schema-only entries. Before Phase 5: decide the budget question (item 8) and whether GlobeNewswire's runtime needs 2 requests at a time.


---

# Session B (Business Wire, Zacks, Fox Business, Investing.com, Reuters) + proxy hook + cost measurement

## B1. Goal
Same method as session A for the last five sites; plus the D13 proxy hook (`PROXY_URL`), a CryptoPotato recheck, and a labelled cost measurement (GlobeNewswire, Newsfile) with proposed cost cuts (not built). Marwan authorized a commit per site and a push at the end.

## B2. What was done (commits)
- `3621034` step 0: `src/lib/proxy.js` + `PROXY_URL` (D63), CryptoPotato recheck logged.
- `7ecfba7` Business Wire (D64): per-entry `headers`; one-page date slices count as complete.
- `face80e` Zacks findings + Imperva detection (D65).
- `f4433c9` Fox Business (D66): `{ jsonld: 'datePublished' }` selector.
- `3085195` Investing.com (D67, D68): RSS zone-less dates fixed, `list.dateZone`, `<enclosure>` image, source merge fills gaps, `typeByUrl`.
- `29ffd0d` Zacks (D69) + Reuters (D70): `dayZone` + day precision, strict page dates, browser returns raw XML, homepage-redirect guard, `disabledReason`.
- Tests: 94 → **104** (proxy 2, slices 1, merge 1, JSON-LD 1, page dates 1, homepage redirect 1, RSS dates 1, typeOf 1, Imperva 1).

## B3. How it works (key snippets)
**Proxy (D63), no dependency:**
```js
// src/lib/proxy.js
export function applyHttpProxy() {            // run.js calls it at startup
  const raw = proxyUrl(); if (!raw) return 'off';
  if (typeof http.setGlobalProxyFromEnv !== 'function') return 'unsupported'; // Node 22: browser only
  http.setGlobalProxyFromEnv({ HTTP_PROXY: raw, HTTPS_PROXY: raw }); return 'on';
}
// fetch-browser.js: chromium.launch({ headless, proxy: browserProxy() })   // { server, username, password }
```
Tested with a local logging CONNECT proxy: both fetchers' connections went through it when set; none when unset. `HTTPS_PROXY` set at runtime or via `.env` does **not** work (Node reads it before startup).

**Business Wire, schema only (D64):**
```js
headers: { 'sec-ch-ua': '"Chromium";v="131", "Google Chrome";v="131", "Not_A Brand";v="24"', 'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"Windows"' },
startUrls: [
  { url: 'https://www.businesswire.com/newsroom', discover: 'html-list', paging: null, list: { item: 'li', link: 'a' } }, // given, 403
  { url: 'https://www.businesswire.com/sitemap/google-news/{from}.xml.gz', discover: 'sitemap', sliceDays: 1, paging: null },
],
// controller: sliceComplete = stop === 'empty page' || stop === 'single page'
```
**Date rules now (D67, D69):** a date with no written zone is never parsed in the machine's zone (`new Date('2026-11-27 18:21:02')` gave 16:21Z in Cairo). RSS: null unless `list: { dateZone: 'UTC' }`. Page dates: must carry an offset; a bare day only with `dayZone`:
```js
publishedDate: { jsonld: 'datePublished', dayZone: 'ET' }   // Zacks: "2026-11-27" → 2026-11-27T05:00:00Z, publishedDatePrecision 'day'
```
`publishedDatePrecision` goes to the trace and `stats.dayOnlyDates` (+ one R-A1 validator warning), not to the record.

**Merge (D67):** a later source fills fields the earlier one lacked: `for (const [k, v] of Object.entries(item)) if (prev[k] == null && v != null) prev[k] = v;`

**Type (D68):** `typeOf(entry, symbol, url)`: `entry.typeByUrl` first (`/news/forex-news/` → forex, `/news/cryptocurrency-news/` → crypto), then defaultType, then general + symbol → stock. Also used by `toRecord` for records without a labeller.

## B4. Decisions
D63 proxy · D64 Business Wire · D65 Imperva + Zacks findings · D66 Fox Business · D67 Investing.com, zone-less dates, merge · D68 `typeByUrl` (closes D47's forex) · D69 Zacks day-only dates (**Marwan**) · D70 Reuters not collected (**Marwan**).

## B5. Deviations
- Zacks and Reuters needed Marwan's decisions mid-session (day-only dates; robots.txt legal notice).
- Three silent date bugs found and fixed (RSS and page dates read in local time; `"2026-11-27"` read as 00:00Z).
- A first-source-wins merge bug hid Investing feed dates (fixed, D67).
- A Cloudflare 403-challenge wait in the browser was tried and reverted (didn't clear; +75 s per article).

## B6. Results per site (2026-11-27, window from 2026-11-13T00:00Z)
| Site | Route | In window | Covers 14 days | fullText | LLM $/article |
|---|---|---|---|---|---|
| Business Wire | 15 daily Google News sitemaps (HTTP + client hints) | **6,416** | yes | null, `blocked` (Akamai Bot Manager, also in headless/headed Chromium) | $0 |
| Fox Business | given pages + news & articles sitemaps (HTTP) | **131** | yes | 99/99 in sample | $0.00015 (limit 10) |
| Investing.com | given `/news/` (browser) + 15 RSS feeds | **138** | **no** (oldest Nov 23) | null, `blocked` (Cloudflare after the 1st page) | $0 |
| Zacks | `/articles/index.php` + news sitemap (browser, Imperva) | **510** | **no** (~1.5 days) | 90/90 in sample; 10/100 removed (redirect home) | $0.00061 (limit 10) |
| Reuters | not collected (D70) | – | – | – | – |
All validate PASS (warnings only). Sample/spot-checks in SITES.md.

**CryptoPotato recheck:** 3 uncached recent articles → **403 on all 3**, Cloudflare managed challenge (`cf-mitigated: challenge`, "Just a moment..."); the browser didn't clear it either (75 s). Phase 5: ~235 cached pages are fine; new ones will be `blocked`. Production: proxy.

## B7. Cost measurement (labelled `--sample 100`, `LLM_BUDGET_USD=0.3`, Haiku 5.5 $0.10/$0.50 per MTok)
| | GlobeNewswire | Newsfile |
|---|---|---|
| Pre-filter pass | 73 / 100 | 92 / 100 |
| LLM calls | 79 (73 classify + 6 extract) | 100 (92 + 8) |
| Labels | earnings 3, dividends 3 | earnings 6, splits 1, ipos 1 |
| Cost | $0.0431 → **$0.00043/article** | $0.0656 → **$0.00066/article** |
| Tokens in / out | 278,914 / 30,432 | 330,336 / 65,065 |
| Law-firm notices | 14 (14% of cost), 0 labelled | **49 (35% of cost)**, 0 labelled |
| Non-English | 10 (5% of cost), 0 labelled | 0 |
| Classify-only → others | 71% of cost | 73% of cost |
| Passed on ONE weak keyword, then others | 26 ("results" 10, "sales" 6, "distributions" 5…) | 33 ("results" 28) |
Errors 0, K4/K11 drops 0. (Session A's GNW holiday sample was $0.00016/article; this one is a normal mix.)

**Projected full-run LLM cost (all 10 sites):** GlobeNewswire 9,919 × $0.00043 = $4.28 · Newsfile 2,099 × $0.00066 = $1.38 · Zacks 510 × $0.00061 = $0.31 · TechCrunch + CryptoPotato ~$0.10 · Fox Business $0.02 · Business Wire, Benzinga, Investing.com $0 (fullText null) · Reuters $0 → **≈ $6.1** (range ~$4.5–8: GlobeNewswire's earnings-heavy days drive it). Credit left ≈ **$9.15** (session B spent $0.12). **Phase 5 + Phase 7 would be ~$12 if both run cold**; Phase 7 is cheap only if Phase 5 runs with `CACHE=1` and `PROMPT_VERSION` doesn't change after it (then only the ~2 new days are billed, ~$1).

**Proposed cost cuts (not built; for Marwan + orchestrator):**
1. **Law-firm class-action notice rule → `others`, no LLM call, traced** (title signature: firm names / "Law Firm" / "class action" + "investors"/"shareholders"/"deadline"). Saves ~**$1.1/run (18%)**. Recall risk: 0 of 63 such notices got a label. Risk: an issuer's own release about a settlement; mitigate by requiring a law-firm signature, and trace the rule.
2. **Prompt caching of the system prompts** (classify ~600 tokens, extract ~1,000; Haiku 5.5's minimum is 512): cached reads bill at ~0.1×. Saves ~**$0.5 (8–9%)**, no quality risk, a one-line `cache_control` change; verify `cache_read_input_tokens` > 0.
3. **Classify with thinking disabled** (Haiku 5.5 allows `disabled` at effort ≤ high): output is 35% (GNW) to 50% (Newsfile) of cost, mostly classify thinking. Could save ~**$1.5–2**. Quality risk: must pass the eval first (~$0.05).
4. **Smaller classify input** (`CLASSIFY_BODY_CHARS` 6,000 → ~3,000): ~**$0.5**; the subject sits in the opening; eval needed.
5. **Tighter wire pre-filter** (two keyword hits, or one strong word; "results" alone is weak): ~**$0.5–0.8**; recall risk, check on the gold set.
6. **Message Batches API** (50% off everything): ~**$3**, but async (minutes to hours), a two-pass labeller (classify batch → extract batch), the most code. Only if the budget forces it.
7. Not recommended: skipping non-English wire releases (~$0.2; loses French earnings like Trans Mountain).
Recommended now: **1 + 2** (≈ −$1.6, ~$4.5/run, no quality risk), then 3 if the eval holds; and run Phase 5 with `CACHE=1`.

## B8. Known issues / open questions
1. **Coverage gaps for the README:** Investing.com (~140 of an unknown hundreds/day, feeds only), Zacks (~1.5 days), Benzinga (~340 of ~2,800), Business Wire (all 6,416 but no text), Reuters (none). Each is logged with its ladder in SITES.md.
2. Zacks' day is assumed to be New York time (Zacks is in Chicago: 1-hour difference only between 23:00 and 24:00 ET). Marwan approved ET.
3. Business Wire publishes many non-English releases (Nov 18: 166 of 796); they're written with title/date only (no text) anyway.
4. Phase 5 runtime adds Zacks (~510 browser pages, ~25 min) and Business Wire (~16 requests).
5. Node 22: the HTTP fetcher can't use `PROXY_URL` (warns); Node 24 is installed here.

## B9. How to verify
```
npm test                                                                   # 104 pass
$env:CACHE=1; $env:LABEL='placeholder'; npm start -- --only "Business Wire" --sample 100; npm run validate
$env:LABEL=''; $env:LLM_BUDGET_USD='0.3'; npm start -- --only Zacks --limit 10; npm run validate
$env:PROXY_URL='http://127.0.0.1:8899'; npm start -- --only "Fox Business" --limit 1   # needs a proxy listening
```
