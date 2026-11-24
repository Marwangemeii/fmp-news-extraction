/**
 * The registry (D4): building-block name → function.
 * A schema entry says e.g. `discover: 'rss'`; the controller looks up registry.discoverers.rss.
 * To add a building block: write the function, add it here, use its name in the schema.
 */
import { fetchHttp } from './fetch-http.js';
import { discoverRss } from './discover-rss.js';
import { discoverWpJson } from './discover-wp-json.js';
import { extractHtml } from './extract-html.js';
import { labelPlaceholder } from './label-placeholder.js';

export const registry = {
  fetchers: { http: fetchHttp },
  discoverers: { rss: discoverRss, 'wp-json': discoverWpJson },
  extractors: { html: extractHtml },
  labellers: { placeholder: labelPlaceholder },
};
