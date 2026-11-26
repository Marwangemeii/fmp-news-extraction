/**
 * Earnings time (D11, D48): wording, clock times with timezones (DST), the press-release publish-time rule.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTime, timeFromPublishTime, etParts } from '../src/lib/time.js';

test('wording → bmo / amc, with no clock time needed', () => {
  assert.equal(parseTime('before market open').value.time, 'bmo');
  assert.equal(parseTime('prior to the market opening').value.time, 'bmo');
  assert.equal(parseTime('pre-market').value.time, 'bmo');
  assert.equal(parseTime('after the market closes').value.time, 'amc');
  assert.equal(parseTime('after the close').value.time, 'amc');
  assert.equal(parseTime('after market close on Thursday').value.timeExact, null);
});

test('clock time + timezone + proven date → timeExact in UTC, daylight saving time handled', () => {
  assert.equal(parseTime('4:05 p.m. ET', { date: '2026-12-11' }).value.timeExact, '2026-12-11T21:05:00.000Z'); // EST
  assert.equal(parseTime('4:05 p.m. ET', { date: '2026-07-15' }).value.timeExact, '2026-07-15T20:05:00.000Z'); // EDT
  assert.equal(parseTime('7:00 a.m. Eastern Time', { date: '2026-11-20' }).value.timeExact, '2026-11-20T12:00:00.000Z');
  assert.equal(parseTime('8:30 a.m. PT', { date: '2026-11-20' }).value.timeExact, '2026-11-20T16:30:00.000Z');
  assert.equal(parseTime('12:00 p.m. EST', { date: '2026-11-20' }).value.timeExact, '2026-11-20T17:00:00.000Z');
  assert.equal(parseTime('07:00 CET', { date: '2026-11-24' }).value.timeExact, '2026-11-24T06:00:00.000Z');
});

test('a clock time gives bmo/amc only for a US listing; during market hours it is null', () => {
  assert.equal(parseTime('7:30 a.m. ET', { date: '2026-11-20', usListing: true }).value.time, 'bmo');
  assert.equal(parseTime('4:05 p.m. ET', { date: '2026-11-20', usListing: true }).value.time, 'amc');
  assert.equal(parseTime('11:00 a.m. ET', { date: '2026-11-20', usListing: true }).value.time, null);
  assert.equal(parseTime('7:30 a.m. ET', { date: '2026-11-20', usListing: false }).value.time, null);
  // No date: no timeExact, but an ET clock still gives bmo/amc for a US listing.
  const r = parseTime('4:05 p.m. ET', { usListing: true });
  assert.deepEqual(r.value, { time: 'amc', timeExact: null });
  assert.match(r.rule, /no proven results date/);
});

test('no wording and no clock time with a timezone → null with a reason', () => {
  assert.match(parseTime('on Tuesday').reason, /no bmo\/amc wording/);
  assert.equal(parseTime('at 4 ET').value, null); // "4 ET" is not a time
});

test('press-release rule: publish time in New York → bmo / amc / null during market hours', () => {
  assert.equal(timeFromPublishTime('2026-11-20T12:45:00.000Z').value, 'bmo'); // IES 7:45 ET
  assert.equal(timeFromPublishTime('2026-11-24T14:10:00.000Z').value, 'bmo'); // T3 9:10 ET
  assert.equal(timeFromPublishTime('2026-11-24T21:15:00.000Z').value, 'amc'); // HP 16:15 ET
  assert.equal(timeFromPublishTime('2026-11-24T17:48:39.000Z').value, null); // 12:48 ET
  assert.deepEqual(etParts('2026-11-25T02:27:43.000Z'), { date: '2026-11-24', minutes: 21 * 60 + 27 }); // the ET day differs from UTC
});
