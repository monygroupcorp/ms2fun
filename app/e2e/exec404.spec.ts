import { expect, test } from '@playwright/test'

test('the EXEC404 fossil page shows a Uniswap trade link-out', async ({ page }) => {
  // The exec404-link card lives on the connected discovery home (see hello-chain.spec); this test
  // covers the fossil page itself, which is static (no chain needed) and reachable directly.
  await page.goto('/exec404')
  await expect(page.getByRole('heading', { level: 1, name: /CULT EXECUTIVES/ })).toBeVisible()
  // Graduated fossil trades on Uniswap — the page links out there.
  const link = page.getByTestId('exec404-uniswap-link')
  await expect(link).toBeVisible()
  await expect(link).toHaveAttribute('href', /app\.uniswap\.org\/swap/)
})

/**
 * The EXEC404 slice reads real fossil state off the fork: the stats panel shows the live market
 * price from the graduated Uniswap V2 pool (`getAmountsOut`).
 *
 * Tagged @archive (NOT @fork): EXEC404 and the V2 pool are forked-mainnet state, so reading them
 * needs an archive-capable fork RPC. A non-archive public RPC 403s on cold mainnet storage once the
 * fork ages — an environment limit, not a code issue (see docs/HUMAN_GATES.md). Run with an archive
 * fork up: `cd app && pnpm exec playwright test --grep @archive`.
 */
test('EXEC404 page reads the live V2 market price off the fork @archive', async ({ page }) => {
  await page.goto('/exec404')
  const stats = page.getByTestId('exec404-stats')
  await expect(stats).toBeVisible()
  await expect(stats).toContainText('gwei', { timeout: 15_000 })
})
