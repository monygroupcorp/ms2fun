import { expect, test } from '@playwright/test'

test('home links to the collections discovery page', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('collections-link').click()
  await expect(page).toHaveURL(/\/collections$/)
  await expect(page.getByRole('heading', { name: 'COLLECTIONS' })).toBeVisible()
})

/**
 * @fork — the discovery read resolves off the fork via QueryAggregator.getHomePageData. The fork
 * has no seeded collections yet, so we assert the honest empty state renders (not the error state).
 */
test('collections discovery read resolves off the fork @fork', async ({ page }) => {
  await page.goto('/collections')
  await expect(page.getByTestId('collections-empty')).toBeVisible({ timeout: 15_000 })
})
