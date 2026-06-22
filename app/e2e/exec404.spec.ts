import { expect, test } from '@playwright/test'

test('home links to the EXEC404 fossil page', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('exec404-link').click()
  await expect(page).toHaveURL(/\/exec404$/)
  await expect(page.getByRole('heading', { name: 'CULT EXECUTIVES' })).toBeVisible()
})

/**
 * The EXEC404 slice reads real fossil state off the fork through the typed ABI: the stats panel
 * shows a live price (gwei), and the bonding-curve quote resolves for a typed amount.
 *
 * Tagged @archive (NOT @fork): EXEC404 is forked-mainnet state, so reading it needs an
 * archive-capable fork RPC. A non-archive public RPC 403s on cold mainnet storage once the fork
 * ages — that's an environment limit, not a code issue (see docs/HUMAN_GATES.md G-A). Run with an
 * archive fork up: `pnpm exec playwright test --grep @archive`.
 */
test('EXEC404 page reads live state and quotes a buy off the fork @archive', async ({ page }) => {
  await page.goto('/exec404')

  const stats = page.getByTestId('exec404-stats')
  await expect(stats).toBeVisible()
  // Price renders from calculateCost(1 EXEC) off the fork.
  await expect(stats).toContainText('gwei', { timeout: 15_000 })

  // A typed amount produces a live bonding-curve quote (calculateCost off the fork).
  await page.getByTestId('exec404-amount').fill('1000')
  await expect(page.getByTestId('exec404-quote')).toContainText('gwei', { timeout: 15_000 })
})
