/**
 * Plain HTTP fetcher (D5, D6). Downloads the raw response body; runs no JavaScript.
 * Polite: waits `delayMs` before every request, times out, retries with backoff.
 */
import { blockReason } from '../lib/blocked.js';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const HEADERS = {
  'User-Agent': USER_AGENT,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

const TIMEOUT_MS = 20_000;
const RETRIES = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 429 (too many requests) and 5xx are usually temporary; other 4xx are not worth retrying. */
const isRetryable = (status) => status === 429 || status >= 500;

/**
 * @param {string} url
 * @param {{ delayMs?: number }} [entry] the schema entry (only `delayMs` is used)
 * @param {{ delayMs?: number }} [opts] overrides the entry's delayMs for this call
 * @returns {Promise<{ url: string, body: string }>} `url` is the final URL after redirects
 * @throws {Error} after the last retry; `err.status` is set when the server answered with an HTTP error,
 *   and `err.blocked` when the answer was a block or challenge page (even with status 200/202, D53)
 */
export async function fetchHttp(url, entry = {}, opts = {}) {
  const delayMs = opts.delayMs ?? entry.delayMs ?? 1000; // a source may pace its list pages slower (D59)
  let lastError;

  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    // Backoff: 1x, 2x, 4x, 8x the base delay.
    await sleep(delayMs * 2 ** attempt);
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
      const body = await res.text();
      const blocked = blockReason({ status: res.status, headers: res.headers, body });
      if (res.ok && !blocked) return { url: res.url, body };

      lastError = new Error(`${blocked ?? `HTTP ${res.status}`} for ${url}`);
      lastError.status = res.status; // lets the controller tell "blocked" from other errors
      if (blocked) lastError.blocked = true;
      // A challenge page with status 200/202 won't go away by asking again a second later.
      if (!isRetryable(res.status) || (blocked && res.ok)) break;
    } catch (err) {
      // Network error or timeout: worth retrying.
      lastError = new Error(`${err.name}: ${err.message} for ${url}`);
    }
  }
  throw lastError;
}
