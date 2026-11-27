import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  // Attributes are needed only for <enclosure url="…" type="image/jpeg">; everywhere else they'd turn
  // plain text elements into objects.
  ignoreAttributes: (_name, jPath) => jPath !== 'rss.channel.item.enclosure',
  htmlEntities: true, // decode &#8217; etc. in titles and descriptions
  // An RSS channel with one item would otherwise give an object, not an array.
  isArray: (name) => name === 'item',
});

/**
 * Turns an RSS 2.0 feed into a list of article stubs.
 *
 * @param {string} xml the feed body
 * @param {string} [_url] the feed URL (unused)
 * @param {{ list?: { dateZone?: 'UTC' } }} [source] `list.dateZone`: the zone of a feed whose dates carry
 *   none ("2026-11-27 18:21:02"), checked against the site and recorded in the schema (D67)
 * @returns {{ url: string, title: string | null, publishedDate: string | null, description: string | null, image?: string }[]}
 */
export function discoverRss(xml, _url, source = {}) {
  const items = parser.parse(xml)?.rss?.channel?.item ?? [];
  return items
    .filter((item) => item.link)
    .map((item) => {
      const image = item.enclosure?.['@_url'];
      const isImage = image && /^image\//.test(item.enclosure['@_type'] ?? 'image/');
      return {
        url: String(item.link).trim(),
        title: item.title != null ? String(item.title).trim() : null,
        publishedDate: toIso(item.pubDate, source.list?.dateZone),
        description: item.description != null ? String(item.description) : null,
        ...(isImage ? { image } : {}),
      };
    });
}

/** A written zone or offset at the end: "+0000", "-05:00", "Z", "GMT", "UT", "UTC", "EST"… */
const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2}|\b(?:UTC?|GMT|[ECMP][SD]T))$/i;

/**
 * "Sat, 21 Nov 2026 04:00:00 +0000" → "2026-11-21T04:00:00.000Z"; unparseable → null.
 * A date with **no zone** is null (JavaScript would read it in the machine's own time zone, so the
 * result would depend on where the run happens), unless the schema says the feed is in UTC.
 */
function toIso(value, dateZone) {
  if (!value) return null;
  let s = String(value).trim();
  if (!HAS_ZONE.test(s)) {
    if (dateZone !== 'UTC') return null;
    s += ' UTC';
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
