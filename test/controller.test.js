/**
 * The controller with a fake registry (no network): every null fullText gets a reason (D31).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAll, spreadSample } from '../src/controller.js';
import { extractHtml } from '../src/blocks/extract-html.js';

const window = { start: new Date('2026-11-10T00:00:00Z'), end: new Date('2026-11-24T12:00:00Z') };
const date = '2026-11-20T10:00:00.000Z';

/** Each fake article URL behaves differently when fetched. */
const PAGES = {
  'https://news.test/ok': { body: '<article><p>Real text.</p></article>' },
  'https://news.test/video': { body: '<article><div>video player only</div></article>' },
  'https://news.test/forbidden': { status: 403 },
  'https://news.test/broken': { status: 500 },
  // A challenge page served with 200: the fetcher flags it (err.blocked), so it's `blocked`, not `noBody` (D53).
  'https://news.test/challenge': { status: 200, blocked: true },
};

const registry = {
  fetchers: {
    fake: async (url) => {
      if (url === 'https://news.test/list') return { url, body: Object.keys(PAGES).join('\n') };
      if (url === 'https://news.test/blocked-list') throw Object.assign(new Error('HTTP 403'), { status: 403, blocked: true });
      const page = PAGES[url];
      if (page.status) {
        throw Object.assign(new Error(`HTTP ${page.status} for ${url}`), { status: page.status, blocked: page.blocked });
      }
      return { url, body: page.body };
    },
  },
  discoverers: {
    lines: (body) => body.split('\n').map((url) => ({ url, title: 'T', publishedDate: date, description: null })),
  },
  extractors: { html: extractHtml },
  labellers: { none: () => ({ labels: ['others'], events: [] }) },
};

const entry = {
  name: 'Fake', site: 'news.test', enabled: true, startUrls: ['https://news.test/list'],
  fetcher: { list: 'fake', article: 'fake' }, discover: 'lines', paging: null,
  extract: 'html', label: 'none', defaultType: 'general', selectors: {},
};

/** Runs `fn` with console output silenced (the controller logs every publisher). */
async function quiet(fn) {
  const errorLog = console.error;
  const log = console.log;
  console.error = console.log = () => {};
  try {
    return await fn();
  } finally {
    console.error = errorLog;
    console.log = log;
  }
}

test('null fullText reasons: noBody, blocked (incl. a 200 challenge page), error, counted and listed per URL', async () => {
  const { records, stats } = await quiet(() => runAll([entry], { registry, window }));
  const s = stats.Fake;
  assert.equal(records.length, 5); // nothing is dropped
  assert.deepEqual(s.fullTextNull, { noBody: 1, blocked: 2, error: 1 });
  assert.deepEqual(
    Object.fromEntries(s.fullTextNullUrls.map((x) => [x.url, x.reason])),
    {
      'https://news.test/video': 'noBody',
      'https://news.test/forbidden': 'blocked',
      'https://news.test/broken': 'error',
      'https://news.test/challenge': 'blocked',
    },
  );
  assert.equal(s.errors, 3); // fetch failures only; a page with no body is not an error
  assert.equal(records.find((r) => r.url === 'https://news.test/ok').fullText, 'Real text.');
});

test('a source whose page 1 fails is isolated: the other sources still run', async () => {
  const two = { ...entry, startUrls: ['https://news.test/blocked-list', 'https://news.test/list'] };
  const { records, stats } = await quiet(() => runAll([two], { registry, window }));
  const s = stats.Fake;
  assert.equal(s.failed, undefined);
  assert.equal(records.length, 5);
  assert.equal(s.sources[0].pagingStop, 'page 1 failed');
  assert.match(s.sources[0].error, /403/);
  assert.equal(s.sources[1].discovered, 5);
});

