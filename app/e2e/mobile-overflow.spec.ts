/**
 * @fork — mobile layout guard. At a 375px viewport, no page should scroll horizontally (the symptom
 * of an overflowing card/grid). Reads the seeded featured collections off the fork; no wallet needed.
 * Guards the class of bug where a flex/grid child can't shrink and pushes the layout wider than the
 * viewport. See docs/DESIGN_SYSTEM_V2.md.
 */
import { test, expect } from '@playwright/test'

const MOBILE = { width: 375, height: 812 }

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  // Allow 1px for sub-pixel rounding.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow, 'horizontal overflow (px) at 375px viewport').toBeLessThanOrEqual(1)
}

test('home discovery does not overflow horizontally on mobile @fork', async ({ page }) => {
  await page.setViewportSize(MOBILE)
  await page.goto('/')
  // Wait for the discovery section to resolve (cards or the honest empty state).
  await expect(page.getByRole('heading', { name: 'FEATURED' })).toBeVisible({ timeout: 15_000 })
  await page.waitForLoadState('networkidle')
  await expectNoHorizontalOverflow(page)
})

test('collections page does not overflow horizontally on mobile @fork', async ({ page }) => {
  await page.setViewportSize(MOBILE)
  await page.goto('/collections')
  await page.waitForLoadState('networkidle')
  await expectNoHorizontalOverflow(page)
})
