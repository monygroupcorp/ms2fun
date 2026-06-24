import { defineChain } from 'viem'
import { createConfig, http } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'

/**
 * The local anvil mainnet-fork. Chain id is 1337 (from the local-chain deploy bridge,
 * `contracts/.../contracts.local.json`), NOT anvil's default 31337.
 */
export const anvilFork = defineChain({
  id: 1337,
  name: 'Anvil Fork',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://localhost:8545'] } },
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
export const config = createConfig({
  chains: [mainnet, anvilFork],
  connectors: [injected()],
  multiInjectedProviderDiscovery: true,
  transports: {
    [mainnet.id]: http(),
    [anvilFork.id]: http(),
  },
})

declare module 'wagmi' {
  interface Register {
    config: typeof config
  }
}
