/**
 * App-shell smoke + a connected-home discovery read off the fork.
 *
 * The home (`/`) shows the marketing hero while disconnected and the discovery grid — featured
 * collections read via QueryAggregator through the generated bindings — once a wallet connects
 * (see routes/HomePage.tsx). The old `HelloChain` widget was removed in the NOESIS reskin, so the
 * "reads a real value off the fork" coverage now lives on that discovery grid.
 */
import { test, expect, connectWallet } from './fixtures/anvilWallet'

test('app shell loads', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('banner').getByRole('link', { name: 'ms2.fun' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'COLLECTIONS', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'LAUNCH', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'CONNECT WALLET' }).first()).toBeVisible()
})

/**
 * @fork — the connected discovery grid resolves off the local fork (localhost:8545) with the
 * platform contracts deployed. Run with: pnpm test:e2e  (after `pnpm chain:fork` + `pnpm chain:deploy`).
 */
test('connected home renders the discovery grid off the fork @fork', async ({ page }) => {
  await page.goto('/')
  await connectWallet(page)
  // Featured section + the pinned EXEC404 fossil card render only once the QueryAggregator read resolves.
  await expect(page.getByRole('heading', { name: 'Featured', exact: true })).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByTestId('exec404-link')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('collections-link')).toBeVisible()
})
