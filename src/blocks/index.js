/**
 * The registry (D4): building-block name → function.
 * A schema entry says e.g. `discover: 'rss'`; the controller looks up registry.discoverers.rss.
 * To add a building block: write the function, add it here, use its name in the schema.
 */
import { fetchHttp } from './fetch-http.js';
import { fetchBrowser, closeBrowser } from './fetch-browser.js';
import { discoverRss } from './discover-rss.js';
import { discoverWpJson } from './discover-wp-json.js';
import { discoverHtmlList } from './discover-html-list.js';
import { discoverSitemap } from './discover-sitemap.js';
import { extractHtml } from './extract-html.js';
import { labelPlaceholder } from './label-placeholder.js';
import { labelLlm } from './label-llm.js';

export const registry = {
  fetchers: { http: fetchHttp, browser: fetchBrowser },
  discoverers: { rss: discoverRss, 'wp-json': discoverWpJson, 'html-list': discoverHtmlList, sitemap: discoverSitemap },
  extractors: { html: extractHtml },
  labellers: { placeholder: labelPlaceholder, llm: labelLlm },
};

/** Releases what building blocks hold open (the shared browser). run.js calls it at the end. */
export async function closeBlocks() {
  await closeBrowser();
}
