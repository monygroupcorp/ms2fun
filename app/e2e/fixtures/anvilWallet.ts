/**
 * Injected-wallet fixture for write-path E2E against the local anvil fork.
 *
 * The app talks to wallets via wagmi's `injected()` connector, which reads `window.ethereum`. This
 * fixture injects a minimal EIP-1193 provider that:
 *   - reports a single account: anvil's default account #0 (UNLOCKED on the fork, so anvil signs
 *     `eth_sendTransaction` itself — no in-browser key handling needed);
 *   - proxies every other RPC method to anvil via a Node-side `exposeFunction` bridge, which avoids
 *     browser CORS entirely (the request leaves from Node, not the page origin).
 *
 * Use the exported `test`/`expect` from this module instead of '@playwright/test' in write-path specs.
 */
import { test as base, expect } from '@playwright/test'

/** anvil default account #0 — funded with 10000 ETH and unlocked on the fork. */
export const TEST_ACCOUNT = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const
export const ANVIL_RPC = 'http://127.0.0.1:8545'

export const test = base.extend({
  // `runTest` is Playwright's fixture-use callback (renamed from the conventional `use` so the
  // react-hooks lint rule doesn't mistake it for React's `use` hook).
  page: async ({ page }, runTest) => {
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
        const raw = await w.__anvilRpc(JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }))
        const json = JSON.parse(raw) as { result?: unknown; error?: { message: string; code: number } }
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
    }, TEST_ACCOUNT)

    await runTest(page)
  },
})

export { expect }

/** Click CONNECT WALLET, then the (single) injected connector in the modal; wait until connected. */
export async function connectWallet(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('banner').getByRole('button', { name: 'CONNECT WALLET' }).click()
  // The modal lists the generic injected connector; click the first connector button.
  await page.locator('ul li button').first().click()
  // Connected = the nav swaps CONNECT WALLET for the disconnect (⏏) control.
  await expect(page.getByRole('button', { name: 'disconnect wallet' })).toBeVisible({
    timeout: 15_000,
  })
}
