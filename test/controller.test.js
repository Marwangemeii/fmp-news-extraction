/**
 * The controller with a fake registry (no network): every null fullText gets a reason (D31).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAll } from '../src/controller.js';
import { extractHtml } from '../src/blocks/extract-html.js';

const window = { start: new Date('2026-11-10T00:00:00Z'), end: new Date('2026-11-24T12:00:00Z') };
const date = '2026-11-20T10:00:00.000Z';

/** Each fake article URL behaves differently when fetched. */
const PAGES = {
  'https://news.test/ok': { body: '<article><p>Real text.</p></article>' },
  'https://news.test/video': { body: '<article><div>video player only</div></article>' },
  'https://news.test/forbidden': { status: 403 },
  'https://news.test/broken': { status: 500 },
};

const registry = {
  fetchers: {
    fake: async (url) => {
      if (url === 'https://news.test/list') return { url, body: Object.keys(PAGES).join('\n') };
      const page = PAGES[url];
      if (page.status) throw Object.assign(new Error(`HTTP ${page.status} for ${url}`), { status: page.status });
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

test('null fullText reasons: noBody, blocked, error, counted and listed per URL', async () => {
  const errorLog = console.error;
  const log = console.log;
  console.error = console.log = () => {}; // keep the test output quiet
  try {
    const { records, stats } = await runAll([entry], { registry, window });
    const s = stats.Fake;
    assert.equal(records.length, 4); // nothing is dropped
    assert.deepEqual(s.fullTextNull, { noBody: 1, blocked: 1, error: 1 });
    assert.deepEqual(
      Object.fromEntries(s.fullTextNullUrls.map((x) => [x.url, x.reason])),
      { 'https://news.test/video': 'noBody', 'https://news.test/forbidden': 'blocked', 'https://news.test/broken': 'error' },
    );
    assert.equal(s.errors, 2); // fetch failures only; a page with no body is not an error
    assert.equal(records.find((r) => r.url === 'https://news.test/ok').fullText, 'Real text.');
  } finally {
    console.error = errorLog;
    console.log = log;
  }
});
