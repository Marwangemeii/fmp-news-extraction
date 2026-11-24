/**
 * The one controller (R-C3, D4). Runs every schema entry the same way:
 * discover (every source, paging back) → fetch → extract → label → collect.
 *
 * It knows nothing about any specific publisher (R-C4): every difference comes
 * from the entry's fields, and every behaviour from a registry function chosen by name.
 */
import { canonicalizeUrl } from './lib/url.js';
import { isInWindow } from './lib/window.js';
import { toSources, discoverPages } from './lib/paging.js';
import { cached } from './lib/cache.js';

/** HTTP statuses that mean the site refused us, as opposed to a broken page or network (D31). */
const BLOCKED_STATUSES = [401, 403, 429, 451];

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
 * @param {{ registry: object, window: { start: Date, end: Date }, limit?: number, cache?: boolean }} opts
 * @returns {Promise<{ records: object[], stats: Record<string, object> }>} output records + per-publisher stats
 */
export async function runAll(publishers, { registry, window, limit, cache = false }) {
  const records = [];
  const stats = {};
  const seen = new Set(); // canonical URLs already written, across all publishers (R-D5)

  for (const entry of publishers) {
    if (!entry.enabled) {
      console.log(`[skip] ${entry.name}: enabled: false (not configured yet)`);
      stats[entry.name] = { enabled: false };
      continue;
    }
    // Filled in as the run goes, so a publisher that fails midway still reports what it reached.
    const s = newStats();
    stats[entry.name] = s;
    const started = Date.now();
    try {
      records.push(...(await runPublisher(entry, { registry, window, limit, cache, seen, s })));
    } catch (err) {
      s.failed = err.message;
      console.error(`[${entry.name}] FAILED: ${err.message}`);
    }
    s.durationMs = Date.now() - started;
  }
  return { records, stats };
}

function newStats() {
  return {
    enabled: true,
    sources: [],
    pagesFetched: 0,
    discovered: 0,
    inWindow: 0,
    written: 0,
    errors: 0,
    fromCache: 0,
    // Every written article with fullText null, by reason (D31). The validator shows the reason per URL.
    fullTextNull: { noBody: 0, blocked: 0, error: 0 },
    fullTextNullUrls: [],
    oldestDate: null,
    windowStartReached: false,
    durationMs: 0,
  };
}

/**
 * @param {object} entry one schema entry
 * @param {{ registry: object, window: { start: Date, end: Date }, limit?: number, cache: boolean,
 *           seen: Set<string>, s: object }} ctx  `s` is this publisher's stats object, updated in place
 */
async function runPublisher(entry, { registry, window, limit, cache, seen, s }) {
  const fetchList = pick(registry, 'fetchers', entry.fetcher.list);
  const extract = pick(registry, 'extractors', entry.extract);
  const label = pick(registry, 'labellers', entry.label);
  // D15: only article pages are cached; list pages always come fresh.
  const cacheCounter = { hits: 0 };
  let fetchArticle = pick(registry, 'fetchers', entry.fetcher.article);
  if (cache) fetchArticle = cached(fetchArticle, cacheCounter);

  // 1. Discover: every source, paging back to the window start, deduplicated by canonical URL.
  const found = new Map();
  for (const source of toSources(entry)) {
    const discover = pick(registry, 'discoverers', source.discover);
    const result = await discoverPages(source, entry, { fetchList, discover, window });
    s.sources.push({
      url: source.url,
      discover: source.discover,
      pagesFetched: result.pages,
      pagingStop: result.stop,
      discovered: result.items.length,
      oldestDate: result.oldestDate,
      reachedStart: result.reachedStart,
      ...(result.error ? { error: result.error } : {}),
    });
    s.pagesFetched += result.pages;
    if (result.error) {
      s.errors++;
      console.error(`[${entry.name}] paging stopped on an error: ${result.error}`);
    }
    for (const item of result.items) {
      const url = canonicalizeUrl(item.url, source.url);
      if (!found.has(url)) found.set(url, { ...item, url });
    }
  }
  const dates = s.sources.map((x) => x.oldestDate).filter(Boolean).sort();
  s.oldestDate = dates[0] ?? null;
  // One source reaching the window start is enough: together the sources cover it (D30).
  s.windowStartReached = s.sources.some((x) => x.reachedStart);
  s.discovered = found.size;

  // 2. Window + limit. Items without a list date are kept and re-checked after extraction.
  let todo = [...found.values()]
    .filter((item) => !item.publishedDate || isInWindow(item.publishedDate, window))
    .sort((a, b) => (b.publishedDate ?? '').localeCompare(a.publishedDate ?? ''));
  s.inWindow = todo.length;
  if (limit) todo = todo.slice(0, limit);

  // 3. Fetch → extract → label, one article at a time (D6: limited concurrency).
  const records = [];
  for (const item of todo) {
    let article;
    let nullReason = null; // why fullText is null, if it is (D31)
    try {
      const page = await fetchArticle(item.url, entry);
      article = extract(page.body, item, entry, page.url);
      if (article.fullText === null) nullReason = 'noBody'; // the page loaded but has no text body
    } catch (err) {
      // Temporary until Phase 4 (D21): keep the article from list data, with fullText null.
      // Extracting from an empty page makes every field fall back to the list item.
      s.errors++;
      nullReason = BLOCKED_STATUSES.includes(err.status) ? 'blocked' : 'error';
      console.error(`[${entry.name}] article failed (${nullReason}), writing list data only: ${err.message}`);
      article = extract('', item, entry, item.url);
    }

    if (!isInWindow(article.publishedDate, window)) continue;
    if (seen.has(article.url)) continue;
    seen.add(article.url);

    if (nullReason) {
      s.fullTextNull[nullReason]++;
      s.fullTextNullUrls.push({ url: article.url, reason: nullReason });
    }
    records.push(toRecord(entry, article, label(article)));
  }
  s.written = records.length;
  s.fromCache = cacheCounter.hits;

  const paging = s.sources.map((x) => `${x.discover} ${x.pagesFetched}p → ${x.pagingStop}`).join(', ');
  console.log(
    `[${entry.name}] ${paging} · oldest ${s.oldestDate} · discovered ${s.discovered} · in window ${s.inWindow}` +
      ` · processed ${todo.length}${limit ? ' (--limit)' : ''} · written ${s.written} · errors ${s.errors}` +
      `${cache ? ` · from cache ${s.fromCache}` : ''}` +
      `${s.fullTextNullUrls.length ? ` · fullText null ${JSON.stringify(s.fullTextNull)}` : ''}`,
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
