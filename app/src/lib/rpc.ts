/**
 * Decentralized read transport (ADR-0010, RPC decision) — for a serverless/static/IPFS client that
 * must never ship an API key. Reads try the connected wallet's own node FIRST (max decentralization,
 * the user's chosen RPC), then fall through to a health-ranked pool of public, key-less endpoints
 * (viem `rank: true` auto-demotes slow/down ones — e.g. llamarpc 521s happen). Every http endpoint
 * batches (JSON-RPC batching).
 *
 * NO keyed / referrer-restricted endpoints (Alchemy/Infura/dRPC keys) — rejected on centralization
 * grounds. If the wallet-first hop ever proves slow for a given wallet, drop the `unstable_connector`
 * line and it becomes pure ranked-public.
 *
 * Extend PUBLIC_RPCS with each further deploy target's chain; the local anvil fork keeps a single
 * localhost transport (no fallback to make).
 *
 * HOW AN ENTRY EARNS ITS PLACE, and why this list is checked rather than remembered. These URLs
 * are inlined into a pinned bundle that cannot be edited, and a dead entry is not free: viem's
 * `rank: true` re-probes every endpoint on a timer and each call burns its retries on the corpses
 * before reaching a live one, which is how a pool with one healthy member gets that member
 * rate-limited. Measured 2026-09-29 against the deployed site, three of the four Sepolia entries
 * were dead — `rpc.sepolia.org` 404 with no CORS headers at all, `sepolia.drpc.org` 400 "chain is
 * not available on free plan", `1rpc.io/sepolia` HTTP 200 carrying a JSON-RPC "usage limit"
 * error — and the survivor answered 403 under the retry storm. `eth.llamarpc.com` was the same
 * story on mainnet: 525, and the comment above this one already said its 521s happen.
 *
 * So an entry is checked three ways before it is listed, because two of those failures pass a
 * check that only looks at one of them:
 *
 *   1. a CORS preflight from the published origin returns `access-control-allow-origin`
 *   2. a BATCHED POST (what `batch: true` actually sends) returns 200
 *   3. the BODY carries a result and not a JSON-RPC error — `1rpc.io` returned 200 while every
 *      call inside it failed, which is the shape a health ranker scores as perfectly healthy
 *
 * `pnpm rpc:check` runs all three against this list and exits non-zero on any entry that fails.
 */
import { fallback, http, unstable_connector, type Transport } from 'wagmi'
import { injected } from 'wagmi/connectors'

/** Public, key-less RPC pools per chain id. */
const PUBLIC_RPCS: Record<number, string[]> = {
  // Ethereum mainnet (chain 1).
  1: [
    'https://ethereum-rpc.publicnode.com',
    'https://eth.drpc.org',
    'https://mainnet.gateway.tenderly.co',
    'https://0xrpc.io/eth',
  ],
  // Sepolia (chain 11155111) — the showcase testnet. Same discipline as the mainnet pool: public,
  // key-less, multi-provider, health-ranked. Testnet endpoints rate-limit harder than mainnet ones,
  // which is what the ranked fallback is for.
  11155111: [
    'https://ethereum-sepolia-rpc.publicnode.com',
    'https://sepolia.gateway.tenderly.co',
    'https://0xrpc.io/sep',
    'https://sepolia.rpc.thirdweb.com',
  ],
}

/**
 * Wallet-preferred → health-ranked public fallback, all batched. Returns undefined when we have no
 * public pool for the chain (caller keeps its own transport — e.g. the localhost anvil fork).
 */
export function decentralizedTransport(chainId: number): Transport | undefined {
  const urls = PUBLIC_RPCS[chainId]
  if (!urls || urls.length === 0) return undefined
  const publicPool = fallback(
    urls.map((u) => http(u, { batch: true })),
    {
      rank: {
        // viem's default ping is `net_listening`, and it is the wrong question twice over. It asks
        // whether a node has peers, not whether this endpoint will answer THIS app, and several
        // public endpoints do not implement it at all — `0xrpc.io` replies -32601 "unsupported
        // method" while serving every eth_call we make. viem reads that refusal as a failed sample,
        // scores the endpoint 0 for stability and ranks it last forever. `eth_blockNumber` is
        // universally implemented, and a wrong or stale answer to it is a real reason to demote.
        ping: ({ transport }) => transport.request({ method: 'eth_blockNumber' }),
        // The default is the client's 4s polling interval, which pings EVERY endpoint in the pool
        // every 4 seconds, unbatched, for as long as the tab is open — measured 2026-09-29 at ~2
        // requests/second across the two pools with the page idle and nothing reading. That is
        // 7,200 requests an hour spent on ranking, which is how a free endpoint decides we are
        // abusive and starts answering 403. Ranking exists to notice an endpoint going bad; 30s
        // notices that perfectly well at an eighth of the cost.
        interval: 30_000,
      },
    },
  )
  // Wallet first (preferred, when connected); else the ranked public pool.
  return fallback([unstable_connector(injected), publicPool])
}
