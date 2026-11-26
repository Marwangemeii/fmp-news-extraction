/**
 * The code-side proof (D8 step 4, D10): every sentence the LLM quotes must be in the article
 * word for word, and every value must be in its sentence. Only whitespace is normalized
 * (runs of spaces, tabs, newlines and non-breaking spaces become one space); nothing else,
 * so a paraphrase, a "fixed" typo or straight quotes for curly ones all fail.
 */

/** @param {string} s */
export const normalizeWs = (s) => s.replace(/\s+/g, ' ').trim();

/**
 * K1: each line of `evidence` (D10: several sentences are joined with "\n") is found in `text`.
 * @param {string|null} evidence
 * @param {string|null} text the article's fullText
 * @returns {{ ok: boolean, reason?: string }}
 */
export function evidenceInText(evidence, text) {
  if (!evidence || !evidence.trim()) return { ok: false, reason: 'no evidence given' };
  if (!text) return { ok: false, reason: 'the article has no fullText' };
  const hay = normalizeWs(text);
  for (const piece of evidence.split('\n').map(normalizeWs).filter(Boolean)) {
    if (!hay.includes(piece)) {
      return { ok: false, reason: `evidence not found in fullText${nearest(piece, hay)}: "${shorten(piece)}"` };
    }
  }
  return { ok: true };
}

/**
 * K2: the value as written is inside its own evidence. Case is ignored here (D45): the model writes
 * "fourth quarter" for "Fourth quarter". K1 above stays exact, so the sentence itself is still verbatim.
 * @param {string} raw
 * @param {string} evidence
 */
export function rawInEvidence(raw, evidence) {
  if (normalizeWs(evidence).toLowerCase().includes(normalizeWs(raw).toLowerCase())) return { ok: true };
  return { ok: false, reason: `"${raw}" not found in its evidence` };
}

/** How many paragraphs count as the article's opening (K11, D44). */
export const OPENING_PARAGRAPHS = 3;

/** The first `n` paragraphs of fullText (paragraphs are separated by a blank line, D29). */
export const opening = (text, n = OPENING_PARAGRAPHS) => text.split('\n\n').slice(0, n).join('\n\n');

/**
 * K11 (D44): a news article's label sentence must be in its opening, where the subject is.
 * Same exact match as K1, on the opening paragraphs only.
 * @param {string} evidence
 * @param {string} text fullText
 */
export function evidenceInOpening(evidence, text) {
  if (evidenceInText(evidence, opening(text)).ok) return { ok: true };
  return { ok: false, reason: `not in opening (first ${OPENING_PARAGRAPHS} paragraphs)` };
}

/** Where a failed sentence stops matching, to make the trace useful: "(first 12 of 20 words match)". */
function nearest(piece, hay) {
  const words = piece.split(' ');
  let n = 0;
  while (n < words.length && hay.includes(words.slice(0, n + 1).join(' '))) n++;
  return n > 0 ? ` (first ${n} of ${words.length} words match)` : '';
}

const shorten = (s) => (s.length > 120 ? `${s.slice(0, 117)}…` : s);

/**
 * Article order of each evidence line, for the event's joined `evidence` field (D10).
 * @param {string[]} pieces evidence lines that already passed K1
 * @param {string} text fullText
 */
export function inArticleOrder(pieces, text) {
  const hay = normalizeWs(text);
  const unique = [...new Set(pieces.map(normalizeWs).filter(Boolean))];
  return unique.sort((a, b) => hay.indexOf(a) - hay.indexOf(b));
}
