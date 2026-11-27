# Sites

One section per publisher. Notes marked **(hypothesis)** are unverified; update them with what was actually observed.

Template for each site:
- **Start URLs:**
- **Discovery route:** how the article list is found
- **Covering 14 days:** how we page back, and the oldest date reached
- **Fetcher:** http / browser (list pages, article pages)
- **Selectors:** body, title, date, image
- **Clean-up:** site-specific removals
- **Blocking log:**

| Date | What we tried | What we saw (status, page content) | Result |
|---|---|---|---|

---

## 1. TechCrunch
- **Start URLs:** https://techcrunch.com/feed/ (given), plus the WordPress REST API `https://techcrunch.com/wp-json/wp/v2/posts?per_page=100&_fields=link,date_gmt,title,excerpt` (added 2026-11-24, D33). R-D2 is satisfied as for CryptoPotato: the given feed is still the first source, fetched and paged as before; the API is an added route.
- **Discovery route:** RSS 2.0 feed, 20 items per page (observed 2026-11-21). Items have `title`, `link`, `pubDate`, `description`, and **no** `content:encoded` and no image, so image and fullText come from the article page.
- **Covering 14 days:** `?paged=N` **works** (verified 2026-11-23): 20 items per page, page 2 = Nov 19–21, page 15 = Nov 5. Schema: `paging: { param: 'paged', maxPages: 30 }`. On 2026-11-23 the run needed 13 pages; the oldest date reached was 2026-11-07, before the window start (2026-11-09). Cross-check: the WordPress REST API (`/wp-json/wp/v2/posts?after=2026-11-09T00:00:00`) reports `X-WP-Total: 246` for the same window; we found 247 in window. A URL-by-URL diff against the API's list (2026-11-23):
  - **Only ours (correct):** a `/video/…` post (not a "post" type in the API), and an article at 2026-11-09T05:26Z that the API's `after` filter drops because it uses the site's Pacific time zone.
  - **Only the API (missed):** `2026/11/21/5-desk-gadgets-that-can-make-your-workday-better/` (published 2026-11-21T18:07Z). It is **not in the RSS feed** at all (checked pages 1–3), so the feed leaves out some posts. That post ends "This post originally published July 5 and has been updated…", so updated re-posts may be what the feed skips.
  - **Fix (2026-11-24, D33):** the REST API was added as a second source. Re-run (window 2026-11-10 → 2026-11-24T16:52Z): feed 13 pages → window start reached, REST 3 pages → window start reached; 243 written. A URL-by-URL diff against the REST list, filtered on `date_gmt` in UTC: **all 242 REST posts are in our output**, and the 1 extra is the feed-only `/video/why-the-data-center-you-dread-might-never-even-be-built/`. "5 desk gadgets" is now included (6,731-char fullText, clean).
- **Timing:** 315 s for 247 articles + 13 feed pages (sequential, `delayMs: 1000`).
- **Fetcher:** http for both. The feed and article pages return 200 with a Chrome User-Agent.
- **Selectors:**
  - title `h1` (`h1.article-hero__title`; og:title has a ` | TechCrunch` suffix)
  - body `.entry-content`, with paragraphs as `p.wp-block-paragraph`
  - date: `meta[property="article:published_time"]` (e.g. `2026-11-21T04:00:00+00:00`), which matches the feed `pubDate`
  - image: `og:image`
  - canonical: `<link rel="canonical">`, which equals the feed link
- **Clean-up:** removed from the body: `.ad-unit`, `.wp-block-techcrunch-card` (related-article cards), `.jw-player-inline-promo`, `.wp-block-tc23-post-relevant-terms`, `.wp-block-techcrunch-social-share`, `.wp-block-techcrunch-post-authors`. Spot-checked on 2 of 5 articles: no menus, ads or cards left.
- **Blocking log:** none, no blocking seen.

## 2. GlobeNewswire
- **Start URLs:** `/en/search/date/24HOURS?pageSize=10&page=1` and `/en/search/subject/prs` (given, fetched exactly as written, one page each), plus the added `/en/search/date/%5B{from}%20TO%20{to}%5D?pageSize=50` in 3-day slices of the window (D57, D60).
- **Discovery route:** HTML search pages (`html-list`): item `.recentNewsH li`, link `.mainLink a`, date `.date-source span:first-child` ("November 27, 2026 10:30 ET"), description `.newsTxt`. 50 per page is the maximum (`pageSize=100` gives 50).
- **Limits found (2026-11-27):**
  - `24HOURS` = 24 hours; `7DAYS` = 7 days; `1MONTH` exists; `30DAYS` and `/date/2026-11-13` give 0 results.
  - **The search returns at most 5,000 results:** `/en/search?pageSize=50` page 100 = 2026-11-19 06:00 ET, page 101 = repeats (paging stopped "no new items" at 2026-11-19T11:53Z).
  - **Custom range** `date/[2026-11-13 TO 2026-11-20]` works (the facet's `RouteValue` is `[]`), in UTC days, both ends inclusive (first result 18:59 ET = 23:59Z on the end day). Past the last page: 0 results.
  - The sitemaps don't cover the window: `sitemaps.globenewswire.com/news/en/2026-11.xml` is empty until the month ends (October's has 13,091 English URLs), `news/en/latest.xml` = 214 URLs (~1 day, no dates), `/NewsRoom/GoogleSitemap` = 1,000 URLs (2 days).
  - **robots.txt disallows `/en/search`** (and `/search`, `/fr/search`, `/de/search`), the path of FMP's given start URLs. Marwan's decision: use it, as FMP gave these URLs; 1 request a second, one at a time (D57).
