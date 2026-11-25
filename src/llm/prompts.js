/**
 * The two prompts (D34). The LLM only COPIES text: a value as written + the sentence it came from.
 * Converting and checking is the code's job (src/lib/convert.js, src/lib/checks.js).
 * Changing a prompt? Bump PROMPT_VERSION in src/llm/config.js.
 */
import { CLASSIFY_BODY_CHARS } from './config.js';

export const CLASSIFY_SYSTEM = `You label financial news articles for a market-data company. Return JSON that matches the schema.

LABELS
Give a label only when that event is the SUBJECT of the article: what the headline and the
opening paragraph are about. A passing mention is not enough.
- earnings: the company reports its actual results for a stated quarter or fiscal year (EPS,
  revenue or net income for that period), OR the company announces the date on which it will
  report results. NOT earnings: previews or predictions before results are out, analyst opinions,
  stock-move stories that state no reported figures, guidance or outlook alone.
- dividends: the company declares, raises, cuts, suspends or reinstates a dividend. Regular and
  special dividends count, and so do per-unit "distributions" of trusts and funds.
- splits: the company announces or completes a stock split, a reverse split or a share consolidation.
- ipos: a company files for, prices, launches, postpones or withdraws its initial public offering.
An article can have several labels, e.g. a results release that also declares a dividend.
If none applies, return an empty "labels" list. The code then labels the article "others".

For each label, copy ONE sentence from the article BODY (not the title) that shows the event is the subject.
Copy it character for character: same words, punctuation, capitalisation and numbers.
Do not shorten, merge, paraphrase or fix typos. The code rejects any sentence it cannot find.

SYMBOLS
- symbol: the ticker of the company the article is mainly about (in a merger, the larger company).
  null if the article is not about one company, or if no ticker is written in the article.
- relatedSymbols: every company ticker written in the article, the main one included.
For each ticker, give it exactly as written ("ACME", "XYZ.A"), the exchange exactly as written
next to it ("NASDAQ", "TSX-V", "CSE", "NYSE American"), or null if none is written, and the
sentence it appears in. Only tickers written in the article. Never add one from your own knowledge.`;

export const EXTRACT_SYSTEM = `You extract event details from a financial news article for a market-data company.
Return JSON that matches the schema. Code converts and verifies everything you return,
so follow these rules exactly.

1. COPY, NEVER COMPUTE. "raw" is the value exactly as written in the article: "$412.5 million",
   "(0.12)", "84 cents", "December 15, 2026", "1-for-10". Do not convert units, reformat dates,
   do arithmetic, or add a year that is not written.
2. EVIDENCE. Every raw value comes with "evidence": the one sentence (or table row) it was
   copied from, copied character for character. raw must appear inside its evidence exactly.
3. NOT STATED = LEFT OUT. Return only values the article states. Never fill a value from your
   own knowledge or work it out from other values.
4. NEGATIVE NUMBERS. Keep the parentheses or the word "loss" in raw: "(0.12)", "$(0.12)",
   "loss of $0.12".
5. Prefer a value stated in a sentence over the same value in a table.

Extract only for the event types listed in the request.

OUTPUT
- "values": one item per stated value: { "field", "raw", "evidence" }. The fields:
  earnings.period            the fiscal period: "third quarter", "Q3", "fourth-quarter", "full year"
  earnings.fiscalYear        the fiscal year: "fiscal 2026", "FY26", "2026"
  earnings.fiscalDateEnding  the period's end date ("September 30, 2026" in "the quarter ended September 30, 2026")
  earnings.date              the day results were released (often the dateline, e.g. "Nov. 5, 2026") or,
                             for a date announcement, the day they will be released
  earnings.time              when the results are or were released: "before the market opens",
                             "after market close", "4:05 p.m. ET". The time of a conference call is NOT
                             the release time unless the article says results are released then.
  dividends.dividend         the amount per share: "$0.25 per share", "C$0.05"
  dividends.declarationDate, dividends.exDividendDate, dividends.recordDate, dividends.paymentDate
  splits.ratio               "1-for-10", "two-for-one", "3:1",
                             "one (1) post-consolidation share for every ten (10) pre-consolidation shares"
  splits.effectiveDate       the day the split takes effect
  ipos.company               the company's name
  ipos.exchange              the exchange: "Nasdaq Global Market"
  ipos.firstTradingDate      the expected or actual first day of trading
  ipos.shares                number of shares offered: "5,000,000 shares"
  ipos.priceRange            "$14.00 to $16.00"
  ipos.pricePerShare         the final offering price: "$15.00"
  ipos.marketCap             market value or valuation, only if stated: "$1.2 billion"
- "figures" (earnings only): EVERY EPS and revenue figure stated for a reported or estimated period,
  one item each:
    metric: "eps" | "revenue"
    period: the period this figure is for, as written ("fourth quarter", "fiscal 2026",
            "nine months"), or "" if the article does not say
    raw, evidence: as above
    basis: "GAAP" | "IFRS" | "adjusted" (non-GAAP, adjusted, core, underlying, excluding items)
           | "unknown" if the article does not say
    kind: "actual" (reported for this period) | "estimate" (analyst consensus or expectation)
          | "previous" (the comparison period, e.g. the same quarter last year)
    perShare: "diluted" | "basic" | "unknown"   (EPS only; "unknown" for revenue)
  Skip company guidance/outlook figures. Empty list if not asked for earnings.
- "ipoAction" (ipos only): the main action reported: "filed" | "expected" | "priced" | "postponed" |
  "withdrawn", with the sentence that states it as evidence. "none" and "" if not asked or not stated.`;

/**
 * The top of the body, cut at a paragraph break at or before `max` characters.
 * (If the first paragraph alone is longer than `max`, it is cut mid-paragraph.)
 *
 * @param {string} fullText
 * @param {number} [max]
 * @returns {{ text: string, bodyChars: number, sentChars: number, truncated: boolean }}
 */
export function topOfBody(fullText, max = CLASSIFY_BODY_CHARS) {
  if (fullText.length <= max) {
    return { text: fullText, bodyChars: fullText.length, sentChars: fullText.length, truncated: false };
  }
  const cut = fullText.lastIndexOf('\n\n', max);
  const text = fullText.slice(0, cut > 0 ? cut : max);
  return { text, bodyChars: fullText.length, sentChars: text.length, truncated: true };
}

/** @param {{ title: string, text: string }} article  @param {string} body */
function articleBlock(article, body) {
  return `<article>\n<title>${article.title ?? ''}</title>\n<summary>${article.text ?? ''}</summary>\n<body>\n${body}\n</body>\n</article>`;
}

/** @param {{ title: string, text: string }} article  @param {string} body the (possibly cut) body */
export function classifyMessage(article, body) {
  return articleBlock(article, body);
}

/**
 * @param {{ title: string, text: string, fullText: string }} article
 * @param {string[]} labels the labels that survived classification
 */
export function extractMessage(article, labels) {
  return `${articleBlock(article, article.fullText)}\n\nExtract these event types: ${labels.join(', ')}`;
}
