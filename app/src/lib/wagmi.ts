import { defineChain } from 'viem'
import { createConfig, http } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'
import { decentralizedTransport } from './rpc'

/**
 * The local anvil mainnet-fork. Chain id is 1337 (from the local-chain deploy bridge,
 * `contracts/.../contracts.local.json`), NOT anvil's default 31337.
 */
export const anvilFork = defineChain({
  id: 1337,
  name: 'Anvil Fork',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://localhost:8545'] } },
  // The mainnet fork carries Multicall3 at its canonical mainnet address. WITHOUT declaring it,
  // viem's `client.multicall` throws ChainDoesNotSupportContract — which broke every multicall
  // reader (the ERC721 auction surface, the NFT galleries). Single-contract reads were unaffected.
  contracts: {
    multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' },
  },
  testnet: true,
})

/**
 * Two chains: mainnet (production) and the local anvil mainnet-fork (dev).
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
 * key-less public endpoints, all batched. The local anvil fork keeps its single localhost transport.
 */
export const config = createConfig({
  chains: [mainnet, anvilFork],
  connectors: [injected()],
  multiInjectedProviderDiscovery: true,
  batch: { multicall: true },
  transports: {
    [mainnet.id]: decentralizedTransport(mainnet.id) ?? http(undefined, { batch: true }),
    [anvilFork.id]: http(undefined, { batch: true }),
  },
})

declare module 'wagmi' {
  interface Register {
    config: typeof config
  }
}
