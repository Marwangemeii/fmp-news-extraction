/**
 * A concurrency limiter: at most `max` tasks run at once, the rest wait in line (first come, first served).
 * Used for LLM calls (D51): one limiter is shared by every publisher, so running publishers in parallel
 * never multiplies the number of calls in flight (new API accounts have low rate limits).
 *
 * @param {number} max
 * @returns {<R>(task: () => Promise<R>) => Promise<R>} `limit(task)` runs `task` when a slot is free
 *
 * @example
 * const limit = createLimiter(4);
 * const results = await Promise.all(items.map((x) => limit(() => work(x)))); // ≤ 4 at once, order kept
 */
export function createLimiter(max) {
  let running = 0;
  const waiting = []; // resolve functions of tasks waiting for a slot

  return async function limit(task) {
    if (running >= max) await new Promise((resolve) => waiting.push(resolve));
    running++;
    try {
      return await task();
    } finally {
      running--;
      waiting.shift()?.(); // hand the freed slot to the next task in line
    }
  };
}
