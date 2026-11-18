/**
 * Blocks per `eth_getLogs` window, per chain. Every log scan in the app walks history in windows of
 * this width, so it has to fit inside the range cap of every public endpoint that serves it.
 *
 * Mainnet's public endpoints refuse wider ranges than Sepolia's: an address-filtered `eth_getLogs`
 * over more than 10,000 blocks is refused by publicnode (HTTP 403, "archive requests require a
 * personal token") and by 0xrpc (-32601), while the same endpoints serve it at 10,000. Sepolia's
 * pool serves 50,000. An entry whose cap is narrower than its chain's window here (0xrpc on Sepolia,
 * drpc on mainnet) is kept off log scans by `rpc.ts` rather than narrowing every scan for it.
 *
 * `pnpm rpc:check` measures each pool entry at these widths, so a provider that narrows its cap
 * shows up there rather than as a page that cannot load its history.
 *
 * No imports: `scripts/check-rpcs.ts` reads this module outside the app's build environment.
 */
export const MAINNET_LOG_WINDOW = 10_000n

export const TESTNET_LOG_WINDOW = 50_000n

/**
 * The width a scan falls back to when a window at the chain's width is refused. Every endpoint a
 * log scan can reach serves it, including the last-resort entries in `rpc.ts` whose cap is
 * narrower than their chain's window (0xrpc on Sepolia), so a scan whose wide path is down still
 * loads, in more requests.
 */
export const FALLBACK_LOG_WINDOW = 10_000n

export function logWindowForChain(chainId: number): bigint {
  return chainId === 1 ? MAINNET_LOG_WINDOW : TESTNET_LOG_WINDOW
}
