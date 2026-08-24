/**
 * Bounded-concurrency map for metadata resolution.
 *
 * Every gallery tile costs one metadata fetch, and those fetches go to public IPFS gateways that
 * meter by client IP. Resolving a window of tiles with `Promise.all` opens one connection per tile
 * at once: the browser queues them, the gateway sees a burst from a single address, and the whole
 * window resolves at the speed of the slowest request in the burst. A collection in the thousands
 * turns that into a request storm.
 *
 * This runs a fixed number of workers over the list instead, so the number of requests IN FLIGHT is
 * capped no matter how long the list is. Results come back in input order.
 *
 * Pure TS (no React), same as the rest of `lib/metadata`.
 */

/**
 * How many metadata resolutions may be in flight at once. Six is chosen against the browser's own
 * per-host connection limit (six for HTTP/1.1) — above it requests only queue in the socket pool,
 * so a larger number buys no parallelism and only lengthens the burst the gateway sees.
 */
export const METADATA_CONCURRENCY = 6

/**
 * Map `items` through `fn`, keeping at most `limit` calls in flight. Results are in input order.
 * A rejection propagates (callers that want soft-fail tiles should catch inside `fn`).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  if (items.length === 0) return results

  const workers = Math.max(1, Math.min(Math.floor(limit) || 1, items.length))
  let cursor = 0

  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await fn(items[index] as T, index)
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()))
  return results
}
