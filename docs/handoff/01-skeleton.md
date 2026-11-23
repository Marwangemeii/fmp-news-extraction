# Handoff 01: Skeleton + first real path

> Written by Claude Code at the end of a session, for the orchestrator (Claude in a separate chat, who cannot see the code).

## 1. Goal of this session
Phase 1 in `docs/PLAN.md`: the end-to-end skeleton (schema → generic controller → registry of building blocks → JSONL), with TechCrunch feed page 1 as the first real path. Also the R-C4 structure test, URL tests and the validator. No LLM, no paging back, no other sites.

## 2. What was done
- `package.json`: ESM, `engines: node>=22`, scripts `start` / `test` / `validate`. Dependencies: `cheerio`, `fast-xml-parser` (D3).
- `.env.example`: documents `ANTHROPIC_API_KEY` (used from Phase 3).
- `src/publishers.js`: the schema, with `DEFAULTS` + 10 entries. Only TechCrunch is `enabled: true`.
- `src/controller.js`: the generic engine (discover → window/limit → fetch → extract → label → record). No publisher names.
- `src/run.js`: the CLI entry. Handles `--only` / `--limit`, computes the window, runs the controller, writes `output/articles.jsonl`.
- `src/blocks/index.js`: the registry `{ fetchers, discoverers, extractors, labellers }`.
- `src/blocks/fetch-http.js`: `fetch` with a Chrome UA, a 20 s timeout, `delayMs` before each request, and 3 retries with exponential backoff on 429/5xx/network errors.
- `src/blocks/discover-rss.js`: RSS 2.0 → `[{ url, title, publishedDate, description }]`.
- `src/blocks/extract-html.js`: article HTML → `{ url, title, image, publishedDate, text, fullText }`, using default selectors plus entry overrides.
- `src/blocks/label-placeholder.js`: always returns `{ labels: ['others'], events: [] }`.
- `src/lib/window.js`: `getWindow(now)` and `isInWindow(iso, window)`.
- `src/lib/url.js`: `canonicalizeUrl()`, `TRACKING_PARAMS`, `isTrackingParam()`, `siteOf()`.
- `src/lib/jsonl.js`: `writeJsonl()` (writes a tmp file, then renames it) and `readJsonl()` (per-line parse results).
- `test/structure.test.js`: R-C4, widened to every `.js` file under `src/` except `publishers.js` (D25), plus schema sanity. `test/url.test.js`: URL cleaning. `test/window.test.js`: the R-D1 worked example.
- `scripts/validate.js`: checks REQUIREMENTS §3 plus R-D1, R-D5 and R-L6. Exits with code 1 on failure.
- Docs: DECISIONS D19–D24, the SITES TechCrunch section, PLAN status, GLOSSARY terms.

## 3. How it works
`run.js` filters the schema by `--only`, computes the window and calls `runAll(publishers, { registry, window, limit })`. For each enabled entry, the controller looks up its building blocks **by name** in the registry. It fetches each start URL, runs the discoverer and dedups by canonical URL. Then it keeps the items inside the window (newest first, `--limit` applied) and, one at a time, fetches the article, extracts the fields, re-checks the window with the page date, dedups on the final canonical URL, labels, and builds the record. Disabled entries are skipped with a log line.

**Schema (`src/publishers.js`):**
```js
const DEFAULTS = {
  enabled: false,
  fetcher: { list: 'http', article: 'http' },
  extract: 'html',
  label: 'placeholder',
  delayMs: 1000,
  defaultType: 'general',
  selectors: {},
};

const ENTRIES = [
  {
    name: 'TechCrunch',
    site: 'techcrunch.com',
    enabled: true,
    startUrls: ['https://techcrunch.com/feed/'],
    discover: 'rss',
    selectors: {
      title: { css: 'h1' },
      body: '.entry-content',
      remove: ['.ad-unit', '.wp-block-techcrunch-card', '.jw-player-inline-promo',
               '.wp-block-tc23-post-relevant-terms', '.wp-block-techcrunch-social-share',
               '.wp-block-techcrunch-post-authors'],
    },
  },
  // ...8 more...
  { name: 'Reuters', site: 'reuters.com',
    startUrls: ['https://www.reuters.com/business/', 'https://www.reuters.com/markets/'] },
];
export const publishers = ENTRIES.map((e) => ({ ...DEFAULTS, ...e }));
```

