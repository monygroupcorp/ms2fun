import { createConfig, http } from 'wagmi'
import { anvil, mainnet } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'

/**
 * Two chains: mainnet (production) and the local anvil mainnet-fork (dev, localhost:8545).
 *
 * Wallet: injected/EIP-6963 only. `multiInjectedProviderDiscovery` (default true) makes wagmi
 * discover all injected wallets via EIP-6963 — we render a brutalist UI on top of these headless
 * connectors and never custody keys (see docs/decisions/0001-web3-stack.md).
 *
 * NOTE: assumes the fork runs with anvil's default chain id (31337). If the local-chain scripts
 * set a different id, align it here when wiring the fork bridge (Phase 0 T3 / Phase 1).
 */
export const config = createConfig({
  chains: [mainnet, anvil],
  connectors: [injected()],
  multiInjectedProviderDiscovery: true,
  transports: {
    [mainnet.id]: http(),
    [anvil.id]: http('http://localhost:8545'),
  },
})

declare module 'wagmi' {
  interface Register {
    config: typeof config
  }
}