- **Covering 14 days (2026-11-27, window from 2026-11-13T00:00Z):** 5 slices, all complete ("empty page"): Nov 25–27 35 pages / 1,649; Nov 22–24 46 / 2,189; Nov 19–21 39 / 1,847; Nov 16–18 69 / 3,323; Nov 13–15 19 / 874 (weekend). **9,882 discovered = 9,882 in window**, oldest 2026-11-13T00:00Z, `windowStartReached: true`. Discovery ~210 pages, ~6 min.
- **Fetcher:** http for lists and articles (Node fetch 200; curl 403, Akamai).
- **Selectors:** body `[itemprop="articleBody"]`; date `meta[property="og:article:published_time"]` ("2026-11-27T15:20:00Z"); og:title, og:image, canonical present.
- **Clean-up:** `#gnw_attachments_section-header`, `#gnw_attachments_section-items` (the "Attachment" heading and file list; 12 of 100 sampled releases changed). Contacts, tags and logos are outside `articleBody`.
- **Spot-check (sample of 100 spread over the window):** 100/100 with fullText, 0 errors; length 84–43,646 chars (median 5,667; the 84-char one is a one-sentence release: "Danske Mortgage Bank Plc will publish the annual report for 2026 on 4 February 2027."). Newest (Vallourec voting rights, ResearchAndMarkets report) and oldest (TEMAI at SEMA; Condor Q3, 43,646 chars, 148 paragraphs) start at the dateline and end at the contact/disclaimer. 29 of 100 contain tables (`a | b` rows). 9 have no og:image. Languages in the sample: en 92, fr 5, da 1, de 1, ko 1.
- **Blocking log:**

| Date | What we tried | What we saw (status, page content) | Result |
|---|---|---|---|
| 2026-11-25 | curl, Chrome UA | 403 "Access Denied" (Akamai, `errors.edgesuite.net`) | the block is on the client fingerprint |
| 2026-11-25 | Node fetch (`fetchHttp`), same UA | 200 on search, RSS, articles | used |
| 2026-11-27 | `/en/search?pageSize=50&page=101` | 200, repeats earlier results | 5,000-result cap → date slices (D60) |
| 2026-11-27 | ~210 list pages + 100 articles in 8 min, 1 request at a time | all 200 | no blocking seen |

## 3. Fox Business
- **Start URLs:** `/markets`, `/category/stocks` (given), plus `sitemap.xml?type=news` and `sitemap.xml?type=articles` (from robots.txt, D66).
- **Discovery route:**
  - Given pages (HTTP, `html-list`): `article` cards, link `h3 a`/`h2 a` (video cards excluded), relative times only ("1 day ago"). `/markets` ~36 links, `/category/stocks` 20, back ~6 days; no "load more" request fires on scroll.
  - `sitemap.xml?type=news`: ~15 URLs (~2 days), `news:publication_date` ("2026-11-27T10:06:33-05:00"), `news:title`.
  - `sitemap.xml?type=articles`: 5,000 URLs sorted by `lastmod` (newest 2026-11-27T07:58Z, oldest 2025-08-26), with `image:loc`; `&page=2` continues into 2024–25. The index (`sitemap.xml`) also lists `videos`, `liveblogs`, `categories`, `fastchanging` (~17 hub pages).
- **Covering 14 days (2026-11-27, window from 2026-11-13T00:00Z):** articles sitemap `window start reached` in one request. **131 in window** (129 by lastmod + 2 only in the news sitemap); 1 dropped by its page date. ~9 articles a day (Thanksgiving week). By section (lastmod): economy 23, politics 17, markets 16, technology 15, lifestyle 14, fox-news-tech 11, retail 5, business-leaders 5…
- **Fetcher:** HTTP for all (200, Chrome UA). robots.txt disallows only `/search`, `/topics/`, `/xid`, `/fox-money/a/*`.
- **Selectors:** title `h1` (og:title is sometimes a different social headline); body `.article-body`; publishedDate `{ jsonld: 'datePublished' }` (= the visible "Published" time and the news sitemap date; `dcterms.created` is the draft time); og:image; canonical.
- **Clean-up:** `.featured` (lead video/image + caption), `.image-ct` (inline images + captions), `.ad-container`, `.embed-media` (empty without JS), `table.stock-fundamentals` (live quote widget), `p:has(> a > strong)` (ALL-CAPS links to other articles, "GET FOX BUSINESS ON THE GO BY CLICKING HERE", "CLICK HERE TO DOWNLOAD THE FOX NEWS APP"). Checked on the 100-sample: all 99 changed; the removed paragraphs are promos, related-article links, quote rows, image credits and video blurbs; 0 ALL-CAPS paragraphs left.
- **Spot-check (sample of 100 over the window):** 99 written, 0 fullText null, 2,190–17,268 chars (median 3,771), Nov 13–27. Newest (Nov 27 07:58Z, Trump/Nvidia CEO) and oldest (Nov 13 00:53Z) start at the lead and end at the last line ("FOX Business' Bradford Betz contributed to this report.").
- **Labelled `--limit 10`:** pre-filter 5/10, all `others`, 0 errors, $0.0015.
- **Blocking log:** none, no blocking seen.

