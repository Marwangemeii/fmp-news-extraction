/**
 * fullText joining (R-A8, D29): spaces at block boundaries and <br>, none added around inline tags.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extractHtml } from '../src/blocks/extract-html.js';

const html = await readFile(new URL('./fixtures/body-spacing.html', import.meta.url), 'utf8');
const item = { url: 'https://news.test/article', title: 'T', publishedDate: null, description: null };
const entry = { selectors: { remove: ['.ad'] } };

test('fullText keeps spaces around inline links, adds them at block boundaries and <br>', () => {
  const { fullText } = extractHtml(html, item, entry, item.url);
  assert.equal(
    fullText,
    [
      'The firm put 10% of its fund into Anthropic’s Series E.', // inline <a>: the source's own spaces
      'Shares rose5% as written, with no space in the source.', // inline: nothing invented
      'Revenue was $1.2 billion1 for the quarter.', // <sup> is inline
      'Line one line two', // <br>
      'First point. Second point.', // two <p> inside one <li>
      '“We are pleased,” the CEO said.', // blockquote
      'Metric | Q3', // table rows: cells joined by " | "
      'EPS (diluted) | $0.84', // two <div> inside one <td>
    ].join('\n\n'), // removed .ad and <script> leave nothing behind
  );
});

test('text: feed description → page meta description → first paragraph → "" (D32)', () => {
  const page = (head, body) => `<html><head>${head}</head><body><article>${body}</article></body></html>`;
  const meta = '<meta property="og:description" content="The page&#8217;s own summary.">';
  const text = (html, description = null) => extractHtml(html, { ...item, description }, {}, item.url).text;

  assert.equal(text(page(meta, '<p>First paragraph.</p>'), '<p>Feed summary.</p>'), 'Feed summary.');
  assert.equal(text(page(meta, '<p>First paragraph.</p>')), 'The page’s own summary.');
  assert.equal(text(page('<meta name="description" content="Plain meta.">', '<p>First.</p>')), 'Plain meta.');
  assert.equal(text(page('', '<p>First paragraph.</p><p>Second.</p>')), 'First paragraph.');
  assert.equal(text(page('', '<div>video player only</div>')), ''); // nothing stated → empty, never invented
});

test('publishedDate from JSON-LD (D66): first block with the key, inside @graph, broken blocks skipped', () => {
  const page = `<html><head>
    <script type="application/ld+json">{ not json </script>
    <script type="application/ld+json">{"@type":"Organization","name":"X"}</script>
    <script type="application/ld+json">{"@graph":[{"@type":"NewsArticle","datePublished":"2026-11-25T23:29:55-05:00"}]}</script>
    </head><body><article><p>Body.</p></article></body></html>`;
  const e = { selectors: { publishedDate: { jsonld: 'datePublished' } } };
  assert.equal(extractHtml(page, item, e, item.url).publishedDate, '2026-11-26T04:29:55.000Z');
  // No JSON-LD: falls back to the list date, as with any selector.
  const none = extractHtml('<html><body><article><p>x</p></article></body></html>', { ...item, publishedDate: '2026-11-20T00:00:00.000Z' }, e, item.url);
  assert.equal(none.publishedDate, '2026-11-20T00:00:00.000Z');
});
