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
  label: 'placeholder', // registry.labellers name (Phase 3 swaps it here, once)
  delayMs: 1000, // polite pause before each request (D6)
  defaultType: 'general', // placeholder until the Phase 3 type rule (D23)
  selectors: {}, // overrides for DEFAULT_SELECTORS in src/blocks/extract-html.js
};

const ENTRIES = [
  {
    name: 'TechCrunch',
    site: 'techcrunch.com',
    enabled: true,
    startUrls: ['https://techcrunch.com/feed/'],
    discover: 'rss',
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
    startUrls: ['https://cryptopotato.com/feed'],
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
