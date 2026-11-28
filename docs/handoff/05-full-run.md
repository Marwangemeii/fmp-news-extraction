# Handoff 05: Full run (session A: fetch run, cost cut 1)

> Written by Claude Code, for the orchestrator (Claude in a separate chat, who cannot see the code).

## 1. Goal of this session
Phase 5, part 1 (Marwan away, working independently): (1) the full **fetch** run (`CACHE=1`, `LABEL=placeholder`, all enabled publishers) to warm the article cache at $0 LLM cost; (2) **cost cut 1 only**: a deterministic law-firm class-action notice rule before any LLM call. STRICT: no change to any prompt, `PROMPT_VERSION`, schema or extraction/clean-up selector (the LLM cache key includes the text); no prompt caching. (3) Report per site; (4) **not** the labelled run (Marwan runs it tonight).

## 2. What was done
- `src/lib/notice-rule.js` (new): `lawFirmNotice(article)` → `{ rule, litigation, firm, firmIn }` or null (D71).
- `src/blocks/label-llm.js`: calls it after the pre-filter passes, before classify; `trace.noticeRule`; `result.why` names the rule and the words.
- `src/controller.js`: stats `llm.noticeRule` (and the run line); **breaker fix**: after 5 blocks in a row, `readCache(url)` is still tried (D72).
- `src/lib/cache.js`: `readCache(url, counter)` split out of `cached()` (no request).
- `src/run.js`: `noticeRule` summed into the run total and printed on the `LLM:` line.
- `scripts/explain.js`: prints a `rule` line.
- `scripts/validate.js`: R-A5 entity check no longer flags "MD&A; Q3-2026" as the entity `&A;` (the only failure of the full run; a false positive). Named entities now need 2+ characters: `&rsquo;`, `&Eacute;` still fail; "MD&A;", "R&D;", "AT&T;" don't.
- Tests: `test/notice-rule.test.js` (new, 6), `test/label-llm.test.js` (+1: no LLM call, trace), `test/controller.test.js` (+1: breaker reads cache). **104 → 112, all pass.**
- Docs: DECISIONS D71, D72; SITES (Phase 5 run table, CryptoPotato row); PLAN; GLOSSARY (4 terms).

## 3. How it works
```js
// src/lib/notice-rule.js: all three must hold
const LITIGATION = /class action|lead plaintiff|securities fraud|lawsuit|secure counsel|investigat(?:e|es|ing|ion)\b|fair deal|recover losses/i; // in the TITLE
const LAW_FIRM = /law firm|\bLLP\b|\bPLLC\b|\bP\.C\.|\battorneys?\b|\bcounsel\b|\bEsq\.|contact the firm/i;                            // title OR first 2 paragraphs
const EVENT_TITLE = /\bresults\b|\bdividends?\b|\bdistributions?\b|\bsplit\b|\bconsolidation\b|initial public offering/i;             // guard: NOT in the title
export function lawFirmNotice(article) {
  const title = article.title ?? '';
  const litigation = title.match(LITIGATION)?.[0];
  if (!litigation || EVENT_TITLE.test(title)) return null;
  const inTitle = title.match(LAW_FIRM)?.[0];
  const inOpening = inTitle ? null : opening(article.fullText ?? '', 2).match(LAW_FIRM)?.[0];
  const firm = inTitle ?? inOpening;
  if (!firm) return null;
  return { rule: NOTICE_RULE, litigation, firm, firmIn: inTitle ? 'title' : 'opening' };
}
// label-llm.js, after `if (!trace.prefilter.pass) return others(…)`:
trace.noticeRule = lawFirmNotice(article);
if (trace.noticeRule) { setSymbols(null); return others(`rule: ${NOTICE_RULE} (title "…", firm "…" in the …), no LLM call`); }
```
**Breaker + cache (D72), `controller.js`:**
```js
const fromDisk = blockedInARow >= BLOCKED_IN_A_ROW && cache ? await readCache(item.url, cacheCounter) : null;
if (fromDisk) { article = extract(fromDisk.body, item, entry, fromDisk.url); if (article.fullText === null) nullReason = 'noBody'; }
else if (blockedInARow >= BLOCKED_IN_A_ROW) { nullReason = 'blocked'; s.notFetchedAfterBlocks++; article = extract('', item, entry, item.url); }
else { /* fetch as before */ }
```

