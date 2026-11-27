/**
 * Block/challenge pages are recognized even with status 200/202 (D53), and normal pages are not.
 * The samples are shortened copies of what the probes saw on 2026-11-27.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockReason } from '../src/lib/blocked.js';
import { createLimiter } from '../src/lib/pool.js';

const headers = (h = {}) => new Headers(h);

test('Cloudflare "you have been blocked" (403) and JS challenge (200)', () => {
  const block = '<html><head><title>Attention Required! | Cloudflare</title></head><body>Sorry, you have been blocked</body></html>';
  assert.match(blockReason({ status: 403, headers: headers(), body: block }), /HTTP 403/);
  assert.match(blockReason({ status: 200, headers: headers(), body: block }), /Attention Required/);
  const challenge = '<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>';
  assert.match(blockReason({ status: 200, headers: headers(), body: challenge }), /Just a moment/);
  assert.match(blockReason({ status: 200, headers: headers({ 'cf-mitigated': 'challenge' }), body: '' }), /Cloudflare challenge/);
});

test('AWS WAF challenge: status 202, by header or by its script', () => {
  const page = '<html><head><title></title><script>window.awsWafCookieDomainList = []; window.gokuProps = {}</script>' +
    '<script src="https://x.token.awswaf.com/x/challenge.js"></script></head></html>';
  assert.match(blockReason({ status: 202, headers: headers({ 'x-amzn-waf-action': 'challenge' }), body: page }), /AWS WAF challenge/);
  assert.match(blockReason({ status: 200, headers: headers(), body: page }), /AWS WAF challenge page/);
});

test('Akamai "Access Denied" (403 or 200)', () => {
  const page = '<HTML><HEAD><TITLE>Access Denied</TITLE></HEAD><BODY>You don\'t have permission</BODY></HTML>';
  assert.ok(blockReason({ status: 200, headers: headers(), body: page }));
});

test('normal pages are not blocked, even an article about captchas', () => {
  assert.equal(blockReason({ status: 200, headers: headers(), body: '<html><title>Q3 results</title><p>Revenue up.</p></html>' }), null);
  const big = `<html><title>Why captcha makers are struggling</title>${'<p>text</p>'.repeat(5000)}</html>`;
  assert.equal(blockReason({ status: 200, headers: headers(), body: big }), null);
});

test('createLimiter: never more than max tasks in flight, results in order', async () => {
  const limit = createLimiter(2);
  let running = 0;
  let peak = 0;
  const task = (i) => async () => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 5));
    running--;
    return i;
  };
  const out = await Promise.all(Array.from({ length: 10 }, (_, i) => limit(task(i))));
  assert.deepEqual(out, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(peak, 2);
});

test('createLimiter: a failing task frees its slot', async () => {
  const limit = createLimiter(1);
  await assert.rejects(limit(async () => { throw new Error('boom'); }));
  assert.equal(await limit(async () => 'next'), 'next');
});
