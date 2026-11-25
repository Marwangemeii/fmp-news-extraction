/**
 * Converters (D37): text exactly as written in the article → a plain number, date or enum.
 * Pure and deterministic, so the same text always gives the same value, and each step is
 * written out in `rule` for the trace. When the text can't be read without guessing,
 * the result is `{ value: null, reason }`. Never a guess.
 *
 * @typedef {{ value: any, rule?: string, reason?: string, yearInferred?: boolean, currency?: string|null }} Converted
 */

const ok = (value, rule, extra = {}) => ({ value, rule, ...extra });
const fail = (reason) => ({ value: null, reason });

// ---------- numbers ----------

const SCALES = [
  { re: /^(trillion|tn|t)\b/i, factor: 1e12, word: 'trillion' },
  { re: /^(billion|bn|b)\b/i, factor: 1e9, word: 'billion' },
  { re: /^(million|mn|mm|m)\b/i, factor: 1e6, word: 'million' },
  { re: /^(thousand|k)\b/i, factor: 1e3, word: 'thousand' },
];

// Longest first, so "US$" wins over "$".
const CURRENCIES = [
  ['US$', 'USD'], ['C$', 'CAD'], ['CA$', 'CAD'], ['A$', 'AUD'], ['AU$', 'AUD'], ['HK$', 'HKD'], ['NZ$', 'NZD'],
  ['S$', 'SGD'], ['R$', 'BRL'], ['$', 'USD?'], ['€', 'EUR'], ['£', 'GBP'], ['¥', 'JPY'], ['₹', 'INR'],
  ['USD', 'USD'], ['CAD', 'CAD'], ['EUR', 'EUR'], ['GBP', 'GBP'], ['JPY', 'JPY'], ['CHF', 'CHF'], ['AUD', 'AUD'],
  ['SEK', 'SEK'], ['NOK', 'NOK'], ['DKK', 'DKK'], ['INR', 'INR'], ['RMB', 'CNY'], ['CNY', 'CNY'],
];

/** A number as written: "1,234.5", "412.5", ".84". Thousands separators must be groups of 3. */
const NUMBER = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+/g;

/**
 * Reads one amount: sign, currency, number, scale word, cents.
 * @param {string} raw
 * @returns {Converted & { scale?: string|null, cents?: boolean }}
 */
function readAmount(raw) {
  const s = raw.trim();
  if (/\d,\d{1,2}(?!\d)/.test(s)) return fail(`comma decimal in "${raw}" is not supported (ambiguous)`);
  const numbers = s.match(NUMBER) ?? [];
  if (numbers.length === 0) return fail(`no number in "${raw}"`);
  if (numbers.length > 1) return fail(`more than one number in "${raw}"`);

  const numText = numbers[0];
  let value = Number(numText.replace(/,/g, ''));
  // What follows the number, past a closing bracket: "$(3.2) million" → "million".
  const after = s.slice(s.indexOf(numText) + numText.length).replace(/^\s*\)?\s*/, '');
  const steps = [`"${numText}" → ${value}`];

  // A scale word may follow the number ("$412.5 million", "$1.2B").
  const scale = SCALES.find((x) => x.re.test(after));
  if (scale) {
    value *= scale.factor;
    steps.push(`× ${scale.word}`);
  }
  const cents = /^(cents?|¢)/i.test(after) || /^¢/.test(s);
  if (cents) {
    value /= 100;
    steps.push('cents ÷ 100');
  }

  // Negative: "(0.12)", "$(0.12)", "-$0.12", "−0.12", "loss of $0.12".
  const negative = /\(\s*[^()]*\d[^()]*\)/.test(s) || /^[-−–]/.test(s) || /[-−–]\s*[$€£¥]?\s*\d/.test(s) || /\bloss\b/i.test(s);
  if (negative) {
    value = -Math.abs(value);
    steps.push('negative (parentheses, minus or "loss")');
  }

  const currency = CURRENCIES.find(([sym]) => s.includes(sym))?.[1] ?? null;
  // Rounds away float noise from the multiplication (412.5 × 1e6 = 412500000.00000006).
  value = Number(value.toPrecision(12));
  return ok(value, steps.join(', '), { currency, scale: scale?.word ?? null, cents });
}

/**
 * A money total (revenue, market cap): "$412.5 million" → 412500000, "$412,500,000" → 412500000.
 * Needs a scale word, or a currency AND a full figure ≥ 1,000,000. A bare table number like "802,932"
 * or "2,026,505" is often "in thousands" (stated in a table header the value doesn't carry), and
 * reading it at face value would be wrong by 1000×. So it is refused, never guessed.
 * @param {string} raw
 */
export function parseMoney(raw) {
  const r = readAmount(raw);
  if (r.value === null) return r;
  if (!r.scale && !(r.currency && Math.abs(r.value) >= 1e6)) {
    return fail(`no unit stated in "${raw}" (a bare table number may be "in thousands")`);
  }
  return ok(r.value, `parseMoney: ${r.rule}${r.currency ? ` (${r.currency})` : ''}`, { currency: r.currency });
}

