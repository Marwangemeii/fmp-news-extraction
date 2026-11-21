# Requirements checklist

Sources: the task PDF ("News Extraction Task"), Ramez's email, and Jack's answers to the clarifying questions.
"Verified by" says how we prove each requirement: **V** = validator script (`npm run validate`), **T** = automated test, **M** = manual review.

Tick a box only when its check passes.

---

## 1. Publishers

| # | publisher (exact) | site | start URL(s) |
|---|---|---|---|
| 1 | TechCrunch | techcrunch.com | https://techcrunch.com/feed/ |
| 2 | GlobeNewswire | globenewswire.com | https://www.globenewswire.com/en/search/date/24HOURS?pageSize=10&page=1 · https://www.globenewswire.com/en/search/subject/prs |
| 3 | Fox Business | foxbusiness.com | https://www.foxbusiness.com/markets · https://www.foxbusiness.com/category/stocks |
| 4 | Investing.com | investing.com | https://www.investing.com/news/ · https://www.investing.com/rss/news_25.rss |
| 5 | Benzinga | benzinga.com | https://www.benzinga.com/sitemap-benzinga.com/www/googlenews.xml · https://www.benzinga.com/news |
| 6 | CryptoPotato | cryptopotato.com | https://cryptopotato.com/feed |
| 7 | Newsfile | newsfilecorp.com | https://feeds.newsfilecorp.com/global/Last25Stories · https://www.newsfilecorp.com/ |
| 8 | Zacks | zacks.com | https://www.zacks.com/articles/index.php · https://www.zacks.com/stock/news |
| 9 | Business Wire | businesswire.com | https://www.businesswire.com/newsroom |
| 10 | Reuters | reuters.com | https://www.reuters.com/business/ · https://www.reuters.com/markets/ |

## 2. Discovery: the 14-day window
- [ ] **R-D1** The window runs from **00:00 UTC, 14 days before the run**, until the moment of the run. (Run Nov 29 15:00 UTC → window = Nov 15 00:00 UTC → Nov 29 15:00 UTC.) *V: every publishedDate is inside the window.*
- [ ] **R-D2** Discovery starts from the given start URLs. *M*
- [ ] **R-D3** Page back until the whole window is covered. Most feeds show only the newest 20–50 items. *M + per-publisher stats: oldest article reached ≤ window start.*
- [ ] **R-D4** All 10 publishers are attempted. *M: stats per publisher.*
- [ ] **R-D5** No duplicates (the same article reached via two start URLs or two pages). *V: url is unique.*

## 3. Article fields (every article, `others` included)
- [ ] **R-A1** `publishedDate`: ISO 8601 in UTC, the real publish time (not the fetch time). *V format + M spot-check.*
- [ ] **R-A2** `publisher`: exactly as in the table above. *V*
- [ ] **R-A3** `site`: domain without `https://` or `www.`. *V*
- [ ] **R-A4** `url`: canonical, tracking parameters removed. It's the unique key. *V unique + T url-cleaning tests.*
- [ ] **R-A5** `title`: HTML entities decoded. *V: no `&amp;` / `&#…;` left.*
- [ ] **R-A6** `image`: lead image URL or `null`. *V type*
- [ ] **R-A7** `text`: feed description or first paragraph, **≤ 500 characters**. *V*
- [ ] **R-A8** `fullText`: complete body as plain text. No menus, ads, "Read more" links or related-article lists. Keep paragraph breaks (`\n\n`) and table rows. *M spot-check per site.*
- [ ] **R-A9** `fullText` is `null` **only** if the site blocked us, and the README says so. *V + M*
- [ ] **R-A10** `symbol`: main ticker; non-US uses FMP's exchange-suffix format (e.g. `.TO`, `.V`); `null` if the article covers no single company. *M + T suffix mapping.*
- [ ] **R-A11** `type`: one of `stock`, `pressReleases`, `crypto`, `forex`, `general`. *V*
- [ ] **R-A12** `labels`: one or more of `earnings`, `dividends`, `splits`, `ipos`, or `others` **alone**. *V*
- [ ] **R-A13** `events`: one object per label; `[]` when the label is `others`. *V*

## 4. Labelling rules
- [ ] **R-L1** A label applies only if the event is the article's **subject**, not a passing mention. *M: hand-labelled sample.*
- [ ] **R-L2** **earnings**: reports actual quarterly or annual results (e.g. EPS or revenue for a stated period), **or** announces the date results will be reported. *Not* earnings: previews, opinion pieces, stock-move stories with no reported figures.
- [ ] **R-L3** **dividends**: declares, raises, cuts, suspends or reinstates a dividend.
- [ ] **R-L4** **splits**: announces or completes a stock split or reverse split, with a ratio.
- [ ] **R-L5** **ipos**: a company files for, prices, launches, postpones or withdraws an IPO.
- [ ] **R-L6** **others**: everything else, never combined with another label. *V*

