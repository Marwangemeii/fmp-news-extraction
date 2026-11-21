# Decisions

Each entry: the decision, why, and what else was considered. Add new entries at the end; never delete one. If a decision changes, add a new entry that replaces it.

---

### D1. Plain JavaScript (ESM) on Node 22+
**Why:** Jack asked for JavaScript over TypeScript. Node is Marwan's daily stack, so the code is easy to defend and change live.
**Considered:** TypeScript (rejected per Jack), Python (stronger anti-bot tooling, but weaker fluency for live changes).

### D2. No Docker, plain scripts
**Why:** Jack: "simply having the scripting is fine. No need to overengineer it." Setup is `npm install` + `npx playwright install chromium` + `npm start`.

### D3. Minimal dependencies
**Planned:** `cheerio` (HTML parsing), `fast-xml-parser` (one parser for both RSS and sitemaps), `playwright` (browser fetcher), `@anthropic-ai/sdk` (LLM, Phase 3). Node built-ins for everything else: `fetch`, `node:test`, `fs`.
**Rule:** any other dependency needs a one-line reason and approval.

### D4. One schema, one controller, a registry of building blocks
- `src/publishers.js`: an array of plain objects, one per publisher, holding only what differs.
- `src/blocks/`: plain functions (fetchers, discoverers, clean-ups, labeller) exported in a registry object.
- `src/controller.js`: loops over the schema, looks up each entry's building blocks by name, runs discover → fetch → extract → label → write.

**Why:** the hard requirement. It's the Strategy pattern with plain objects, no classes.
**Enforced by:** a structure test (R-C4).

### D5. Fetching: HTTP by default, Playwright when needed
Each entry picks `fetcher: 'http'` or `fetcher: 'browser'`, and can pick differently for list pages and article pages.
**Why:** HTTP is fast and enough for most sites. A browser is needed only for pages built by JavaScript or protected by JavaScript challenges.

### D6. Polite and robust fetching
Limited concurrency per publisher, a delay between requests, a timeout, retries with backoff on 429/5xx, and a realistic User-Agent.
**Why:** thousands of requests, and sites that block aggressive clients.

### D7. Window, canonical URL, dedup
- Window start = 00:00 UTC of (run date − 14 days); end = run time.
- Canonical URL: `<link rel="canonical">` if present, else the fetched URL, with tracking params removed (`utm_*`, `fbclid`, `gclid`, etc.) and the fragment dropped.
- Dedup by canonical URL across all start URLs and pages.

### D8. LLM proposes, code proves
1. **Pre-filter:** a broad keyword check. Articles with no earnings, dividend, split or IPO vocabulary get `others` with no LLM call. It's kept broad so it rarely misses a real one.
2. **LLM:** returns labels plus values **exactly as written** (`"$412.5 million"`, `"December 15, 2026"`) and the evidence sentences, as strict JSON.
3. **Code converts** text → numbers and dates deterministically.
4. **Code checks:** each evidence sentence is found word for word in `fullText`; each value appears in its evidence; label rules (`others` alone). A value that fails becomes `null`, and the failure is logged in the trace.
5. **Measure:** compare against a hand-labelled gold set of ~50 articles and report the accuracy in the README.

**Why:** Jack allowed an LLM only if it's traceable and doesn't hallucinate.
**Model:** decided in Phase 3. A small, fast model for labelling; possibly a stronger one for extraction.

### D9. Traceability: a trace record per article
`output/traces.jsonl`, one line per article, keyed by url. It holds the model + prompt version, the LLM's raw response, and for each value: source text → converted value → rule applied, plus which checks passed or failed and why.
`npm run explain -- <url>` prints it readably.
**Why:** R-J1, "back derive the original logic". It's also the best interview demo.

### D10. `evidence` = every sentence the figures come from
Several sentences are joined with `\n`, in article order; each one must be found word for word in `fullText`. Each item in earnings `figures` (D12) also carries its own single evidence sentence.
**Why:** the PDF says "the exact sentence"; Jack said to retrieve everything.

