/**
 * `npm run validate [-- --run-at <iso>]`
 * Checks output/articles.jsonl against the field-level rules in REQUIREMENTS §3 and §5 (+ R-D1, R-D3, R-D5, R-L6, R-J5),
 * using output/stats.json from the same run for the run time and the per-publisher counts.
 * Exits with code 1 if any rule fails. Warnings are reported but don't fail.
 */
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { readJsonl } from '../src/lib/jsonl.js';
import { isTrackingParam } from '../src/lib/url.js';
import { getWindow, isInWindow } from '../src/lib/window.js';
import { publishers } from '../src/publishers.js';

const FILE = 'output/articles.jsonl';
const STATS = 'output/stats.json';
const KEYS = ['publishedDate', 'publisher', 'site', 'url', 'title', 'image', 'text', 'fullText', 'symbol', 'type', 'labels', 'events'];
const TYPES = ['stock', 'pressReleases', 'crypto', 'forex', 'general'];
const LABELS = ['earnings', 'dividends', 'splits', 'ipos', 'others'];
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const ENTITY = /&(amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-f]+|[a-z]+);/i;
const siteByName = new Map(publishers.map((p) => [p.name, p.site]));

/** Required event fields per category (REQUIREMENTS §5), split by kind for the R-E8/R-E9 checks. */
const EVENT_FIELDS = {
  earnings: {
    dates: ['fiscalDateEnding', 'date'],
    numbers: ['calendarYear', 'epsActual', 'epsEstimated', 'revenueActual', 'revenueEstimated'],
    enums: { period: ['Q1', 'Q2', 'Q3', 'Q4', 'FY'], time: ['bmo', 'amc'] },
  },
  dividends: { dates: ['declarationDate', 'date', 'recordDate', 'paymentDate'], numbers: ['dividend'], enums: {} },
  splits: { dates: ['date'], numbers: ['numerator', 'denominator'], enums: { splitType: ['forward', 'reverse'] } },
  ipos: {
    dates: ['date'],
    numbers: ['shares', 'pricePerShare', 'marketCap'],
    enums: { actions: ['filed', 'expected', 'priced', 'postponed', 'withdrawn'] },
    text: ['company', 'exchange', 'priceRange'],
  },
};
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const isRealYmd = (s) => YMD.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const normalizeWs = (s) => s.replace(/\s+/g, ' ').trim();

const { values } = parseArgs({ options: { 'run-at': { type: 'string' } } });

// The run time comes from stats.json, written by the same run (D26), so validating later doesn't shift the window.
let stats;
try {
  stats = JSON.parse(await readFile(STATS, 'utf8'));
} catch (err) {
  console.error(`Can't read ${STATS} (${err.code ?? err.message}). Run \`npm start\` first.`);
  process.exit(1);
}
const runAt = new Date(values['run-at'] ?? stats.runAt);
const window = getWindow(runAt);

// url → why its fullText is null, recorded by the controller (D31).
const NULL_REASONS = {
  noBody: 'the page loaded but has no text body',
  blocked: 'the site refused the request',
  error: 'the fetch failed',
};
const nullReasonByUrl = new Map(
  Object.values(stats.publishers ?? {}).flatMap((s) => (s.fullTextNullUrls ?? []).map((x) => [x.url, x.reason])),
);
// url → the LLM failure that made it `others` (D38): reported as a warning, never silent.
const llmErrorByUrl = new Map(
  Object.values(stats.publishers ?? {}).flatMap((s) => (s.llmErrorUrls ?? []).map((x) => [x.url, x])),
);

/** rule ID → list of { line, url, msg } */
const failures = new Map();
const warnings = new Map();
const add = (map, rule, line, url, msg) => {
  if (!map.has(rule)) map.set(rule, []);
  map.get(rule).push({ line, url, msg });
};

const rows = await readJsonl(FILE);
const seenUrls = new Set();
const perPublisher = new Map();

if (rows.length === 0) add(failures, 'R-S1', 0, '', 'file is empty');

