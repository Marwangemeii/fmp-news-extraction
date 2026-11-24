/**
 * Dev cache for article pages (D15). On only when CACHE=1 (run.js decides).
 * The controller wraps the ARTICLE fetcher only; list/feed pages are never cached,
 * so discovery always sees fresh data.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DIR = '.cache';

/**
 * @param {(url: string, entry: object) => Promise<{ url: string, body: string }>} fetcher
 * @param {{ hits: number }} counter incremented on every cache hit (for stats.fromCache)
 * @returns the same signature as `fetcher`
 */
export function cached(fetcher, counter) {
  return async (url, entry) => {
    // sha1 of the URL: a safe, fixed-length file name for any URL.
    const file = join(DIR, `${createHash('sha1').update(url).digest('hex')}.json`);
    try {
      const page = JSON.parse(await readFile(file, 'utf8'));
      counter.hits++;
      return page;
    } catch {
      // Not cached yet (or unreadable): fetch it.
    }
    const page = await fetcher(url, entry); // throws on failure, so failures are never cached
    await mkdir(DIR, { recursive: true });
    await writeFile(file, JSON.stringify({ url: page.url, body: page.body }), 'utf8');
    return page;
  };
}
