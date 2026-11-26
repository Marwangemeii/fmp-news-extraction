/**
 * Exchanges and tickers (D14, D46).
 * - exchange names as written → one code → the FMP suffix ("TSX" → ".TO");
 * - findTickers(): the deterministic "(NASDAQ: ABC)" pattern;
 * - K7: a ticker the LLM proposes must be written in its sentence, and that sentence in the article;
 * - resolveSymbols(): the article's `symbol` + `relatedSymbols`, with a trace of every decision.
 */
import { evidenceInText, opening } from './checks.js';

/** Exchange as written → code. Order matters: "NYSE American" before "NYSE", "TSX Venture" before "TSX". */
const EXCHANGES = [
  [/stockholm/i, 'Stockholm'], // before NASDAQ: "Nasdaq Stockholm" is not the US Nasdaq
  [/nasdaq/i, 'NASDAQ'],
  [/nyse american|nyse mkt|\bamex\b/i, 'NYSE American'],
  [/nyse arca/i, 'NYSE Arca'],
  [/new york stock exchange|\bnyse\b/i, 'NYSE'],
  [/\botc/i, 'OTC'],
  [/cboe canada|\bneo\b/i, 'Cboe Canada'],
  [/\bcboe\b/i, 'Cboe'],
  [/tsx venture|\btsxv\b|\btsx-v\b/i, 'TSXV'],
  [/toronto stock exchange|\btsx\b/i, 'TSX'],
  [/canadian securities exchange|\bcse\b|\bcnsx\b/i, 'CSE'],
  [/london stock exchange|\blse\b|\baim\b/i, 'LSE'],
  [/xetra/i, 'XETRA'],
  [/frankfurt|\bfse\b/i, 'FSE'],
  [/euronext paris/i, 'Euronext Paris'],
  [/euronext amsterdam/i, 'Euronext Amsterdam'],
  [/euronext brussels/i, 'Euronext Brussels'],
  [/borsa italiana|euronext milan/i, 'Borsa Italiana'],
  [/six swiss|\bsix\b/i, 'SIX'],
  [/australian securities exchange|\basx\b/i, 'ASX'],
  [/hong kong|\bhkex\b|\bsehk\b/i, 'HKEX'],
  [/tokyo stock exchange/i, 'TSE'],
  [/national stock exchange of india|\bnse\b/i, 'NSE'],
  [/oslo/i, 'Oslo'],
];

/**
 * Exchange code → FMP ticker suffix. "" = a US exchange (no suffix).
 * Only .L, .DE and .MI were checked against FMP so far (handoff 03); FMP's docs site returned 403
 * for the rest (2026-11-25), so the others follow the Yahoo-style convention FMP uses: UNVERIFIED (D46).
 */
export const FMP_SUFFIX = {
  NASDAQ: '', NYSE: '', 'NYSE American': '', 'NYSE Arca': '', Cboe: '', OTC: '',
  TSX: '.TO', TSXV: '.V', CSE: '.CN', 'Cboe Canada': '.NE',
  LSE: '.L', XETRA: '.DE', FSE: '.F',
  'Euronext Paris': '.PA', 'Euronext Amsterdam': '.AS', 'Euronext Brussels': '.BR', 'Borsa Italiana': '.MI',
  SIX: '.SW', ASX: '.AX', HKEX: '.HK', TSE: '.T', NSE: '.NS', Oslo: '.OL', Stockholm: '.ST',
};

/** @param {string|null} raw e.g. "Nasdaq Global Market" → "NASDAQ"; null if not a known exchange */
export function exchangeCode(raw) {
  if (!raw) return null;
  return EXCHANGES.find(([re]) => re.test(raw))?.[1] ?? null;
}

/**
 * @param {string|null} raw e.g. "Nasdaq Global Market", "TSX-V"
 * @returns {string|null} the code, or the text as written if unknown (for the IPO `exchange` field)
 */
export function normalizeExchange(raw) {
  if (!raw) return null;
  return exchangeCode(raw) ?? raw.replace(/\s+/g, ' ').trim();
}

/** A US exchange: market hours 9:30–16:00 ET apply (D11). */
export const isUsExchange = (code) => FMP_SUFFIX[code] === '';

/** A ticker as written: "HPQ", "BRK.B", "REI.UN", "BRK-B". */
const TICKER = /^[A-Z][A-Z0-9]{0,5}(?:[.-][A-Z0-9]{1,4})?$/;

/**
 * Ticker + exchange as written → FMP symbol. A class/unit dot becomes "-" (FMP style: BRK.B → BRK-B,
 * REI.UN on TSX → REI-UN.TO), then the exchange suffix is added.
 * @returns {{ value: string, rule: string } | { value: null, reason: string }}
 */
export function toFmpSymbol(ticker, exchangeRaw) {
  if (!TICKER.test(ticker ?? '')) return { value: null, reason: `"${ticker}" does not look like a ticker` };
  if (!exchangeRaw) return { value: ticker, rule: `"${ticker}" with no exchange written: as written, no suffix` };
  const code = exchangeCode(exchangeRaw);
  if (!code) return { value: null, reason: `unknown exchange "${exchangeRaw}": no FMP suffix known` };
  const value = ticker.replace('.', '-') + FMP_SUFFIX[code];
  return { value, rule: `"${ticker}" on "${exchangeRaw}" → ${code} → ${value}` };
}

