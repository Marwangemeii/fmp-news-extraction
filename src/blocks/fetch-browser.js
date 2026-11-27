/**
 * Browser fetcher (D5, D13 step 3, D55): loads the page in headless Chromium (Playwright), so the
 * site's JavaScript runs. That is what gets past a JavaScript challenge (e.g. an AWS WAF "prove you're
 * a browser" page): the challenge solves itself, sets a cookie, and reloads the real page.
 *
 * - One Chromium for the whole run, launched on first use; `closeBrowser()` ends it (run.js).
 * - One browser context (cookie jar) + one tab per schema entry, so a site's challenge cookie is kept
 *   for its next pages, and sites never share cookies.
 * - Same politeness as the HTTP fetcher: `delayMs` before every request, a timeout, retries with backoff.
 * - Returns the rendered HTML (`page.content()`). For XML or JSON sources, use the http fetcher.
 */
import { chromium } from 'playwright';
import { blockReason } from '../lib/blocked.js';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const TIMEOUT_MS = 45_000; // page load; slower than plain HTTP
const CHALLENGE_WAIT_MS = 20_000; // how long a challenge may take to solve itself
const RETRIES = 2;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @type {Promise<import('playwright').Browser> | null} */
let browserPromise = null;
/** One tab per entry, keyed by the entry object itself (not by its name). */
const tabs = new WeakMap();

async function tabFor(entry) {
  if (!tabs.has(entry)) {
    tabs.set(entry, (async () => {
      browserPromise ??= chromium.launch({ headless: process.env.BROWSER_HEADED !== '1' });
      const context = await (await browserPromise).newContext({ userAgent: USER_AGENT, locale: 'en-US' });
      const page = await context.newPage();
      // The latest main-document response: after a challenge reloads the page, this is the real page's.
      const tab = { page, last: null };
      page.on('response', (res) => {
        if (res.request().isNavigationRequest() && res.frame() === page.mainFrame()) tab.last = res;
      });
      return tab;
    })());
  }
  return tabs.get(entry);
}

/** Playwright gives headers as a plain object; blockReason expects `headers.get(name)`. */
const headersOf = (res) => {
  const h = res?.headers() ?? {};
  return { get: (name) => h[name.toLowerCase()] ?? null };
};

/**
 * @param {string} url
 * @param {{ delayMs?: number }} [entry] the schema entry
 * @param {{ delayMs?: number }} [opts] overrides the entry's delayMs for this call
 * @returns {Promise<{ url: string, body: string }>} `url` is the final URL after redirects
 * @throws {Error} with `err.status` and, for a block or challenge that didn't clear, `err.blocked`
 */
export async function fetchBrowser(url, entry = {}, opts = {}) {
  const delayMs = opts.delayMs ?? entry.delayMs ?? 1000; // a source may pace its list pages slower (D59)
  let lastError;

  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    await sleep(delayMs * 2 ** attempt);
    try {
      const tab = await tabFor(entry);
      tab.last = null;
      await tab.page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });

      // Wait while the page is a challenge: it usually solves itself within a few seconds, then reloads.
      // While it reloads, page.content() throws ("page is navigating"): an empty body means "not ready
      // yet", never "a page with nothing on it" (a list page read that way would end paging early).
      let status;
      let body = '';
      let blocked = null;
      let waited = false;
      const read = async () => {
        await tab.page.waitForLoadState('domcontentloaded', { timeout: TIMEOUT_MS }).catch(() => {});
        status = tab.last?.status() ?? 0;
        body = await tab.page.content().catch(() => '');
        blocked = body ? blockReason({ status, headers: headersOf(tab.last), body }) : null;
      };
      const deadline = Date.now() + CHALLENGE_WAIT_MS;
      // Only a challenge (served with 2xx) can solve itself; a 4xx block page ("you have been blocked") won't.
      const mayClear = () => !body || (blocked && status < 400);
      await read();
      while (mayClear() && Date.now() < deadline) {
        waited = true;
        await sleep(500);
        await read();
      }
      if (waited && !blocked) {
        // The page was reloaded by the challenge: let the new document finish loading, then read it again
        // (reading right at the reload once gave a half-built page with no article links).
        await tab.page.waitForLoadState('load', { timeout: TIMEOUT_MS }).catch(() => {});
        await read();
      }

      if (!body) throw new Error(`no page content after ${CHALLENGE_WAIT_MS / 1000} s`); // caught below: retried
      if (!blocked && status < 400) return { url: tab.page.url(), body };

      lastError = new Error(`${blocked ?? `HTTP ${status}`} for ${url} (browser)`);
      lastError.status = status;
      if (blocked) lastError.blocked = true;
      // Retry only what can change seconds later: a challenge that didn't clear in time, 429, 5xx.
      // A 403 block or a 404 won't; a block is retried at another time (D13 step 4), not hammered now.
      const unclearedChallenge = blocked && status < 400;
      if (!unclearedChallenge && status !== 429 && status < 500) break;
    } catch (err) {
      lastError = new Error(`${err.name}: ${err.message.split('\n')[0]} for ${url} (browser)`);
    }
  }
  throw lastError;
}

/** Closes the shared Chromium, if it was started. Safe to call more than once. */
export async function closeBrowser() {
  if (!browserPromise) return;
  const browser = await browserPromise;
  browserPromise = null;
  await browser.close();
}
