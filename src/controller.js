/**
 * The one controller (R-C3, D4). Runs every schema entry the same way:
 * discover (every source, paging back) → fetch → extract → label → collect.
 *
 * It knows nothing about any specific publisher (R-C4): every difference comes
 * from the entry's fields, and every behaviour from a registry function chosen by name.
 */
import { canonicalizeUrl } from './lib/url.js';
import { isInWindow } from './lib/window.js';
import { toSources, discoverPages, listDateOf } from './lib/paging.js';
import { cached } from './lib/cache.js';
import { createLimiter } from './lib/pool.js';
import { BLOCKED_STATUSES } from './lib/blocked.js';
import { LLM_CONCURRENCY } from './llm/config.js';
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
 * Runs all entries at the same time (D51). Each site still gets one request at a time with its own
 * delay, so running them side by side is as polite as one after another, and the run takes as long as
 * the slowest site instead of the sum. One failing publisher never stops the others (R-D4).
 * The output keeps the schema order, whatever order the publishers finish in.
 *
 * @param {object[]} publishers schema entries (already filtered by --only in run.js)
 * @param {{ registry: object, window: { start: Date, end: Date }, limit?: number, sample?: number,
 *           cache?: boolean }} opts  limit = the newest n articles; sample = n articles spread over the window
 * @returns {Promise<{ records: object[], traces: object[], stats: Record<string, object> }>}
 *   output records, one labeller trace per record (D9), per-publisher stats
 */
export async function runAll(publishers, { registry, window, limit, sample, cache = false }) {
  const stats = {};
  const seen = new Set(); // canonical URLs already written, across all publishers (R-D5)
  const spend = { usd: 0 }; // LLM spend of the whole run, shared by every labeller call (budget cap)
  const llmLimit = createLimiter(LLM_CONCURRENCY); // shared: at most LLM_CONCURRENCY articles labelled at once, run-wide

  const outs = await Promise.all(
    publishers.map(async (entry) => {
      if (!entry.enabled) {
        console.log(`[skip] ${entry.name}: enabled: false (not configured yet)`);
        stats[entry.name] = { enabled: false };
        return null;
      }
      // Filled in as the run goes, so a publisher that fails midway still reports what it reached.
      const s = newStats();
      stats[entry.name] = s;
      const started = Date.now();
      try {
        return await runPublisher(entry, { registry, window, limit, sample, cache, seen, s, spend, llmLimit });
      } catch (err) {
        s.failed = err.message;
        console.error(`[${entry.name}] FAILED: ${err.message}`);
        return null;
      } finally {
        s.durationMs = Date.now() - started;
      }
    }),
  );

  // Stats in schema order too (above, they were added in finishing order).
  const ordered = Object.fromEntries(publishers.map((p) => [p.name, stats[p.name]]));
  const done = outs.filter(Boolean);
  return { records: done.flatMap((o) => o.records), traces: done.flatMap((o) => o.traces), stats: ordered };
}

/**
 * Dev option `--sample n`: n items spread evenly over a newest-first list, so a sample covers the
 * newest AND the oldest days of the window (`--limit` takes only the newest).
 * @template T
 * @param {T[]} items
 * @param {number} n
 * @returns {T[]}
 */
export function spreadSample(items, n) {
  if (n >= items.length) return items;
  if (n === 1) return [items[0]];
  const step = (items.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => items[Math.round(i * step)]);
}

