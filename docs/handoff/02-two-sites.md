# Handoff 02: Two easy sites, full window

> Written by Claude Code at the end of a session, for the orchestrator (Claude in a separate chat, who cannot see the code).

## 1. Goal of this session
Phase 2 in `docs/PLAN.md`: TechCrunch + CryptoPotato cover the full 14-day window (paging back), CryptoPotato enabled with selectors, the dev cache (D15), `output/stats.json`, the text-joining bug check, and git housekeeping.

## 2. What was done
- `src/lib/paging.js` (new): `toSources(entry)` (per-source discovery, D30), `pageUrl()`, `discoverPages()` (the generic paging loop and its stop rules, D28).
- `src/lib/cache.js` (new): `cached(fetcher, counter)`, the on-disk dev cache for article pages (D15).
- `src/blocks/discover-wp-json.js` (new): WordPress REST API JSON → article stubs. Registered as `'wp-json'`.
- `src/blocks/extract-html.js`: `textOf(node)` replaces cheerio `.text()` for blocks (D29). `blockquote` was added to the default blocks.
- `src/controller.js`: loops sources → `discoverPages`, wraps only the article fetcher with the cache, builds per-publisher stats. `runAll` now returns `{ records, stats }`.
- `src/run.js`: reads `CACHE=1` and writes `output/stats.json` with `runAt`, the window, `limit` and the run duration.
- `src/publishers.js`: `DEFAULTS.paging = null`. TechCrunch got `paging`. CryptoPotato is enabled with two sources and its selectors.
- `scripts/validate.js`: `runAt` is read from `stats.json` (`--run-at` still overrides; mtime is no longer used, D26). Cross-checks: stats `written` must equal the row count (failure). `windowStartReached: false`, `--limit` runs and failed publishers give warnings.
- Tests: `test/paging.test.js` (8 tests: every stop reason, `pageUrl`, `toSources`); `test/extract.test.js` + `test/fixtures/body-spacing.html`; `test/structure.test.js` now reads per-source URLs and discoverers.
- `.gitignore`: added `.vscode/`, `output/articles.jsonl`, `output/stats.json`. `git rm --cached .vscode/settings.json output/articles.jsonl` (the files are still on disk).
- Docs: DECISIONS D26–D30 (and D22 marked as replaced), SITES (TechCrunch + CryptoPotato), PLAN status, CLAUDE.md commands, GLOSSARY.

## 3. How it works
For each enabled entry, the controller turns `startUrls` into **sources**. Each source has a URL, a discoverer and paging, taken from the item itself or from the entry. For each source, `discoverPages` fetches page 1 (the URL exactly as written), then `?<param>=2`, `3`, … and stops at the first rule that applies. Items from all sources are merged and deduplicated by canonical URL. Everything after that (the window filter, fetch, extract, label) is unchanged from Phase 1.

**Schema entries:**
```js
{
  name: 'TechCrunch', site: 'techcrunch.com', enabled: true,
  startUrls: ['https://techcrunch.com/feed/'],
  discover: 'rss',
  paging: { param: 'paged', maxPages: 30 }, // feed/?paged=2, 3… 20 items a page, ~13 pages for 14 days
  selectors: { /* unchanged from Phase 1 */ },
},
{
  name: 'CryptoPotato', site: 'cryptopotato.com', enabled: true,
  startUrls: [
    // The given feed (R-D2). It ignores ?paged=N, and unknown params trigger a Cloudflare 429, so one page only.
    { url: 'https://cryptopotato.com/feed', discover: 'rss', paging: null },
    // Added route for paging back (D27): the WordPress REST API, 100 posts per page.
    { url: 'https://cryptopotato.com/wp-json/wp/v2/posts?per_page=100&_fields=link,date_gmt,title,excerpt',
      discover: 'wp-json', paging: { param: 'page', maxPages: 10 } },
  ],
  defaultType: 'crypto',
  selectors: {
    body: '.post-details-content',
    remove: ['.code-block', '.single-post-tags', 'h3.heading-4 + ul', 'h3.heading-4'],
  },
},
```

**Sources (`src/lib/paging.js`):**
```js
export function toSources(entry) {
  return entry.startUrls.map((s) => {
    const src = typeof s === 'string' ? { url: s } : s;
    return {
      url: src.url,
      discover: src.discover ?? entry.discover,
      // `in`, not `??`: an explicit `paging: null` on a source means "one page only"
      paging: 'paging' in src ? src.paging : (entry.paging ?? null),
    };
  });
}
```

