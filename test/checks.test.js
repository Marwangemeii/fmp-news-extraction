/**
 * The evidence checks (K1, K2, K11): K1 is word for word, whitespace is the only thing normalized.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evidenceInText, evidenceInOpening, rawInEvidence, inArticleOrder, normalizeWs } from '../src/lib/checks.js';
import { prefilter } from '../src/lib/prefilter.js';
import { topOfBody } from '../src/llm/prompts.js';

const FULL = 'Acme Corp. reported revenue of $412.5 million.\n\nDiluted EPS was $0.42, compared with $0.30.\n\nThe board declared a dividend of $0.10 per share.';

test('K1: a sentence copied exactly is found; whitespace differences are fine', () => {
  assert.equal(evidenceInText('Diluted EPS was $0.42, compared with $0.30.', FULL).ok, true);
  assert.equal(evidenceInText('Diluted  EPS   was $0.42,\tcompared with $0.30.', FULL).ok, true);
  // "\n" joins several sentences (D10): each one is checked on its own.
  assert.equal(evidenceInText('Acme Corp. reported revenue of $412.5 million.\nThe board declared a dividend of $0.10 per share.', FULL).ok, true);
});

test('K1: a paraphrase, a fixed typo or different quotes fail, with a reason', () => {
  const r = evidenceInText('Diluted earnings per share were $0.42.', FULL);
  assert.equal(r.ok, false);
  assert.match(r.reason, /not found/);
  assert.match(r.reason, /first 1 of 6 words match/);
  assert.equal(evidenceInText('Acme Corp. reported revenue of $412.5 million!', FULL).ok, false);
  assert.equal(evidenceInText('', FULL).ok, false);
  assert.equal(evidenceInText(null, FULL).ok, false);
  assert.equal(evidenceInText('anything', null).ok, false);
});

test('K2: the raw value must be inside its evidence', () => {
  assert.equal(rawInEvidence('$0.42', 'Diluted EPS was $0.42, compared with $0.30.').ok, true);
  assert.equal(rawInEvidence('$0.43', 'Diluted EPS was $0.42, compared with $0.30.').ok, false);
  // D45: K2 ignores case (K1 does not).
  assert.equal(rawInEvidence('fourth quarter', 'Fourth quarter revenue rose.').ok, true);
  assert.equal(evidenceInText('acme corp. reported revenue of $412.5 million.', FULL).ok, false);
});

test('K11: a sentence is in the opening only if it is in the first 3 paragraphs', () => {
  const text = ['P1.', 'P2.', 'P3.', 'P4 deep mention.'].join('\n\n');
  assert.equal(evidenceInOpening('P3.', text).ok, true);
  assert.deepEqual(evidenceInOpening('P4 deep mention.', text), { ok: false, reason: 'not in opening (first 3 paragraphs)' });
});

test('inArticleOrder: unique lines, sorted by where they appear', () => {
  const lines = ['The board declared a dividend of $0.10 per share.', 'Acme Corp. reported revenue of $412.5 million.', 'Acme Corp. reported revenue of $412.5 million.'];
  assert.deepEqual(inArticleOrder(lines, FULL), [lines[1], lines[0]]);
  assert.equal(normalizeWs(' a   b\n'), 'a b');
});

test('pre-filter: vocabulary per label, whole words, case-insensitive', () => {
  const r = prefilter({ title: 'Acme files S-1 for IPO', text: '', fullText: 'Acme announced its debut.' });
  assert.equal(r.pass, true);
  assert.deepEqual(r.matched.ipos, ['IPO', 'S-1', 'debut']);
  assert.deepEqual(r.matched.earnings, []);
  const none = prefilter({ title: 'A new phone launches', text: 'It is blue.', fullText: 'The phone is blue and splitting hairs is fun.' });
  assert.equal(none.pass, false); // "splitting" is not the word "split"
  assert.equal(prefilter({ title: 'Board declares quarterly dividend', fullText: null }).matched.dividends[0], 'dividends?');
});

test('classify input: the top of the body, cut at a paragraph break', () => {
  const body = ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)].join('\n\n');
  assert.deepEqual(topOfBody(body, 1000), { text: body, bodyChars: body.length, sentChars: body.length, truncated: false });
  const cut = topOfBody(body, 90);
  assert.equal(cut.text, `${'a'.repeat(40)}\n\n${'b'.repeat(40)}`);
  assert.equal(cut.truncated, true);
});

test('schemas stay within the API limit of 16 union-typed fields', async () => {
  const { CLASSIFY_SCHEMA, EXTRACT_SCHEMA, countUnions } = await import('../src/llm/schemas.js');
  assert.ok(countUnions(CLASSIFY_SCHEMA) <= 16, `classify: ${countUnions(CLASSIFY_SCHEMA)}`);
  assert.ok(countUnions(EXTRACT_SCHEMA) <= 16, `extract: ${countUnions(EXTRACT_SCHEMA)}`);
  assert.equal(countUnions({ anyOf: [{ type: ['string', 'null'] }, { type: 'null' }] }), 2);
});
