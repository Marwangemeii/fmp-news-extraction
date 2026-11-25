/**
 * Exchanges and tickers (D14). M1: exchange names as written → one code.
 * M2 adds the FMP suffix table and the ticker checks.
 */

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
 * @param {string|null} raw e.g. "Nasdaq Global Market", "TSX-V"
 * @returns {string|null} the code, or the text as written if unknown
 */
export function normalizeExchange(raw) {
  if (!raw) return null;
  const hit = EXCHANGES.find(([re]) => re.test(raw));
  return hit ? hit[1] : raw.replace(/\s+/g, ' ').trim();
}