**The paging loop (`discoverPages`, shortened):**
```js
for (let n = 1; n <= maxPages; n++) {
  const url = pageUrl(source.url, source.paging?.param, n);   // n=1 → URL as written
  try { ({ body } = await fetchList(url, entry)); }
  catch (err) { if (n === 1) throw err; stop = 'page error'; error = err.message; break; }
  pages++;
  const found = discover(body, url);
  if (found.length === 0) { stop = 'empty page'; break; }
  const fresh = found.filter((item) => !seen.has(item.url));
  if (fresh.length === 0) { stop = 'no new items'; break; }      // the site ignores the page param
  /* add fresh items, track oldestDate */
  if (oldestDate && oldestDate < window.start.toISOString()) { stop = 'window start reached'; break; }
}
// otherwise stop = 'max pages' (or 'single page' when paging is null)
```

**Text joining (`extract-html.js`):**
```js
const BLOCK_TAGS = new Set(['address', 'article', 'aside', 'blockquote', 'br', 'dd', 'div', /* … */ 'td', 'th', 'tr', 'ul']);
function textOf(node) {
  if (node.type === 'text') return node.data;
  if (node.type !== 'tag') return '';            // script/style/comments skipped
  const inner = (node.children ?? []).map(textOf).join('');
  return BLOCK_TAGS.has(node.name) ? ` ${inner} ` : inner;   // then clean() collapses spaces
}
```

**stats.json (real, from the cached re-run; CryptoPotato shown, TechCrunch has one source):**
```json
{
  "runAt": "2026-11-23T18:03:41.011Z",
  "window": { "start": "2026-11-09T00:00:00.000Z", "end": "2026-11-23T18:03:41.011Z" },
  "limit": null,
  "durationMs": 48822,
  "publishers": {
    "CryptoPotato": {
      "enabled": true,
      "sources": [
        { "url": "https://cryptopotato.com/feed", "discover": "rss", "pagesFetched": 1, "pagingStop": "single page",
          "discovered": 36, "oldestDate": "2026-11-21T10:34:13.000Z", "reachedStart": false },
        { "url": "https://cryptopotato.com/wp-json/wp/v2/posts?per_page=100&_fields=link,date_gmt,title,excerpt",
          "discover": "wp-json", "pagesFetched": 3, "pagingStop": "window start reached",
          "discovered": 300, "oldestDate": "2026-11-05T19:38:34.000Z", "reachedStart": true }
      ],
      "pagesFetched": 4, "discovered": 300, "inWindow": 261, "written": 261, "errors": 0, "fromCache": 261,
      "oldestDate": "2026-11-05T19:38:34.000Z", "windowStartReached": true, "durationMs": 15543
    },
    "GlobeNewswire": { "enabled": false }
  }
}
```

## 4. Decisions made (all added to `docs/DECISIONS.md`)
- **D26** (replaces D22): the validator reads `runAt` from `stats.json` and cross-checks stats against the file. Why: an mtime changes when a file is copied or touched.
- **D27:** CryptoPotato keeps the given feed and adds the WordPress REST API as a second source. Why: the feed ignores `?paged=N`, a cache-busting param got a Cloudflare 429, and the API pages correctly with dates.
- **D28:** paging config lives in the schema; the stop logic is generic in `src/lib/paging.js`, including a "no new items" stop for sites that ignore the param.
- **D29:** `textOf()` adds spaces at block boundaries and `<br>`, never around inline tags; `blockquote` is a default block.
- **D30:** discovery is per source. A `startUrls` item can override `discover` and `paging`, and `windowStartReached` is true if any source reached the window start. Marwan asked for this at plan review, so R-D2's given feed is kept and Phase 4's mixed-type sites fit.

## 5. Deviations from the plan or the docs
- **Plan change at review (Marwan):** CryptoPotato originally *replaced* its feed with the REST API. It now keeps the feed (R-D2) and adds the API, through per-source discovery (D30).
- **The "fund intoAnthropic’s" bug was not reproducible.** The live HTML has `fund into Anthropic’s` as plain text with a normal space, our current output is correct, and the committed Phase 1 output never contained the bad string. Cheerio keeps the source's own whitespace around `<a>`. While checking, I found real space drops at `<br>` and at blocks nested in blocks (`<li><p>a</p><p>b</p></li>` → "ab"), fixed those (D29), and the fixture test also guards the inline `<a>` case.
- Also gitignored `output/stats.json` (same lifecycle as `articles.jsonl`, to be committed in Phase 7). The prompt named only `.vscode/` and `articles.jsonl`.
- The stats have no publisher-level `pagingStop`. It's per source, because a publisher can have several sources.

