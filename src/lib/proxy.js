/**
 * Optional proxy (D13, D63): `PROXY_URL=http://user:pass@host:port`. Unset = no proxy.
 * This is the hook for FMP's proxy network; nothing in the code depends on a proxy being there.
 */
import http from 'node:http';

/** @returns {string|null} */
export const proxyUrl = () => process.env.PROXY_URL || null;

/**
 * Playwright's launch option, or undefined with no proxy. Credentials go in their own fields
 * (Playwright doesn't read them from the URL).
 * @returns {{ server: string, username?: string, password?: string } | undefined}
 */
export function browserProxy() {
  const raw = proxyUrl();
  if (!raw) return undefined;
  const u = new URL(raw);
  const proxy = { server: `${u.protocol}//${u.host}` };
  if (u.username) proxy.username = decodeURIComponent(u.username);
  if (u.password) proxy.password = decodeURIComponent(u.password);
  return proxy;
}

/**
 * Routes Node's built-in `fetch` (the http fetcher) through PROXY_URL. Uses Node's own
 * `http.setGlobalProxyFromEnv()` (Node 24+), so no dependency. Setting HTTPS_PROXY in
 * process.env at runtime is not enough: Node reads those only at startup.
 * @returns {'off'|'on'|'unsupported'} 'unsupported' = this Node has no runtime API; only the browser is proxied
 */
export function applyHttpProxy() {
  const raw = proxyUrl();
  if (!raw) return 'off';
  if (typeof http.setGlobalProxyFromEnv !== 'function') return 'unsupported';
  http.setGlobalProxyFromEnv({ HTTP_PROXY: raw, HTTPS_PROXY: raw });
  return 'on';
}
