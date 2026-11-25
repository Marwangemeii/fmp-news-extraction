/**
 * Pre-filter (D8 step 1): a broad keyword check before any LLM call.
 * An article with none of these words can't be about earnings, dividends, splits or IPOs,
 * so it is labelled `others` for free. Kept broad on purpose: a false pass costs one cheap
 * LLM call, a false fail loses a real event (recall over precision).
 */

/** Case-insensitive, whole words. Each pattern's source text is what the trace shows. */
export const KEYWORDS = {
  earnings: [
    'earnings', 'results', 'quarter', 'quarterly', 'Q[1-4]', '[1-4]Q', 'fiscal', 'net income', 'net loss',
    'revenues?', 'sales', 'EPS', 'per share', 'per diluted share', 'conference call', 'webcast',
  ],
  dividends: ['dividends?', 'distributions?', 'payout', 'ex-dividend', 'record date', 'payable'],
  splits: ['split', 'reverse split', 'consolidation', 'consolidate'],
  ipos: [
    'IPO', 'initial public offering', 'go public', 'going public', 'listing', 'S-1', 'F-1', 'prospectus',
    'debut', 'direct listing', 'blank check', 'SPAC',
  ],
};

// \b doesn't work next to "-" the way we want ("S-1"), so whole words are "not preceded/followed by a letter or digit".
const compiled = Object.fromEntries(
  Object.entries(KEYWORDS).map(([label, words]) => [
    label,
    words.map((w) => ({ word: w, re: new RegExp(`(?<![A-Za-z0-9])${w}(?![A-Za-z0-9])`, 'i') })),
  ]),
);

/**
 * @param {{ title?: string|null, text?: string|null, fullText?: string|null }} article
 * @returns {{ pass: boolean, matched: Record<string, string[]> }} matched = the keywords found, per label
 */
export function prefilter(article) {
  const haystack = [article.title, article.text, article.fullText].filter(Boolean).join('\n');
  const matched = {};
  for (const [label, list] of Object.entries(compiled)) {
    matched[label] = list.filter(({ re }) => re.test(haystack)).map(({ word }) => word);
  }
  return { pass: Object.values(matched).some((m) => m.length > 0), matched };
}