| Date | What we tried | What we saw (status, page content) | Result |
|---|---|---|---|
| 2026-11-27 | given pages, robots.txt, sitemaps, articles over Node fetch | all 200 | used |
| 2026-11-27 | `/api/article-search?…` (the Fox "load more" API seen on other Fox sites) | 404 | not used |

## 4. Investing.com
- **Start URLs:** `/news/`, `/rss/news_25.rss` (given), plus 13 other news feeds from `/webmaster-tools/rss` (D67).
- **Discovery route:**
  - Feeds (HTTP, `rss`, `list.dateZone: 'UTC'`): `news` (All News), `news_1` (Forex), `_11` (Commodities), `_14` (Economy), `_95` (Economic Indicators), `_285` (Most Popular), `_301` (Crypto), `_356` (Company), `_357` (Insider Trading), `_1061` (Analyst Ratings), `_1062` (Earnings), `_1063` (Earnings Call Transcripts), `_1064` (SEC Filings), `_1065` (Investment Ideas), `_25` (Stock Market). 10 items each, `<enclosure>` image, `pubDate` "2026-11-27 18:21:02" (UTC, checked), **no description**. Skipped: `_355` Press Releases (robots.txt `Disallow: /news/press-releases`), `_350` Personal Finance (2023–24 items).
  - `/news/` (browser, `html-list`): 10 cards `article[data-test="article-item"]`, link `a[data-test="article-title-link"]` (minus `/news/pro/`, disallowed), `<time datetime="2026-11-27 18:28:24">` with text "11 minutes ago".
  - robots.txt (read in the browser) lists `sitemap_index.xml` → `news_sitemap.xml`, `news_company_sitemap.xml`, `news_insider_trading_sitemap.xml`, `news_analyst_ratings_sitemap.xml`, `news_stock_market_sitemap.xml`: all 403 over HTTP.
- **Covering 14 days (2026-11-27):** **not covered.** 16 requests: 138 articles, oldest 2026-11-23T11:02Z (most feeds reach back only hours; Forex/Crypto/Earnings ~2 days). `windowStartReached: false`.
- **What gets written:** each feed article: url, title, publishedDate (feed, UTC), image (enclosure), `text: ""`, `fullText: null` (`blocked`), `others`, no LLM call. Type: `/news/forex-news/` → forex, `/news/cryptocurrency-news/` → crypto (D68). Sample 100: 100 written (in the first run: general 78, crypto 10, forex 7), 95 not requested after 5 blocks. Validate PASS (warnings: R-A7/R-A9 per record, R-D3). Labelled `--limit 10`: 0 LLM calls, $0.
- **Selectors:** none verified (no article page loads).
- **Production approach:** FMP's proxy network (`PROXY_URL`, D63) or Investing.com's licensed data.
- **Blocking log:**

| Date | What we tried | What we saw (status, page content) | Result |
|---|---|---|---|
| 2026-11-27 | robots.txt, `/news/`, sitemaps (`sitemap.xml`, `sitemap_index.xml`, `news_sitemap.xml`), articles; Node fetch, Chrome UA, also full Chrome headers | **403**, body "403" (3 bytes), `server: cloudflare`, `cf-ray` | blocked for plain HTTP |
| 2026-11-27 | `/rss/news_25.rss` and the other `/rss/*.rss`, `/webmaster-tools/rss` | 200 | **used** (D67) |
| 2026-11-27 | headless Chromium (normal Chrome UA): `/news/`, then an article, robots.txt | `/news/` 200 (first page of the session); then **403** "Just a moment..." (`cf-mitigated: challenge`) | the Benzinga pattern (D62) |
| 2026-11-27 | same, 20 s between pages | 200, then 403 challenge, 403 challenge; `navigator.webdriver = true`; `cf_clearance` set after page 1 | slower pacing doesn't help (D13 step 4) |
| 2026-11-27 | robots.txt / `sitemap_index.xml` as the first page of a new browser (probing only) | 200: sitemap list found | not used: reading each sitemap as a fresh session = the rejected fresh-session trick (D62) |
| 2026-11-27 | run: articles over HTTP + breaker | 5 × 403, rest not requested | written from feed data |

## 5. Benzinga
- **Start URLs:** `/sitemap-benzinga.com/www/googlenews.xml` and `/news` (given), plus the added `/sitemap-benzinga.com/www/latest.xml` (from robots.txt).
- **Discovery route:**
  - Google News sitemap (HTTP, `sitemap`): ~335 URLs, 2 days, with `news:publication_date`, `news:title`, `news:stock_tickers` ("NYSE:APO") and `image:loc`. It ignores `?page=2`; `googlenews-2.xml` is 404.
  - `/news` (browser, `html-list`, one page): ~22 cards (`.post-card`, link `a.post-card-article-link`, title `span.inline`), **no dates** on the cards. Plain HTTP gets 403.
  - `latest.xml` (HTTP, `sitemap`, one request): 10,000 URLs, newest first by `<lastmod>`, back ~5 weeks; no titles, no publish dates.
