import { describe, expect, it } from 'vitest'
import { SUPPORTED_CHAINS, anvilFork, anvilRpcFor } from './chains'

// The chain's declared rpc is what a WALLET is handed (`wallet_addEthereumChain`,
// `WrongNetworkBanner`'s manual fallback). The wallet cannot use the dev server's same-origin
// proxy, so this URL is the one place the dev channel's port has to be absolute in the page — and
// it has to be the port the fork was actually started on, or the added network points at nothing.
describe('anvilRpcFor', () => {
  it('names localhost when the page is on localhost', () => {
    expect(anvilRpcFor('localhost', 8545)).toBe('http://localhost:8545')
  })

  it('follows the overridden port, so ANVIL_PORT=8546 adds a network on 8546', () => {
    expect(anvilRpcFor('localhost', 8546)).toBe('http://localhost:8546')
    expect(anvilRpcFor('localhost', 8600)).toBe('http://localhost:8600')
  })

  // Walking the app from another machine over Tailscale: the wallet runs beside the browser, so it
  // resolves the same host the page did — not the dev server's own loopback.
  it('keeps the page host off localhost, at the same port', () => {
    expect(anvilRpcFor('workstation.tail1234.ts.net', 8600)).toBe(
      'http://workstation.tail1234.ts.net:8600',
    )
  })

  it('falls back to localhost with no hostname (SSR/no-window)', () => {
    expect(anvilRpcFor(undefined, 8545)).toBe('http://localhost:8545')
    expect(anvilRpcFor('', 8545)).toBe('http://localhost:8545')
  })

  // Unset ANVIL_PORT is the historical :8545 loop, which is what the test run itself builds with.
  it('defaults to the port vite inlined, which is 8545 with ANVIL_PORT unset', () => {
    expect(anvilRpcFor('localhost')).toBe('http://localhost:8545')
  })
})

describe('anvilFork', () => {
  it('declares its rpc at the resolved port', () => {
    expect(anvilFork.rpcUrls.default.http[0]).toBe(anvilRpcFor(window.location.hostname))
  })

  it('is one of the supported chains', () => {
    expect(SUPPORTED_CHAINS.map((chain) => chain.id)).toContain(anvilFork.id)
  })
})
