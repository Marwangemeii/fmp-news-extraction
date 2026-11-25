/**
 * `node scripts/make-fixture.js <url> --publisher <name> --out <file> [--body <css>] [--date <css>] [--cached]`
 * Saves one real article as a small JSON fixture for `npm run eval`: the extracted fields
 * (title, text, fullText, publishedDate), never the raw HTML. Uses the project's own fetcher and extractor,
 * so a fixture looks exactly like what the pipeline sees. --cached reads the page from .cache/ (no network).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { fetchHttp } from '../src/blocks/fetch-http.js';
import { extractHtml } from '../src/blocks/extract-html.js';
import { publishers } from '../src/publishers.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    publisher: { type: 'string' },
    out: { type: 'string' },
    body: { type: 'string' }, // overrides the entry's body selector (for publishers not configured yet)
    date: { type: 'string' }, // a meta[...] selector for the publish date, read from its content attribute
    cached: { type: 'boolean' },
  },
});
const url = positionals[0];
const entry = publishers.find((p) => p.name === values.publisher);
if (!url || !entry || !values.out) {
  console.error('Usage: node scripts/make-fixture.js <url> --publisher <name> --out <file> [--body <css>] [--date <css>] [--cached]');
  process.exit(1);
}

const selectors = { ...entry.selectors };
if (values.body) selectors.body = values.body;
if (values.date) selectors.publishedDate = { css: values.date, attr: 'content' };

let page;
if (values.cached) {
  const file = join('.cache', `${createHash('sha1').update(url).digest('hex')}.json`);
  page = JSON.parse(await readFile(file, 'utf8'));
} else {
  page = await fetchHttp(url, entry);
}
const a = extractHtml(page.body, { url, title: null, publishedDate: null, description: null }, { ...entry, selectors }, page.url);
if (!a.fullText) {
  console.error(`No body text found with selector "${selectors.body}"`);
  process.exit(1);
}
const fixture = {
  url: a.url,
  publisher: entry.name,
  title: a.title,
  publishedDate: a.publishedDate,
  text: a.text,
  fullText: a.fullText,
  fetchedAt: new Date().toISOString(),
};
await mkdir(dirname(values.out), { recursive: true });
await writeFile(values.out, JSON.stringify(fixture, null, 2) + '\n', 'utf8');
console.log(`${values.out}: ${a.title} · ${a.publishedDate} · ${a.fullText.length} chars`);