## 6. Requirements covered
- **R-D2** (M): every given start URL is still fetched as written; the REST API is an added source (SITES.md §6).
- **R-D3** (stats + V): `windowStartReached: true` for both, and the validator warns if it's false.
- **R-D4** (stats): all 10 publishers appear in `stats.json`; disabled ones as `{ enabled: false }`.
- **R-D5** (V): dedup across sources and pages, and the validator's uniqueness check passes.
- **R-D1** (V): window check, now against `runAt` from stats.
- **R-A8** (M + T): spot-checked 5 per site, `test/extract.test.js`.
- **R-A9** (V): 2 warnings, both CryptoPotato `/video/` posts (see §9).
- **R-C1–R-C6** (T): the structure test also scans the new files (`paging.js`, `cache.js`, `discover-wp-json.js`) and passes.

## 7. How to verify
```
npm test                                   # 23 tests, all pass
npm start                                  # ~13 min sequential; TechCrunch 247, CryptoPotato 261
npm run validate                           # PASS: 0 failures, 4 warnings (2 video posts × R-A7 + R-A9)
CACHE=1 npm start                          # 1st run fills .cache/; 2nd run ~49 s, "from cache 247" / "from cache 261"
node scripts/validate.js --run-at 2026-12-30T00:00:00Z   # negative: FAIL, 508 failures (R-D1)
```
Log line format:
```
[CryptoPotato] rss 1p → single page, wp-json 3p → window start reached · oldest 2026-11-05T19:38:34.000Z · discovered 300 · in window 261 · processed 261 · written 261 · errors 0 · from cache 261
```

## 8. Results (2026-11-23, window 2026-11-09T00:00Z → ~18:00Z)
- `npm test`: 23 passed, 0 failed.
- **Full run (no `--limit`, sequential, fresh fetch):** 785 s total. TechCrunch 315 s (247 articles + 13 feed pages, ~1.3 s/article). CryptoPotato 470 s (261 articles + 4 list pages, ~1.8 s/article; pages are ~290 KB). 0 errors. No concurrency added.
- **Cached re-run:** 49 s; all 508 articles from cache, and the list pages were still fetched (13 + 4).
- `npm run validate`: PASS, 0 failures, 4 warnings.
- **Window coverage:**

| | TechCrunch | CryptoPotato |
|---|---|---|
| pages / stop | 13 → window start reached | feed 1 → single page; REST 3 → window start reached |
| oldest date reached | 2026-11-07T17:18Z | 2026-11-05T19:38Z |
| oldest written | 2026-11-09T05:26Z | 2026-11-09T05:06Z |
| largest gap between articles | 17.6 h (Fri 23:00 → Sat 16:34) | 7.2 h |
| written | 247 | 261 |
| REST API `X-WP-Total` for the window | 246 | 261 |

  TechCrunch diff against the API's list: we have 2 extra that are correct (a `/video/` post that isn't an API "post"; an article at Nov 9 05:26Z that the API's Pacific-time `after` filter drops), and we **miss 1**: `5-desk-gadgets-that-can-make-your-workday-better` (Nov 21), which is not in the RSS feed at all.
- Every day from Nov 9 to Nov 23 has articles for both sites (TechCrunch 6–28 a day, CryptoPotato 12–23).
- **Spot checks:** 5 per site, all clean. Noise scans over all 508 found no "You may also like", "Tags:", ad scripts or related cards. The one regex hit was "Read more…" inside a quoted tweet, which is real article content. All 200 `h3.heading-4` elements across the 261 CryptoPotato pages are "You may also like:".

## 9. Known issues / open questions for the orchestrator
1. **CryptoPotato `/video/` posts (2):** a title and a JS video player, with no text. `fullText: null`, `text: ""`. R-A9 says null only if blocked. Should we skip them as non-articles, or keep them and document it?
2. **The TechCrunch feed leaves out some posts** (1 of 246 this window). Adding TechCrunch's REST API as a second source (D30 makes that a schema-only change) would close the gap. Do it now, or in Phase 5?
3. Run time: ~13 min for ~510 articles sequential. With 10 sites, a full run may take 1 h+. Concurrency per publisher (or running publishers in parallel) is likely needed in Phase 4/5.
4. The TechCrunch type is still the `general` placeholder (D23).

## 10. Suggested next step
Phase 3: the labeller, extractor and traces. Use `CACHE=1` so iterating on prompts doesn't re-fetch the 508 articles.

---

## Addendum (2026-11-24): Marwan's decisions on the open questions

### A1. Decisions taken (all in `docs/DECISIONS.md`)
- **D31:** body-less pages (CryptoPotato `/video/` posts) are **kept**. Every null `fullText` carries a reason: `noBody` (the page loaded, no text body), `blocked` (HTTP 401/403/429/451) or `error` (other fetch failures). Counted per publisher in `stats.json`, listed per URL, shown in the validator's R-A9 warnings. A null with no recorded reason **fails** validation.
- **D32:** `text` fallback chain: feed/API description → page `og:description` / meta `description` → first paragraph → `""`.
- **D33:** TechCrunch gets its WordPress REST API as a second source after the given feed (schema-only).