## 4. Decisions made
- **D71** law-firm notice rule: generic legal words (not firm names), firm signature in title or opening, guard on event titles; traced; no prompt change. Added.
- **D72** the breaker still reads the dev cache (a disk read is not a request). Added.
- Validator entity fix: a bug fix, not a decision (here only).

## 5. Deviations from the plan or the docs
- **The fetch run's shell was stopped by Claude Code** (machine low on memory: 1.7 GB free of 13.9 GB; the run's node process at ~1.4 GB). The `node src/run.js` process itself kept running and finished normally (exit 0); only the log's final `EXIT` line is missing. Nothing was restarted.
- The run used the code as it was at its start (the rule and D72 were written while it ran), so its CryptoPotato numbers show the D72 bug.
- The D72 fix and the validator fix weren't in the brief: both are bug fixes that don't change any extracted text (Marwan's condition).

## 6. Requirements covered
- **R-D1–R-D4, R-A*, R-J1** on the full output: `npm run validate` PASS (0 failures).
- **R-C4**: structure test passes (the rule has no publisher names; the test caught one in a comment, fixed).
- **Rule 5 (traceability)**: `trace.noticeRule` + `result.why` + `explain`; tested.

## 7. How to verify
```
npm test                                   # 112 pass
npm run validate                           # on the fetch output: PASS, 0 failures, 13,055 warnings
LLM_BUDGET_USD=0.05 npm run eval           # 0 billed calls (35 cached), every score identical to before
```
**Tonight's labelled run (Marwan), PowerShell:**
```
$env:CACHE=1; $env:LABEL=''; $env:LLM_BUDGET_USD='7'; cmd /c "npm start > output\run-labelled.log 2>&1"
npm run validate
```
Close Chrome/other apps first (memory, see §9), and run it in your own terminal, not as a Claude background task.

## 8. Results
**Fetch run** (2026-11-28T13:33Z, window 2026-11-14T00:00Z → run; 16,172 s = 4 h 30 min; exit 0, no crash). Full table in SITES.md "Phase 5".

| Site | In window | Written | fullText null | Not written | Errors | Window start | Duration |
|---|---|---|---|---|---|---|---|
| TechCrunch | 210 | 210 | 0 | 0 | 0 | yes | 1 min |
| GlobeNewswire | 9,253 | 9,253 | 0 | 0 | 0 | yes (5/5 slices complete) | 269 min |
| Fox Business | 127 | 125 | 0 | 2 outside window | 0 | yes | 1 min |
| Investing.com | 142 | 141 | 141 blocked | 1 no date | 5 | **no** (11-24) | 1 min |
| Benzinga | 2,608 | 256 | 256 blocked | 2,352 no date | 5 | yes | <1 min |
| CryptoPotato | 248 | 248 | 248 blocked (D72 bug) | 0 | 5 | yes | <1 min |
| Newsfile | 1,993 | 1,988 | 0 | 0 (+5 uncounted) | 0 | yes | 47 min |
| Zacks | 510 | 445 | 0 | 55 (45 removed, 10 no date) | 1 | **no** (~1.5 days) | 26 min |
| Business Wire | 5,999 | 5,999 | 5,998 blocked, 1 noBody | 0 | 8 | yes | 1 min |
| Reuters | – | – | – | not collected (D70) | – | – | – |
| **Total** | | **18,665** | 6,644 blocked + 1 noBody | | | | 4 h 30 |

- **Validate:** PASS, 0 failures after the R-A5 false positive was fixed (1 failure before: "MD&A; Q3-2026"). Warnings 13,055: R-A7 6,397 (empty text, blocked), R-A9 6,648 (fullText null with reason), R-D3 2 (Investing, Zacks), R-D1 3 (Investing 1, Benzinga 2,352, Zacks 55), R-A1 1 (Zacks day-only), R-D2 3 (Zacks `/stock/news`, BW `/newsroom`, Reuters), LLM 1 (placeholder).
- **`output/articles.jsonl`: 91.2 MB (86.9 MiB)**: GlobeNewswire 70.5, Newsfile 13.7, Business Wire 3.2, Zacks 2.0, others <1 each. Largest fullText 130,045 chars.
- **Tests:** 112/112. **Eval:** 17/19 exact label sets, every score identical to before the rule; LLM 0 billed calls, 35 cached (was 36: fixture 15 now skipped by the rule), **$0**.
- **Rule on the real output (offline):** of 18,665 articles, 12,021 have text; 8,665 pass the pre-filter; **2,024 are caught by the rule** (GNW 1,008, Newsfile 1,016) → **6,641 go to the LLM** (GNW 5,246, Newsfile 824, Zacks 433, TechCrunch 83, Fox 55), plus ~75 from CryptoPotato's 186 recovered pages (D72).
- **Rule checks:** 70/70 notices in the cached samples caught; 0 of 16 labelled sample releases and 0 of 18 real-label fixtures caught; all 45 unusual-title hits in the full output read by hand: all law-firm notices.
- **Session LLM spend: $0.**

**Tonight's labelled run, estimate** (B7's per-article costs, notices removed): GlobeNewswire 5,246 × ~$0.00063 ≈ $3.3 · Newsfile 824 × ~$0.00099 ≈ $0.8 · Zacks ~$0.27 · TechCrunch + Fox + CryptoPotato ~$0.1 → **≈ $4.5** (range ~$3.5–6; the rule saves ~$0.9). ~6,700 classify + ~800 extract calls, a few hundred already cached. Credit left ≈ $9.15. Runtime: discovery ~15 min + new articles since 13:33Z + LLM time (~7,500 calls at 4 at a time, unmeasured; likely 2–3 h).