/**
 * Every "(Exchange: TICKER)" in the text, deterministically. Handles several listings in one bracket,
 * "(NYSE: CMBT, Euronext Brussels: CMBT and Euronext Oslo Børs: CMBTO)", and a bare ticker after a pair,
 * which keeps that pair's exchange: "(Nasdaq: SENEA, SENEB)". A pair counts only if the exchange is known.
 * @param {string} text
 * @returns {{ ticker: string, exchange: string, symbol: string }[]} in article order, unique by symbol
 */
export function findTickers(text) {
  const out = [];
  for (const m of (text ?? '').matchAll(/\(([^()]{2,200})\)/g)) {
    let exchange = null;
    for (const piece of m[1].split(/[,;]|\band\b/)) {
      const p = piece.trim();
      const pair = p.match(/^(.{2,40}?)\s*:\s*["“]?([A-Za-z0-9.-]+?)["”]?$/);
      let ticker;
      if (pair) {
        exchange = exchangeCode(pair[1]) ? pair[1].trim() : null;
        ticker = pair[2];
      } else if (exchange) ticker = p;
      if (!exchange || !TICKER.test(ticker ?? '')) continue;
      const symbol = toFmpSymbol(ticker, exchange).value;
      if (symbol && !out.some((x) => x.symbol === symbol)) out.push({ ticker, exchange, symbol });
    }
  }
  return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * K7: a proposed ticker is real only if its sentence is in the article (K1), the ticker is in that
 * sentence as a whole word (case-sensitive), and so is the exchange, if one was given.
 * @param {{ ticker: string, exchange: string|null, evidence: string }} p as the classifier returned it
 * @param {string} text fullText
 * @returns {{ ok: boolean, reason?: string }}
 */
export function proveTicker(p, text) {
  const k1 = evidenceInText(p.evidence, text);
  if (!k1.ok) return k1;
  const ev = p.evidence.replace(/\s+/g, ' ');
  if (!new RegExp(`(^|[^A-Za-z0-9])${escapeRe(p.ticker)}($|[^A-Za-z0-9])`).test(ev)) {
    return { ok: false, reason: `ticker "${p.ticker}" not in its sentence` };
  }
  if (p.exchange && !ev.toLowerCase().includes(p.exchange.replace(/\s+/g, ' ').toLowerCase())) {
    return { ok: false, reason: `exchange "${p.exchange}" not in its sentence` };
  }
  return { ok: true };
}

/**
 * The article's symbol and relatedSymbols (D14, D46).
 * - symbol: the classifier's main ticker if it passes K7. With no classifier answer (no LLM call, or it
 *   failed), the first "(Exchange: TICKER)" in the opening paragraphs. If the classifier said "no single
 *   company" (null) or its ticker failed K7 → null: no guess.
 * - relatedSymbols: the K7-proven tickers of the classifier + every regex ticker; main symbol first.
 * If the classifier gives no exchange, the exchange the regex found for the same ticker is used.
 *
 * @param {{ fullText: string|null }} article
 * @param {{ symbol: object|null, relatedSymbols: object[] } | null} proposed the classifier's answer, or null
 * @returns {{ symbol: string|null, exchange: string|null, relatedSymbols: string[], trace: object }}
 */
export function resolveSymbols(article, proposed) {
  const text = article.fullText ?? '';
  const regex = findTickers(text);
  const trace = { value: null, exchange: null, regex: regex.map((x) => x.symbol), related: [] };

  /** K7 + suffix for one proposed ticker; returns { symbol, code } or null, and traces why. */
  const prove = (p, role) => {
    const exchange = p.exchange || regex.find((x) => x.ticker === p.ticker)?.exchange || null;
    const k7 = proveTicker(p, text);
    const fmp = k7.ok ? toFmpSymbol(p.ticker, exchange) : null;
    const t = { role, ticker: p.ticker, exchange: p.exchange, evidence: p.evidence, k7: k7.ok };
    if (!k7.ok) t.reason = `K7: ${k7.reason}`;
    else if (fmp.value === null) t.reason = fmp.reason;
    else {
      t.symbol = fmp.value;
      t.rule = fmp.rule + (p.exchange ? '' : exchange ? ` (exchange from the "(${exchange}: ${p.ticker})" pattern)` : '');
    }
    trace.related.push(t);
    return t.symbol ? { symbol: t.symbol, code: exchangeCode(exchange) } : null;
  };

  let main = null;
  if (proposed) {
    if (proposed.symbol) {
      main = prove(proposed.symbol, 'main');
      trace.rule = main ? 'the classifier\'s main ticker, proven by K7' : undefined;
      trace.reason = main ? undefined : 'the classifier\'s main ticker failed (see related[0]): null, no guess';
    } else {
      trace.reason = 'the classifier found no single main company with a written ticker: null';
    }
  } else {
    const first = findTickers(opening(text))[0];
    if (first) {
      main = { symbol: first.symbol, code: exchangeCode(first.exchange) };
      trace.rule = `no classifier answer: first "(${first.exchange}: ${first.ticker})" in the opening paragraphs`;
    } else {
      trace.reason = 'no classifier answer and no "(Exchange: TICKER)" in the opening paragraphs: null';
    }
  }

  const related = proposed ? (proposed.relatedSymbols ?? []).map((p) => prove(p, 'related')?.symbol) : [];
  const relatedSymbols = [...new Set([main?.symbol, ...related, ...regex.map((x) => x.symbol)].filter(Boolean))];
  trace.value = main?.symbol ?? null;
  trace.exchange = main?.code ?? null;
  return { symbol: trace.value, exchange: trace.exchange, relatedSymbols, trace };
}
