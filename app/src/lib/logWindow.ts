/**
 * Blocks per `eth_getLogs` window, per chain. Every log scan in the app walks history in windows of
 * this width, so it has to fit inside the range cap of every public endpoint that serves it.
 *
 * Mainnet's public endpoints refuse wider ranges than Sepolia's: an address-filtered `eth_getLogs`
 * over more than 10,000 blocks is refused by publicnode (HTTP 403, "archive requests require a
 * personal token") and by 0xrpc (-32601), while the same endpoints serve it at 10,000. Sepolia's
 * pool serves 50,000 everywhere except one entry, which `rpc.ts` keeps off log scans instead.
 *
 * `pnpm rpc:check` measures each pool entry at these widths, so a provider that narrows its cap
 * shows up there rather than as a page that cannot load its history.
 *
 * No imports: `scripts/check-rpcs.ts` reads this module outside the app's build environment.
 */
export const MAINNET_LOG_WINDOW = 10_000n

export const TESTNET_LOG_WINDOW = 50_000n

export function logWindowForChain(chainId: number): bigint {
  return chainId === 1 ? MAINNET_LOG_WINDOW : TESTNET_LOG_WINDOW
}