## 5. Event fields
Every event: `category` (the label), `symbol`, `evidence`.
- [ ] **R-E1** `evidence` is copied **word for word** from the article. *V: every evidence sentence is found in fullText.*
- [ ] **R-E2** **earnings**: `calendarYear` (fiscal year as the company labels it), `period` (`Q1`–`Q4` or `FY`), `fiscalDateEnding`, `date` (day results were or will be announced), `time` (`bmo` / `amc` / `null`), `epsActual`, `epsEstimated`, `revenueActual`, `revenueEstimated`.
- [ ] **R-E3** If GAAP and adjusted EPS are both given, `epsActual` = GAAP. *M + gold set.*
- [ ] **R-E4** Revenue in full units (`$412.5 million` → `412500000`). *T conversion tests.*
- [ ] **R-E5** **dividends**: `dividend` (per share), `declarationDate`, `date` (= ex-dividend date), `recordDate`, `paymentDate`.
- [ ] **R-E6** **splits**: `date` (effective date), `numerator` (new shares), `denominator` (old shares), `splitType` (`forward` / `reverse`).
- [ ] **R-E7** **ipos**: `company`, `exchange`, `date` (expected or actual first trading day), `actions` (`filed` / `expected` / `priced` / `postponed` / `withdrawn`), `shares`, `priceRange` (text), `pricePerShare`, `marketCap`.
- [ ] **R-E8** All dates are `YYYY-MM-DD`. *V*
- [ ] **R-E9** All numbers are plain JSON numbers: no currency signs, no commas, no strings. *V*
- [ ] **R-E10** A field the article doesn't state is `null`. **Never guess.** *V (value appears in evidence) + M*

## 6. Code structure (hard requirement)
- [ ] **R-C1** One schema (single module) holding all 10 publishers. *M*
- [ ] **R-C2** Each entry holds only what differs: name, start URLs, how its list is found, how pages are fetched, selectors, site-specific clean-up. *M*
- [ ] **R-C3** One controller runs every publisher: discover → fetch → extract → label → write. *M*
- [ ] **R-C4** The controller contains **no publisher names and no per-site `if` branches**. *T: a structure test fails if any publisher name or domain appears in the controller.*
- [ ] **R-C5** Adding an 11th publisher = one schema entry, no controller change. *M: rehearse it live.*
- [ ] **R-C6** Shared building blocks (HTTP fetch, browser fetch, RSS parser, sitemap parser, labeller) are reusable functions chosen by name. *M*

## 7. Deliverables
- [ ] **R-S1** `articles.jsonl`: one JSON object per line, one line per article, all publishers, `others` included. *V*
- [ ] **R-S2** Code: the schema + the single controller, run by **one command**. *M*
- [ ] **R-S3** **It must work when they rerun it after the deadline**, on fresh articles, without us touching it. *M: final dry run from a clean clone.*
- [ ] **R-S4** README: a table with the article count per publisher and how the 14 days were covered. *M*
- [ ] **R-S5** README: for each site that blocked us, what we saw, what we tried, and what we'd do in production. *M*
- [ ] **R-S6** A high-level methodology description (from Ramez's email). *M*

## 8. Clarifications from Jack (CEO/CTO)
- [ ] **R-J1** An LLM is allowed, **if it's traceable**: we must show it isn't hallucinating and be able to trace back the logic behind every value. → trace record per article + `explain` command (D9).
- [ ] **R-J2** Free unblocking techniques are fine; they have proxy networks for later. → try hard (escalation ladder), log every attempt, keep an optional proxy setting (D13).
- [ ] **R-J3** `time`: highest granularity. An exact time with a timezone if stated; `bmo`/`amc` if stated or inferable; otherwise `null` (D11).
- [ ] **R-J4** Earnings: retrieve **every** figure and classify it (actual / estimate / previous; GAAP / IFRS / adjusted) (D12).
- [ ] **R-J5** `symbol` = the main company (in a merger, the larger one; don't over-focus) **and** extract all relevant companies mentioned (D14).
- [ ] **R-J6** Node.js with **JavaScript** (not TypeScript). No Docker; plain scripts are fine. **Don't overengineer.**
