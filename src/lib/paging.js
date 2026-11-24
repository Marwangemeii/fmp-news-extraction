/**
 * Discovery sources and paging back (R-D2, R-D3, D28, D30). Generic: nothing here knows any site.
 *
 * A schema entry's `startUrls` item is either a string, which uses the entry's `discover` and
 * `paging`, or an object `{ url, discover, paging }` that overrides them for that one source.
 */

/**
 * @typedef {{ param: string, maxPages: number }} Paging
 *   param: the query parameter that holds the page number, e.g. 'paged' → ?paged=2
 *   maxPages: safety limit, so a site that ignores the param can't loop forever
 * @typedef {{ url: string, discover: string, paging: Paging | null }} Source
 */

/**
 * @param {{ startUrls: (string | object)[], discover?: string, paging?: Paging | null }} entry
 * @returns {Source[]}
 */
export function toSources(entry) {
  return entry.startUrls.map((s) => {
    const src = typeof s === 'string' ? { url: s } : s;
    return {
      url: src.url,
      discover: src.discover ?? entry.discover,
      // `in`, not `??`: an explicit `paging: null` on a source means "one page only",
      // even when the entry pages.
      paging: 'paging' in src ? src.paging : (entry.paging ?? null),
    };
  });
}

/** Page 1 is the URL as written; page n sets the page parameter. https://x/feed/ → https://x/feed/?paged=2 */
export function pageUrl(url, param, n) {
  if (n === 1) return url;
  const u = new URL(url);
  u.searchParams.set(param, String(n));
  return u.toString();
}

/**
 * Fetches page 1, 2, 3… of one source until the window start is covered.
 * Stop reasons (the first that holds):
 *   'window start reached'  the page's oldest item is older than window.start
 *   'empty page'            the discoverer found nothing (past the last page)
 *   'no new items'          every URL on the page was already seen (the site ignores the page param)
 *   'page error'            page 2+ failed after the fetcher's retries (page 1 failing throws)
 *   'max pages'             safety limit hit
 *   'single page'           the source has no paging
 *
 * @param {Source} source
 * @param {object} entry the schema entry (passed through to the fetcher for delayMs)
 * @param {{ fetchList: Function, discover: Function, window: { start: Date } }} ctx
 */
export async function discoverPages(source, entry, { fetchList, discover, window }) {
  const maxPages = source.paging ? source.paging.maxPages : 1;
  const items = [];
  const seen = new Set();
  let pages = 0;
  let oldestDate = null;
  let stop = source.paging ? 'max pages' : 'single page';
  let error = null;

  for (let n = 1; n <= maxPages; n++) {
    const url = pageUrl(source.url, source.paging?.param, n);
    let body;
    try {
      ({ body } = await fetchList(url, entry));
    } catch (err) {
      if (n === 1) throw err;
      stop = 'page error';
      error = err.message;
      break;
    }
    pages++;

    const found = discover(body, url);
    if (found.length === 0) {
      stop = 'empty page';
      break;
    }
    const fresh = found.filter((item) => !seen.has(item.url));
    if (fresh.length === 0) {
      stop = 'no new items';
      break;
    }
    for (const item of fresh) {
      seen.add(item.url);
      items.push(item);
      if (item.publishedDate && (!oldestDate || item.publishedDate < oldestDate)) oldestDate = item.publishedDate;
    }

    // ISO strings in UTC compare correctly as text.
    if (oldestDate && oldestDate < window.start.toISOString()) {
      stop = 'window start reached';
      break;
    }
  }

  const reachedStart = Boolean(oldestDate && oldestDate < window.start.toISOString());
  return { items, pages, oldestDate, reachedStart, stop, error };
}
