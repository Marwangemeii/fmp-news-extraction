/**
 * D71: law-firm class-action notices → others without an LLM call.
 * Titles are real ones from the Phase 4 GlobeNewswire/Newsfile samples.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lawFirmNotice } from '../src/lib/notice-rule.js';

const body = (first) => `${first}\n\nMore text about the case.\n\nContact us.`;

test('law-firm notices are caught, with the firm in the title', () => {
  const titles = [
    'ROSEN, A LEADING LAW FIRM, Encourages Gildan Activewear Inc. Investors to Secure Counsel Before Important Deadline in Securities Class Action First Filed by the Firm - GIL',
    'DAVA EQUITY ACTION REMINDER: Faruqi & Faruqi, LLP Reminds Endava plc (DAVA) Investors of Securities Class Action Lawsuit Deadline on November 30, 2026',
    'Kaplan Fox & Kilsheimer LLP Alerts Coastal Financial Corporation (CCB) Investors: Securities Class Action Deadline is December 1, 2026',
    'INSM Shareholders: Amparo Law Firm PLLC Is Investigating Whether Insmed\'s $175.00-Per-Share Sale to Sanofi Delivers the Best Value for Shareholders',
    'Scott+Scott Attorneys at Law LLP Commences Investigation Into Arbor Realty Trust, Inc. (ABR) and Encourages Investors to Contact the Firm',
  ];
  for (const title of titles) {
    const r = lawFirmNotice({ title, fullText: body('NEW YORK, Nov. 24, 2026 -- A firm announces a case.') });
    assert.ok(r, title);
    assert.equal(r.firmIn, 'title');
  }
});

test('law-firm notices are caught, with the firm only in the opening paragraph', () => {
  const r = lawFirmNotice({
    title: 'QBTS INVESTOR NOTICE: D-Wave Quantum Inc. Investors with Substantial Losses May Seek to Lead D-Wave Class Action Lawsuit Before December 15, 2026 Deadline',
    fullText: body('San Diego, California--(Newsfile Corp. - November 23, 2026) - Robbins Geller Rudman & Dowd LLP announces that purchasers of D-Wave Quantum Inc. securities have until December 15, 2026 to seek appointment as lead plaintiff.'),
  });
  assert.deepEqual(r, { rule: 'law-firm class-action notice', litigation: 'Class Action', firm: 'LLP', firmIn: 'opening' });

  const esq = lawFirmNotice({
    title: 'TIGR Shareholder Alert: UP Fintech Holding Limited Securities Class Action Lawsuit - Investors With Losses May Contact SueWallSt',
    fullText: body('NEW YORK, Nov. 24, 2026 -- SueWallSt notifies investors that a securities class action is pending. Contact Joseph E. Levi, Esq. at the number below.'),
  });
  assert.equal(esq.firm, 'Esq.');
});

test('a firm name deep in the body does not count: only the title and the opening', () => {
  const r = lawFirmNotice({
    title: 'Acme Comments on Class Action Lawsuit',
    fullText: 'Acme said the claims are without merit.\n\nIt will defend itself.\n\nThe plaintiffs are represented by Smith LLP.',
  });
  assert.equal(r, null);
});

test('an issuer\'s own event release is never caught, even when it mentions litigation and counsel', () => {
  const cases = [
    // The title names results / a dividend / a split / an IPO: the LLM decides, as before.
    { title: 'Acme Reports Third Quarter 2026 Results and Update on Class Action Lawsuit', first: 'Acme, advised by outside counsel, today reported results.' },
    { title: 'Acme Declares Quarterly Dividend; Settles Securities Class Action', first: 'The settlement was negotiated by Acme\'s counsel, Smith LLP.' },
    { title: 'Acme Announces Pricing of Initial Public Offering Following Investigation', first: 'Smith LLP is acting as counsel to the underwriters.' },
    // No litigation in the title.
    { title: 'Acme Announces Pricing of $50 Million Offering', first: 'Smith LLP is acting as legal counsel to Acme.' },
  ];
  for (const { title, first } of cases) assert.equal(lawFirmNotice({ title, fullText: body(first) }), null, title);
});

test('real labelled samples and fixtures are not caught', () => {
  const titles = [
    'MustGrow Reports Third Quarter and Nine-Month 2026 Financial Results',
    'Coco Pool II Corp. Closes its Initial Public Offering and Lists on The TSX Venture Exchange as a CPC',
    'CSE Bulletin: Consolidation - CMP Mining Inc. (CMP)',
    'Alpine Income Property Trust Declares Dividends for the Fourth Quarter 2026',
    'Infrastructure Dividend Split Corp. Class A Distributions',
    'Flipkart CEO Kalyan Krishnamurthy to step down next week amid IPO uncertainty',
  ];
  for (const title of titles) assert.equal(lawFirmNotice({ title, fullText: body('Counsel LLP said so.') }), null, title);
});

test('no title or no fullText does not throw', () => {
  assert.equal(lawFirmNotice({ title: null, fullText: null }), null);
  assert.equal(lawFirmNotice({ title: 'Class action filed', fullText: null }), null);
});
