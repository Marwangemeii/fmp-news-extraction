import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: true,
  htmlEntities: true, // decode &#8217; etc. in titles and descriptions
  // An RSS channel with one item would otherwise give an object, not an array.
  isArray: (name) => name === 'item',
});

/**
 * Turns an RSS 2.0 feed into a list of article stubs.
 *
 * @param {string} xml the feed body
 * @returns {{ url: string, title: string | null, publishedDate: string | null, description: string | null }[]}
 */
export function discoverRss(xml) {
  const items = parser.parse(xml)?.rss?.channel?.item ?? [];
  return items
    .filter((item) => item.link)
    .map((item) => ({
      url: String(item.link).trim(),
      title: item.title != null ? String(item.title).trim() : null,
      publishedDate: toIso(item.pubDate),
      description: item.description != null ? String(item.description) : null,
    }));
}

/** "Sat, 21 Nov 2026 04:00:00 +0000" → "2026-11-21T04:00:00.000Z"; unparseable → null. */
function toIso(value) {
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
