import * as cheerio from 'cheerio';
import { parseListDate } from '../lib/time.js';

/**
 * Turns an HTML page that lists articles (a search result page, a newsroom page) into article stubs,
 * the same shape as the RSS discoverer. Which elements to read comes from the schema (D54):
 *
 *   list: {
 *     item: '.results li',          // one element per article
 *     link: 'h3 a',                 // inside the item: the article link (its href)
 *     title: 'h3 a',                // optional, default: the link's text
 *     date: '.date',                // optional: text holding the date, e.g. "November 27, 2026 10:30 ET"
 *     description: 'p.summary',     // optional
 *     dropQuery: true,              // optional: remove "?…" from links (e.g. a search page adds "?k=")
 *     blockedText: 'try again in a few minutes', // optional: text of the site's rate-limit page
 *   }
 *
 * A page containing `blockedText` throws an error marked `blocked`, so paging pauses and retries
 * instead of reading it as an empty page (= the end of the list) (D59).
 *
 * @param {string} html the list page
 * @param {string} pageUrl the list page's URL, to resolve relative links
 * @param {{ list?: object }} source the source (D30), which carries the `list` config
 * @returns {{ url: string, title: string | null, publishedDate: string | null, description: string | null }[]}
 */
export function discoverHtmlList(html, pageUrl, source = {}) {
  const cfg = source.list;
  if (!cfg?.item || !cfg?.link) throw new Error(`html-list needs list.item and list.link in the schema (source ${pageUrl})`);
  if (cfg.blockedText && html.includes(cfg.blockedText)) {
    throw Object.assign(new Error(`rate-limit page ("${cfg.blockedText}")`), { blocked: true, rateLimited: true });
  }
  const $ = cheerio.load(html);
  const items = [];
  const seen = new Set(); // a list can link the same article twice (title + "read more")

  $(cfg.item).each((_, el) => {
    const $el = $(el);
    const a = $el.find(cfg.link).first();
    const href = a.attr('href');
    if (!href) return;
    const u = new URL(href, pageUrl);
    if (cfg.dropQuery) u.search = '';
    const url = u.toString();
    if (seen.has(url)) return;
    seen.add(url);

    items.push({
      url,
      title: clean(cfg.title ? $el.find(cfg.title).first().text() : a.text()) || null,
      publishedDate: cfg.date ? parseListDate($el.find(cfg.date).first().text()) : null,
      description: cfg.description ? clean($el.find(cfg.description).first().text()) || null : null,
    });
  });
  return items;
}

function clean(s) {
  return s ? s.replace(/\s+/g, ' ').trim() : '';
}
