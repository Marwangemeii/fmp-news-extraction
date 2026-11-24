/**
 * R-C4, widened: per-site logic lives only in the schema (src/publishers.js).
 * Every other .js file under src/ (controller, run.js, blocks/, lib/) must contain
 * no publisher names, no domains, and no comparisons on an entry's name or site.
 * Plus schema sanity, so a typo in publishers.js fails here instead of mid-run.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishers } from '../src/publishers.js';
import { registry } from '../src/blocks/index.js';
import { toSources } from '../src/lib/paging.js';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const SCHEMA = 'publishers.js';

/** Every .js file under src/ except the schema, as { path: 'blocks/fetch-http.js', lines: [...] }. */
const files = await Promise.all(
  (await readdir(SRC, { recursive: true }))
    .map((p) => p.split('\\').join('/')) // Windows paths → forward slashes
    .filter((p) => p.endsWith('.js') && p !== SCHEMA)
    .map(async (path) => ({ path, lines: (await readFile(join(SRC, path), 'utf8')).split('\n') })),
);

/**
 * A comparison on an entry's identity: `x.name === …`, `x.site.toLowerCase() !== …`, or reversed
 * (`… === x.name`). Doesn't match `.tagName` or `err.name` used without a comparison.
 */
const IDENTITY_COMPARISON = /\.(name|site)\b[\w.()]*\s*[!=]==?|[!=]==?\s*[\w.()]*\.(name|site)\b/;

/**
 * The one allowed exception: run.js matches `--only` (user input from the CLI) against schema names.
 * Comparing against user input is fine; comparing against a hardcoded name is not.
 */
const isAllowedComparison = (path, line) => path === 'run.js' && line.includes('values.only');

/** The exact names from REQUIREMENTS §1. */
const REQUIRED_NAMES = [
  'TechCrunch', 'GlobeNewswire', 'Fox Business', 'Investing.com', 'Benzinga',
  'CryptoPotato', 'Newsfile', 'Zacks', 'Business Wire', 'Reuters',
];

test('scans the expected files (sanity: controller, run.js, blocks/, lib/; not the schema)', () => {
  const paths = files.map((f) => f.path);
  for (const p of ['controller.js', 'run.js', 'blocks/index.js', 'lib/url.js']) assert.ok(paths.includes(p), `missing ${p}`);
  assert.ok(!paths.includes(SCHEMA));
});

test('no publisher name or domain outside the schema (R-C4)', () => {
  for (const p of publishers) {
    const forbidden = [
      p.name, // "Fox Business"
      p.name.replace(/\s+/g, ''), // "FoxBusiness"
      p.site, // "foxbusiness.com"
      p.site.split('.')[0], // "foxbusiness"
    ].map((s) => s.toLowerCase());
    for (const { path, lines } of files) {
      lines.forEach((line, i) => {
        for (const word of forbidden) {
          assert.ok(!line.toLowerCase().includes(word), `src/${path}:${i + 1} mentions "${word}" (from ${p.name})`);
        }
      });
    }
  }
});

test('no comparison on an entry name or site outside the schema (R-C4)', () => {
  for (const { path, lines } of files) {
    lines.forEach((line, i) => {
      if (IDENTITY_COMPARISON.test(line) && !isAllowedComparison(path, line)) {
        assert.fail(`src/${path}:${i + 1} compares a name/site: ${line.trim()}`);
      }
    });
  }
});

test('schema has exactly the 10 required publishers, unique', () => {
  assert.deepEqual(publishers.map((p) => p.name).sort(), [...REQUIRED_NAMES].sort());
});

test('every entry has a bare site and https start URLs', () => {
  for (const p of publishers) {
    assert.match(p.site, /^[a-z0-9.-]+\.[a-z]+$/, `${p.name}: site "${p.site}"`);
    assert.ok(!p.site.startsWith('www.'), `${p.name}: site must not start with www.`);
    assert.ok(Array.isArray(p.startUrls) && p.startUrls.length > 0, `${p.name}: no startUrls`);
    // A startUrls item is a string or { url, discover, paging } (D30).
    for (const { url } of toSources(p)) assert.match(url, /^https:\/\//, `${p.name}: ${url}`);
    assert.equal(typeof p.enabled, 'boolean', `${p.name}: enabled must be true/false`);
  }
});

test('every enabled entry names building blocks that exist in the registry', () => {
  for (const p of publishers.filter((p) => p.enabled)) {
    const uses = [
      ['fetchers', p.fetcher?.list],
      ['fetchers', p.fetcher?.article],
      ...toSources(p).map((s) => ['discoverers', s.discover]), // each source's discoverer
      ['extractors', p.extract],
      ['labellers', p.label],
    ];
    for (const [kind, name] of uses) {
      assert.equal(typeof registry[kind]?.[name], 'function', `${p.name}: unknown ${kind} "${name}"`);
    }
  }
});
