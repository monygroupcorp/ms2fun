import { defineChain } from 'viem'
import { createConfig, http } from 'wagmi'
import { mainnet, sepolia } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'
import { sepoliaForkEnabled } from './addresses'
import { decentralizedTransport } from './rpc'

/**
 * The local anvil mainnet-fork. Chain id is 1337 (from the local-chain deploy bridge,
 * `contracts/.../contracts.local.json`), NOT anvil's default 31337.
 */
// The chain's DECLARED rpc — this is what a WALLET is told to add/switch to
// (`WrongNetworkBanner`'s manual fallback, `wallet_addEthereumChain`), so it stays the absolute
// loopback URL: the wallet is a separate app on the user's machine, not the page, so it is bound
// by neither the page's CSP nor Chrome's Local Network Access gate and cannot reach anvil through
// the dev-server's same-origin proxy. Host-aware for Tailscale (walking the app from another
// machine): on localhost that's localhost:8545, off it, that machine's own hostname:8545 — the
// wallet runs alongside the browser, so it resolves the same host the page did. Falls back to
// localhost for SSR/no-window.
const ANVIL_RPC =
  typeof window !== 'undefined' && window.location.hostname !== 'localhost'
    ? `http://${window.location.hostname}:8545`
    : 'http://localhost:8545'

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

export const anvilFork = defineChain({
  id: 1337,
  name: 'Anvil Fork',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [ANVIL_RPC] } },
  // The mainnet fork carries Multicall3 at its canonical mainnet address. WITHOUT declaring it,
  // viem's `client.multicall` throws ChainDoesNotSupportContract — which broke every multicall
  // reader (the ERC721 auction surface, the NFT galleries). Single-contract reads were unaffected.
  contracts: {
    multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' },
  },
  testnet: true,
})

/**
 * Three chains: mainnet, Sepolia (the showcase testnet), and the local anvil mainnet-fork (dev).
 * Which one a build actually talks to is `activeChainId` in ./addresses — this list is what the app
 * knows how to reach at all, and it must cover every id `addressesByChain` carries or a route-scoped
 * read on that chain has no transport.
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
  chains: [mainnet, sepolia, anvilFork],
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

declare module 'wagmi' {
  interface Register {
    config: typeof config
  }
}
