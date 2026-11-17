/**
 * Reverse-windowed log scanning (ADR-0010 Tier 1B).
 *
 * A serverless client reads event history straight from the chain. Two rules make that viable on a
 * public RPC:
 *   1. FLOOR at the deploy block, never `0n` — see `deployBlock` / `EXEC404_DEPLOY_BLOCK`.
 *   2. Scan BACKWARD from `latest` in fixed windows, newest-first: `getLogs(latest−W, latest)`, then
 *      `latest−2W…`, down to the floor. Within a window the provider returns logs ascending by
 *      `(block, logIndex)`; walking windows newest-first gives recent activity first, lets feeds
 *      early-stop (`maxWindows`) before reaching the floor, and keeps every request within the
 *      provider's `eth_getLogs` range cap (pick `W ≤` the cap).
 *
 * `reverseWindows` is pure (tested); `scanBackward` drives it over a caller-supplied per-window fetch
 * so it stays generic over event type / abi.
 */
import { activeChainId } from './addresses'
import { logWindowForChain } from './logWindow'

/** Default window width (blocks per `getLogs`) on the chain this build talks to: `≤` every pool
 *  endpoint's `eth_getLogs` range cap there (`logWindowForChain`). */
export const DEFAULT_LOG_WINDOW = logWindowForChain(activeChainId)

export interface BlockWindow {
  fromBlock: bigint
  toBlock: bigint
}

/**
 * Inclusive `[floor..latest]` split into newest-first windows of width `≤ size`. Empty when the range
 * is empty (`latest < floor`). Floor is clamped to `>= 0`.
 */
export function reverseWindows(latest: bigint, floor: bigint, size: bigint): BlockWindow[] {
  if (size <= 0n) throw new Error('window size must be > 0')
  const lo = floor < 0n ? 0n : floor
  if (latest < lo) return []

  const windows: BlockWindow[] = []
  let to = latest
  while (true) {
    const from = to - size + 1n > lo ? to - size + 1n : lo
    windows.push({ fromBlock: from, toBlock: to })
    if (from === lo) break
    to = from - 1n
  }
  return windows
}

/**
 * Walk `[floor..latest]` newest-first, calling `fetchWindow(from, to)` per window and concatenating.
 * Stops after `maxWindows` windows if given (feed early-stop), or after the first window that
 * returns anything when `untilFound` is set (a lookup for one log). Results are in window order
 * (newest window first); callers that need strict global order should sort by their own key.
 */
export async function scanBackward<T>(
  fetchWindow: (fromBlock: bigint, toBlock: bigint) => Promise<T[]>,
  opts: {
    latest: bigint
    floor: bigint
    window?: bigint
    maxWindows?: number
    untilFound?: boolean
  },
): Promise<T[]> {
  const windows = reverseWindows(opts.latest, opts.floor, opts.window ?? DEFAULT_LOG_WINDOW)
  const out: T[] = []
  let count = 0
  for (const w of windows) {
    const logs = await fetchWindow(w.fromBlock, w.toBlock)
    out.push(...logs)
    count += 1
    if (opts.maxWindows !== undefined && count >= opts.maxWindows) break
    if (opts.untilFound && out.length > 0) break
  }
  return out
}
