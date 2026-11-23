/**
 * The 14-day collection window (D7, R-D1).
 * start = 00:00 UTC of (run date − 14 days); end = the run time itself.
 * Example: run at 2026-11-29T15:00Z → start 2026-11-15T00:00Z, end 2026-11-29T15:00Z.
 *
 * @param {Date} now the run time
 * @returns {{ start: Date, end: Date }}
 */
export function getWindow(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 14));
  return { start, end: new Date(now) };
}

/**
 * @param {string | null | undefined} isoDate
 * @param {{ start: Date, end: Date }} window
 */
export function isInWindow(isoDate, window) {
  if (!isoDate) return false;
  const t = new Date(isoDate).getTime();
  return t >= window.start.getTime() && t <= window.end.getTime();
}
