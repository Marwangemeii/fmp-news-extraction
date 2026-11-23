/**
 * Plain HTTP fetcher (D5, D6). Downloads the raw response body; runs no JavaScript.
 * Polite: waits `delayMs` before every request, times out, retries with backoff.
 */

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
 * @returns {Promise<{ url: string, body: string }>} `url` is the final URL after redirects
 */
export async function fetchHttp(url, entry = {}) {
  const delayMs = entry.delayMs ?? 1000;
  let lastError;

  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    // Backoff: 1x, 2x, 4x, 8x the base delay.
    await sleep(delayMs * 2 ** attempt);
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.ok) return { url: res.url, body: await res.text() };

      lastError = new Error(`HTTP ${res.status} for ${url}`);
      if (!isRetryable(res.status)) break;
    } catch (err) {
      // Network error or timeout: worth retrying.
      lastError = new Error(`${err.name}: ${err.message} for ${url}`);
    }
  }
  throw lastError;
}
