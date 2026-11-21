# Sites

One section per publisher. Notes marked **(hypothesis)** are unverified; update them with what was actually observed.

Template for each site:
- **Start URLs:**
- **Discovery route:** how the article list is found
- **Covering 14 days:** how we page back, and the oldest date reached
- **Fetcher:** http / browser (list pages, article pages)
- **Selectors:** body, title, date, image
- **Clean-up:** site-specific removals
- **Blocking log:**

| Date | What we tried | What we saw (status, page content) | Result |
|---|---|---|---|

---

## 1. TechCrunch
- **Start URLs:** https://techcrunch.com/feed/
- **Notes:** a WordPress feed; WordPress feeds often support `?paged=2`, `?paged=3`, … **(hypothesis)**

## 2. GlobeNewswire
- **Start URLs:** `/en/search/date/24HOURS?pageSize=10&page=1`, `/en/search/subject/prs`
- **Notes:** the start URL only covers 24 hours, so a different route is needed for 14 days (paging the subject search, or a date-range search). **(hypothesis)**

## 3. Fox Business
- **Start URLs:** /markets, /category/stocks
- **Notes:** the list may be loaded by JavaScript or a "Show more" button; check the network tab for a JSON endpoint. **(hypothesis)**

## 4. Investing.com
- **Start URLs:** /news/, /rss/news_25.rss
- **Notes:** may be bot-protected. **(hypothesis)**

## 5. Benzinga
- **Start URLs:** the Google News sitemap, /news
- **Notes:** Google News sitemaps only list about the last 2 days by design, so another route is needed (the sitemap index, or paging /news). **(hypothesis)**

## 6. CryptoPotato
- **Start URLs:** https://cryptopotato.com/feed
- **Notes:** a WordPress feed, so `?paged=N` may work. Most articles have `type: crypto`. **(hypothesis)**

## 7. Newsfile
- **Start URLs:** Last25Stories feed, the homepage
- **Notes:** the feed has only 25 items, so another route is needed. Many Canadian issuers: watch for TSXV/CSE ticker suffixes. **(hypothesis)**

## 8. Zacks
- **Start URLs:** /articles/index.php, /stock/news
- **Notes:** may be bot-protected. **(hypothesis)**

## 9. Business Wire
- **Start URLs:** /newsroom
- **Notes:** may be bot-protected. **(hypothesis)**

## 10. Reuters
- **Start URLs:** /business/, /markets/
- **Notes:** likely strong bot protection. Check for internal JSON APIs and sitemaps. **(hypothesis)**
