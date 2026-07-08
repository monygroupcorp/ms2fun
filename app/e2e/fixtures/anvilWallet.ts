/**
 * Injected-wallet fixture for write-path E2E against the local anvil fork.
 *
 * The app talks to wallets via wagmi's `injected()` connector, which reads `window.ethereum`. This
 * fixture injects a minimal EIP-1193 provider that:
 *   - reports a single account (anvil's default account #0 by default, or any parameterized account —
 *     see `adminTest` below);
 *   - proxies every other RPC method to anvil via a Node-side `exposeFunction` bridge, which avoids
 *     browser CORS entirely (the request leaves from Node, not the page origin).
 *
 * An account OTHER than an anvil default key isn't unlocked on the fork, so anvil can't sign its
 * `eth_sendTransaction` on its own — the Node-side setup below calls `anvil_impersonateAccount` on the
 * account before the test body runs (released via `anvil_stopImpersonatingAccount` in teardown), which
 * makes anvil sign for it without a real private key (precedent: `deploy.ts` + `target-requests.spec`
 * already impersonate ADMIN contract-side via viem; this does the same so the account can ALSO sign
 * through the injected browser wallet, driving admin actions through the real UI instead of raw viem).
 *
 * Use the exported `test`/`expect` from this module instead of '@playwright/test' in write-path specs.
 */
import { test as base, expect } from '@playwright/test'
import { createTestClient, http, type Address } from 'viem'

/** anvil default account #0 — funded with 10000 ETH and unlocked on the fork. */
export const TEST_ACCOUNT = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const
/** The platform testing wallet (ADMIN) — owns the handed-over registries + every seeded instance
 *  (SeedAnvil.s.sol `_transferAdmin`). Not an anvil default key, so driving it through the injected
 *  browser wallet needs impersonation (see `adminTest`). */
export const ADMIN = '0x54EfD4549AE44bD03B2cCC1C72492CA9A3219C86' as const
export const ANVIL_RPC = 'http://127.0.0.1:8545'

const forkChain = {
  id: 1337,
  name: 'anvil-fork',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [ANVIL_RPC] } },
} as const

const anvilTestClient = createTestClient({
  mode: 'anvil',
  chain: forkChain,
  transport: http(ANVIL_RPC),
})

/** Build a Playwright `test` whose injected wallet reports `account`. Impersonates on the anvil fork
 *  (setup) / releases (teardown) whenever `account` isn't the already-unlocked anvil default (#0). */
function makeWalletTest(account: Address) {
  const needsImpersonation = account.toLowerCase() !== TEST_ACCOUNT.toLowerCase()

  return base.extend({
    // `runTest` is Playwright's fixture-use callback (renamed from the conventional `use` so the
    // react-hooks lint rule doesn't mistake it for React's `use` hook).
    page: async ({ page }, runTest) => {
      if (needsImpersonation) await anvilTestClient.impersonateAccount({ address: account })

      try {
        // Node-side RPC bridge — no browser CORS because the fetch originates in Node.
        await page.exposeFunction('__anvilRpc', async (body: string): Promise<string> => {
          const resp = await fetch(ANVIL_RPC, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
          })
          return resp.text()
        })

        await page.addInitScript((account: string) => {
          let nextId = 1
          const listeners: Record<string, Array<(...a: unknown[]) => void>> = {}
          async function rpc(method: string, params: unknown[]): Promise<unknown> {
            if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [account]
            if (method === 'wallet_requestPermissions')
              return [{ parentCapability: 'eth_accounts', caveats: [] }]
            if (
              method === 'wallet_switchEthereumChain' ||
              method === 'wallet_addEthereumChain' ||
              method === 'wallet_watchAsset'
            )
              return null
            const w = window as unknown as { __anvilRpc: (b: string) => Promise<string> }
            const raw = await w.__anvilRpc(
              JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
            )
            const json = JSON.parse(raw) as {
              result?: unknown
              error?: { message: string; code: number }
            }
            if (json.error) {
              const e = new Error(json.error.message) as Error & { code: number }
              e.code = json.error.code
              throw e
            }
            return json.result
          }
          const provider = {
            isMetaMask: true,
            request: ({ method, params }: { method: string; params?: unknown[] }) =>
              rpc(method, params ?? []),
            on(event: string, cb: (...a: unknown[]) => void) {
              ;(listeners[event] ||= []).push(cb)
            },
            removeListener(event: string, cb: (...a: unknown[]) => void) {
              listeners[event] = (listeners[event] ?? []).filter((f) => f !== cb)
            },
          }
          ;(window as unknown as { ethereum: unknown }).ethereum = provider
        }, account)

        await runTest(page)
      } finally {
        if (needsImpersonation) await anvilTestClient.stopImpersonatingAccount({ address: account })
      }
    },
  })
}

/** Injected wallet = anvil #0 (permissionless write paths). */
export const test = makeWalletTest(TEST_ACCOUNT)
/** Injected wallet = ADMIN, via anvil impersonation (owner-gated write paths). */
export const adminTest = makeWalletTest(ADMIN)

export { expect }

/** Click CONNECT WALLET, then the (single) injected connector in the modal; wait until connected.
 *  Mobile-aware: at ≤1024px the top-bar nav (incl. the wallet) is hidden behind the MENU overlay, so
 *  open it first. */
export async function connectWallet(page: import('@playwright/test').Page): Promise<void> {
  const menuButton = page.getByRole('button', { name: 'open menu' })
  if (await menuButton.isVisible().catch(() => false)) await menuButton.click()
  await page.getByRole('button', { name: 'CONNECT WALLET' }).first().click()
  // The modal lists the generic injected connector; click the first connector button.
  await page.locator('ul li button').first().click()
  // Connected = the wallet UI swaps CONNECT WALLET for the disconnect (⏏) control.
  await expect(page.getByRole('button', { name: 'disconnect wallet' }).first()).toBeVisible({
    timeout: 15_000,
  })
}
