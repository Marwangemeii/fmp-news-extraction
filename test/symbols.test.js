/**
 * Tickers and FMP suffixes (D14, D46): suffix table, the "(Exchange: TICKER)" regex, K7, the fallback.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toFmpSymbol, findTickers, proveTicker, resolveSymbols, exchangeCode, isUsExchange } from '../src/lib/symbols.js';

test('suffix table: US has none; non-US gets the FMP suffix; a class/unit dot becomes "-"', () => {
  assert.equal(toFmpSymbol('HPQ', 'NYSE').value, 'HPQ');
  assert.equal(toFmpSymbol('WWB', 'Nasdaq Global Select Market').value, 'WWB');
  assert.equal(toFmpSymbol('IS', 'TSX').value, 'IS.TO');
  assert.equal(toFmpSymbol('ABC', 'TSX-V').value, 'ABC.V');
  assert.equal(toFmpSymbol('ABC', 'CSE').value, 'ABC.CN');
  assert.equal(toFmpSymbol('CMBT', 'Euronext Brussels').value, 'CMBT.BR');
  assert.equal(toFmpSymbol('CMBTO', 'Euronext Oslo Børs').value, 'CMBTO.OL');
  assert.equal(toFmpSymbol('VOD', 'London Stock Exchange').value, 'VOD.L');
  assert.equal(toFmpSymbol('BRK.B', 'NYSE').value, 'BRK-B');
  assert.equal(toFmpSymbol('REI.UN', 'TSX').value, 'REI-UN.TO');
  assert.equal(toFmpSymbol('MCIG', 'OTCQB').value, 'MCIG');
});

test('suffix table: no exchange → as written; an unknown exchange or a non-ticker → null with a reason', () => {
  assert.deepEqual(toFmpSymbol('ANT', null).value, 'ANT');
  assert.match(toFmpSymbol('ABC', 'Bolsa de Lima').reason, /unknown exchange/);
  assert.match(toFmpSymbol('Anthropic', 'NASDAQ').reason, /does not look like a ticker/);
});

test('exchange codes: "Nasdaq Stockholm" is not the US Nasdaq; US vs non-US', () => {
  assert.equal(exchangeCode('Nasdaq Stockholm'), 'Stockholm');
  assert.equal(isUsExchange(exchangeCode('NYSE American')), true);
  assert.equal(isUsExchange(exchangeCode('TSX')), false);
  assert.equal(isUsExchange(null), false);
});

test('findTickers: several listings in one bracket, a bare ticker keeps the previous exchange', () => {
  const cmb = 'CMB.TECH NV (“CMBT”) (NYSE: CMBT, Euronext Brussels: CMBT and Euronext Oslo Børs: CMBTO) reports.';
  assert.deepEqual(findTickers(cmb).map((x) => x.symbol), ['CMBT', 'CMBT.BR', 'CMBTO.OL']);
  assert.deepEqual(findTickers('Seneca Foods Corp. (Nasdaq: SENEA, SENEB) announced').map((x) => x.symbol), ['SENEA', 'SENEB']);
  assert.deepEqual(findTickers('Infrastructure Dividend Split Corp. (TSX:IS) (the “Fund”)').map((x) => x.symbol), ['IS.TO']);
  assert.deepEqual(findTickers('mCig Inc. (OTCQB:MCIG) today').map((x) => x.symbol), ['MCIG']);
  // Not tickers: no known exchange, a time, a lowercase word.
  assert.deepEqual(findTickers('the call (at 4:05 p.m.) (Note: see below) (the “Company”)'), []);
});

test('K7: ticker as a whole word in a sentence of the article, exchange too if given', () => {
  const text = 'HP (NYSE: HPQ) reported results.\n\nShares rose.';
  assert.equal(proveTicker({ ticker: 'HPQ', exchange: 'NYSE', evidence: 'HP (NYSE: HPQ) reported results.' }, text).ok, true);
  assert.match(proveTicker({ ticker: 'HP', exchange: null, evidence: 'Shares rose.' }, text).reason, /not in its sentence/);
  assert.match(proveTicker({ ticker: 'HPQ', exchange: 'NASDAQ', evidence: 'HP (NYSE: HPQ) reported results.' }, text).reason, /exchange "NASDAQ"/);
  assert.match(proveTicker({ ticker: 'HPQ', exchange: null, evidence: 'HP Inc. (HPQ) reported.' }, text).reason, /not found in fullText/);
});

test('resolveSymbols: no classifier answer → first regex ticker in the opening; classifier null stays null', () => {
  const article = { fullText: 'Law firm alert.\n\nInvestors in Fervo Energy (NASDAQ: FRVO) may have claims.\n\nAlso (NYSE: XYZ).' };
  const none = resolveSymbols(article, null);
  assert.equal(none.symbol, 'FRVO');
  assert.deepEqual(none.relatedSymbols, ['FRVO', 'XYZ']);
  assert.equal(none.exchange, 'NASDAQ');

  const nullAnswer = resolveSymbols(article, { symbol: null, relatedSymbols: [] });
  assert.equal(nullAnswer.symbol, null); // the classifier's "no single company" stands
  assert.deepEqual(nullAnswer.relatedSymbols, ['FRVO', 'XYZ']);
});

test('resolveSymbols: no exchange from the classifier → the exchange the regex found for that ticker', () => {
  const article = { fullText: 'Infrastructure Dividend Split Corp. (TSX:IS) announced a distribution. IS units trade daily.' };
  const r = resolveSymbols(article, { symbol: { ticker: 'IS', exchange: null, evidence: 'Infrastructure Dividend Split Corp. (TSX:IS) announced a distribution.' }, relatedSymbols: [] });
  assert.equal(r.symbol, 'IS.TO');
});