**Extractor defaults (`src/blocks/extract-html.js`):**
```js
const DEFAULT_SELECTORS = {
  canonical: { css: 'link[rel="canonical"]', attr: 'href' },
  title: { css: 'meta[property="og:title"]', attr: 'content' },
  image: { css: 'meta[property="og:image"]', attr: 'content' },
  publishedDate: { css: 'meta[property="article:published_time"]', attr: 'content' },
  body: 'article',
  blocks: 'p, h2, h3, h4, li, tr',   // one fullText paragraph each; tr cells joined by " | "
  remove: [],
};
```
Fallbacks: if a page value is missing, the feed value is used. `text` = the feed description with HTML stripped (or else the first fullText paragraph), cut to ≤ 500 characters at a word boundary with `…`. Signature: `extract(html, item, entry, finalUrl)`.

**Controller core (`src/controller.js`):**
```js
function pick(registry, kind, name) {
  const fn = registry[kind]?.[name];
  if (!fn) throw new Error(`Unknown ${kind} "${name}". Known: ${Object.keys(registry[kind] ?? {}).join(', ')}`);
  return fn;
}
// in runPublisher(entry, ...):
const fetchList = pick(registry, 'fetchers', entry.fetcher.list);
const discover  = pick(registry, 'discoverers', entry.discover);
// ...
for (const item of todo) {
  let article;
  try {
    const page = await fetchArticle(item.url, entry);
    article = extract(page.body, item, entry, page.url);
  } catch (err) {
    errors++;                                   // D21: keep list data, fullText null
    article = extract('', item, entry, item.url);
  }
  if (!isInWindow(article.publishedDate, window)) continue;
  if (seen.has(article.url)) continue;
  seen.add(article.url);
  records.push(toRecord(entry, article, label(article)));
}
```

**R-C4 test (`test/structure.test.js`), widened (D25):** it scans **every `.js` file under `src/` except `src/publishers.js`**: controller, `run.js`, `blocks/`, `lib/`. Per-site logic may live only in the schema. Line by line, each file must contain:
- no publisher name, name without spaces, site, or the site's first label. The list is built from the schema, so new publishers are covered automatically.
- no comparison on an entry's `name`/`site`, in either direction.

The one allowed exception is the `--only` line in `run.js`. It compares schema names against user input from the CLI, which is allowed; comparing against a hardcoded name is not.
```js
const IDENTITY_COMPARISON = /\.(name|site)\b[\w.()]*\s*[!=]==?|[!=]==?\s*[\w.()]*\.(name|site)\b/;
const isAllowedComparison = (path, line) => path === 'run.js' && line.includes('values.only');
// allowed:   p.name.toLowerCase() === values.only.toLowerCase()   (run.js, CLI input)
// rejected:  entry.site.toLowerCase() === 'x'  ·  n === entry.name  ·  if (entry.name === 'Reuters')
// not matched (fine): console.log(entry.name) · publisher: entry.name · el.tagName === 'tr'
```
Failures name the file and line, e.g. `src/lib/_probe.js:4 mentions "zacks" (from Zacks)`. A first test checks that the scan really includes `controller.js`, `run.js`, `blocks/index.js` and `lib/url.js`, and excludes the schema, so the scan can't silently cover nothing.

There are also schema checks: exactly the 10 required names, a bare `site`, https `startUrls`, and every enabled entry's block names resolving in the registry.

## 4. Decisions made
All of these were added to `docs/DECISIONS.md`:
- **D19:** `DEFAULTS` in the schema plus `DEFAULT_SELECTORS` in the extractor, so entries hold only what differs.
- **D20:** `--only` is matched in `run.js`, so the controller never compares names.
- **D21:** a failed article is written from list data with `fullText: null`, and the validator warns about it. This is temporary until Phase 4.
- **D22:** the validator takes the run time from the output file's mtime (or `--run-at`).
- **D23:** `defaultType` per entry, as a placeholder until the Phase 3 type rule.
- **D24:** no `cleanups` registry slot until Phase 2 needs one; `remove` selectors cover the noise for now.
- **D25:** the R-C4 test scans all of `src/` except the schema. The single exception is `run.js`'s `--only` match, because it compares against CLI input, not a hardcoded name.

