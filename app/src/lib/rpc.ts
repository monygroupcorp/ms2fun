/**
 * Decentralized read transport (ADR-0010, RPC decision) — for a serverless/static/IPFS client that
 * must never ship an API key. Reads try the connected wallet's own node FIRST (max decentralization,
 * the user's chosen RPC), then fall through to a health-ranked pool of public, key-less endpoints
 * (viem `rank: true` auto-demotes slow/down ones — e.g. llamarpc 521s happen). Every http endpoint
 * batches (JSON-RPC batching).
 *
 * NO keyed / referrer-restricted endpoints (Alchemy/Infura/dRPC keys) — rejected on centralization
 * grounds. The wallet-first hop is bounded by WALLET_HOP_TIMEOUT_MS so a wallet that never answers
 * falls through to the public pool; to drop the hop entirely, remove the `connectedWallet()` line
 * and it becomes pure ranked-public.
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
import { fallback, http, type Transport } from 'wagmi'
import {
  createTransport,
  ProviderDisconnectedError,
  TimeoutError,
  type EIP1193RequestFn,
  type HttpTransportConfig,
} from 'viem'

/**
 * How long the connected wallet's own node gets to answer one read before the call falls through
 * to the public pool. A wallet that is locked, mid-prompt or simply wedged never rejects, and
 * viem's `fallback` only moves on when a transport throws, so without a bound one silent wallet
 * leaves every page that reads chain state loading forever. Long enough for a healthy wallet
 * node on a slow link, short enough that the public pool answers before a visitor gives up.
 */
export const WALLET_HOP_TIMEOUT_MS = 3_500

/** Make `transport`'s requests throw a `TimeoutError` when they take longer than `ms`. */
export function withRequestTimeout(transport: Transport, ms: number): Transport {
  return (params) => {
    const inner = transport(params)
    return {
      ...inner,
      request: ((args: Parameters<typeof inner.request>[0]) => {
        let timer: ReturnType<typeof setTimeout> | undefined
        const deadline = new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new TimeoutError({
                  body: args as unknown as Record<string, unknown>,
                  url: 'injected-wallet',
                }),
              ),
            ms,
          )
        })
        return Promise.race([inner.request(args), deadline]).finally(() => clearTimeout(timer))
      }) as typeof inner.request,
    }
  }
}

/**
 * The methods the wallet hop carries: reads that should see the connected user's own view of the
 * chain (`eth_call`, gas estimation) and anything that writes. Never `eth_getLogs` or the block
 * reads a log scan makes. A wallet's node is the user's, sized for one person signing; it is not a
 * pool for history walks, and a wallet that rate-limits them fails the user's next signature too.
 */
export const WALLET_METHODS = [
  'eth_call',
  'eth_estimateGas',
  'eth_sendTransaction',
  'eth_sendRawTransaction',
] as const

/** What the hop needs to know about the wallet the visitor has actually connected. */
export interface WalletConnection {
  chainId: number
  connector: { getProvider(parameters?: { chainId?: number | undefined }): Promise<unknown> }
}

let readConnection: () => WalletConnection | undefined = () => undefined

/**
 * Tell the wallet hop how to find the current connection. Called once by `wagmi.ts` after
 * `createConfig`, because the transports are built before the config that tracks connections
 * exists. Until it is called the hop reports no connection, so every read goes to the public pool.
 */
export function bindWalletConnection(read: () => WalletConnection | undefined): void {
  readConnection = read
}

/**
 * The connected wallet's own node, for `WALLET_METHODS` only, and only while a wallet is connected
 * on the request's chain.
 *
 * wagmi's `unstable_connector(injected)` resolves the injected provider whether or not the site is
 * connected, so a visitor who had merely installed a wallet sent every read, log scans included,
 * through it, each one preceded by an `eth_chainId`. This reads the connection wagmi already tracks
 * instead: no connection, or one on another chain, throws before any wallet request is made, and
 * viem's `fallback` moves straight to the pool. Using the connection's own connector also sends the
 * reads to the wallet the visitor chose, not to whichever extension owns `window.ethereum`.
 */
export function connectedWallet(): Transport {
  return ({ chain, retryCount }) => {
    const request: EIP1193RequestFn = async ({ method, params }) => {
      const connection = readConnection()
      if (!connection || (chain && connection.chainId !== chain.id)) {
        throw new ProviderDisconnectedError(new Error('No wallet connected on this chain.'))
      }
      const provider = (await connection.connector.getProvider({ chainId: chain?.id })) as
        | { request: EIP1193RequestFn }
        | undefined
      if (!provider) throw new ProviderDisconnectedError(new Error('Provider is disconnected.'))
      return provider.request({ method, params } as Parameters<EIP1193RequestFn>[0])
    }
    return createTransport({
      key: 'wallet',
      name: 'Connected wallet',
      methods: { include: [...WALLET_METHODS] },
      request,
      retryCount,
      type: 'wallet',
    })
  }
}

/**
 * Build `transport` once per chain and hand every later caller that same instance.
 *
 * viem's `fallback` calls each inner transport's factory on every request, and once more per
 * remaining transport when it checks which of them accept the method. A ranked `fallback` starts a
 * new ranking loop each time its factory runs, and that loop never stops. Nested inside another
 * `fallback`, the ranked pool therefore gained a perpetual pinger per request that fell past the
 * wallet, and each new loop started in list order, so ranking never reached real traffic either.
 * One instance per chain means one ranking loop, and requests see its ranking.
 */
export function oncePerChain(transport: Transport): Transport {
  const built = new Map<number | undefined, ReturnType<Transport>>()
  return (parameters) => {
    const key = parameters.chain?.id
    let instance = built.get(key)
    if (!instance) {
      instance = transport(parameters)
      built.set(key, instance)
    }
    return instance
  }
}

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
  ],
}

/**
 * Pool entries that refuse an `eth_getLogs` as wide as the app's window on their chain
 * (`logWindowForChain` in `logScan.ts`). They stay in the pool for everything else; a log scan
 * skips them rather than spending a request on a refusal per window. `pnpm rpc:check` measures each
 * entry at the app's window and reads this list, so an entry that starts refusing shows up there.
 *
 * `exclude`, not `include`: the ranker pings with `eth_blockNumber`, and an include list without it
 * would fail every ping and rank the entry last for good.
 */
const NARROW_LOG_RANGE: string[] = ['https://0xrpc.io/sep']

function poolEntry(url: string): Transport {
  const config: HttpTransportConfig = { batch: true }
  if (NARROW_LOG_RANGE.includes(url)) config.methods = { exclude: ['eth_getLogs'] }
  return http(url, config)
}

/**
 * Wallet-preferred → health-ranked public fallback, all batched. Returns undefined when we have no
 * public pool for the chain (caller keeps its own transport — e.g. the localhost anvil fork).
 */
export function decentralizedTransport(chainId: number): Transport | undefined {
  const urls = PUBLIC_RPCS[chainId]
  if (!urls || urls.length === 0) return undefined
  const publicPool = fallback(urls.map(poolEntry), {
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
  })
  // The connected wallet first, for the methods it carries, bounded so a silent wallet cannot
  // stall reads; else the ranked public pool, built once (`oncePerChain`).
  return fallback([
    withRequestTimeout(connectedWallet(), WALLET_HOP_TIMEOUT_MS),
    oncePerChain(publicPool),
  ])
}
