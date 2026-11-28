/**
 * Dev cache for article pages (D15). On only when CACHE=1 (run.js decides).
 * The controller wraps the ARTICLE fetcher only; list/feed pages are never cached,
 * so discovery always sees fresh data.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DIR = '.cache';

// sha1 of the URL: a safe, fixed-length file name for any URL.
const fileOf = (url) => join(DIR, `${createHash('sha1').update(url).digest('hex')}.json`);

/**
 * The cached page for a URL, or null. No request is made, so the circuit breaker (D61) can still use it.
 * @param {string} url
 * @param {{ hits: number }} counter incremented on a hit (for stats.fromCache)
 * @returns {Promise<{ url: string, body: string } | null>}
 */
export async function readCache(url, counter) {
  try {
    const page = JSON.parse(await readFile(fileOf(url), 'utf8'));
    counter.hits++;
    return page;
  } catch {
    return null; // not cached yet (or unreadable)
  }
}

/**
 * @param {(url: string, entry: object) => Promise<{ url: string, body: string }>} fetcher
 * @param {{ hits: number }} counter incremented on every cache hit (for stats.fromCache)
 * @returns the same signature as `fetcher`
 */
export function cached(fetcher, counter) {
  return async (url, entry) => {
    const hit = await readCache(url, counter);
    if (hit) return hit;
    const file = fileOf(url);
    const page = await fetcher(url, entry); // throws on failure, so failures are never cached
    await mkdir(DIR, { recursive: true });
    await writeFile(file, JSON.stringify({ url: page.url, body: page.body }), 'utf8');
    return page;
  };
}