## 5. Deviations from the plan or the docs
- The extractor takes a 4th argument, `finalUrl` (the URL after redirects), which it uses as the base and fallback for the canonical URL. The plan sketched three arguments.
- D24 was added beyond the D19–D23 the plan listed. It records a "not yet" choice that was already in the plan.
- `test/window.test.js` was added (not in PLAN's build list). It's 5 lines and checks the R-D1 example.
- The R-C4 test is wider than REQUIREMENTS states. R-C4 says "the controller"; at Marwan's request the test covers all of `src/` except the schema (D25). Widening it surfaced two comments that named a publisher as an example (`src/lib/url.js`, `src/run.js`); both now use neutral examples.

## 6. Requirements covered
- **R-C1, R-C2, R-C3, R-C6** (M): one schema; entries hold only what differs; one controller; blocks chosen by name.
- **R-C4** (T): `test/structure.test.js`.
- **R-A4** (T + V): `test/url.test.js`, plus the validator's uniqueness, tracking-param and fragment checks.
- **R-D1** (T + V): `test/window.test.js`, plus the validator's window check.
- **R-D5** (V): dedup in the controller and uniqueness in the validator.
- **R-A1–R-A3, R-A5–R-A7, R-A9 (warning), R-A10–R-A13, R-L6, R-S1** (V): field checks in `scripts/validate.js`.
- **R-A8** (partial, M): fullText was clean on spot-checked TechCrunch articles. Full clean-up is Phase 2.

## 7. How to verify
```
npm install
npm test                                  # 14 tests, all pass
npm start -- --only TechCrunch --limit 5  # "[TechCrunch] discovered 20 · in window 20 · processed 5 (--limit) · written 5 · errors 0"
npm run validate                          # "PASS: 0 failures, 0 warnings"
npm start                                 # TechCrunch 20 written + 9 "[skip] <name>: enabled: false (not configured yet)" lines
node scripts/validate.js --run-at 2026-12-30T00:00:00Z   # negative check: 20× R-D1 failures, exit code 1
```

## 8. Results (first run on 2026-11-21, about 17:22 UTC; re-run on 2026-11-23, about 13:32 UTC after widening the structure test)
- `npm test`: 14 passed, 0 failed (it was 13 before the structure test was widened).
- Negative check for D25: a temporary `src/lib/_probe.js` with `entry.site.toLowerCase() === 'x'`, `n === entry.name` and `'https://www.zacks.com/'` made both R-C4 tests fail, with file:line messages. The probe was then deleted, and the suite was back to 14/14. The reversed form (`n === entry.name`) was also confirmed against the regex directly.
- Re-run on 2026-11-23: `npm start -- --only TechCrunch --limit 5` wrote 5 with 0 errors, and `npm run validate` gave PASS with 0 failures and 0 warnings.
- `npm start`: TechCrunch discovered 20, in window 20, written 20, errors 0. 9 publishers skipped with a log line.
- `npm start -- --only TechCrunch --limit 5`: 5 written, 0 errors.
- `npm run validate`: PASS, 0 failures and 0 warnings on both the 20-article and 5-article outputs.
- Oldest date reached: 2026-11-20 (feed page 1 only covers about 1 day; paging back is Phase 2).
- Sample record (fullText shortened here):
```json
{
  "publishedDate": "2026-11-21T04:00:00.000Z",
  "publisher": "TechCrunch",
  "site": "techcrunch.com",
  "url": "https://techcrunch.com/2026/11/20/startup-sues-apple-in-india-over-tap-to-share-contacts-feature/",
  "title": "Startup sues Apple in India over tap-to-share contacts feature",
  "image": "https://techcrunch.com/wp-content/uploads/2026/11/apple-namedrop.jpg?resize=1200,800",
  "text": "A U.S. startup is seeking $162 million in damages and an injunction to impact iPhone and Apple Watch imports to India.",
  "fullText": "Apple is being sued in India by a U.S.-based startup that alleges ... (2765 chars)",
  "symbol": null,
  "type": "general",
  "labels": ["others"],
  "events": []
}
```

## 9. Known issues / open questions for the orchestrator
- `type: 'general'` for TechCrunch is a placeholder (D23). Is TechCrunch `general` or `stock` by default? Phase 3 decides.
- The image URL keeps TechCrunch's `?resize=1200,800` param. It's a valid lead image URL, so I left it.
- `delayMs: 1000` with sequential fetching makes a 20-article run take about 25 s. A full 14-day TechCrunch run (around 300+ articles) would take about 5–6 minutes. Adding concurrency per publisher may be worth it in Phase 2, but only if the run time hurts.
- Output from development runs (`output/articles.jsonl`) is untracked and won't be committed until Phase 7.

## 10. Suggested next step
Phase 2: verify `?paged=N` on the TechCrunch and CryptoPotato feeds and add paging back until the window start (a discoverer option in the schema, e.g. `paging: { param: 'paged' }`). Enable CryptoPotato with its selectors, add the dev cache (D15) and `output/stats.json` (D16).