/**
 * A per-share amount (EPS, dividend, offering price): "$0.84", "84 cents", "(0.12)", "loss of $0.12".
 * @param {string} raw
 */
export function parsePerShare(raw) {
  const r = readAmount(raw);
  if (r.value === null) return r;
  if (r.scale) return fail(`"${raw}" has a scale word (${r.scale}): not a per-share amount`);
  return ok(r.value, `parsePerShare: ${r.rule}${r.currency ? ` (${r.currency})` : ''}`, { currency: r.currency });
}

/**
 * A share count: "5,000,000 shares", "5.0 million" → 5000000.
 * @param {string} raw
 */
export function parseShares(raw) {
  const r = readAmount(raw);
  if (r.value === null) return r;
  if (r.value < 0 || !Number.isInteger(r.value)) return fail(`"${raw}" is not a whole number of shares`);
  return ok(r.value, `parseShares: ${r.rule}`);
}

// ---------- dates ----------

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const DAY = '(\\d{1,2})(?:st|nd|rd|th)?';
const YEAR = '(\\d{4})';

const pad = (n) => String(n).padStart(2, '0');

/** A real calendar date? (rejects Feb 30, month 13…) */
function isRealDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function build(y, m, d, rule, extra = {}) {
  if (!isRealDate(y, m, d)) return fail(`${y}-${pad(m)}-${pad(d)} is not a real calendar date`);
  return ok(`${y}-${pad(m)}-${pad(d)}`, rule, extra);
}

/**
 * The year that puts month/day nearest to the publish date (D37, `yearInferred`).
 * "payable January 15" in a release published 2026-12-10 → 2027-01-15.
 */
function nearestYear(m, d, publishedDate) {
  const pub = new Date(publishedDate);
  const y = pub.getUTCFullYear();
  let best = null;
  for (const cand of [y - 1, y, y + 1]) {
    if (!isRealDate(cand, m, d)) continue;
    const diff = Math.abs(Date.UTC(cand, m - 1, d) - pub.getTime());
    if (best === null || diff < best.diff) best = { year: cand, diff };
  }
  return best?.year ?? null;
}

/**
 * A date as written → "YYYY-MM-DD".
 * "December 15, 2026" · "Dec. 15, 2026" · "Thursday, Sept. 30th, 2026" · "15 December 2026" · "2026-12-15" ·
 * "12/25/2026" (only if unambiguous). Without a year, the year nearest `publishedDate` (trace: yearInferred).
 *
 * @param {string} raw
 * @param {{ publishedDate?: string|null }} [ctx]
 */
export function parseDate(raw, { publishedDate } = {}) {
  const s = raw.trim();
  let m;

  if ((m = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/))) {
    return build(+m[1], +m[2], +m[3], `parseDate: ISO "${m[0]}"`);
  }
  if ((m = s.match(new RegExp(`\\b${MONTH}\\s+${DAY},?\\s+${YEAR}\\b`, 'i')))) {
    return build(+m[3], MONTHS[m[1].toLowerCase()], +m[2], `parseDate: "${m[0]}" (month day, year)`);
  }
  if ((m = s.match(new RegExp(`\\b${DAY}\\s+(?:of\\s+)?${MONTH},?\\s+${YEAR}\\b`, 'i')))) {
    return build(+m[3], MONTHS[m[2].toLowerCase()], +m[1], `parseDate: "${m[0]}" (day month year)`);
  }
  if ((m = s.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/))) {
    const [a, b, y] = [+m[1], +m[2], +m[3]];
    if (a <= 12 && b <= 12 && a !== b) return fail(`"${m[0]}" is ambiguous (month/day or day/month)`);
    const [mo, d] = a > 12 ? [b, a] : [a, b];
    return build(y, mo, d, `parseDate: "${m[0]}" (${a > 12 ? 'day/month' : 'month/day'}/year)`);
  }

  // No year written: month + day only.
  m = s.match(new RegExp(`\\b${MONTH}\\s+${DAY}\\b`, 'i')) ?? s.match(new RegExp(`\\b${DAY}\\s+(?:of\\s+)?${MONTH}\\b`, 'i'));
  if (m) {
    const [mo, d] = /^\d/.test(m[1]) ? [MONTHS[m[2].toLowerCase()], +m[1]] : [MONTHS[m[1].toLowerCase()], +m[2]];
    if (!publishedDate) return fail(`"${m[0]}" has no year and there is no publish date to place it`);
    const y = nearestYear(mo, d, publishedDate);
    if (y === null) return fail(`"${m[0]}" is not a real calendar date`);
    return build(y, mo, d, `parseDate: "${m[0]}", no year written → ${y} (nearest to publishedDate ${publishedDate.slice(0, 10)})`, { yearInferred: true });
  }
  return fail(`no date found in "${raw}"`);
}

// ---------- split ratio ----------

const UNITS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const WORD_NUMBERS = {
  ...UNITS, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
};