## 9. Known issues / open questions for the orchestrator
1. **Memory.** The fetch run's process reached ~1.4 GB with 1.7 GB free; the labelled run also holds traces (one per article, with LLM JSON) until the end. Run it with other apps closed. If it fails, the article cache stays warm and the LLM cache keeps every answer already paid for, so a rerun only pays for what's missing.
2. **File size margin:** 86.9 MiB of GitHub's 100 MiB hard limit (50 MiB triggers a warning, not a rejection). Labels/events + CryptoPotato's 186 texts should add a few MB. If a final run exceeds it, options: Git LFS, or splitting/compressing (check what the task allows).
3. **Phase 7 needs `CACHE=1` too**, or CryptoPotato is all `blocked` (D72 only helps with a warm cache), and the run takes 4.5 h again.
4. **Uncounted gaps:** Newsfile 5 and Zacks 10 in-window items appear in no counter (probably the `seen` canonical-URL dedupe, which isn't counted). Not verified.
5. **GlobeNewswire count** dropped from 9,882 (Phase 4) to 9,253: the window moved a day forward over the Thanksgiving week (fewer releases). All 5 slices complete.
6. The rule misses 166 legal-looking titles (e.g. Rosen's "If You Have Suffered Losses… Contact The Rosen Law Firm About Your Rights"); they cost ~$0.07 in calls. Not widened, to keep the evidence base (every word in the rule came from verified samples).

## 10. Suggested next step
Marwan's labelled run tonight (command in §7), then `npm run validate`, then the quality check: spot-check labels on the busiest earnings days, `npm run explain` on a few rule hits and on any `llmError`, and record cost/calls vs this estimate.