- **Covering 14 days (2026-11-27, window from 2026-11-13T00:00Z):** `latest.xml` reaches 2026-10-21 → `windowStartReached: true`. **2,804 URLs in window** (by `publication_date`, else `lastmod`). Discovery: 3 requests, ~20 s. By section (lastmod, 2,762 earlier in the day): markets 891, news 646, trading-ideas 607, analyst-stock-ratings 189, crypto 162, personal-finance 90, etfs 68, opinion 62, m-a 34, real-estate 11, government 2.
- **Fetcher:** sitemaps over HTTP. Articles: **blocked** (see the log). They are requested over HTTP, and after 5 blocks in a row the rest aren't requested (D61).
- **Selectors (verified on 2 pages loaded before the block, kept for when access exists):** title `h1.article-title` (og:title adds " - SanDisk (NASDAQ:SNDK)"); body `.article-content-body-only`; date `article:published_time` ("2026-11-27T10:29:28.000-05:00", the default selector); og:image; canonical.
- **Clean-up (same):** `.ad-reserved` (ad slots, incl. the "Don't Miss" widget), `.read-next-block`, `p.copyright`. A last line "This content was partially produced with the help of AI tools and was reviewed and published by Benzinga editors." is part of the article and kept.
- **What gets written:** articles with a provable publish date, i.e. those in the Google News sitemap: url, title, publishedDate, image (from the sitemap), `text: ""`, `fullText: null` (reason `blocked`), `others` (no LLM call, D41). In the 100-article sample: 11 written, 89 counted as `droppedNoDate` (lastmod only). A full run would write ~340 and count ~2,460 as not written. **LLM cost: $0.**
- **robots.txt:** allows the article paths; disallows `/pressreleases`, `/secfilings`, `/bzfeed` and others (not used).
- **Production approach:** FMP's proxy network or Benzinga's licensed news API (D62).
- **Blocking log (D13 ladder):**

| Date | What we tried | What we saw (status, page content) | Result |
|---|---|---|---|
| 2026-11-27 | given Google News sitemap, Node fetch (Chrome UA) | 200, 339 URLs, 2 days | used |
| 2026-11-27 | `/news` and an article page, Node fetch | **403**, Cloudflare "Attention Required!", "Sorry, you have been blocked" (`server: cloudflare`, `cf-ray`) | blocked for plain HTTP |
| 2026-11-27 | same, + full browser headers (`sec-ch-ua`, `Sec-Fetch-*`, `Upgrade-Insecure-Requests`) | 403, same page | headers don't help (step 2) |
| 2026-11-27 | AMP `/amp/content/<id>` | 403, same page | no alternative page |
| 2026-11-27 | `/feed` (RSS) | 200, 25 "Top Stories" with **full bodies** in `<description>`, ~1 day; `?page=2`, `?paged=2`, `/feed/` = the same 25 items | too short for the window; a possible fullText source for 25 articles, not used |
| 2026-11-27 | `/news/feed`, `/markets/feed`, `/news/earnings/feed`, `/topic/earnings/feed`, `/rss`, `/money/feed/` | 403; `/feeds` 404; `feeds.benzinga.com` DNS failure | no other RSS |
| 2026-11-27 | sitemaps: `sitemap.xml` index → `archive.xml` (monthly files, **no dates**; Nov = 6,808 URLs), `latest.xml` (lastmod), `channels`, `reports`, `app-routes`, `authors`, `quotes`; `sitemap_index.xml` → `/money/feed/post-sitemap*.xml`; `/sec/insider-trades/sitemap.xml`; `googlenews.xml?page=2` | all 200; only `googlenews.xml` has publish dates; `/money/wp-json/…` 403 | `latest.xml` added for coverage; no route with publish dates beyond 2 days |
| 2026-11-27 | headless Chromium (Playwright), default UA ("HeadlessChrome") | 403 on `/news` and an article | step 3 alone fails |
| 2026-11-27 | headless Chromium with a normal Chrome UA | **first page of a session 200**, then 403 on every page, also 75 s later; after the first page: cookies `cf_clearance`, `__cf_bm`, `_cfuvid`; `navigator.webdriver = true` | Cloudflare's script flags the automated session |
| 2026-11-27 | considered: a fresh browser session per article; hiding automation markers (`navigator.webdriver`, `AutomationControlled`) | not run | **rejected** (Marwan): they deliberately defeat the block (D62) |
| 2026-11-27 | run with articles over HTTP + circuit breaker | 5 × 403, then the rest not requested (95 of 100 in the sample) | D61; production: FMP's proxy network or Benzinga's licensed API |

## 6. CryptoPotato
- **Start URLs:** `https://cryptopotato.com/feed` (given), plus the WordPress REST API `https://cryptopotato.com/wp-json/wp/v2/posts?per_page=100&_fields=link,date_gmt,title,excerpt` (added, D27).
- **How R-D2 is satisfied:** the given feed is still the first source and is fetched on every run, exactly as given, with no query params added. The REST API is an **added** route on the same site, used only to page back past the feed's ~2 days. Both sources' items are merged and deduplicated by canonical URL (D30).
- **Discovery route:**
  - Feed: RSS 2.0, 36 items (~2 days), discoverer `rss`, `paging: null`.
  - REST API: JSON array of posts with `link`, `date_gmt` (UTC, no `Z`), `title.rendered`, `excerpt.rendered`. Discoverer `wp-json`. Headers `X-WP-Total` / `X-WP-TotalPages` give the totals (37,275 posts / 373 pages of 100 on 2026-11-23). Past the last page WordPress returns an error object, which the discoverer turns into [] ("empty page").