### A2. What changed
- `src/blocks/fetch-http.js`: the thrown error carries `err.status` when the server answered with an HTTP error.
- `src/controller.js`: `BLOCKED_STATUSES = [401, 403, 429, 451]`; a `nullReason` per article; stats `fullTextNull` + `fullTextNullUrls`; the log line shows the null counts when there are any.
- `src/blocks/extract-html.js`: a `description` default selector and the `text` chain.
- `src/publishers.js`: TechCrunch's second source.
- `scripts/validate.js`: R-A9 shows the reason; a missing reason is a failure.
- Tests: `test/controller.test.js` (new: `runAll` with a fake registry covering ok / noBody / 403 / 500), plus a `text` chain test in `test/extract.test.js`.

```js
// src/controller.js, the article loop
let nullReason = null; // why fullText is null, if it is (D31)
try {
  const page = await fetchArticle(item.url, entry);
  article = extract(page.body, item, entry, page.url);
  if (article.fullText === null) nullReason = 'noBody'; // the page loaded but has no text body
} catch (err) {
  s.errors++;
  nullReason = BLOCKED_STATUSES.includes(err.status) ? 'blocked' : 'error';
  article = extract('', item, entry, item.url);
}
// … window + dedup checks …
if (nullReason) {
  s.fullTextNull[nullReason]++;
  s.fullTextNullUrls.push({ url: article.url, reason: nullReason });
}
```
```js
// src/blocks/extract-html.js
description: { css: 'meta[property="og:description"], meta[name="description"]', attr: 'content' },
// …
text: truncate(stripHtml(item.description) || stripHtml(pick($, sel.description)) || firstParagraph(fullText)),
```
```js
// src/publishers.js, TechCrunch
startUrls: [
  'https://techcrunch.com/feed/', // the given feed (R-D2); uses discover + paging below
  { url: 'https://techcrunch.com/wp-json/wp/v2/posts?per_page=100&_fields=link,date_gmt,title,excerpt',
    discover: 'wp-json', paging: { param: 'page', maxPages: 10 } },
],
discover: 'rss',
paging: { param: 'paged', maxPages: 30 },
```
`stats.json` per publisher now also has:
```json
"fullTextNull": { "noBody": 2, "blocked": 0, "error": 0 },
"fullTextNullUrls": [
  { "url": "https://cryptopotato.com/video/bitcoin-bounces-after-the-crash-why-all-eyes-are-on-wednesday/", "reason": "noBody" },
  { "url": "https://cryptopotato.com/video/this-week-could-bring-another-crash-tuesday-is-critical/", "reason": "noBody" }
]
```

### A3. Results (window 2026-11-10T00:00Z → 2026-11-24T16:52Z)
- `npm test`: **25 passed**, 0 failed.
- `CACHE=1 npm start -- --only TechCrunch`: 57 s. `rss 13p → window start reached, wp-json 3p → window start reached · oldest 2026-11-05T19:06Z · discovered 301 · in window 243 · written 243 · errors 0 · from cache 225`. Validator: PASS, 0 failures, 0 warnings.
- **URL-by-URL diff vs the REST API** (posts since Nov 8, filtered locally on `date_gmt` in UTC to the window): REST 242, ours 243, in both 242. **Nothing is only in REST.** The only one only in ours is the feed-only `/video/why-the-data-center-you-dread-might-never-even-be-built/`.
- **"5 desk gadgets" (2026-11-21T18:07:55Z) is included**: 44 blocks, 6,731 chars, clean (product headings, descriptions, prices; no shopping cards).
- Cached run of both publishers (66 s): TechCrunch 243, CryptoPotato 256. CryptoPotato `fullTextNull: { noBody: 2, blocked: 0, error: 0 }`. Validator: PASS, 0 failures, 4 warnings (2 × R-A7 `text is empty`, 2 × R-A9 `fullText is null: noBody (the page loaded but has no text body)`).
- Negative check: with `fullTextNullUrls` emptied in `stats.json`, the validator fails (`✖ R-A9: 2 … fullText is null with no recorded reason in stats.json`, exit 1). The original was restored afterwards.

### A4. Open questions
- A block page served with 200 (a challenge page) would be counted as `noBody`. Phase 4 should detect challenge pages (D13).
- Updated open questions: §9.1 and §9.2 are resolved by D31–D33. §9.3 (run time) and §9.4 (TechCrunch type) remain.
