import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: true,
  htmlEntities: true,
  removeNSPrefix: true, // <news:publication_date> → publication_date
  isArray: (name) => name === 'url', // a sitemap with one URL would otherwise give an object
});

/**
 * Turns an XML sitemap (`<urlset>`) into article stubs, the same shape as the RSS discoverer (D58).
 *
 * Dates:
 * - `publishedDate` only from a Google News `<news:publication_date>`: that is the publish time.
 * - `<lastmod>` is the last *modification* time, so it is never used as the publish date. It goes to
 *   `listDate`, which paging and the window pre-filter use: lastmod is never earlier than the publish
 *   time, so an article published in the window always has lastmod in the window too (nothing is lost),
 *   and the article page's own date decides at the end.
 *
 * @param {string} xml
 * @returns {{ url: string, title: string | null, publishedDate: string | null, listDate: string | null,
 *             description: null }[]}
 */
export function discoverSitemap(xml) {
  let urls;
  try {
    urls = parser.parse(xml)?.urlset?.url ?? [];
  } catch {
    return [];
  }
  return urls
    .filter((u) => u.loc)
    .map((u) => ({
      url: String(u.loc).trim(),
      title: u.news?.title != null ? String(u.news.title).trim() : null,
      publishedDate: toIso(u.news?.publication_date),
      listDate: toIso(u.lastmod),
      description: null,
    }));
}

/** ISO with an offset or Z → ISO UTC; anything else → null. */
function toIso(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(s)) return null; // no timezone: not guessed
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