test('publishers run in parallel, output and stats stay in schema order', async () => {
  // The first publisher is slow, so it finishes last.
  const slowReg = {
    ...registry,
    fetchers: {
      ...registry.fetchers,
      slow: async (url) => {
        await new Promise((r) => setTimeout(r, 30));
        return registry.fetchers.fake(url);
      },
    },
  };
  const a = { ...entry, name: 'A', fetcher: { list: 'slow', article: 'slow' } };
  const b = { ...entry, name: 'B', startUrls: ['https://news.test/list?b'], discover: 'linesB' };
  slowReg.discoverers = { ...registry.discoverers, linesB: () => [{ url: 'https://news.test/ok?b=1', title: 'B', publishedDate: date }] };
  slowReg.fetchers.fake = async (url) => {
    if (url === 'https://news.test/list?b') return { url, body: '' };
    if (url === 'https://news.test/ok?b=1') return { url, body: '<article><p>B text.</p></article>' };
    return registry.fetchers.fake(url);
  };
  const { records, stats } = await quiet(() => runAll([a, b], { registry: slowReg, window }));
  assert.deepEqual(Object.keys(stats), ['A', 'B']);
  assert.equal(records.at(-1).publisher, 'B');
  assert.ok(records.slice(0, -1).every((r) => r.publisher === 'A'));
});

test('a lastmod-only item (D58): in window by listDate; page date decides; no date at all → counted, not written', async () => {
  const reg = {
    ...registry,
    fetchers: {
      fake: async (url) => {
        if (url === 'https://news.test/sm') return { url, body: '' };
        if (url === 'https://news.test/dated') return { url, body: '<meta property="article:published_time" content="2026-11-20T09:00:00Z"><article><p>Dated.</p></article>' };
        if (url === 'https://news.test/old') return { url, body: '<meta property="article:published_time" content="2026-11-01T09:00:00Z"><article><p>Old.</p></article>' };
        throw Object.assign(new Error('HTTP 403'), { status: 403, blocked: true }); // /blocked
      },
    },
    discoverers: {
      sm: () => ['dated', 'old', 'blocked'].map((id) => ({ url: `https://news.test/${id}`, title: id, publishedDate: null, listDate: '2026-11-21T00:00:00.000Z' })),
    },
  };
  const e = { ...entry, startUrls: ['https://news.test/sm'], discover: 'sm' };
  const { records, stats } = await quiet(() => runAll([e], { registry: reg, window }));
  const s = stats.Fake;
  assert.equal(s.inWindow, 3); // by lastmod
  assert.deepEqual(records.map((r) => [r.url, r.publishedDate]), [['https://news.test/dated', '2026-11-20T09:00:00.000Z']]);
  assert.equal(s.droppedOutsideWindow, 1); // "old": modified recently, published before the window
  assert.equal(s.droppedNoDate, 1);
  assert.deepEqual(s.droppedNoDateUrls, [{ url: 'https://news.test/blocked', reason: 'blocked' }]);
});

test('--sample spreads over the list: first, last and evenly in between', () => {
  const items = Array.from({ length: 11 }, (_, i) => i);
  assert.deepEqual(spreadSample(items, 3), [0, 5, 10]);
  assert.deepEqual(spreadSample(items, 1), [0]);
  assert.deepEqual(spreadSample(items, 50), items);
  assert.equal(new Set(spreadSample(items, 11)).size, 11);
});

test('--sample in a run: processed counts the sample, inWindow the full list', async () => {
  const { stats } = await quiet(() => runAll([entry], { registry, window, sample: 2 }));
  assert.equal(stats.Fake.inWindow, 5);
  assert.equal(stats.Fake.processed, 2);
});

test('date slices (D60): the window counts as covered only if every slice ran out of results', async () => {
  const reg = {
    ...registry,
    fetchers: {
      fake: async (url) => ({ url, body: url }),
    },
    discoverers: {
      // Slice 2026-11-19..21 never runs out (a result cap): pages keep repeating → "no new items".
      sliced: (body) => {
        const u = new URL(body);
        const page = Number(u.searchParams.get('page') ?? 1);
        if (body.includes('2026-11-19') ) return [{ url: 'https://news.test/same', publishedDate: date }];
        return page === 1 ? [{ url: `https://news.test/${u.pathname.split('/').pop()}`, publishedDate: date }] : [];
      },
    },
  };
  const e = {
    ...entry, discover: 'sliced', fetcher: { list: 'fake', article: 'fake' },
    startUrls: [{ url: 'https://news.test/s/{from}_{to}', sliceDays: 3, paging: { param: 'page', maxPages: 5 } }],
  };
  const { stats } = await quiet(() => runAll([e], { registry: reg, window, sample: 1 }));
  const s = stats.Fake;
  assert.equal(s.sources.length, 5); // Nov 10 → Nov 24 in 3-day slices
  assert.deepEqual(s.sources.filter((x) => !x.sliceComplete).map((x) => x.slice.from), ['2026-11-19']);
  assert.equal(s.windowStartReached, false);
});
