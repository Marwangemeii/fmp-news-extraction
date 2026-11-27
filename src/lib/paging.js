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
 * @typedef {{ url: string, discover: string, paging: Paging | null, fetcher: string, list: object | null }} Source
 *   fetcher: registry.fetchers name for this source's list pages (D55); list: the html-list config (D54)
 */

/**
 * @param {{ startUrls: (string | object)[], discover?: string, paging?: Paging | null,
 *           fetcher?: { list?: string }, list?: object }} entry
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
      fetcher: src.fetcher ?? entry.fetcher?.list ?? 'http',
      list: src.list ?? entry.list ?? null,
      ...(src.delayMs ? { delayMs: src.delayMs } : {}), // slower pacing for this source's list pages (D59)
    };
  });
}

/**
 * The date a list gives for an item: its publish date, or else a sitemap's `lastmod` (`listDate`, D58).
 * Used only to decide when to stop paging and which items can be in the window; lastmod is never
 * earlier than the publish date, so it never drops an in-window article.
 * @param {{ publishedDate?: string | null, listDate?: string | null }} item
 */
export const listDateOf = (item) => item.publishedDate ?? item.listDate ?? null;

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
 * A **rate-limited** list page (HTTP 429, or a rate-limit message the discoverer recognizes,
 * `err.rateLimited`) is retried after a long pause, up to BLOCKED_RETRIES times (D13 step 4, D59):
 * sites lift such limits after a few minutes, and stopping would lose the rest of the window.
 * `blockedRetries` counts them. Other errors (a hard block, a 404) stop paging as before.
 *
 * @param {Source & { delayMs?: number }} source  `delayMs` slows this source's list pages (D59)
 * @param {object} entry the schema entry (passed through to the fetcher for delayMs)
 * @param {{ fetchList: Function, discover: Function, window: { start: Date }, pauseMs?: number }} ctx
 *   pauseMs: the wait before retrying a blocked page (tests pass 0)
 */
export async function discoverPages(source, entry, { fetchList, discover, window, pauseMs = BLOCKED_PAUSE_MS }) {
  const maxPages = source.paging ? source.paging.maxPages : 1;
  const items = [];
  const seen = new Set();
  let pages = 0;
  let oldestDate = null;
  let stop = source.paging ? 'max pages' : 'single page';
  let error = null;
  let blockedRetries = 0;

  pageLoop: for (let n = 1; n <= maxPages; n++) {
    const url = pageUrl(source.url, source.paging?.param, n);
    let found;
    for (let attempt = 0; ; attempt++) {
      try {
        const { body } = await fetchList(url, entry, { delayMs: source.delayMs });
        found = discover(body, url, source); // may throw `rateLimited` on a rate-limit page (list.blockedText)
        break;
      } catch (err) {
        // Only a rate limit is worth waiting for; a hard block (Cloudflare 403) isn't lifted in minutes.
        if ((err.rateLimited || err.status === 429) && attempt < BLOCKED_RETRIES) {
          blockedRetries++;
          console.error(`[paging] ${url} blocked (${err.message}); waiting ${pauseMs / 1000} s, retry ${attempt + 1}/${BLOCKED_RETRIES}`);
          await sleep(pauseMs);
          continue;
        }
        if (n === 1) throw err;
        stop = 'page error';
        error = err.message;
        break pageLoop;
      }
    }
    pages++;

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
      const d = listDateOf(item);
      if (d && (!oldestDate || d < oldestDate)) oldestDate = d;
    }

    // ISO strings in UTC compare correctly as text.
    if (oldestDate && oldestDate < window.start.toISOString()) {
      stop = 'window start reached';
      break;
    }
  }

  const reachedStart = Boolean(oldestDate && oldestDate < window.start.toISOString());
  return { items, pages, oldestDate, reachedStart, stop, error, blockedRetries };
}

const BLOCKED_PAUSE_MS = 90_000;
const BLOCKED_RETRIES = 3;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
