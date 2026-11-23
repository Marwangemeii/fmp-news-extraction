/**
 * Canonical URLs (D7, R-A4). The URL is the unique key of an article,
 * so the same article must always produce the same string.
 */

/** Query params that only track where a click came from. Exact names, plus any `utm_*`. */
export const TRACKING_PARAMS = [
  'fbclid', 'gclid', 'dclid', 'msclkid', 'yclid', 'igshid',
  'mc_cid', 'mc_eid', '_ga', 'ref_src', 'guccounter', 'guce_referrer', 'guce_referrer_sig',
];

/** @param {string} name */
export function isTrackingParam(name) {
  const n = name.toLowerCase();
  return n.startsWith('utm_') || TRACKING_PARAMS.includes(n);
}

/**
 * Removes tracking params and the #fragment, lower-cases the host.
 * Everything else (path, meaningful params like ?p=123) is kept as-is.
 *
 * @param {string} url absolute URL, or relative when `base` is given
 * @param {string} [base]
 * @returns {string}
 */
export function canonicalizeUrl(url, base) {
  const u = new URL(url.trim(), base);
  u.hash = '';
  // Copy the keys first: deleting while iterating searchParams skips entries.
  for (const key of [...u.searchParams.keys()]) {
    if (isTrackingParam(key)) u.searchParams.delete(key);
  }
  // URL already lower-cases the host; this only tidies a trailing "?" left by deleted params.
  return u.toString().replace(/\?$/, '');
}

/**
 * Domain without `www.` (R-A3). "https://www.example.com/x" → "example.com".
 * @param {string} url
 */
export function siteOf(url) {
  return new URL(url).hostname.replace(/^www\./, '');
}
