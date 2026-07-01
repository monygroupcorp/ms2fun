import { test, expect } from '@playwright/test'

test('the home hero links to the collections discovery page', async ({ page }) => {
  await page.goto('/')
  // Disconnected home = the marketing hero; its secondary CTA is "Browse" → /collections.
  await page.getByRole('link', { name: 'Browse', exact: true }).click()
  await expect(page).toHaveURL(/\/collections$/)
  await expect(page.getByRole('heading', { name: 'Collections', level: 1 })).toBeVisible()
})

/**
 * @fork — the discovery read resolves off the fork via QueryAggregator + the registry scan. The fork
 * is SEEDED (chain:deploy rents featured collections), so we assert the list renders (not the empty
 * or error state).
 */
test('collections discovery read resolves off the fork @fork', async ({ page }) => {
  await page.goto('/collections')
  await expect(page.getByTestId('collections-list')).toBeVisible({ timeout: 15_000 })
})
