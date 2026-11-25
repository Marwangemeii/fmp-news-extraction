# Eval fixtures (D42)

`articles/*.json`: real articles saved as extracted fields (`title`, `text`, `fullText`, `publishedDate`), not HTML, with `scripts/make-fixture.js`. `gold.json` holds the expected answers. **Status: DRAFT, to be verified by Marwan.**

GlobeNewswire fixtures were fetched on 2026-11-25 with `--body '[itemprop="articleBody"]' --date 'meta[property="og:article:published_time"]'`. TechCrunch and CryptoPotato fixtures come from the page cache (`--cached`, no network). Business Wire returned 403 (Akamai), so its planned slots went to GlobeNewswire.

| # | Case | Source | Gold labels |
|---|---|---|---|
| 01 | Q4 + full-year results, GAAP + adjusted EPS | [GlobeNewswire: IES Holdings](https://www.globenewswire.com/news-release/2026/11/20/3407370/29106/en/ies-holdings-reports-fiscal-2026-fourth-quarter-and-full-year-results-board-authorizes-additional-350-million-for-share-repurchase-program.html) | earnings |
| 02 | Results with a diluted **loss** per share, positive basic EPS | [GlobeNewswire: T3 Defense](https://www.globenewswire.com/news-release/2026/11/24/3409356/0/en/t3-defense-announces-third-quarter-2026-financial-results.html) | earnings |
| 03 | Earnings **date announcement** (before market open) | [GlobeNewswire: Johnson Outdoors](https://www.globenewswire.com/news-release/2026/11/24/3409738/10340/en/johnson-outdoors-to-release-fiscal-2026-fourth-quarter-results-on-december-11-2026.html) | earnings |
| 04 | Quarterly dividend declaration | [GlobeNewswire: QNB Corp.](https://www.globenewswire.com/news-release/2026/11/24/3409709/0/en/qnb-corp-declares-q4-2026-dividend.html) | dividends |
| 05 | Results + dividend increase; full year listed **before** Q4 | [GlobeNewswire: HP Inc.](https://www.globenewswire.com/news-release/2026/11/24/3409888/0/en/hp-inc-reports-fiscal-2026-full-year-and-fourth-quarter-results-announces-dividend-increase.html) | earnings, dividends |
| 06 | Forward split, ratio in words ("five-for-one") | [GlobeNewswire: Seneca Foods](https://www.globenewswire.com/news-release/2026/11/04/3395880/32471/en/seneca-foods-announces-shareholder-approval-of-five-for-one-forward-stock-split.html) | splits |
| 07 | Reverse split 1-for-10 | [GlobeNewswire: BullFrog AI](https://www.globenewswire.com/news-release/2026/11/25/3410122/0/en/bullfrog-ai-holdings-announces-1-for-10-reverse-stock-split.html) | splits |
| 08 | Reverse split in words ("one-for-ten") | [GlobeNewswire: Ready Capital](https://www.globenewswire.com/news-release/2026/11/23/3408916/0/en/ready-capital-corporation-announces-one-for-ten-reverse-stock-split.html) | splits |
| 09 | Share consolidation 1-for-16 | [GlobeNewswire: INLIF](https://www.globenewswire.com/news-release/2026/11/24/3409225/0/en/inlif-limited-announces-1-for-16-share-consolidation-effective-november-27-2026.html) | splits |
| 10 | IPO pricing | [GlobeNewswire: Windward Bio](https://www.globenewswire.com/news-release/2026/11/12/3402338/0/en/windward-bio-announces-pricing-of-initial-public-offering.html) | ipos |
| 11 | IPO filing (S-1, a 2014 spin-off) | [GlobeNewswire: VitaCig](https://www.globenewswire.com/news-release/2014/04/21/628238/28613/en/mcig-inc-subsidiary-vitacig-inc-files-for-initial-public-offering.html) | ipos |
| 12 | Non-US issuer, IFRS, three listings (NYSE / Euronext Brussels / Oslo), results + distribution | [GlobeNewswire: CMB.TECH](https://www.globenewswire.com/news-release/2026/11/24/3409001/0/en/press-release-cmb-tech-announces-q3-2026-results.html) | earnings, dividends |
| 13 | TSX fund distribution; "Split Corp." in the name is **not** a split | [GlobeNewswire: Infrastructure Dividend Split Corp.](https://www.globenewswire.com/news-release/2026/11/23/3408530/0/en/infrastructure-dividend-split-corp-class-a-distributions.html) | dividends |
| 14 | Canadian date announcement, no ticker in the text | [GlobeNewswire: Transcontinental](https://www.globenewswire.com/news-release/2026/11/25/3410427/0/en/transcontinental-inc-release-of-fourth-quarter-and-fiscal-year-2026-results-and-conference-call.html) | earnings |
| 15 | IPO mentioned many times, but the subject is a class action | [GlobeNewswire: Fervo Energy / KSF](https://www.globenewswire.com/news-release/2026/11/25/3409967/6713/en/fervo-energy-frvo-ipo-investors-kahn-swick-foti-alerts-shareholders-to-class-action-lead-plaintiff-deadline-january-19-2027.html) | others |
| 16 | IPO only in passing (CEO steps down) | [TechCrunch: Flipkart](https://techcrunch.com/2026/11/25/flipkart-ceo-kalyan-krishnamurthy-to-step-down-next-week-amid-ipo-uncertainty/) | others |
| 17 | IPO pricing as a **news story** | [TechCrunch: Anthropic prices IPO](https://techcrunch.com/2026/11/18/anthropic-reportedly-prices-ipo-at-83-a-share-above-projected-range/) | ipos |
| 18 | Actual results as a news story, relative date ("on Tuesday") | [TechCrunch: Nvidia](https://techcrunch.com/2026/11/17/nvidia-promises-that-revenue-will-keep-soaring-for-now/) | earnings |
| 19 | Opinion piece about an upcoming IPO | [CryptoPotato: Anthropic IPO risks](https://cryptopotato.com/anthropic-ipo-3-hidden-risks-investors-should-know-before-buying/) | others (arguable) |

Not covered yet: an earnings **preview** that should be `others` (none found in the window; 19 is the closest), and a Newsfile TSXV/CSE issuer (the Newsfile feed's 25 items were all law-firm alerts on the day). Add them in Phase 4/5.
