/**
 * Phase 1 stand-in for the real labeller (Phase 3): every article is `others`.
 * Same signature the real one will have: article in, { labels, events } out.
 *
 * @param {object} _article
 * @returns {{ labels: string[], events: object[] }}
 */
export function labelPlaceholder(_article) {
  return { labels: ['others'], events: [] };
}
