import { expect, test } from '@playwright/test'

test('app shell loads', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'ms2.fun' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'FEATURED', exact: true })).toBeVisible()
})

/**
 * G8 — the hello-chain reads a real value off the anvil fork through the generated bindings.
 * Tagged @fork: requires the local fork (localhost:8545) with the platform contracts deployed.
 * Run with: pnpm test:e2e --grep @fork  (after the fork is up).
 */
test('hello-chain reads MasterRegistry total factories off the fork @fork', async ({ page }) => {
  await page.goto('/')
  const value = page.getByTestId('hello-chain-value')
  await expect(value).toBeVisible()
  await expect(value).not.toHaveText('unreachable', { timeout: 15_000 })
  await expect(value).toHaveText(/^\d+$/, { timeout: 15_000 })
})
