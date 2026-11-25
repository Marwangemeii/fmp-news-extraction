/**
 * Converters (D37): text as written → number / date / enum. Every rule has a case here,
 * including the ones that must refuse (null) instead of guessing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney, parsePerShare, parseShares, parseDate, parseRatio, parsePeriod, parseFiscalYear, asText } from '../src/lib/convert.js';

const v = (r) => r.value;

test('parseMoney: scale words and full figures (R-E4)', () => {
  assert.equal(v(parseMoney('$412.5 million')), 412500000);
  assert.equal(v(parseMoney('US$1.2B')), 1.2e9);
  assert.equal(v(parseMoney('€3.4 bn')), 3.4e9);
  assert.equal(v(parseMoney('$412,500,000')), 412500000);
  assert.equal(v(parseMoney('$5m')), 5e6);
  assert.equal(v(parseMoney('$2.25 trillion')), 2.25e12);
  assert.equal(v(parseMoney('C$12.4 million')), 12400000);
  assert.equal(parseMoney('C$12.4 million').currency, 'CAD');
  assert.equal(v(parseMoney('$(3.2) million')), -3200000);
});

test('parseMoney: refuses a bare number that may be "in thousands", ranges and comma decimals', () => {
  assert.equal(v(parseMoney('412,500')), null);
  assert.equal(v(parseMoney('2,026,505')), null); // ≥ 1M but no currency: a table value "in thousands" (eval fixture 12)
  assert.match(parseMoney('412,500').reason, /no unit/);
  assert.equal(v(parseMoney('$14 to $16 million')), null); // two numbers
  assert.equal(v(parseMoney('3,4 million')), null); // European decimal comma: ambiguous
  assert.equal(v(parseMoney('n/a')), null);
});

test('parsePerShare: EPS, cents, negatives in parentheses or words', () => {
  assert.equal(v(parsePerShare('$0.84')), 0.84);
  assert.equal(v(parsePerShare('$0.84 per diluted share')), 0.84);
  assert.equal(v(parsePerShare('84 cents')), 0.84);
  assert.equal(v(parsePerShare('(0.12)')), -0.12);
  assert.equal(v(parsePerShare('$(0.12)')), -0.12);
  assert.equal(v(parsePerShare('-$0.12')), -0.12);
  assert.equal(v(parsePerShare('loss of $0.12')), -0.12);
  assert.equal(v(parsePerShare('C$0.05 per share')), 0.05);
  assert.equal(v(parsePerShare('$1.2 million')), null); // a total, not per share
});

test('parseShares: whole numbers only', () => {
  assert.equal(v(parseShares('5,000,000 shares')), 5000000);
  assert.equal(v(parseShares('5.0 million')), 5000000);
  assert.equal(v(parseShares('2.5 shares')), null);
});

test('parseDate: common written forms → YYYY-MM-DD (R-E8)', () => {
  assert.equal(v(parseDate('December 15, 2026')), '2026-12-15');
  assert.equal(v(parseDate('Dec. 15, 2026')), '2026-12-15');
  assert.equal(v(parseDate('Sept. 30, 2026')), '2026-09-30');
  assert.equal(v(parseDate('Thursday, November 5th, 2026')), '2026-11-05');
  assert.equal(v(parseDate('15 December 2026')), '2026-12-15');
  assert.equal(v(parseDate('2026-12-15')), '2026-12-15');
  assert.equal(v(parseDate('12/25/2026')), '2026-12-25');
  assert.equal(v(parseDate('25/12/2026')), '2026-12-25');
});

test('parseDate: refuses invalid and ambiguous dates', () => {
  assert.equal(v(parseDate('February 30, 2026')), null);
  assert.equal(v(parseDate('11/05/2026')), null); // Nov 5 or May 11?
  assert.equal(v(parseDate('next Tuesday')), null);
});

test('parseDate: no year written → the year nearest the publish date, flagged yearInferred (D37)', () => {
  const late = parseDate('January 15', { publishedDate: '2026-12-10T12:00:00Z' });
  assert.equal(late.value, '2027-01-15');
  assert.equal(late.yearInferred, true);
  assert.equal(v(parseDate('December 1', { publishedDate: '2026-11-20T12:00:00Z' })), '2026-12-01');
  assert.equal(v(parseDate('December 1')), null); // no publish date to place it
});

test('parseRatio: N-for-M = N new shares for M old (R-E6)', () => {
  assert.deepEqual(v(parseRatio('1-for-10')), { numerator: 1, denominator: 10, splitType: 'reverse' });
  assert.deepEqual(v(parseRatio('two-for-one')), { numerator: 2, denominator: 1, splitType: 'forward' });
  assert.deepEqual(v(parseRatio('3:1')), { numerator: 3, denominator: 1, splitType: 'forward' });
  assert.deepEqual(v(parseRatio('1 for 20')), { numerator: 1, denominator: 20, splitType: 'reverse' });
  assert.deepEqual(v(parseRatio('one-for-twenty-five')), { numerator: 1, denominator: 25, splitType: 'reverse' });
  assert.deepEqual(
    v(parseRatio('one (1) post-consolidation share for every ten (10) pre-consolidation shares')),
    { numerator: 1, denominator: 10, splitType: 'reverse' },
  );
  assert.equal(v(parseRatio('1-for-1')), null);
  assert.equal(v(parseRatio('a stock split')), null);
});

test('parsePeriod: quarters and full year; halves refused', () => {
  assert.equal(v(parsePeriod('third quarter')), 'Q3');
  assert.equal(v(parsePeriod('Q3')), 'Q3');
  assert.equal(v(parsePeriod('3Q')), 'Q3');
  assert.equal(v(parsePeriod('fourth-quarter')), 'Q4');
  assert.equal(v(parsePeriod('third quarter of fiscal 2026')), 'Q3');
  assert.equal(v(parsePeriod('full year')), 'FY');
  assert.equal(v(parsePeriod('fiscal year')), 'FY');
  assert.equal(v(parsePeriod('FY2026')), 'FY');
  assert.equal(v(parsePeriod('first half')), null);
  assert.equal(v(parsePeriod('nine months')), null);
});

test('parseFiscalYear: as the company labels it', () => {
  assert.equal(v(parseFiscalYear('fiscal 2026')), 2026);
  assert.equal(v(parseFiscalYear('FY2026')), 2026);
  assert.equal(v(parseFiscalYear('FY26')), 2026);
  assert.equal(v(parseFiscalYear('2026')), 2026);
  assert.equal(v(parseFiscalYear('fiscal year 2027')), 2027);
  assert.equal(v(parseFiscalYear('2025/26')), null);
  assert.equal(v(parseFiscalYear('this year')), null);
});

test('asText: kept as written, whitespace tidied', () => {
  assert.equal(v(asText('  Acme   Holdings, Inc. ')), 'Acme Holdings, Inc.');
  assert.equal(v(asText('$14.00 to $16.00')), '$14.00 to $16.00');
});

test('every successful conversion explains itself (rule), every refusal says why (reason)', () => {
  assert.match(parseMoney('$412.5 million').rule, /412\.5.*million/);
  assert.ok(parseDate('February 30, 2026').reason);
});
