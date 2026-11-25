# CLAUDE.md

Take-home task for FMP (Financial Modeling Prep): collect every article that 10 financial news publishers posted in the last 14 days, label each one (earnings, dividends, splits, ipos, or others), extract event details, and write `articles.jsonl`.

## Read before any work
1. `docs/REQUIREMENTS.md`: every requirement, with an ID. This is the acceptance criteria.
2. `docs/DECISIONS.md`: what was already decided and why. Don't re-decide these silently.
3. `docs/PLAN.md`: the current phase and its "done when" condition. Work on that phase only.
4. `docs/SITES.md`: per-publisher findings, when working on a site.
5. `learning/GLOSSARY.md`: finance and technical terms. Use these meanings consistently; add new terms when you introduce them.

## Hard rules
1. **One schema, one controller.** All publishers live in `src/publishers.js`. `src/controller.js` runs every entry and contains **no publisher names and no per-site `if` branches**. Per-site differences live only in schema entries. Building blocks (fetchers, discoverers, clean-ups, labeller) are plain functions in a registry, chosen by name from the schema. Adding an 11th publisher = adding one schema entry.
2. **Plain JavaScript (ESM) on Node 22+.** No TypeScript, no Docker, no frameworks, no class hierarchies. Use JSDoc comments where types help readability.
3. **Don't overengineer.** Build the smallest thing that meets the requirement. Ask before adding any dependency, and give a one-line reason for it.
4. **Never guess a value.** If the article doesn't state it, it's `null`. The LLM proposes; the code proves. Any value that fails a check becomes `null` and the failure is logged in the trace.
5. **Everything LLM-derived is traceable.** Each article gets a trace record (see D9 in `docs/DECISIONS.md`).
6. **No secrets in the repo.** `ANTHROPIC_API_KEY` comes from the environment. `.env` is gitignored; `.env.example` documents it.
7. **Be polite to sites.** Limited concurrency, delays between requests, timeouts, retries with backoff.

## How to work with Marwan
- **Start every task in plan mode.** Propose the plan and wait for approval before writing code.
- Keep changes small and reviewable. Marwan must understand every line, because he'll defend and modify this code live in an interview. When he asks about something, explain it plainly, with an example.
- Add short comments only where the *why* isn't obvious.
- Before saying a task is done, run `npm test` and `npm run validate` (once they exist) and report the results.
- **New decision?** Add an entry to `docs/DECISIONS.md`: what was decided, why, and what alternatives were considered.
- **New site finding** (a discovery route, a blocking attempt)? Add it to `docs/SITES.md`.
- **Don't commit until Marwan approves the diff.**

## End of every session (mandatory)
1. Write `docs/handoff/NN-<phase>.md` using `docs/handoff/TEMPLATE.md`. It's read by the orchestrator (Claude in a separate chat), who cannot see the code, so include the key snippets.
2. Write `learning/NN-<phase>.md` using `learning/TEMPLATE.md`. This is for Marwan's own understanding: plain English, real examples from our code, no jargon left unexplained. `learning/` is gitignored and not part of the submission.
3. Update the phase status in `docs/PLAN.md`.

## Commands (keep this list current)
- `npm install`
- `npx playwright install chromium`: needed once, for the browser fetcher
- `npm start`: runs the whole schema and writes `output/articles.jsonl` + `output/stats.json`
- `npm start -- --only <publisher> --limit <n>`: dev run of one publisher, n articles
- `CACHE=1 npm start` (PowerShell: `$env:CACHE=1; npm start`): dev cache for article pages in `.cache/` (D15) and LLM answers in `.cache/llm/` (D36)
- `npm test`
- `npm run validate`: checks `output/articles.jsonl` against the requirements (run time from `output/stats.json`; `-- --run-at <iso>` overrides)
- `npm run explain -- <url or part of it> [--json]`: prints the trace for one article from `output/traces.jsonl`
- `npm run eval [-- --verbose] [-- --only <prefix>]`: runs the real labeller on `test/fixtures/articles` against `test/fixtures/gold.json` (LLM cache always on); `LLM_EXTRACT_MODEL=claude-sonnet-5-5 npm run eval` compares models
- `node scripts/make-fixture.js <url> --publisher <name> --out <file> [--body <css>] [--date <css>] [--cached]`: saves one article as an eval fixture
- `LLM_BUDGET_USD=1 npm start`: caps the run's estimated LLM spend (D34). `npm start` and `npm run eval` load `.env` (Node's `--env-file-if-exists`)