### D11. Earnings `time`
- `time` stays `bmo` / `amc` / `null`, as the PDF specifies.
- An extra field, `timeExact` (ISO 8601 UTC), is filled when the article states an exact time with a timezone ("4:05 p.m. ET").
- `bmo`/`amc` comes from:
  - explicit wording ("before the market opens"), or
  - a stated time, for US listings (market hours 9:30–16:00 ET), or
  - the publish time of the company's **own** press release, which *is* the announcement.
- A news article's publish time is **not** used, since it's written after the fact.
- Otherwise `null`.

**Why:** R-J3, highest granularity without guessing.

### D12. Earnings: required fields + an all-figures list
The required fields stay as specified. A `figures` array lists every EPS and revenue figure stated:
```json
{ "metric": "eps", "value": 0.84, "basis": "GAAP", "kind": "actual", "evidence": "..." }
```
- `metric`: `eps` | `revenue`
- `basis`: `GAAP` | `IFRS` | `adjusted` | `null`
- `kind`: `actual` | `estimate` | `previous`

`epsActual` = the GAAP (or IFRS, for IFRS reporters) figure. If both diluted and basic EPS are given, use diluted, since analyst estimates are on a diluted basis.
**Why:** R-J4.

### D13. Blocked sites: an escalation ladder, free techniques only
For each blocked site, in order:
1. Alternative routes the site itself offers: other feeds, sitemap archives, AMP pages, the JSON API the page calls, data embedded in the HTML.
2. Realistic headers and cookies.
3. Playwright, with careful waits and human-like pacing.
4. Slower pacing, retries at another time.

Every attempt is logged in `docs/SITES.md` (what we tried, what we saw). The fetcher accepts an optional proxy setting via an env variable, so FMP's proxy network can be plugged in later.
**Why:** R-J2. Ramez expects real effort before declaring a site blocked.

### D14. `symbol` + `relatedSymbols`
- `symbol`: the main company. In a merger, the larger one, without over-investing in this.
- `relatedSymbols`: every company ticker mentioned, the main one included.
- Non-US tickers use FMP suffixes, mapped from the exchange in the text, e.g. TSX → `.TO`, TSXV → `.V`, CSE → `.CN`, LSE → `.L`. The mapping must be verified against FMP's docs in Phase 3.

**Why:** R-A10, R-J5.

### D15. A dev cache for article pages
Fetched article HTML is cached on disk (`.cache/`, gitignored) when `CACHE=1`, to avoid re-fetching during development. List/feed pages are **never** cached, so discovery always sees fresh data.
**Why:** fast iteration on extraction and labelling, and politeness to the sites.

### D16. Outputs
- `output/articles.jsonl`: the deliverable
- `output/traces.jsonl`: per-article traces (D9)
- `output/stats.json`: per publisher: discovered, in window, fetched, blocked, errors, oldest date reached. It feeds the README table.

### D17. Workflow
- This chat (the orchestrator) owns the plan and the requirements and writes the session prompts.
- Claude Code implements, in plan mode first, and writes a handoff file per session.
- The repo is public, so the orchestrator can read it. It's made private after FMP has reviewed it.

### D18. Learning notes, private
`learning/` holds Marwan's notes: a glossary plus one note per session, written by Claude Code. It's gitignored, so it's not part of the submission.
**Why:** Marwan must understand, defend and modify every part live; the notes are his study material.

---

## Open questions (decide in the phase noted)
- **Phase 3:** which Claude model(s); prompt structure.
- **Phase 3:** `symbol` and `type` for articles that skip the LLM: from site metadata and ticker patterns like `(NASDAQ: ABC)`, or `null`.
- **Phase 3:** the `type` rule: a default per publisher in the schema, overridden by content (e.g. a forex story on Investing.com).
