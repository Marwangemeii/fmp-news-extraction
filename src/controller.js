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
import { mapLimit } from './lib/pool.js';
import { CONCURRENCY } from './llm/config.js';

/** HTTP statuses that mean the site refused us, as opposed to a broken page or network (D31). */
const BLOCKED_STATUSES = [401, 403, 429, 451];
const LABELS = ['earnings', 'dividends', 'splits', 'ipos', 'others'];

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
 * @returns {Promise<{ records: object[], traces: object[], stats: Record<string, object> }>}
 *   output records, one labeller trace per record (D9), per-publisher stats
 */
export async function runAll(publishers, { registry, window, limit, cache = false }) {
  const records = [];
  const traces = [];
  const stats = {};
  const seen = new Set(); // canonical URLs already written, across all publishers (R-D5)
  const spend = { usd: 0 }; // LLM spend of the whole run, shared by every labeller call (budget cap)

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
      const out = await runPublisher(entry, { registry, window, limit, cache, seen, s, spend });
      records.push(...out.records);
      traces.push(...out.traces);
    } catch (err) {
      s.failed = err.message;
      console.error(`[${entry.name}] FAILED: ${err.message}`);
    }
    s.durationMs = Date.now() - started;
  }
  return { records, traces, stats };
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
    labels: Object.fromEntries(LABELS.map((l) => [l, 0])), // articles per label
    llm: newLlmStats(),
    // Articles labelled `others` because an LLM call failed, never silently (D38).
    llmErrorUrls: [],
    durationMs: 0,
  };
}

/** LLM accounting (D34); run.js sums these across publishers. */
export function newLlmStats() {
  return {
    prefilterPassed: 0,
    prefilterSkipped: 0, // no vocabulary, or no fullText: labelled others with no LLM call
    calls: 0, // billed calls this run
    cacheHits: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    byModel: {},
    llmErrors: { error: 0, refusal: 0, truncated: 0, budget: 0 },
    // K4: labels the classifier proposed vs. dropped because their sentence wasn't in the article.
    labelsProposed: 0,
    labelsDropped: 0,
  };
}

/** Adds one article's trace to the LLM stats. */
function countTrace(llm, trace) {
  if (!trace) return;
  if (trace.classify) llm.prefilterPassed++;
  else llm.prefilterSkipped++;
  for (const call of trace.calls ?? []) {
    if (call.fromCache) llm.cacheHits++;
    else llm.calls++;
    llm.inputTokens += call.inputTokens;
    llm.outputTokens += call.outputTokens;
    llm.costUsd += call.costUsd;
    const m = (llm.byModel[call.model] ??= { calls: 0, cacheHits: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 });
    if (call.fromCache) m.cacheHits++;
    else m.calls++;
    m.inputTokens += call.inputTokens;
    m.outputTokens += call.outputTokens;
    m.costUsd += call.costUsd;
  }
  if (trace.llmError) llm.llmErrors[trace.llmError.kind] = (llm.llmErrors[trace.llmError.kind] ?? 0) + 1;
  const checks = trace.classify?.labelChecks ?? [];
  llm.labelsProposed += checks.length;
  llm.labelsDropped += checks.filter((x) => x.evidenceInFullText === false).length;
}

/**
 * @param {object} entry one schema entry
 * @param {{ registry: object, window: { start: Date, end: Date }, limit?: number, cache: boolean,
 *           seen: Set<string>, s: object }} ctx  `s` is this publisher's stats object, updated in place
 */
async function runPublisher(entry, { registry, window, limit, cache, seen, s, spend }) {
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

  // 3. Fetch → extract, one article at a time (D6: polite to the site).
  const articles = [];
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
    articles.push(article);
  }

  // 4. Label: a few LLM calls in flight at once (the API, not the site, is the limit here).
  const ctx = { cache, spend };
  const results = await mapLimit(articles, CONCURRENCY, async (article) => {
    try {
      return await label(article, entry, ctx);
    } catch (err) {
      // A bug in the labeller must not lose the article or stop the publisher: traced like an LLM error.
      const trace = { url: article.url, llmError: { stage: 'labeller', kind: 'error', message: err.message }, calls: [] };
      return { labels: ['others'], events: [], trace };
    }
  });

  const records = [];
  const traces = [];
  articles.forEach((article, i) => {
    const result = results[i];
    const trace = result.trace ?? null;
    records.push(toRecord(entry, article, result));
    if (trace) traces.push(trace);
    for (const l of result.labels) s.labels[l]++;
    countTrace(s.llm, trace);
    if (trace?.llmError) s.llmErrorUrls.push({ url: article.url, ...trace.llmError });
  });
  s.written = records.length;
  s.fromCache = cacheCounter.hits;

  const paging = s.sources.map((x) => `${x.discover} ${x.pagesFetched}p → ${x.pagingStop}`).join(', ');
  console.log(
    `[${entry.name}] ${paging} · oldest ${s.oldestDate} · discovered ${s.discovered} · in window ${s.inWindow}` +
      ` · processed ${todo.length}${limit ? ' (--limit)' : ''} · written ${s.written} · errors ${s.errors}` +
      `${cache ? ` · from cache ${s.fromCache}` : ''}` +
      `${s.fullTextNullUrls.length ? ` · fullText null ${JSON.stringify(s.fullTextNull)}` : ''}`,
  );
  const l = s.llm;
  console.log(
    `[${entry.name}] labels ${JSON.stringify(s.labels)} · pre-filter passed ${l.prefilterPassed}/${articles.length}` +
      ` · LLM calls ${l.calls} (cached ${l.cacheHits}) · ${l.inputTokens} in / ${l.outputTokens} out · $${l.costUsd.toFixed(4)}` +
      ` · labels dropped by evidence check ${l.labelsDropped}/${l.labelsProposed}` +
      `${s.llmErrorUrls.length ? ` · LLM errors ${JSON.stringify(l.llmErrors)}` : ''}`,
  );
  return { records, traces };
}

/** Output record, fields in REQUIREMENTS §3 order (+ relatedSymbols after symbol, R-J5). */
function toRecord(entry, article, { labels, events, symbol = null, relatedSymbols = [], type = entry.defaultType }) {
  return {
    publishedDate: article.publishedDate,
    publisher: entry.name,
    site: entry.site,
    url: article.url,
    title: article.title,
    image: article.image,
    text: article.text,
    fullText: article.fullText,
    symbol,
    relatedSymbols,
    type,
    labels,
    events,
  };
}
