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
- **Start URLs:** `/en/search/date/24HOURS?pageSize=10&page=1`, `/en/search/subject/prs`
- **Notes:** the start URL only covers 24 hours, so a different route is needed for 14 days (paging the subject search, or a date-range search). **(hypothesis)**
- **Found in Phase 3 (fetching eval fixtures, 2026-11-25):**
  - Node's `fetch` (our `fetchHttp`, Chrome User-Agent) gets **200** on search pages, the RSS feed and article pages. **curl gets 403** "Access Denied" from Akamai (`errors.edgesuite.net`) on the same URLs with the same User-Agent, so the block is on the client fingerprint, not the headers.
  - Keyword search works: `/en/search/keyword/<words>?pageSize=20` lists releases newest first (links `a[href*="/news-release/"]`). Quoted phrases narrow it.
  - RSS: `/RssFeed/orgclass/1/feedTitle/GlobeNewswire%20-%20News%20about%20Public%20Companies` → 200.
  - **Article selectors:** body `[itemprop="articleBody"]`; publish time `meta[property="og:article:published_time"]` (not `article:published_time`, so the default selector misses it); og:title/og:image/canonical present. Datelines look like `NEW YORK, Nov. 24, 2026 (GLOBE NEWSWIRE) --`.
  - Tables come out as `a | b | c` rows, and financial tables are often "in thousands" (D37).

## 3. Fox Business
- **Start URLs:** /markets, /category/stocks
- **Notes:** the list may be loaded by JavaScript or a "Show more" button; check the network tab for a JSON endpoint. **(hypothesis)**

## 4. Investing.com
- **Start URLs:** /news/, /rss/news_25.rss
- **Notes:** may be bot-protected. **(hypothesis)**

## 5. Benzinga
- **Start URLs:** the Google News sitemap, /news
- **Notes:** Google News sitemaps only list about the last 2 days by design, so another route is needed (the sitemap index, or paging /news). **(hypothesis)**

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

## 7. Newsfile
- **Start URLs:** Last25Stories feed, the homepage
- **Notes:** the feed has only 25 items, so another route is needed. Many Canadian issuers: watch for TSXV/CSE ticker suffixes. **(hypothesis)**

## 8. Zacks
- **Start URLs:** /articles/index.php, /stock/news
- **Notes:** may be bot-protected. **(hypothesis)**

## 9. Business Wire
- **Start URLs:** /newsroom
- **Notes:** may be bot-protected. **(hypothesis)**
- **Blocking log:**

| Date | What we tried | What we saw (status, page content) | Result |
|---|---|---|---|
| 2026-11-25 | `/newsroom` with curl (Chrome UA) and with our `fetchHttp` (Node fetch) | **403** "Access Denied" (Akamai) on both | blocked for plain HTTP; Phase 4 tries the ladder (D13). Its eval fixture slots went to GlobeNewswire |

## 10. Reuters
- **Start URLs:** /business/, /markets/
- **Notes:** likely strong bot protection. Check for internal JSON APIs and sitemaps. **(hypothesis)**
