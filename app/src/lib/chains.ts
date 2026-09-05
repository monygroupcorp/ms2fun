import { defineChain } from 'viem'
import { mainnet, sepolia } from 'wagmi/chains'

/**
 * The chains this app knows how to talk to, as plain data.
 *
 * Split out of `./wagmi` so that reading a chain's NAME does not require building a wagmi config:
 * importing `./wagmi` runs `createConfig`, which pulls in connectors and transports, and a module
 * that only wants to print "Sepolia" should not drag that in (page tests that mock `wagmi` have no
 * `createConfig` to run). `./wagmi` still owns the config; this file owns the chain list.
 */

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
 */
export const SUPPORTED_CHAINS = [mainnet, sepolia, anvilFork] as const
