/** R-A4: canonical URLs, tracking params removed. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeUrl, siteOf } from '../src/lib/url.js';

test('strips utm_* params', () => {
  assert.equal(
    canonicalizeUrl('https://techcrunch.com/2026/11/20/a/?utm_source=twitter&utm_medium=social&utm_campaign=x'),
    'https://techcrunch.com/2026/11/20/a/',
  );
});

test('strips fbclid and gclid, keeps meaningful params', () => {
  assert.equal(
    canonicalizeUrl('https://example.com/news?p=123&fbclid=abc&gclid=def'),
    'https://example.com/news?p=123',
  );
});

test('drops the #fragment', () => {
  assert.equal(canonicalizeUrl('https://example.com/a#comments'), 'https://example.com/a');
});

test('lower-cases the host but not the path', () => {
  assert.equal(canonicalizeUrl('https://TechCrunch.COM/Some/Path'), 'https://techcrunch.com/Some/Path');
});

test('leaves an already-clean URL unchanged', () => {
  const url = 'https://www.reuters.com/markets/us/story-2026-11-20/';
  assert.equal(canonicalizeUrl(url), url);
});

test('resolves a relative URL against a base', () => {
  assert.equal(canonicalizeUrl('/a?utm_source=x', 'https://example.com/feed'), 'https://example.com/a');
});

test('siteOf removes www.', () => {
  assert.equal(siteOf('https://www.reuters.com/business/'), 'reuters.com');
  assert.equal(siteOf('https://techcrunch.com/feed/'), 'techcrunch.com');
});
