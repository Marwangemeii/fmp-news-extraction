/**
 * Detects a page that says "you're blocked" or "prove you're human" instead of the content,
 * even when its HTTP status is 200 or 202 (D31 limit, closed in Phase 4, D53).
 * Generic: it knows bot-protection vendors (Cloudflare, AWS WAF, Akamai, Imperva), never a publisher.
 */

/** Statuses that mean the site refused us. */
export const BLOCKED_STATUSES = [401, 403, 429, 451];

/**
 * Challenge/block pages are small (a few KB of script and a message). A real article page is much
 * larger, so the title check only runs on small pages: an article titled "Why captchas fail" stays an article.
 */
const SMALL_PAGE = 30_000;

/** Titles of known block and challenge pages (matched on the <title> text only). */
const BLOCK_TITLES = [
  /^just a moment/i, // Cloudflare JS challenge
  /^attention required/i, // Cloudflare block ("Sorry, you have been blocked")
  /^access denied/i, // Akamai
  /^pardon our interruption/i, // Imperva (Distil) bot challenge, served with 200 (D65)
  /captcha/i,
  /verify (that )?you are (a )?human|are you a robot|human verification/i,
];

/**
 * @param {{ status: number, headers?: { get(name: string): string | null }, body?: string }} res
 * @returns {string | null} why the page counts as blocked, or null for a normal page
 */
export function blockReason({ status, headers, body = '' }) {
  if (BLOCKED_STATUSES.includes(status)) return `HTTP ${status}`;

  // Vendor headers that say outright that the response is a challenge.
  const waf = headers?.get('x-amzn-waf-action'); // AWS WAF: "challenge" or "captcha"
  if (waf) return `AWS WAF ${waf} (HTTP ${status})`;
  const cf = headers?.get('cf-mitigated'); // Cloudflare: "challenge"
  if (cf) return `Cloudflare ${cf} (HTTP ${status})`;

  if (body.length < SMALL_PAGE) {
    const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() ?? '';
    if (title && BLOCK_TITLES.some((re) => re.test(title))) return `block page "${title}" (HTTP ${status})`;
    // AWS WAF challenge without the header (e.g. seen in a browser): its script sets window.gokuProps.
    if (/window\.gokuProps|challenge\.js/.test(body) && /awswaf/i.test(body)) return `AWS WAF challenge page (HTTP ${status})`;
  }
  return null;
}
