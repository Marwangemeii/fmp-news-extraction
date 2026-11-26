/**
 * The article `type` (R-A11, D47): stock | pressReleases | crypto | forex | general.
 * The publisher decides first: a wire is `pressReleases`, a crypto site is `crypto` (its schema entry's
 * `defaultType`). A general-news publisher's article about one proven company is `stock`.
 *
 * @param {{ defaultType: string }} entry the schema entry
 * @param {string|null} symbol the article's proven main symbol
 * @returns {{ value: string, rule: string }}
 */
export function typeOf(entry, symbol) {
  if (entry.defaultType === 'general' && symbol) {
    return { value: 'stock', rule: `general-news publisher + a proven main symbol (${symbol}) → stock` };
  }
  return { value: entry.defaultType, rule: `the publisher's defaultType (${entry.defaultType})` };
}
