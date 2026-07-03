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
 * Extend PUBLIC_RPCS with the deploy target's chain (testnet/mainnet) when we cut a real deploy; the
 * local anvil fork keeps a single localhost transport (no fallback to make).
 */
import { fallback, http, unstable_connector, type Transport } from 'wagmi'
import { injected } from 'wagmi/connectors'

/** Public, key-less RPC pools per chain id. */
const PUBLIC_RPCS: Record<number, string[]> = {
  // Ethereum mainnet (chain 1).
  1: [
    'https://ethereum-rpc.publicnode.com',
    'https://eth.drpc.org',
    'https://rpc.ankr.com/eth',
    'https://cloudflare-eth.com',
    'https://eth.llamarpc.com',
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
    { rank: true },
  )
  // Wallet first (preferred, when connected); else the ranked public pool.
  return fallback([unstable_connector(injected), publicPool])
}
