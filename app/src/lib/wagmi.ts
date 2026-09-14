import { createConfig, http } from 'wagmi'
import { mainnet, sepolia } from 'wagmi/chains'
import { SUPPORTED_CHAINS, anvilFork } from './chains'
import { injected } from 'wagmi/connectors'
import { sepoliaForkEnabled } from './addresses'
import { decentralizedTransport } from './rpc'

// The APP's own read transport for the mainnet-fork channel — same-origin, proxied server-side to
// anvil by `vite.config.ts`'s `devChainProxy`. Same-origin is covered by the page's
// `connect-src 'self'` CSP and exempt from the LNA gate that a plain loopback fetch now trips; it
// also keeps working when the app is opened from another machine, since the proxy target is
// resolved on the dev server rather than the browser. viem's `http()` builds requests off
// `location` for a relative URL, so no origin needs constructing here.
const ANVIL_RPC_PROXY = '/__rpc/mainnet'

/**
 * The Sepolia-fork dev channel's endpoint (`app/scripts/dev-chain/SEPOLIA-CHANNEL.md`) — a second
 * anvil on :8546, forking Sepolia and keeping chain id 11155111. Same same-origin-proxy rule as
 * the mainnet channel's app transport above: this is the APP's read path, not a wallet-facing
 * chain rpcUrls entry (the `sepolia` chain here is `wagmi/chains`' standard export, untouched), so
 * it can be the proxy path outright. The wallet's own custom-network entry for this channel is the
 * absolute `http://localhost:8546`, documented in `scripts/dev-chain/SEPOLIA-CHANNEL.md`.
 */
const SEPOLIA_FORK_RPC = '/__rpc/sepolia'

/**
 * The chain list itself is `SUPPORTED_CHAINS` in ./chains; this module adds the wallet and
 * transport layer over it.
 *
 * Wallet: injected/EIP-6963 only. `multiInjectedProviderDiscovery: true` makes wagmi discover all
 * injected wallets via EIP-6963 — each gets its own connector (id = rdns, e.g. 'io.ambire.wallet').
 * The explicit `injected()` adds a generic connector (id 'injected') as a fallback for wallets that
 * don't announce via EIP-6963.  WalletModal.dedupeConnectors() hides the generic one whenever any
 * EIP-6963 connector is present, preventing duplicates.  See docs/decisions/0001-web3-stack.md.
 */
/**
 * Read-path performance (ADR-0010, Tier 0) — this is a serverless, static, IPFS-hosted client, so the
 * chain IS the backend and every read must be cheap on a public RPC:
 *  - `batch: { multicall: true }` — viem coalesces independent `readContract`s across hooks into ONE
 *    Multicall3 call per tick (our Multicall3 address is declared on the chain above). A page that
 *    fires ~10 singleton reads becomes 1 call.
 *  - `http(url, { batch: true })` — JSON-RPC batching folds whatever isn't multicall-able (plus the
 *    multicall itself) into a single HTTP POST instead of N round-trips.
 * RPC stays fully decentralized (no keyed endpoints, ADR-0010): a real network uses
 * `decentralizedTransport` — the connected wallet's node preferred, then a health-ranked pool of
 * key-less public endpoints, all batched. The local anvil fork keeps its single same-origin-proxied
 * transport (`ANVIL_RPC_PROXY` above).
 */
export const config = createConfig({
  chains: SUPPORTED_CHAINS,
  connectors: [injected()],
  multiInjectedProviderDiscovery: true,
  batch: { multicall: true },
  transports: {
    [mainnet.id]: decentralizedTransport(mainnet.id) ?? http(undefined, { batch: true }),
    // The Sepolia-fork dev channel, when it is selected, is a local anvil rather than a network —
    // so it takes the fork's single localhost transport, exactly as the mainnet channel does, and
    // the health-ranked public pool is not consulted for it. Unset (every ordinary build) this is
    // the unchanged `decentralizedTransport` line.
    [sepolia.id]: sepoliaForkEnabled
      ? http(SEPOLIA_FORK_RPC, { batch: true })
      : (decentralizedTransport(sepolia.id) ?? http(undefined, { batch: true })),
    [anvilFork.id]: http(ANVIL_RPC_PROXY, { batch: true }),
  },
})

export { anvilFork } from './chains'

declare module 'wagmi' {
  interface Register {
    config: typeof config
  }
}
