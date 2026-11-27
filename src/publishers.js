/**
 * THE schema (R-C1, D4): one entry per publisher, holding only what differs (R-C2).
 * Building blocks are named here and looked up in src/blocks/index.js by the controller.
 * Adding a publisher = adding one entry below (R-C5).
 */

/** Applied to every entry; an entry overrides only what differs (D19). */
const DEFAULTS = {
  enabled: false,
  fetcher: { list: 'http', article: 'http' }, // registry.fetchers names: list pages / article pages
  extract: 'html', // registry.extractors name
  label: 'llm', // registry.labellers name: pre-filter → LLM → code checks (D34)
  delayMs: 1000, // polite pause before each request (D6)
  defaultType: 'general', // the article type; a general-news article about one proven company becomes 'stock' (D47)
  selectors: {}, // overrides for DEFAULT_SELECTORS in src/blocks/extract-html.js
  paging: null, // { param, maxPages }: page back via ?<param>=2, 3… (src/lib/paging.js). null = one page.
};

// A startUrls item is a URL string (uses the entry's `discover` and `paging`) or an object
// { url, discover, paging } that overrides them for that one source (D30).

const ENTRIES = [
  {
    name: 'TechCrunch',
    site: 'techcrunch.com',
    enabled: true,
    startUrls: [
      'https://techcrunch.com/feed/', // the given feed (R-D2); uses discover + paging below
      // Added route (D33): the feed leaves out some posts, the WordPress REST API lists them all.
      {
        url: 'https://techcrunch.com/wp-json/wp/v2/posts?per_page=100&_fields=link,date_gmt,title,excerpt',
        discover: 'wp-json',
        paging: { param: 'page', maxPages: 10 },
      },
    ],
    discover: 'rss',
    paging: { param: 'paged', maxPages: 30 }, // feed/?paged=2, 3… 20 items a page, ~13 pages for 14 days
    selectors: {
      title: { css: 'h1' }, // og:title has a " | TechCrunch" suffix
      body: '.entry-content',
      remove: [
        '.ad-unit',
        '.wp-block-techcrunch-card', // related-article cards
        '.jw-player-inline-promo',
        '.wp-block-tc23-post-relevant-terms',
        '.wp-block-techcrunch-social-share',
        '.wp-block-techcrunch-post-authors',
      ],
    },
  },
  {
    name: 'GlobeNewswire',
    site: 'globenewswire.com',
    enabled: true,
    defaultType: 'pressReleases', // a wire: companies' own announcements (D47)
    // Node's fetch gets 200 here; curl gets an Akamai 403 (it's the client fingerprint, not the headers).
    startUrls: [
      // The given URLs (R-D2), fetched exactly as written: 10 releases of the last 24 hours, and a subject page.
      { url: 'https://www.globenewswire.com/en/search/date/24HOURS?pageSize=10&page=1', paging: null },
      { url: 'https://www.globenewswire.com/en/search/subject/prs', paging: null },
      // Added route (D57, D60): the same search filtered to a date range lists every release (all languages),
      // newest first, 50 per page (the site's maximum). The search returns at most 5,000 results (100 pages),
      // and 14 days are ~8,000+, so the window is cut into 3-day slices (~1,500–3,300 each).
      {
        url: 'https://www.globenewswire.com/en/search/date/%5B{from}%20TO%20{to}%5D?pageSize=50',
        sliceDays: 3,
        paging: { param: 'page', maxPages: 100 },
      },
    ],
    discover: 'html-list',
    list: {
      item: '.recentNewsH li',
      link: '.mainLink a',
      date: '.date-source span:first-child', // "November 27, 2026 10:30 ET"
      description: '.newsTxt',
    },
    selectors: {
      body: '[itemprop="articleBody"]', // only the release text; tags and contacts are outside it
      publishedDate: { css: 'meta[property="og:article:published_time"]', attr: 'content' }, // "2026-11-27T15:20:00Z"
      remove: [
        '#gnw_attachments_section-header', // "Attachment" heading (22 of 100 sampled releases)
        '#gnw_attachments_section-items', // its list of attached file names
      ],
    },
  },
  {
    name: 'Fox Business',
    site: 'foxbusiness.com',
    enabled: true,
    startUrls: [
      // The given pages (R-D2): ~20–40 cards each, relative times ("3 hours ago"), so no list date.
      // Video cards are left out: they link to /video/<id>, a player with no article text.
      { url: 'https://www.foxbusiness.com/markets', discover: 'html-list', paging: null },
      { url: 'https://www.foxbusiness.com/category/stocks', discover: 'html-list', paging: null },
      // Added routes (D66), from robots.txt: the Google News sitemap (~15 newest, publish dates) and the
      // articles sitemap (5,000 newest by lastmod, ~15 months; lastmod only pre-filters, D58). The articles
      // sitemap is refreshed a few times a day; the news sitemap covers the hours since.
      { url: 'https://www.foxbusiness.com/sitemap.xml?type=news', discover: 'sitemap', paging: null },
      { url: 'https://www.foxbusiness.com/sitemap.xml?type=articles', discover: 'sitemap', paging: null },
    ],
    list: { item: 'article', link: 'h3 a:not([href*="/video/"]), h2 a:not([href*="/video/"])' },
    selectors: {
      title: 'h1', // og:title is sometimes a different (social) headline
      body: '.article-body',
      // The visible "Published" time; dcterms.created is the draft's creation time.
      publishedDate: { jsonld: 'datePublished' }, // "2026-11-25T23:29:55-05:00"
      remove: [
        '.featured', // the lead video or image block, with its caption
        '.image-ct', // inline images and their captions
        '.ad-container',
        '.embed-media', // embedded posts (empty without JavaScript)
        'table.stock-fundamentals', // live quote widget: "Ticker | Security | Last | Change"
        'p:has(> a > strong)', // ALL-CAPS links to other articles, "GET FOX BUSINESS ON THE GO BY CLICKING HERE"
      ],
    },
  },
  {
    name: 'Investing.com',
    site: 'investing.com',
    enabled: true,
    // Cloudflare answers plain HTTP with 403 on every www page except /rss/*, and the browser after the
    // first page of a session ("Just a moment...", D67). We stop at the legitimate ladder (D62): articles
    // are written from the RSS feeds with fullText null, reason `blocked`; the breaker (D61) stops after 5.
    delayMs: 2000,
    // Sections that are an asset class (D68). Everything else: general, or stock with a proven symbol.
    typeByUrl: [
      { contains: '/news/forex-news/', type: 'forex' },
      { contains: '/news/cryptocurrency-news/', type: 'crypto' },
    ],
    startUrls: [
      // The given /news/ page (R-D2), through the browser (plain HTTP gets 403): 10 cards, "11 minutes ago"
      // (no list date). /news/pro/ links are skipped: robots.txt disallows them.
      {
        url: 'https://www.investing.com/news/',
        fetcher: 'browser',
        discover: 'html-list',
        paging: null,
        list: { item: 'article[data-test="article-item"]', link: 'a[data-test="article-title-link"]:not([href*="/news/pro/"])' },
      },
      // The given feed and, added (D67), the site's other news feeds (/webmaster-tools/rss), 10 items each.
      // Their pubDate has no zone ("2026-11-27 18:21:02"); it is UTC (checked against the page's
      // "2026-11-27T17:59:10Z" for the same article). Left out: press releases (robots.txt disallows
      // /news/press-releases) and personal finance (last item 2024).
      ...['news_25', 'news', 'news_1', 'news_11', 'news_14', 'news_95', 'news_285', 'news_301', 'news_356', 'news_357',
        'news_1061', 'news_1062', 'news_1063', 'news_1064', 'news_1065'].map((feed) => ({
        url: `https://www.investing.com/rss/${feed}.rss`,
        discover: 'rss',
        paging: null,
        list: { dateZone: 'UTC' },
      })),
    ],
  },
  {
    name: 'Benzinga',
    site: 'benzinga.com',
    enabled: true,
    // Article pages are blocked by Cloudflare (403 "Sorry, you have been blocked") over HTTP, and in the
    // browser after the first page of a session (D62). We stop at the legitimate ladder (no stealth), so
    // articles are written from sitemap data with fullText null, reason `blocked`; the circuit breaker
    // (D61) stops requesting them after 5 blocks in a row. The sitemaps work over HTTP.
    fetcher: { list: 'http', article: 'http' },
    delayMs: 2000,
    startUrls: [
      // The given Google News sitemap (R-D2): ~340 articles, ~2 days, with publish dates and titles.
      { url: 'https://www.benzinga.com/sitemap-benzinga.com/www/googlenews.xml', discover: 'sitemap', paging: null },
      // The given /news page: ~25 cards, no dates on the cards (the article page's date decides).
      {
        url: 'https://www.benzinga.com/news',
        fetcher: 'browser',
        discover: 'html-list',
        paging: null,
        list: { item: '.post-card', link: 'a.post-card-article-link', title: 'span.inline' },
      },
      // Added route (D58): the "latest" sitemap from robots.txt, 10,000 URLs (~5 weeks) in one request,
      // newest first by lastmod. lastmod is a modification date, so it's only used to pre-filter.
      { url: 'https://www.benzinga.com/sitemap-benzinga.com/www/latest.xml', discover: 'sitemap', paging: null },
    ],
    selectors: {
      title: 'h1.article-title', // og:title adds " - Company (NASDAQ:TICKER)"
      body: '.article-content-body-only',
      remove: [
        '.ad-reserved', // ad slots, incl. the "Don't Miss" widget
        '.read-next-block', // "Read Next" card
        'p.copyright',
      ],
    },
  },
  {
    name: 'CryptoPotato',
    site: 'cryptopotato.com',
    enabled: true,
    startUrls: [
      // The given feed (R-D2). It ignores ?paged=N, and unknown params trigger a Cloudflare 429, so one page only.
      { url: 'https://cryptopotato.com/feed', discover: 'rss', paging: null },
      // Added route for paging back (D27): the WordPress REST API, 100 posts per page.
      {
        url: 'https://cryptopotato.com/wp-json/wp/v2/posts?per_page=100&_fields=link,date_gmt,title,excerpt',
        discover: 'wp-json',
        paging: { param: 'page', maxPages: 10 },
      },
    ],
    defaultType: 'crypto',
    selectors: {
      body: '.post-details-content',
      remove: [
        '.code-block', // ad scripts
        '.single-post-tags', // "Tags: …"
        'h3.heading-4 + ul', // the "You may also like:" link list (before the heading rule, which removes its anchor)
        'h3.heading-4', // the "You may also like:" heading
      ],
    },
  },
  {
    name: 'Newsfile',
    site: 'newsfilecorp.com',
    enabled: true,
    defaultType: 'pressReleases', // a wire: companies' own announcements (D47)
    // www.newsfilecorp.com answers every plain HTTP request with an AWS WAF JavaScript challenge (202),
    // so its pages go through the browser (D55). The feed lives on another host and works over HTTP.
    fetcher: { list: 'http', article: 'browser' },
    startUrls: [
      // The given feed (R-D2): the newest 25 releases (~2 hours), English and French.
      { url: 'https://feeds.newsfilecorp.com/global/Last25Stories', discover: 'rss', paging: null },
      // The given homepage: "Today's Top Releases" (5 items).
      {
        url: 'https://www.newsfilecorp.com/',
        fetcher: 'browser',
        discover: 'html-list',
        paging: null,
        list: { item: 'section.nf-section-skytint figure.nf-tiles-logo', link: 'a', title: 'h5', date: 'p' },
      },
      // Added route (D56): the site's search with no keyword lists every release, newest first,
      // 25 per page, paged with ?pg=N. ~85 pages cover 14 days.
      {
        url: 'https://www.newsfilecorp.com/search?k=',
        fetcher: 'browser',
        discover: 'html-list',
        paging: { param: 'pg', maxPages: 150 },
        // The search is rate-limited: ~37 pages at 1 a second, then "unusually high demand" (D59).
        delayMs: 4000,
        list: {
          item: 'article.nf-tiles figure',
          link: 'h3 a',
          date: 'p.date:last-of-type', // "2026-11-27 11:05 AM EST | Company"
          description: 'p[lang]',
          dropQuery: true, // links carry "?k=": the same release as in the feed
          blockedText: 'Our public search function is currently experiencing unusually high demand',
        },
      },
    ],
    selectors: {
      body: 'article#release',
      // The release page has no machine-readable publish date (no article:published_time, no JSON-LD),
      // so the date comes from the list item (feed pubDate or the search list's "… AM EST").
      publishedDate: null,
      remove: [
        '#contactInfo', // "Contact information:" block
        '#corporateNewsLogoContainer', // logo
        '#corporateLinkBack', // "To view the source version of this press release, please visit …"
        'p:contains("To view the source version of this press release")', // the same line without its id
        'img.tracker',
        'p:has(> a[href^="/company/"])', // "Source: <company>"
      ],
    },
  },
  {
    name: 'Zacks',
    site: 'zacks.com',
    startUrls: ['https://www.zacks.com/articles/index.php', 'https://www.zacks.com/stock/news'],
  },
  {
    name: 'Business Wire',
    site: 'businesswire.com',
    enabled: true,
    defaultType: 'pressReleases', // a wire: companies' own announcements (D47)
    // Akamai Bot Manager blocks every HTML page (403 "Page Unavailable"), over HTTP and in the browser (D64).
    // The sitemaps answer only with the client hints a real Chrome sends with this User-Agent (D13 step 2).
    // Articles are written from the daily Google News sitemaps with fullText null, reason `blocked`;
    // the circuit breaker (D61) stops requesting them after 5 blocks in a row.
    headers: {
      'sec-ch-ua': '"Chromium";v="131", "Google Chrome";v="131", "Not_A Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
    },
    delayMs: 3000, // robots.txt asks named crawlers for 10 s; ~20 requests a run
    startUrls: [
      // The given newsroom (R-D2): blocked (403), recorded as "page 1 failed" each run.
      { url: 'https://www.businesswire.com/newsroom', discover: 'html-list', paging: null, list: { item: 'li', link: 'a' } },
      // Added route (D64), from robots.txt: one Google News sitemap per UTC day, every release in every
      // language, with title, publish date and image. One file per day of the window.
      { url: 'https://www.businesswire.com/sitemap/google-news/{from}.xml.gz', discover: 'sitemap', sliceDays: 1, paging: null },
    ],
  },
  {
    name: 'Reuters',
    site: 'reuters.com',
    startUrls: ['https://www.reuters.com/business/', 'https://www.reuters.com/markets/'],
    // enabled: false via DEFAULTS. No discover/selectors yet; configured in Phase 4.
  },
];

export const publishers = ENTRIES.map((e) => ({ ...DEFAULTS, ...e }));