- **Covering 14 days:** the feed **ignores** `?paged=N`: `/feed?paged=2`, `/feed/?paged=2` return the same 36 items, byte-identical (218,874 bytes), so a page cache ignores the query. The REST API pages correctly with `&page=N` (page 2 = Nov 12–17). Schema on that source: `paging: { param: 'page', maxPages: 10 }`. On 2026-11-23 it needed 3 pages; oldest date reached 2026-11-05. Cross-check: `X-WP-Total` with `after=2026-11-09T00:00:00` = 261; we found 261 in window.
- **Fetcher:** http for both. Feed, REST API and article pages return 200 with a Chrome User-Agent.
- **Selectors:** body `.post-details-content` (there's no `.entry-content`). og:title, og:image, `article:published_time` and canonical are present and clean, so the defaults work.
- **Clean-up:** removed from the body: `.code-block` (ad scripts), `.single-post-tags` ("Tags: …"), `h3.heading-4 + ul` and `h3.heading-4` (the "You may also like:" heading and its list of links). Quotes are in `<blockquote>`, now a default fullText block (D29).
- **Video posts (for the README):** `/video/…` URLs (2 in the 2026-11-23 and 2026-11-24 runs) are a title, a lead image and a JavaScript video player, with **no article text**. There is no description anywhere either: the REST excerpt, `og:description`, meta `description` and `twitter:description` are all empty. They are **kept** (every article counts, D31), with `fullText: null`, reason `noBody` in `stats.json`, and `text: ""` (nothing to summarize, D32). The site did not block us: the pages return 200. Validator: one R-A7 and one R-A9 warning each, with the reason shown.
- **Checked on all 261 cached pages:** every `h3.heading-4` is "You may also like:" (200 of them), so removing it can't drop a real subheading.
- **Timing:** 470 s for 261 articles + 4 list pages (pages are ~290 KB each).
- **Type:** `defaultType: 'crypto'`.
- **Blocking log:**

| Date | What we tried | What we saw (status, page content) | Result |
|---|---|---|---|
| 2026-11-23 | `/feed/?paged=2` | 200, the same 36 items as page 1 | the feed can't page back |
| 2026-11-23 | `/feed/?paged=3&x=1` (cache-buster) | **429**, Cloudflare "Just a moment…" challenge page | never add unknown params to this site's URLs |
| 2026-11-23 | `/wp-json/wp/v2/posts?per_page=100&page=2` | 200 JSON, 100 posts, `cf-cache-status: MISS` | used for paging back (D27) |
| 2026-11-23 | `/sitemap_index.xml`, `/page/2/` | 200 (Yoast sitemap index; HTML archive page) | not used: only `lastmod` / no machine-readable dates |
| 2026-11-25 | `CACHE=1` run on a mobile hotspot: 19 article pages not in the cache yet | **403** on all 19 (the 235 cached pages weren't fetched); feed and REST API still 200 | written with `fullText: null`, reason `blocked` (D31). Likely the hotspot IP; retry from the usual network before Phase 5 (D13 step 4) |
| 2026-11-27 | `--sample 5` run (Phase 4 step 0 check), 1 new article page | **403** again (`/monero-xmr-drops-15-daily-heres-the-reason/`) | not only the hotspot: try the browser fetcher for CryptoPotato articles in Phase 5 |
| 2026-11-27 (session B) | 3 recent feed articles not in `.cache/`, http fetcher (Chrome UA), usual network | **403 on all 3**: Cloudflare managed challenge, `cf-mitigated: challenge`, `<title>Just a moment...` (5,974 bytes); feed still 200 | articles now challenged for plain HTTP from this network, not only the hotspot |
| 2026-11-27 (session B) | 2 of them in the browser fetcher; then with a test change that waits on a 403 challenge (3 × 20 s) | 403 in 2.5 s; with waiting: still the challenge after 75 s | headless Chromium doesn't pass this challenge (as on Benzinga, D62); change reverted (D63). Phase 5: ~235 pages are in `.cache/`; uncached ones will be `blocked`. Production: FMP's proxy (`PROXY_URL`, D63) |

## 7. Newsfile
- **Start URLs:** `https://feeds.newsfilecorp.com/global/Last25Stories` (given), `https://www.newsfilecorp.com/` (given), plus the added `https://www.newsfilecorp.com/search?k=` (D56).
- **Discovery route:**
  - Feed (HTTP, `rss`, `paging: null`): 25 newest releases (~2 hours on a weekday morning), English and French (`<item xml:lang="fr">`). Descriptions are truncated to ~500 chars. It ignores `?page=2` and `/2` (same 25 items).
  - Homepage (browser, `html-list`, one page): "Today's Top Releases", 5 items (`section.nf-section-skytint figure.nf-tiles-logo`, link `a`, title `h5`, date `p`). Links are `/release/<id>/` with no slug; the page's canonical fixes them.
  - **Search with no keyword** (browser, `html-list`): every release, newest first, 25 per page, `?pg=N` (`article.nf-tiles figure`, link `h3 a`, date `p.date:last-of-type` = "2026-11-27 11:05 AM EST | Company", description `p[lang]`). Links carry `?k=`, dropped by `dropQuery`.
- **Covering 14 days:** 2026-11-27 run (window from 2026-11-13T00:00Z): **83 search pages → window start reached**, oldest 2026-11-12T22:55Z, **2,082 discovered, 2,068 in window**. Search pages are paced at 4 s (D59). Discovery takes ~8 min.
- **Fetcher:** feed over HTTP; homepage, search and article pages through the **browser** (D55). Every `www` page, robots.txt and sitemaps included, answers plain HTTP with an AWS WAF challenge.
- **Selectors:** body `article#release`; title og:title (clean); image og:image (a generated social card, `…/socialImage/<company>/facebook/<id>`); canonical present. **No publish date on the release page** (no `article:published_time`, no JSON-LD; only the dateline "November 27, 2026" and a sidebar of the company's releases), so `publishedDate` comes from the list item (feed `pubDate` with offset, or the search list's "… AM EST"): `selectors.publishedDate: null`.
- **Clean-up:** `#contactInfo`, `#corporateNewsLogoContainer`, `#corporateLinkBack`, `p:contains("To view the source version of this press release")` (the same line without its id, seen once in 100), `img.tracker`, `p:has(> a[href^="/company/"])` ("Source: <company>" link). A "Source: X" line the issuer wrote into its own text stays (1 of 100).
- **Spot-check (sample of 100 spread over the window, 2026-11-27):** 100/100 with fullText (1,072–20,692 chars, median 4,661); newest (Nov 27 16:05Z, Rosen Law ENSG) and oldest (Nov 13 00:00Z = 7:00 PM EST Nov 12, Gold Springs Q3 filings) start at the dateline and end at the release's own last line (disclaimer / forward-looking statements). About a third of releases are law-firm class-action notices.
- **Language:** French releases are kept (D56/D57); the search list may be English-only (its form has a hidden `l=en`); French releases certainly reach us through the feed. To check in Phase 5.
- **Timing per article (browser):** ~1.5–2.5 s + `delayMs` 1 s. Full extraction of ~2,070 releases ≈ 1.5–2 h (Phase 5).
- **Blocking log:**

| Date | What we tried | What we saw (status, page content) | Result |
|---|---|---|---|
| 2026-11-27 | homepage, `/release/…`, `/newsroom`, `/sitemap.xml`, `/robots.txt` with Node fetch (Chrome UA) | **202**, 2.5 KB page with `window.gokuProps` + `challenge.js` from `awswaf.com`, header `x-amzn-waf-action: challenge` | plain HTTP can't pass (it runs no JavaScript) |
| 2026-11-27 | same, + full browser headers (`sec-ch-ua`, `Sec-Fetch-*`) | 202, same challenge | headers alone don't help (D13 step 2) |
| 2026-11-27 | `feeds.newsfilecorp.com/global/Last25Stories?page=2`, `/2`, `/global/Last100Stories` | 200 same 25 items; 200 empty (25 bytes) | the feed can't page back |
| 2026-11-27 | headless Chromium (Playwright) | challenge solves itself in ~3–5 s, sets `aws-waf-token`, page reloads with 200; next pages load directly | **works** (D13 step 3) |
| 2026-11-27 | `/sitemap-news.php` (browser) | 5,000 release URLs (IDs 304136–326126), **no dates** | not used: can't stop at the window start |
| 2026-11-27 | `/news/business?pg=N` | one industry, ~40 per page, empty by page 60 | not used: one industry only |
| 2026-11-27 | `/search?k=&pg=N` at ~1 page/1.5 s | pages 1–37 fine, then **200 with no results**: "Our public search function is currently experiencing unusually high demand. Please try again in a few minutes." | rate limit (D59): `list.blockedText` + 4 s pacing + 90 s pause/retry |
| 2026-11-27 | `/search?k=&pg=N` at 4 s pacing | 83 pages, no rate-limit page | window covered |
| 2026-11-27 | first browser page of a session | `page.content()` read during the challenge reload gave an empty body | fetcher fixed: empty = not ready (D55) |

## 8. Zacks
- **Start URLs:** `/articles/index.php`, `/stock/news` (given).
- **Protection:** Imperva (the "Pardon Our Interruption" JavaScript challenge, `reese84`), served with **200** on every page, robots.txt excepted. `blockReason()` now recognizes the title (D65). In the browser the challenge clears on the session's first page (~50 s), then pages load in 2–5 s.
- **Discovery found (2026-11-27):**
  - `/articles/index.php` (browser): "Most Recent Articles", **10 items** (`.listitem`, link `h1 a`, date `time` "Published on November 27,2026"). Its paging links (`?page=2…4`) and the infinite-scroll endpoint `?page=N&type=json` return **no items** for every page after 1 (checked 2, 5, 10, 50, 60).
  - `/stock/news` (browser): **403** every time (also after the challenge cleared for the session).
  - robots.txt sitemaps: `news_all_articles_sitemap.xml` (Google News, **500 URLs = ~1.5 days**, `news:publication_date` **date only**, "2026-11-27"), `all_articles_sitemap.xml` (the same 500, `lastmod` date only, `image:loc`), `all_articles_pf_sitemap.xml` (380 personal-finance URLs back to 2024). `?page=2` is ignored; `/sitemap.xml`, `/sitemap_index.xml`, `/rss/` 404; `/rss/rss_news.php` = the challenge; `/sitemap.php` is an HTML site map.
- **Publish time:** **none anywhere.** Article page: JSON-LD `"datePublished": "2026-11-27"`, `<time datetime="00:00">November 27, 2026`; `meta name="date"` / `last-modified` = the time the page was generated (= now), not the publish time. R-A1 asks for the real publish time. **Decision (Marwan, D69):** written with the day at 00:00 New York time, flagged as day precision (trace, `stats.dayOnlyDates`, validator R-A1 warning).
- **Selectors (verified on 1 article):** body `#comtext` (`.commentary_body`); og:title, og:image, canonical clean. Clean-up candidates: `button` ("Quick Quote"), `.third_para_ad_commentary`, `.inline_top_ad_commentary`, `.inline_bottom_ad_commentary`, `.cta_section`. "Key Takeaways" (`.key-points`) is article text.
- **Configured (D69):** sources `/articles/index.php` (browser, `.listitem` / `h1 a`), `/stock/news` (403, `page 1 failed`), `news_all_articles_sitemap.xml` (browser; the fetcher now returns the raw XML). Lists and articles through the browser, `delayMs` 2000. Body `#comtext, #reserach_daily` (the Research Daily layout, the site's spelling); date `{ jsonld: 'datePublished', dayZone: 'ET' }`; remove list as above plus `p:contains("Image Source: Zacks Investment Research")` (chart captions).
- **Run (2026-11-27, sample 100 of 510):** 510 in window (the sitemap's 500 + the list's 10), `windowStartReached: false` (no list date: the window is not covered beyond ~1.5 days). 90 written, all with fullText (1 Research Daily page fixed by the grouped body selector), all `dayOnlyDates` (2026-11-26T05:00Z / 2026-11-27T05:00Z). **10 not written: the article redirects to the homepage**, also by id alone (`/stock/news/3036582/`): removed or premium pieces (~9% of the sitemap). The extractor now keeps the requested URL when a page's canonical is the site root, so they're listed by their own URL in `droppedNoDateUrls`. Newest (WAT, Nov 27) and oldest (quantum stocks, Nov 26) start at "Key Takeaways" and end at the last paragraph; 0 "Quick Quote" or caption lines left. Validate PASS (R-A1 day-only, R-D1, R-D2, R-D3 warnings). Labelled `--limit 10`: pre-filter 10/10, all `others` (analysis pieces), symbols XOM, PNW, HIG, BMY; $0.0061 ($0.00061/article). Discovery + 100 articles: 7 min.
- **Production approach:** a route back 14 days needs Zacks' licensed content feed; the day-only dates stay a site limit.
- **robots.txt:** `User-agent: *` disallows `/search/`, `/pr/`, `/article/stock/news/`, PDFs, registration; article paths `/stock/news/<id>/`, `/commentary/<id>/` allowed. `GPTBot` disallowed entirely (we're not GPTBot; noted).
- **Blocking log:**

| Date | What we tried | What we saw (status, page content) | Result |
|---|---|---|---|
| 2026-11-27 | `/articles/index.php`, `/stock/news`, sitemaps, `/rss/` with Node fetch (Chrome UA), also full Chrome headers | **200**, 5,996 bytes, `<title>Pardon Our Interruption`, Imperva `reese84` script; robots.txt 200 | plain HTTP can't pass a JS challenge |
| 2026-11-27 | headless Chromium (browser fetcher) | first page of a session: challenge clears (~50 s); then sitemaps, `/articles/index.php`, articles **200**; `/stock/news` 403 | **works** (D13 step 3) |
| 2026-11-27 | `/articles/index.php?page=N` and `?page=N&type=json` (N = 2, 5, 10, 50, 60) | 200, no items | the list holds 10 articles |
| 2026-11-27 | sitemaps from robots.txt; `?page=2`; `/sitemap.xml`, `/sitemap_index.xml`, `/sitemap.php`, `/rss/` | 500 URLs (~1.5 days, date only); same; 404; HTML; 404 | no route back 14 days found |

## 9. Business Wire
- **Start URLs:** `https://www.businesswire.com/newsroom` (given, blocked: `page 1 failed` each run), plus the added daily Google News sitemaps `https://www.businesswire.com/sitemap/google-news/{YYYY-MM-DD}.xml.gz` (D64).
- **Discovery route:** robots.txt (no `User-agent: *` group, so nothing is disallowed for us; named crawlers get `Crawl-delay: 10`) lists `sitemap-index.xml` (site pages), `sitemap/standard/smaps-bw-mod.xml` and `sitemap/google-news/gn-bw-mod.xml` (each an index of 345 **daily** files) and an MRSS feed. A daily Google News file holds every release of that UTC day, all languages: `<loc>`, `news:publication_date` ("2026-11-26T22:12:00.000Z"), `news:title`, `news:language`, `image:loc`. Same URL set as the standard daily file (224 / 796 / 433 on Nov 26 / 18 / 13).
- **Covering 14 days (2026-11-27, window from 2026-11-13T00:00Z):** 15 files, all loaded (`single page` → slice complete). Per day: 27th 165 (to 18:02Z), 26th 224 (Thanksgiving), 25th 439, 24th 627, 23rd 587, 22nd 43, 21st 40, 20th 473, 19th 894, 18th 796, 17th 973, 16th 664, 15th 11, 14th 54, 13th 433. **6,416 discovered = 6,416 in window**, oldest 2026-11-13T00:08Z, `windowStartReached: true`. Discovery 16 requests, ~70 s at 3 s pacing. Languages on Nov 18: en 630, fr 28, es/it/de 21, nl 19, ar 12, ja/zh-HK 11, zh-CN 10, pt 9…
- **Dates checked:** 2 releases in both the MRSS feed and the Nov 27 sitemap: same time to the minute (10:06Z, 10:05Z).
- **Fetcher:** HTTP with the entry's `headers` (`sec-ch-ua`, `sec-ch-ua-mobile`, `sec-ch-ua-platform`): without them even the sitemaps are Akamai "Access Denied". Articles: **blocked**; the breaker (D61) stops after 5.
- **Selectors / clean-up:** none verified (no article page ever loaded). Defaults stay.
- **What gets written:** every in-window release: url, title, publishedDate, image, `text: ""`, `fullText: null` (`blocked`), `others`, no LLM call (D41). **LLM cost: $0.** Sample 100: 100 written, 95 not requested after 5 blocks. Validate PASS (warnings: R-A9 per record, R-D2 for `/newsroom`, sample, LABEL). Labelled `--limit 10`: 10 written, 0 LLM calls, $0.
- **Production approach:** FMP's proxy network (`PROXY_URL`, D63) or Business Wire's licensed feed.
- **Blocking log:**

| Date | What we tried | What we saw (status, page content) | Result |
|---|---|---|---|
| 2026-11-25 | `/newsroom` with curl (Chrome UA) and with our `fetchHttp` (Node fetch) | **403** "Access Denied" (Akamai) on both | blocked for plain HTTP. Its eval fixture slots went to GlobeNewswire |
| 2026-11-27 | `robots.txt`, `/newsroom`, Node fetch (Chrome UA) | 403 "Access Denied" (`AkamaiGHost`) | |
| 2026-11-27 | `feed.businesswire.com/rss/home/?rss=G1QFDERJXkJeEFpRWQ==` (the classic "all news" feed) | 200, "The RSS channel you requested was deactivated by the administrator." | no all-news RSS |
| 2026-11-27 | category RSS `?rss=G1QFDERJXkJeGVtRWA==` (Technology: Networks), MRSS from robots.txt | 200; MRSS 47 items over ~1 week, descriptions cut at ~500 chars | not used: truncated, partial; used to cross-check dates |
| 2026-11-27 | full Chrome header set (`sec-ch-ua*`, `Sec-Fetch-*`, `Upgrade-Insecure-Requests`) | sitemaps + robots.txt **200**; `/newsroom`, articles (`/news/home/<id>/<lang>`, with/without slug) **403** "Page Unavailable" with an Akamai Bot Manager script | step 2 opens the sitemaps only. One header group at a time: only `sec-ch-ua*` matters |
| 2026-11-27 | headless Chromium (normal Chrome UA) on `/newsroom`, robots.txt | `net::ERR_HTTP2_PROTOCOL_ERROR` (connection reset) | step 3 fails |
| 2026-11-27 | headed Chromium (`BROWSER_HEADED=1`), an article and `/newsroom` | 403 | step 3 fails; no stealth (D62) |
| 2026-11-27 | `businesswire.com` (no www), `newsroom.`/`services.businesswire.com`, `m.businesswire.com` | 301 to www; marketing pages; TLS name error | no other route |
| 2026-11-27 | daily Google News sitemaps, 15 files at 3 s | all 200 | **used** (D64) |
| 2026-11-27 | run: articles over HTTP + breaker | 5 × 403, rest not requested | as Benzinga (D61, D62) |

## 10. Reuters
- **Start URLs:** `/business/`, `/markets/` (given). **Not collected** (D70, Marwan's decision): the entry is `enabled: false` with a `disabledReason`.
- **robots.txt:** opens with "NOTICE: Collection of content, data and/or information from reuters.com through automated means is prohibited unless you have prior written consent from Reuters and may only be conducted for the purposes explicitly described in such permission." `User-agent: *` → `Allow: /plus/`, `Disallow: /`. Lists sitemaps (`arc/outboundfeeds/news-sitemap-index`, `sitemap-index`, …), all under the disallow.
- **Protection:** DataDome: the given pages answer **401** with "Please enable JS and disable any ad blocker" and a `captcha-delivery.com` script.
- **Production approach:** a licensed Reuters feed (Reuters/LSEG).
- **Blocking log:**

| Date | What we tried | What we saw (status, page content) | Result |
|---|---|---|---|
| 2026-11-27 | robots.txt, Node fetch, full Chrome headers | 200: legal notice + `User-agent: *` `Disallow: /` | probing stopped here |
| 2026-11-27 | `/business/`, `/markets/` (the given URLs), same request | **401**, 774 bytes, DataDome captcha page | not collected (D70); no browser, sitemap or API attempt by design |
