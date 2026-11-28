/**
 * Law-firm class-action notice rule (D71): checked after the pre-filter, before any LLM call.
 *
 * Wire services carry many near-identical notices from law firms ("ROSEN, A LEADING LAW FIRM,
 * Encourages Acme Investors to Secure Counsel…", "Faruqi & Faruqi, LLP Reminds … of Securities
 * Class Action Lawsuit Deadline"). They name IPOs, quarters and results, so they pass the
 * pre-filter, but in the Phase 4 samples none of the 63 got a label: they cost ~1/3 of one wire
 * service's LLM spend for nothing. This rule labels them `others` without a call; the trace says what matched.
 *
 * All three must hold, so an issuer's own announcement is not caught by accident:
 *  1. the title is about litigation;
 *  2. a law-firm signature is in the title or the opening paragraphs (who is speaking);
 *  3. the title does not itself name an event we label (results, dividend, split, IPO):
 *     such a title goes to the LLM as before. A wrong match here only costs one call.
 */
import { opening } from './checks.js';

export const NOTICE_RULE = 'law-firm class-action notice';

// Built from the 70 notices in the Phase 4 wire-service samples (see D71).
const LITIGATION = /class action|lead plaintiff|securities fraud|lawsuit|secure counsel|investigat(?:e|es|ing|ion)\b|fair deal|recover losses/i;
const LAW_FIRM = /law firm|\bLLP\b|\bPLLC\b|\bP\.C\.|\battorneys?\b|\bcounsel\b|\bEsq\.|contact the firm/i;
const EVENT_TITLE = /\bresults\b|\bdividends?\b|\bdistributions?\b|\bsplit\b|\bconsolidation\b|initial public offering/i;

/**
 * @param {{ title?: string|null, fullText?: string|null }} article
 * @returns {{ rule: string, litigation: string, firm: string, firmIn: 'title'|'opening' } | null}
 *   null = not a notice (the article goes on to the LLM)
 */
export function lawFirmNotice(article) {
  const title = article.title ?? '';
  const litigation = title.match(LITIGATION)?.[0];
  if (!litigation || EVENT_TITLE.test(title)) return null;
  const inTitle = title.match(LAW_FIRM)?.[0];
  const inOpening = inTitle ? null : opening(article.fullText ?? '', 2).match(LAW_FIRM)?.[0];
  const firm = inTitle ?? inOpening;
  if (!firm) return null;
  return { rule: NOTICE_RULE, litigation, firm, firmIn: inTitle ? 'title' : 'opening' };
}
