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
  defaultType: 'general', // placeholder until the Phase 3 type rule (D23)
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
    startUrls: [
      'https://www.globenewswire.com/en/search/date/24HOURS?pageSize=10&page=1',
      'https://www.globenewswire.com/en/search/subject/prs',
    ],
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
    startUrls: [
      'https://www.benzinga.com/sitemap-benzinga.com/www/googlenews.xml',
      'https://www.benzinga.com/news',
    ],
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
    startUrls: ['https://feeds.newsfilecorp.com/global/Last25Stories', 'https://www.newsfilecorp.com/'],
  },
  {
    name: 'Zacks',
    site: 'zacks.com',
    startUrls: ['https://www.zacks.com/articles/index.php', 'https://www.zacks.com/stock/news'],
  },
  {
    name: 'Business Wire',
    site: 'businesswire.com',
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
