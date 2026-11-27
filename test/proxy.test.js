import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserProxy, applyHttpProxy } from '../src/lib/proxy.js';

test('no PROXY_URL: no proxy for either fetcher', () => {
  delete process.env.PROXY_URL;
  assert.equal(browserProxy(), undefined);
  assert.equal(applyHttpProxy(), 'off');
});

test('PROXY_URL with credentials: Playwright gets server + username/password separately', () => {
  process.env.PROXY_URL = 'http://us%40er:p%3Ass@proxy.example:8080';
  try {
    assert.deepEqual(browserProxy(), { server: 'http://proxy.example:8080', username: 'us@er', password: 'p:ss' });
  } finally {
    delete process.env.PROXY_URL;
  }
});