function newStats() {
  return {
    enabled: true,
    sources: [],
    pagesFetched: 0,
    discovered: 0,
    inWindow: 0,
    processed: 0, // article pages fetched: inWindow, or fewer with --limit / --sample
    written: 0,
    errors: 0,
    fromCache: 0,
    // Every written article with fullText null, by reason (D31). The validator shows the reason per URL.
    fullTextNull: { noBody: 0, blocked: 0, error: 0 },
    fullTextNullUrls: [],
    // Fetched, but not written: the page's date is outside the window, or no publish date at all (D58).
    droppedOutsideWindow: 0,
    droppedNoDate: 0,
    droppedNoDateUrls: [],
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
    // K11: labels on news articles dropped because their sentence wasn't in the opening paragraphs (D44).
    labelsNotInOpening: 0,
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
  llm.labelsNotInOpening += checks.filter((x) => x.inOpening === false).length;
}

/**
 * @param {object} entry one schema entry
 * @param {{ registry: object, window: { start: Date, end: Date }, limit?: number, sample?: number, cache: boolean,
 *           seen: Set<string>, s: object, spend: { usd: number }, llmLimit: Function }} ctx
 *   `s` is this publisher's stats object, updated in place; `llmLimit` is the run-wide LLM limiter
 */
async function runPublisher(entry, { registry, window, limit, sample, cache, seen, s, spend, llmLimit }) {
  const extract = pick(registry, 'extractors', entry.extract);
  const label = pick(registry, 'labellers', entry.label);
  // D15: only article pages are cached; list pages always come fresh.
  const cacheCounter = { hits: 0 };
  let fetchArticle = pick(registry, 'fetchers', entry.fetcher.article);
  if (cache) fetchArticle = cached(fetchArticle, cacheCounter);

  // 1. Discover: every source, paging back to the window start, deduplicated by canonical URL.
  const found = new Map();
  for (const source of toSources(entry, window)) {
    const discover = pick(registry, 'discoverers', source.discover);
    const fetchList = pick(registry, 'fetchers', source.fetcher); // a source may use its own fetcher (D55)
    let result;
    try {
      result = await discoverPages(source, entry, { fetchList, discover, window });
    } catch (err) {
      // Page 1 of this source failed (e.g. blocked): the publisher's other sources still run.
      result = { items: [], pages: 0, oldestDate: null, reachedStart: false, stop: 'page 1 failed', error: err.message };
    }
    s.sources.push({
      url: source.url,
      discover: source.discover,
      pagesFetched: result.pages,
      pagingStop: result.stop,
      discovered: result.items.length,
      oldestDate: result.oldestDate,
      reachedStart: result.reachedStart,
      // A date slice (D60) is complete only if paging ran out of results ("empty page"). Any other stop
      // (max pages, the site's result cap → "no new items", an error) leaves a hole in its days.
      ...(source.slice ? { slice: source.slice, sliceComplete: result.stop === 'empty page' } : {}),
      ...(result.error ? { error: result.error } : {}),
    });
    s.pagesFetched += result.pages;
    if (result.error) {
      s.errors++;
      console.error(`[${entry.name}] source ${source.url} stopped on an error: ${result.error}`);
    }
    for (const item of result.items) {
      const url = canonicalizeUrl(item.url, source.url);
      if (!found.has(url)) found.set(url, { ...item, url });
    }
  }
  const dates = s.sources.map((x) => x.oldestDate).filter(Boolean).sort();
  s.oldestDate = dates[0] ?? null;
  // One source reaching the window start is enough: together the sources cover it (D30).
  // Date slices (D60) cover the window only if every slice is complete; one incomplete slice = a hole.
  const slices = s.sources.filter((x) => x.slice);
  const incomplete = slices.filter((x) => !x.sliceComplete);
  s.windowStartReached = incomplete.length === 0 && (s.sources.some((x) => x.reachedStart) || slices.length > 0);
  for (const x of incomplete) console.error(`[${entry.name}] date slice ${x.slice.from}..${x.slice.to} incomplete (${x.pagingStop}): a hole in the window`);
  s.discovered = found.size;

  // 2. Window + limit. The list date may be a sitemap lastmod (D58), so the article page's own date
  // decides after extraction. Items without any list date are kept and checked then too.
  let todo = [...found.values()]
    .filter((item) => !listDateOf(item) || isInWindow(listDateOf(item), window))
    .sort((a, b) => (listDateOf(b) ?? '').localeCompare(listDateOf(a) ?? ''));
  s.inWindow = todo.length;
  if (sample) todo = spreadSample(todo, sample);
  else if (limit) todo = todo.slice(0, limit);
  s.processed = todo.length;

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
      // err.blocked: a block or challenge page, even one served with status 200 (D53).
      nullReason = err.blocked || BLOCKED_STATUSES.includes(err.status) ? 'blocked' : 'error';
      console.error(`[${entry.name}] article failed (${nullReason}), writing list data only: ${err.message}`);
      article = extract('', item, entry, item.url);
    }

    if (!article.publishedDate) {
      // Neither the page nor the list gives a publish date (e.g. a blocked page listed only with a
      // lastmod). Never written with a guessed date, but counted and listed (D58).
      s.droppedNoDate++;
      s.droppedNoDateUrls.push({ url: article.url, reason: nullReason ?? 'no publish date on the page' });
      continue;
    }
    if (!isInWindow(article.publishedDate, window)) {
      s.droppedOutsideWindow++; // the list date said maybe; the page's own date says no
      continue;
    }
    if (seen.has(article.url)) continue;
    seen.add(article.url);

    if (nullReason) {
      s.fullTextNull[nullReason]++;
      s.fullTextNullUrls.push({ url: article.url, reason: nullReason });
    }
    articles.push(article);
  }

  // 4. Label through the run-wide limiter: parallel publishers share LLM_CONCURRENCY slots (D51).
  const ctx = { cache, spend };
  const results = await Promise.all(
    articles.map((article) =>
      llmLimit(async () => {
        try {
          return await label(article, entry, ctx);
        } catch (err) {
          // A bug in the labeller must not lose the article or stop the publisher: traced like an LLM error.
          const trace = { url: article.url, llmError: { stage: 'labeller', kind: 'error', message: err.message }, calls: [] };
          return { labels: ['others'], events: [], trace };
        }
      }),
    ),
  );

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
      ` · processed ${todo.length}${sample ? ' (--sample)' : limit ? ' (--limit)' : ''} · written ${s.written} · errors ${s.errors}` +
      `${cache ? ` · from cache ${s.fromCache}` : ''}` +
      `${s.fullTextNullUrls.length ? ` · fullText null ${JSON.stringify(s.fullTextNull)}` : ''}` +
      `${s.droppedOutsideWindow ? ` · page date outside window ${s.droppedOutsideWindow}` : ''}` +
      `${s.droppedNoDate ? ` · no publish date ${s.droppedNoDate}` : ''}`,
  );
  const l = s.llm;
  console.log(
    `[${entry.name}] labels ${JSON.stringify(s.labels)} · pre-filter passed ${l.prefilterPassed}/${articles.length}` +
      ` · LLM calls ${l.calls} (cached ${l.cacheHits}) · ${l.inputTokens} in / ${l.outputTokens} out · $${l.costUsd.toFixed(4)}` +
      ` · labels dropped: evidence (K4) ${l.labelsDropped}, not in opening (K11) ${l.labelsNotInOpening}, of ${l.labelsProposed}` +
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
