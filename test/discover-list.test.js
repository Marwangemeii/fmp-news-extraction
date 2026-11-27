/**
 * The html-list discoverer (D54) and the list-date parser, on shortened copies of real list pages
 * (2026-11-27). No network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverHtmlList } from '../src/blocks/discover-html-list.js';
import { parseListDate } from '../src/lib/time.js';
import { discoverSitemap } from '../src/blocks/discover-sitemap.js';

test('parseListDate: wall time + written zone → UTC; DST from the date; no zone → null', () => {
  assert.equal(parseListDate('2026-11-27 11:05 AM EST | The Rosen Law Firm PA'), '2026-11-27T16:05:00.000Z');
  assert.equal(parseListDate('2026-09-22 3:40 PM EDT'), '2026-09-22T19:40:00.000Z');
  assert.equal(parseListDate('2026-11-27 12:05 AM EST'), '2026-11-27T05:05:00.000Z'); // 12 AM = 00h
  assert.equal(parseListDate('November 27, 2026 10:30 ET'), '2026-11-27T15:30:00.000Z'); // ET in November = UTC-5
  assert.equal(parseListDate('July 1, 2026 10:30 ET'), '2026-07-01T14:30:00.000Z'); // ET in July = UTC-4
  assert.equal(parseListDate('Fri, 27 Nov 2026 10:25:00 -0500'), '2026-11-27T15:25:00.000Z');
  assert.equal(parseListDate('2026-11-27T15:30:16+00:00'), '2026-11-27T15:30:16.000Z');
  assert.equal(parseListDate('November 27, 2026'), null); // no time, no zone: not guessed
  assert.equal(parseListDate('2026-11-27 10:30'), null);
  assert.equal(parseListDate(''), null);
});

const SEARCH_PAGE = `
<article class="nf-tiles">
  <figure class="nf-tiles-logo nf-tile-wide"><div>
    <h3><a href="/release/326133/ENSG-DEADLINE-ALERT?k=" lang="en">ENSG DEADLINE ALERT</a></h3>
    <p lang="en">New York, New York--(Newsfile Corp. - November 27, 2026) - WHY: Rosen Law Firm…</p>
    <p class="date"><a href="/news/">industries..name</a></p>
    <p class="date">2026-11-27 11:05 AM EST | <a href="/company/7397/x">The Rosen Law Firm PA</a></p>
  </div></figure>
  <figure class="nf-tiles-logo nf-tile-wide"><div>
    <h3><a href="/release/326121/Imprint?k=" lang="en">Imprint.live to Rebrand</a></h3>
    <p class="date">2026-11-27 10:56 AM EST | <a href="/company/8935/x">Baden Bower</a></p>
  </div></figure>
  <figure class="nf-tiles-logo nf-tile-wide"><div><p>no link here</p></div></figure>
</article>`;

test('html-list: items, absolute links, dropQuery, dates, descriptions; items without a link skipped', () => {
  const list = { item: 'article.nf-tiles figure', link: 'h3 a', date: 'p.date:last-of-type', description: 'p[lang]', dropQuery: true };
  const items = discoverHtmlList(SEARCH_PAGE, 'https://news.test/search?k=', { list });
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    url: 'https://news.test/release/326133/ENSG-DEADLINE-ALERT',
    title: 'ENSG DEADLINE ALERT',
    publishedDate: '2026-11-27T16:05:00.000Z',
    description: 'New York, New York--(Newsfile Corp. - November 27, 2026) - WHY: Rosen Law Firm…',
  });
  assert.equal(items[1].description, null);
});

const GNW_PAGE = `
<div class="recentNewsH"><ul>
  <li class="row"><div class="newsLink">
    <div class="date-source"><span>November 27, 2026 10:30 ET</span><span>|</span><span>Source: <a href="/en/search/organization/x">Mordor</a></span></div>
    <div class="mainLink"><a href="/news-release/2026/11/27/3411340/0/en/hospitality.html">Hospitality Industry in UK</a></div>
    <div class="newsTxt"><p> Hyderabad, India, Nov. 27, 2026 (GLOBE NEWSWIRE) -- According to…</p></div>
  </div></li>
</ul></div>`;

test('html-list: a second layout (month-name dates), title from the link text, query kept by default', () => {
  const list = { item: '.recentNewsH li', link: '.mainLink a', date: '.date-source span:first-child', description: '.newsTxt' };
  const [item] = discoverHtmlList(GNW_PAGE, 'https://wire.test/en/search?page=2', { list });
  assert.equal(item.url, 'https://wire.test/news-release/2026/11/27/3411340/0/en/hospitality.html');
  assert.equal(item.title, 'Hospitality Industry in UK');
  assert.equal(item.publishedDate, '2026-11-27T15:30:00.000Z');
  assert.match(item.description, /^Hyderabad, India/);
});

test('html-list: a missing list config is a schema error, not an empty page', () => {
  assert.throws(() => discoverHtmlList('<ul></ul>', 'https://x.test/', {}), /list\.item and list\.link/);
});

const NEWS_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
<url><loc>https://news.test/news/26/11/1/apollo</loc><news:news><news:publication><news:name>X</news:name></news:publication>
<news:title>If You Invested $1000 In Apollo &amp; Co</news:title><news:publication_date>2026-11-27T15:30:16+00:00</news:publication_date></news:news></url>
</urlset>`;
const LASTMOD_SITEMAP = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://news.test/news/26/11/2/visa</loc><lastmod>2026-11-27T15:31:33Z</lastmod><changefreq>always</changefreq></url>
<url><loc>https://news.test/news/26/11/3/amd</loc><lastmod>2026-11-27</lastmod></url>
</urlset>`;

test('sitemap: publication_date is the publish date; lastmod only a listDate; no zone → null', () => {
  assert.deepEqual(discoverSitemap(NEWS_SITEMAP), [{
    url: 'https://news.test/news/26/11/1/apollo', title: 'If You Invested $1000 In Apollo & Co',
    publishedDate: '2026-11-27T15:30:16.000Z', listDate: null, description: null,
  }]);
  const [a, b] = discoverSitemap(LASTMOD_SITEMAP);
  assert.equal(a.publishedDate, null);
  assert.equal(a.listDate, '2026-11-27T15:31:33.000Z');
  assert.equal(b.listDate, null); // a bare date has no timezone
  assert.deepEqual(discoverSitemap('<sitemapindex></sitemapindex>'), []);
  assert.deepEqual(discoverSitemap('not xml <'), []);
});

test('html-list: a page with the schema\'s blockedText throws `blocked` instead of returning []', () => {
  const list = { item: 'li', link: 'a', blockedText: 'unusually high demand' };
  const page = '<p>Our public search function is currently experiencing unusually high demand. Please try again in a few minutes.</p>';
  assert.throws(() => discoverHtmlList(page, 'https://x.test/search', { list }), (err) => err.blocked === true);
});
