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
    startUrls: ['https://www.foxbusiness.com/markets', 'https://www.foxbusiness.com/category/stocks'],
  },
  {
    name: 'Investing.com',
    site: 'investing.com',
    startUrls: ['https://www.investing.com/news/', 'https://www.investing.com/rss/news_25.rss'],
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
    defaultType: 'pressReleases', // a wire: companies' own announcements (D47)
    startUrls: ['https://www.businesswire.com/newsroom'],
  },
  {
    name: 'Reuters',
    site: 'reuters.com',
    startUrls: ['https://www.reuters.com/business/', 'https://www.reuters.com/markets/'],
    // enabled: false via DEFAULTS. No discover/selectors yet; configured in Phase 4.
  },
];

export const publishers = ENTRIES.map((e) => ({ ...DEFAULTS, ...e }));