/** "10" → 10, "ten" → 10, "twenty-five" → 25. Positive integers only. */
function toInt(word) {
  const w = word.toLowerCase();
  if (/^\d+$/.test(w)) return Number(w);
  return w.split('-').reduce((sum, part) => sum + (WORD_NUMBERS[part] ?? NaN), 0) || null;
}

// A number: digits, or a number word ("ten", "twenty-five"). Longest words first so "fourteen" beats "four".
const NUMBER_WORDS = Object.keys(WORD_NUMBERS).sort((a, b) => b.length - a.length).join('|');
const NUM = `(\\d+|(?:${NUMBER_WORDS})(?:-(?:${Object.keys(UNITS).join('|')}))?)`;

/**
 * A split ratio → { numerator: new shares, denominator: old shares, splitType }.
 * "1-for-10" → 1/10 reverse · "two-for-one" → 2/1 forward · "3:1" → 3/1 · "one (1) new share for every ten (10)" → 1/10.
 * @param {string} raw
 */
export function parseRatio(raw) {
  // "one (1)" → "one": the digits in brackets repeat the word.
  const s = raw.toLowerCase().replace(/\(\s*\d+\s*\)/g, '').replace(/\s+/g, ' ').trim();
  let m;
  let form;
  if ((m = s.match(new RegExp(`\\b${NUM}\\b[^.;]*?\\bfor (?:each|every) ${NUM}\\b`)))) form = '"X … for every Y"';
  else if ((m = s.match(new RegExp(`\\b${NUM}[\\s-]+for[\\s-]+${NUM}\\b`)))) form = '"X-for-Y"';
  else if ((m = s.match(/\b(\d+)\s*:\s*(\d+)\b/))) form = '"X:Y"';
  else return fail(`no ratio found in "${raw}"`);

  const numerator = toInt(m[1]);
  const denominator = toInt(m[2]);
  if (!numerator || !denominator) return fail(`"${m[0]}" is not two whole numbers`);
  if (numerator === denominator) return fail(`"${m[0]}" is 1:1, not a split`);
  const splitType = numerator > denominator ? 'forward' : 'reverse';
  return ok({ numerator, denominator, splitType }, `parseRatio: ${form} → ${numerator} new for ${denominator} old (${splitType})`);
}

// ---------- fiscal period and year ----------

const ORDINALS = { first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4 };

/**
 * "third quarter" / "Q3" / "3Q" / "fourth-quarter" → "Q3"/"Q4"; "full year" / "fiscal year" / "FY" → "FY".
 * @param {string} raw
 */
export function parsePeriod(raw) {
  const s = raw.toLowerCase();
  let m;
  if ((m = s.match(/\bq([1-4])\b/)) || (m = s.match(/\b([1-4])q\b/))) return ok(`Q${m[1]}`, `parsePeriod: "${raw}" → Q${m[1]}`);
  if ((m = s.match(/\b(first|second|third|fourth|1st|2nd|3rd|4th)[\s-]+(?:fiscal[\s-]+)?quarter\b/))) {
    const q = ORDINALS[m[1]];
    return ok(`Q${q}`, `parsePeriod: "${raw}" → Q${q}`);
  }
  if (/\b(half|six months|nine months|h[12])\b/.test(s)) return fail(`"${raw}" is not a quarter or a full year`);
  if (/\b(full[\s-]year|fiscal year|fy(?:\d{2}|\d{4})?|annual|twelve months|12 months|year[\s-]end(?:ed)?)\b/.test(s)) {
    return ok('FY', `parsePeriod: "${raw}" → FY`);
  }
  return fail(`no fiscal period found in "${raw}"`);
}

/**
 * "fiscal 2026" / "FY2026" / "FY26" / "2026" → 2026. "2025/26" → null (which year?).
 * @param {string} raw
 */
export function parseFiscalYear(raw) {
  const s = raw.trim();
  if (/\d{4}\s*[/–-]\s*\d{2,4}\b/.test(s)) return fail(`"${raw}" spans two years`);
  let m;
  if ((m = s.match(/\b(?:fy|fiscal(?: year)?)\s*'?(\d{2}|\d{4})\b/i))) {
    const y = m[1].length === 2 ? 2000 + Number(m[1]) : Number(m[1]);
    return ok(y, `parseFiscalYear: "${m[0]}" → ${y}`);
  }
  const years = [...new Set(s.match(/\b(19|20)\d{2}\b/g) ?? [])];
  if (years.length === 1) return ok(Number(years[0]), `parseFiscalYear: "${years[0]}" → ${years[0]}`);
  if (years.length > 1) return fail(`"${raw}" has more than one year`);
  return fail(`no year found in "${raw}"`);
}

// ---------- text ----------

/** Kept as written; only whitespace is tidied. Used for IPO company and price range. */
export function asText(raw) {
  const value = raw.replace(/\s+/g, ' ').trim();
  return value ? ok(value, 'text as written') : fail('empty text');
}