for (const { line, record: r, error } of rows) {
  const fail = (rule, msg) => add(failures, rule, line, r?.url ?? '', msg);

  if (error || typeof r !== 'object' || r === null || Array.isArray(r)) {
    fail('R-S1', `not a JSON object${error ? `: ${error}` : ''}`);
    continue;
  }
  for (const k of KEYS) if (!(k in r)) fail('R-S1', `missing key "${k}"`);
  perPublisher.set(r.publisher, (perPublisher.get(r.publisher) ?? 0) + 1);

  // R-A1 / R-D1: date format and window
  if (typeof r.publishedDate !== 'string' || !ISO_UTC.test(r.publishedDate) || Number.isNaN(Date.parse(r.publishedDate))) {
    fail('R-A1', `publishedDate not ISO 8601 UTC: ${JSON.stringify(r.publishedDate)}`);
  } else if (!isInWindow(r.publishedDate, window)) {
    fail('R-D1', `publishedDate ${r.publishedDate} outside window`);
  }

  // R-A2 / R-A3: publisher and site
  if (!siteByName.has(r.publisher)) fail('R-A2', `unknown publisher ${JSON.stringify(r.publisher)}`);
  if (typeof r.site !== 'string' || /^https?:|^www\./.test(r.site)) fail('R-A3', `bad site ${JSON.stringify(r.site)}`);
  else if (siteByName.has(r.publisher) && r.site !== siteByName.get(r.publisher)) {
    fail('R-A3', `site "${r.site}" ≠ schema site "${siteByName.get(r.publisher)}"`);
  }

  // R-A4 / R-D5: canonical, unique url
  let u;
  try {
    u = new URL(r.url);
  } catch {
    fail('R-A4', `url not absolute: ${JSON.stringify(r.url)}`);
  }
  if (u) {
    const host = u.hostname.replace(/^www\./, '');
    if (typeof r.site === 'string' && host !== r.site && !host.endsWith(`.${r.site}`)) {
      fail('R-A3', `url host "${host}" doesn't match site "${r.site}"`);
    }
    if (u.hash) fail('R-A4', 'url has a #fragment');
    const tracking = [...u.searchParams.keys()].filter(isTrackingParam);
    if (tracking.length) fail('R-A4', `tracking params: ${tracking.join(', ')}`);
    if (seenUrls.has(r.url)) fail('R-D5', 'duplicate url');
    seenUrls.add(r.url);
  }

  // R-A5: title
  if (typeof r.title !== 'string' || !r.title.trim()) fail('R-A5', 'title missing');
  else if (ENTITY.test(r.title)) fail('R-A5', `undecoded entity in title: ${r.title}`);

  // R-A6: image
  if (r.image !== null && !(typeof r.image === 'string' && /^https?:\/\//.test(r.image))) {
    fail('R-A6', `image not null or an absolute URL: ${JSON.stringify(r.image)}`);
  }

  // R-A7: text
  if (typeof r.text !== 'string') fail('R-A7', 'text is not a string');
  else if (r.text.length > 500) fail('R-A7', `text is ${r.text.length} chars (max 500)`);
  else if (!r.text.trim()) add(warnings, 'R-A7', line, r.url, 'text is empty');

  // R-A8 / R-A9: fullText
  if (r.fullText === null) {
    const reason = nullReasonByUrl.get(r.url);
    if (!reason) fail('R-A9', 'fullText is null with no recorded reason in stats.json');
    else add(warnings, 'R-A9', line, r.url, `fullText is null: ${reason} (${NULL_REASONS[reason] ?? 'unknown reason'})`);
  } else if (typeof r.fullText !== 'string' || !r.fullText.trim()) fail('R-A8', 'fullText is not a non-empty string or null');

  // R-A10 / R-A11
  if (r.symbol !== null && typeof r.symbol !== 'string') fail('R-A10', `symbol not null or string: ${JSON.stringify(r.symbol)}`);
  if ('relatedSymbols' in r && !(Array.isArray(r.relatedSymbols) && r.relatedSymbols.every((x) => typeof x === 'string'))) {
    fail('R-J5', `relatedSymbols must be an array of strings: ${JSON.stringify(r.relatedSymbols)}`);
  }
  if (!TYPES.includes(r.type)) fail('R-A11', `type ${JSON.stringify(r.type)} not in ${TYPES.join('/')}`);

  // R-A12 / R-L6: labels
  const labels = Array.isArray(r.labels) ? r.labels : null;
  if (!labels || labels.length === 0) fail('R-A12', 'labels must be a non-empty array');
  else {
    for (const l of labels) if (!LABELS.includes(l)) fail('R-A12', `unknown label ${JSON.stringify(l)}`);
    if (new Set(labels).size !== labels.length) fail('R-A12', 'duplicate labels');
    if (labels.includes('others') && labels.length > 1) fail('R-L6', '"others" combined with another label');
  }

  // R-A13: events
  if (!Array.isArray(r.events)) fail('R-A13', 'events is not an array');
  else if (labels) {
    const real = labels.filter((l) => l !== 'others');
    const categories = r.events.map((e) => e?.category);
    if (labels.includes('others') && r.events.length) fail('R-A13', 'events must be [] for "others"');
    else if ([...categories].sort().join() !== [...real].sort().join()) {
      fail('R-A13', `event categories [${categories}] don't match labels [${real}]`);
    }
  }

  // R-E1 / R-E2..E7 / R-E8 / R-E9: event fields
  for (const e of Array.isArray(r.events) ? r.events : []) {
    const spec = EVENT_FIELDS[e?.category];
    if (!spec) continue; // unknown category is already an R-A13 failure
    const where = `${e.category}`;
    if (!('symbol' in e)) fail('R-E2', `${where}: missing "symbol"`);
    // R-E1: every evidence line is in fullText, word for word (whitespace normalized).
    if (typeof e.evidence !== 'string' || !e.evidence.trim()) fail('R-E1', `${where}: evidence is empty`);
    else if (typeof r.fullText !== 'string') fail('R-E1', `${where}: evidence but no fullText to find it in`);
    else {
      const hay = normalizeWs(r.fullText);
      for (const line of e.evidence.split('\n')) {
        if (!hay.includes(normalizeWs(line))) fail('R-E1', `${where}: evidence not in fullText: "${line.slice(0, 80)}…"`);
      }
    }
    for (const k of spec.dates) {
      if (!(k in e)) fail('R-E2', `${where}: missing "${k}"`);
      else if (e[k] !== null && !(typeof e[k] === 'string' && isRealYmd(e[k]))) fail('R-E8', `${where}.${k} not YYYY-MM-DD: ${JSON.stringify(e[k])}`);
    }
    for (const k of spec.numbers) {
      if (!(k in e)) fail('R-E2', `${where}: missing "${k}"`);
      else if (e[k] !== null && !(typeof e[k] === 'number' && Number.isFinite(e[k]))) fail('R-E9', `${where}.${k} not a plain number: ${JSON.stringify(e[k])}`);
    }
    for (const [k, allowed] of Object.entries(spec.enums)) {
      if (!(k in e)) fail('R-E2', `${where}: missing "${k}"`);
      else if (e[k] !== null && !allowed.includes(e[k])) fail('R-E2', `${where}.${k} ${JSON.stringify(e[k])} not in ${allowed.join('/')}`);
    }
    for (const k of spec.text ?? []) {
      if (!(k in e)) fail('R-E7', `${where}: missing "${k}"`);
      else if (e[k] !== null && typeof e[k] !== 'string') fail('R-E7', `${where}.${k} not text: ${JSON.stringify(e[k])}`);
    }
  }

  // D38: an article labelled `others` because the LLM failed is reported, never silent.
  const llmError = llmErrorByUrl.get(r.url);
  if (llmError) add(warnings, 'LLM', line, r.url, `labelled others because the LLM failed (${llmError.kind} in ${llmError.stage}): ${llmError.message}`);
}

// --- Cross-checks against stats.json ---
for (const [name, s] of Object.entries(stats.publishers ?? {})) {
  if (!s.enabled) continue;
  const n = perPublisher.get(name) ?? 0;
  // Catches a stats.json left over from a different run than articles.jsonl.
  if (s.written !== n) add(failures, 'stats', 0, '', `${name}: stats say written ${s.written}, articles.jsonl has ${n}`);
  if (!s.windowStartReached) add(warnings, 'R-D3', 0, '', `${name}: window start not reached (oldest ${s.oldestDate})`);
  if (s.failed) add(warnings, 'R-D4', 0, '', `${name} failed: ${s.failed}`);
}
if (stats.limit) add(warnings, 'R-D3', 0, '', `dev run with --limit ${stats.limit}: not a full collection`);

// --- Report ---
console.log(`Validating ${FILE}: ${rows.length} articles`);
console.log(`Window: ${window.start.toISOString()} → ${window.end.toISOString()} (run at ${runAt.toISOString()}, from ${values['run-at'] ? '--run-at' : STATS})`);
for (const [name, n] of perPublisher) console.log(`  ${name}: ${n}`);

const report = (title, map) => {
  for (const [rule, list] of map) {
    console.log(`${title} ${rule}: ${list.length}`);
    // line 0 = a run-level message (from stats.json), not tied to one article
    for (const { line, url, msg } of list.slice(0, 5)) console.log(line ? `    line ${line} ${url}\n      ${msg}` : `    ${msg}`);
    if (list.length > 5) console.log(`    … and ${list.length - 5} more`);
  }
};
report('✖', failures);
report('⚠', warnings);

const nFail = [...failures.values()].reduce((a, l) => a + l.length, 0);
const nWarn = [...warnings.values()].reduce((a, l) => a + l.length, 0);
console.log(nFail ? `FAIL: ${nFail} failures, ${nWarn} warnings` : `PASS: 0 failures, ${nWarn} warnings`);
process.exit(nFail ? 1 : 0);
