# Plan

Deadline: **Sunday, Nov 29, 2026**. Status values: `todo` · `in progress` · `done`.
Work on one phase at a time. Each phase ends with a handoff file in `docs/handoff/` and a learning note in `learning/`.

| Phase | Day | Status |
|---|---|---|
| 0. Repo + docs | Sat 21 | done |
| 1. Skeleton + first real path | Sat 21 | done |
| 2. Two easy sites, full window | Sun 22 | done (awaiting diff approval) |
| 3. Labeller, extractor, traces | Mon 23 – Tue 24 | done (M1 + M2; M2 awaiting diff approval) |
| 4. Remaining 8 sites | Wed 25 – Thu 26 | in progress (session A: Newsfile done; GlobeNewswire, Benzinga next) |
| 5. Full run + quality check | Fri 27 | todo |
| 6. README, methodology, rehearsal | Sat 28 | todo |
| 7. Final run + submit | Sun 29 | todo |

---

## Phase 0: Repo + docs (Marwan)
Create the public repo, add these docs, commit, push.
**Done when:** the repo is on GitHub with `CLAUDE.md` and `docs/`.

## Phase 1: Skeleton + first real path
**Build:**
- `package.json` (ESM, scripts: `start`, `test`, `validate`), `.gitignore` (already exists; extend it if needed), `.env.example`.
- `src/publishers.js`: all 10 entries with name, site and start URLs. Only TechCrunch fully configured; the others marked `enabled: false` until their phase.
- `src/blocks/`: `http` fetcher, `rss` discoverer, article field extraction (title, image, text, fullText via selectors, publishedDate), the registry object.
- `src/lib/`: window calculation, URL canonicalization, JSONL writer.
- `src/controller.js` + `src/run.js` (the CLI entry; flags `--only <publisher>`, `--limit <n>` for development).
- A placeholder labeller that returns `labels: ["others"], events: []`.
- `test/structure.test.js` (R-C4) + URL-cleaning tests.
- `scripts/validate.js`: checks the field-level rules in REQUIREMENTS §3 (format, uniqueness, `others` alone, `text` ≤ 500, window).

**Done when:**
- `npm start -- --only TechCrunch` writes real TechCrunch articles (page 1 of the feed only) to `output/articles.jsonl`.
- `npm test` and `npm run validate` pass.
- Disabled publishers are skipped with a clear log line.

## Phase 2: Two easy sites, full window
TechCrunch + CryptoPotato: page back through the full 14 days, clean `fullText`, add the dev cache (D15) and `output/stats.json`.
**Done when:** both reach the window start (shown in stats), the validator passes, and 5 spot-checked articles per site have a clean `fullText`.

## Phase 3: Labeller, extractor, traces
Pre-filter → LLM → conversion → checks → trace (D8–D12, D14). Symbol mapping, `type` rule, `npm run explain`, gold set (~50 hand-labelled articles) + accuracy script.
**Done when:** the gold-set accuracy is measured, every evidence check is enforced, and `explain` works on any article.
**Milestones (agreed 2026-11-25):** M1 = pre-filter + LLM (prompts, schemas, cache) + converters + checks + traces + explain + fixtures/eval (labels + event fields): **done**. M2 = symbol + relatedSymbols + FMP suffix, `type` rule, `figures[]` in the output, `time`/`timeExact` (D11), eval on those fields + Haiku vs Sonnet extract comparison, plus Marwan's decisions on M1 (K11, body-only evidence, K2 case, extract failure keeps labels): **done** (D44–D50). Gold set: 19 fixtures now (DRAFT); it grows toward ~50 in Phase 5.

## Phase 4: Remaining 8 sites
Suggested order, easier to harder: Newsfile, GlobeNewswire, Benzinga, Business Wire, Zacks, Fox Business, Investing.com, Reuters. For each: discovery route, window coverage, selectors, clean-up, and the blocking ladder (D13), logged in `docs/SITES.md`.
**Done when:** every site either covers the window or has a complete attempt log.

## Phase 5: Full run + quality check
A full run, the validator, gold-set accuracy, fixes for the top issues.
**Done when:** the validator passes on the full output and the numbers are recorded.

## Phase 6: README, methodology, rehearsal
- README: setup, one command, the per-publisher table, blocked sites, methodology.
- Rehearsal: Marwan explains every file and adds an 11th publisher live.

## Phase 7: Final run + submit
Clean clone → install → run (close to submission, because the window is relative to the run time) → validate → commit `articles.jsonl` → submit.
