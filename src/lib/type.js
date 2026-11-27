/**
 * The article `type` (R-A11, D47): stock | pressReleases | crypto | forex | general.
 * 1. The schema's `typeByUrl` rules (D68): a publisher whose site has a section per asset class
 *    (e.g. `/news/forex-news/`) states which URL part means which type. First match wins.
 * 2. The publisher's `defaultType`: a wire is `pressReleases`, a crypto site is `crypto`.
 * 3. A general-news publisher's article about one proven company is `stock`.
 *
 * @param {{ defaultType: string, typeByUrl?: { contains: string, type: string }[] }} entry the schema entry
 * @param {string|null} symbol the article's proven main symbol
 * @param {string} [url] the article URL
 * @returns {{ value: string, rule: string }}
 */
export function typeOf(entry, symbol, url = '') {
  const byUrl = (entry.typeByUrl ?? []).find((r) => url.includes(r.contains));
  if (byUrl) return { value: byUrl.type, rule: `the URL contains "${byUrl.contains}" → ${byUrl.type} (schema typeByUrl)` };
  if (entry.defaultType === 'general' && symbol) {
    return { value: 'stock', rule: `general-news publisher + a proven main symbol (${symbol}) → stock` };
  }
  return { value: entry.defaultType, rule: `the publisher's defaultType (${entry.defaultType})` };
}
