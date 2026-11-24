import * as cheerio from 'cheerio';

/**
 * Turns a WordPress REST API posts response (/wp-json/wp/v2/posts) into article stubs,
 * the same shape as the RSS discoverer.
 * Past the last page WordPress returns an error object, not an array → [] (paging stops on 'empty page').
 *
 * @param {string} body the JSON response
 * @returns {{ url: string, title: string | null, publishedDate: string | null, description: string | null }[]}
 */
export function discoverWpJson(body) {
  let posts;
  try {
    posts = JSON.parse(body);
  } catch {
    return [];
  }
  if (!Array.isArray(posts)) return [];
  return posts
    .filter((p) => p.link)
    .map((p) => ({
      url: String(p.link).trim(),
      title: decode(p.title?.rendered),
      publishedDate: toIso(p.date_gmt),
      description: p.excerpt?.rendered ?? null,
    }));
}

/** "Bitcoin&#8217;s Rally" → "Bitcoin’s Rally" */
function decode(html) {
  if (!html) return null;
  return cheerio.load(html).text().trim() || null;
}

/** date_gmt is UTC but has no zone suffix ("2026-11-17T21:45:41"), so add the Z. */
function toIso(value) {
  if (!value) return null;
  const d = new Date(`${value}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
