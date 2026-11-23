/**
 * The one controller (R-C3, D4). Runs every schema entry the same way:
 * discover → fetch → extract → label → collect.
 *
 * It knows nothing about any specific publisher (R-C4): every difference comes
 * from the entry's fields, and every behaviour from a registry function chosen by name.
 */
import { canonicalizeUrl } from './lib/url.js';
import { isInWindow } from './lib/window.js';

/**
 * Looks up a building block by name, failing loudly on a typo in the schema.
 * @param {object} registry
 * @param {string} kind e.g. 'fetchers'
 * @param {string} name e.g. 'http'
 */
function pick(registry, kind, name) {
  const fn = registry[kind]?.[name];
  if (!fn) {
    throw new Error(`Unknown ${kind} "${name}". Known: ${Object.keys(registry[kind] ?? {}).join(', ')}`);
  }
  return fn;
}

/**
 * Runs all entries in order; one failing publisher never stops the others (R-D4).
 *
 * @param {object[]} publishers schema entries (already filtered by --only in run.js)
 * @param {{ registry: object, window: { start: Date, end: Date }, limit?: number }} opts
 * @returns {Promise<object[]>} output records
 */
export async function runAll(publishers, { registry, window, limit }) {
  const records = [];
  const seen = new Set(); // canonical URLs already written, across all publishers (R-D5)

  for (const entry of publishers) {
    if (!entry.enabled) {
      console.log(`[skip] ${entry.name}: enabled: false (not configured yet)`);
      continue;
    }
    try {
      records.push(...(await runPublisher(entry, { registry, window, limit, seen })));
    } catch (err) {
      console.error(`[${entry.name}] FAILED: ${err.message}`);
    }
  }
  return records;
}

/**
 * @param {object} entry one schema entry
 * @param {{ registry: object, window: { start: Date, end: Date }, limit?: number, seen: Set<string> }} ctx
 */
async function runPublisher(entry, { registry, window, limit, seen }) {
  const fetchList = pick(registry, 'fetchers', entry.fetcher.list);
  const fetchArticle = pick(registry, 'fetchers', entry.fetcher.article);
  const discover = pick(registry, 'discoverers', entry.discover);
  const extract = pick(registry, 'extractors', entry.extract);
  const label = pick(registry, 'labellers', entry.label);

  // 1. Discover: every start URL, deduplicated by canonical URL.
  const found = new Map();
  for (const startUrl of entry.startUrls) {
    const { body } = await fetchList(startUrl, entry);
    for (const item of discover(body, startUrl)) {
      const url = canonicalizeUrl(item.url, startUrl);
      if (!found.has(url)) found.set(url, { ...item, url });
    }
  }

  // 2. Window + limit. Items without a list date are kept and re-checked after extraction.
  let todo = [...found.values()]
    .filter((item) => !item.publishedDate || isInWindow(item.publishedDate, window))
    .sort((a, b) => (b.publishedDate ?? '').localeCompare(a.publishedDate ?? ''));
  const inWindow = todo.length;
  if (limit) todo = todo.slice(0, limit);

  // 3. Fetch → extract → label, one article at a time (D6: limited concurrency).
  const records = [];
  let errors = 0;
  for (const item of todo) {
    let article;
    try {
      const page = await fetchArticle(item.url, entry);
      article = extract(page.body, item, entry, page.url);
    } catch (err) {
      // Temporary until Phase 4 (D21): keep the article from list data, with fullText null.
      // Extracting from an empty page makes every field fall back to the list item.
      errors++;
      console.error(`[${entry.name}] article failed, writing list data only: ${err.message}`);
      article = extract('', item, entry, item.url);
    }

    if (!isInWindow(article.publishedDate, window)) continue;
    if (seen.has(article.url)) continue;
    seen.add(article.url);

    records.push(toRecord(entry, article, label(article)));
  }

  console.log(
    `[${entry.name}] discovered ${found.size} · in window ${inWindow} · processed ${todo.length}` +
      `${limit ? ' (--limit)' : ''} · written ${records.length} · errors ${errors}`,
  );
  return records;
}

/** Output record, fields in REQUIREMENTS §3 order. */
function toRecord(entry, article, { labels, events }) {
  return {
    publishedDate: article.publishedDate,
    publisher: entry.name,
    site: entry.site,
    url: article.url,
    title: article.title,
    image: article.image,
    text: article.text,
    fullText: article.fullText,
    symbol: null, // Phase 3
    type: entry.defaultType,
    labels,
    events,
  };
}
