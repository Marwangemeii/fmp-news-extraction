/**
 * Paging back (D28) and per-source discovery (D30), with a fake fetcher and discoverer: no network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toSources, pageUrl, discoverPages } from '../src/lib/paging.js';

const window = { start: new Date('2026-11-09T00:00:00Z') };
const item = (id, date) => ({ url: `https://news.test/${id}`, publishedDate: date });

/**
 * Runs discoverPages over fake pages. `pages[n - 1]` is what page n contains,
 * or the string 'fail' to make that page's fetch throw.
 */
async function run(pages, paging = { param: 'page', maxPages: 10 }) {
  const fetched = [];
  const fetchList = async (url) => {
    fetched.push(url);
    const n = Number(new URL(url).searchParams.get('page') ?? 1);
    if (pages[n - 1] === 'fail') throw new Error(`HTTP 500 for ${url}`);
    return { url, body: JSON.stringify(pages[n - 1] ?? []) };
  };
  const discover = (body) => JSON.parse(body);
  const source = { url: 'https://news.test/list', discover: 'fake', paging };
  return { ...(await discoverPages(source, {}, { fetchList, discover, window })), fetched };
}

test('pageUrl: page 1 is the URL as written; later pages set the param', () => {
  assert.equal(pageUrl('https://x.test/feed/', 'paged', 1), 'https://x.test/feed/');
  assert.equal(pageUrl('https://x.test/feed/', 'paged', 2), 'https://x.test/feed/?paged=2');
  assert.equal(pageUrl('https://x.test/api?per_page=100', 'page', 3), 'https://x.test/api?per_page=100&page=3');
});

test('stops once a page goes past the window start', async () => {
  const r = await run([
    [item(1, '2026-11-20T00:00:00.000Z'), item(2, '2026-11-15T00:00:00.000Z')],
    [item(3, '2026-11-10T00:00:00.000Z'), item(4, '2026-11-08T23:00:00.000Z')],
    [item(5, '2026-11-01T00:00:00.000Z')], // never fetched
  ]);
  assert.equal(r.stop, 'window start reached');
  assert.equal(r.pages, 2);
  assert.equal(r.items.length, 4);
  assert.equal(r.oldestDate, '2026-11-08T23:00:00.000Z');
  assert.equal(r.reachedStart, true);
});

test('stops on an empty page (past the last page)', async () => {
  const r = await run([[item(1, '2026-11-20T00:00:00.000Z')], []]);
  assert.equal(r.stop, 'empty page');
  assert.equal(r.pages, 2);
  assert.equal(r.reachedStart, false);
});

test('stops when a page has no new items (the site ignores the page param)', async () => {
  const same = [item(1, '2026-11-20T00:00:00.000Z'), item(2, '2026-11-19T00:00:00.000Z')];
  const r = await run([same, same, same, same]);
  assert.equal(r.stop, 'no new items');
  assert.equal(r.pages, 2);
  assert.equal(r.items.length, 2);
});

test('stops at maxPages', async () => {
  const pages = [1, 2, 3, 4, 5].map((n) => [item(n, `2026-11-2${n}T00:00:00.000Z`)]);
  const r = await run(pages, { param: 'page', maxPages: 3 });
  assert.equal(r.stop, 'max pages');
  assert.equal(r.pages, 3);
});

test('a failing page 2+ stops paging with the error; a failing page 1 throws', async () => {
  const r = await run([[item(1, '2026-11-20T00:00:00.000Z')], 'fail']);
  assert.equal(r.stop, 'page error');
  assert.equal(r.pages, 1);
  assert.match(r.error, /HTTP 500/);
  await assert.rejects(run(['fail']), /HTTP 500/);
});

test('no paging: one page, and no query param is ever added', async () => {
  const r = await run([[item(1, '2026-11-20T00:00:00.000Z')], [item(2, '2026-11-01T00:00:00.000Z')]], null);
  assert.equal(r.stop, 'single page');
  assert.deepEqual(r.fetched, ['https://news.test/list']);
});

test('toSources: strings use the entry defaults; objects override them, including paging: null', () => {
  const entry = {
    discover: 'rss',
    paging: { param: 'paged', maxPages: 5 },
    startUrls: [
      'https://a.test/feed',
      { url: 'https://a.test/api', discover: 'wp-json', paging: { param: 'page', maxPages: 2 } },
      { url: 'https://a.test/other-feed', paging: null },
    ],
  };
  assert.deepEqual(toSources(entry), [
    { url: 'https://a.test/feed', discover: 'rss', paging: { param: 'paged', maxPages: 5 } },
    { url: 'https://a.test/api', discover: 'wp-json', paging: { param: 'page', maxPages: 2 } },
    { url: 'https://a.test/other-feed', discover: 'rss', paging: null },
  ]);
});
