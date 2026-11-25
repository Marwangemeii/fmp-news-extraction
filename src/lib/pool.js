/**
 * Runs `fn` over `items` with at most `limit` calls in flight, keeping the input order in the result.
 * Used for LLM calls: one at a time would take hours on a full run, unlimited would hit rate limits.
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  // Each worker takes the next unclaimed index until none are left. JS is single-threaded, so `next++` is safe.
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
