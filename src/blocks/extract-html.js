import * as cheerio from 'cheerio';
import { canonicalizeUrl } from '../lib/url.js';

/**
 * Standard tags most news sites have. A schema entry's `selectors` override any of these (D19).
 * A selector is either a CSS string (use the element's text) or { css, attr } (use an attribute).
 */
const DEFAULT_SELECTORS = {
  canonical: { css: 'link[rel="canonical"]', attr: 'href' },
  title: { css: 'meta[property="og:title"]', attr: 'content' },
  image: { css: 'meta[property="og:image"]', attr: 'content' },
  publishedDate: { css: 'meta[property="article:published_time"]', attr: 'content' },
  // The page's own summary, used for `text` when the feed has none (D32). The first match in the page wins.
  description: { css: 'meta[property="og:description"], meta[name="description"]', attr: 'content' },
  body: 'article',
  // Each matching element becomes one paragraph of fullText.
  blocks: 'p, h2, h3, h4, li, tr, blockquote',
  // Removed from the body before reading it (ads, related-article cards, share buttons...).
  remove: [],
};

const TEXT_MAX = 500; // R-A7

/**
 * @param {string} html the article page
 * @param {{ url: string, title: string|null, publishedDate: string|null, description: string|null }} item from discovery
 * @param {{ selectors?: object }} entry the schema entry
 * @param {string} finalUrl the URL after redirects
 */
export function extractHtml(html, item, entry, finalUrl) {
  const sel = { ...DEFAULT_SELECTORS, ...entry.selectors };
  const $ = cheerio.load(html);

  const canonical = pick($, sel.canonical);
  const fullText = readBody($, sel);

  return {
    url: canonicalizeUrl(canonical || finalUrl || item.url, finalUrl || item.url),
    title: clean(pick($, sel.title)) || item.title,
    image: absolute(pick($, sel.image), finalUrl || item.url),
    publishedDate: toIso(pick($, sel.publishedDate)) || item.publishedDate,
    // The publisher's own summary first, never a guess (D32): feed/API description → page meta description
    // → first paragraph of the body. If none exists, text is "".
    text: truncate(stripHtml(item.description) || stripHtml(pick($, sel.description)) || firstParagraph(fullText)),
    fullText,
  };
}

/** First match of a selector: its attribute if `attr` is set, else its text. */
function pick($, selector) {
  if (!selector) return null;
  const { css, attr } = typeof selector === 'string' ? { css: selector } : selector;
  const el = $(css).first();
  if (!el.length) return null;
  const value = attr ? el.attr(attr) : el.text();
  return value?.trim() || null;
}

/** Body → plain text, one block per paragraph, separated by a blank line (R-A8). */
function readBody($, sel) {
  const body = $(sel.body).first();
  if (!body.length) return null;
  for (const r of sel.remove) body.find(r).remove();

  const blocks = [];
  body.find(sel.blocks).each((_, el) => {
    const $el = $(el);
    // Skip blocks nested in another block (an <li> inside a <p>, a <p> inside an <li>), to avoid duplicates.
    if ($el.parent().closest(sel.blocks).length) return;
    const text =
      el.tagName === 'tr'
        ? $el.find('th, td').map((_, c) => clean(textOf(c))).get().join(' | ')
        : clean(textOf(el));
    if (text) blocks.push(text);
  });
  return blocks.length ? blocks.join('\n\n') : null;
}

/**
 * Tags that start a new line in a browser. Their text gets a space on each side, so
 * `<li><p>first</p><p>second</p></li>` reads "first second", not "firstsecond".
 * Inline tags (a, span, strong, sup…) get nothing added: the page's own spaces are kept
 * as written, and `x<span>y</span>` stays "xy".
 */
const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'br', 'dd', 'div', 'dl', 'dt', 'figcaption', 'figure',
  'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'ol', 'p', 'pre', 'section',
  'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
]);

/**
 * An element's text, like cheerio's .text(), but with a space at block boundaries and <br>.
 * Script and style contents are skipped (their node type isn't 'tag', so they return '').
 */
function textOf(node) {
  if (node.type === 'text') return node.data;
  if (node.type !== 'tag') return '';
  const inner = (node.children ?? []).map(textOf).join('');
  return BLOCK_TAGS.has(node.name) ? ` ${inner} ` : inner;
}

/** Collapses whitespace runs (including non-breaking spaces) into one space. */
function clean(s) {
  return s ? s.replace(/\s+/g, ' ').trim() : '';
}

/** Feed descriptions may hold HTML; cheerio's text() strips tags and decodes entities. */
function stripHtml(s) {
  return s ? clean(cheerio.load(s).text()) : '';
}

function firstParagraph(fullText) {
  return fullText ? fullText.split('\n\n')[0] : '';
}

/** Cuts to ≤ 500 chars at a word boundary, ending with "…". */
function truncate(s) {
  if (!s || s.length <= TEXT_MAX) return s || '';
  const cut = s.slice(0, TEXT_MAX - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut) + '…';
}

function toIso(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function absolute(url, base) {
  if (!url) return null;
  try {
    return new URL(url, base).toString();
  } catch {
    return null;
  }
}
