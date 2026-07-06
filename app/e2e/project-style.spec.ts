/**
 * @fork — proves the styleUri renderer: a collection created WITH a styleUri has that CSS applied to
 * its page (the `has-project-style` body flag + an injected <style data-project-style>). Drives the
 * REAL stepped launch wizard with the injected auto-signing wallet. See docs/testing-write-path-e2e.md.
 */
import { test, expect, connectWallet, TEST_ACCOUNT } from './fixtures/anvilWallet'

test('a collection styleUri is fetched and applied to its page @fork', async ({ page }) => {
  await page.goto('/launch')
  await connectWallet(page)

  // ERC-1155 is the wizard's default contract type — fill core details on the Contract step.
  // Labels carry a required-asterisk span, so match by prefix, not exact.
  const name = `Styled-${Date.now()}`
  await page.getByLabel(/^Name/).fill(name)
  await page.getByLabel(/^Collection metadata/).fill('data:application/json,{}')
  await page.getByLabel(/^Creator/).fill(TEST_ACCOUNT)

  // Contract → Gating (skip) → Alignment → Collection page → Review. The stepper skips N/A steps.
  await page.getByRole('button', { name: /Continue/ }).click() // → Gating
  await page.getByRole('button', { name: /Continue/ }).click() // → Alignment
  await page.getByRole('button', { name: /^Yield/ }).click() // family → venue picker
  await page
    .getByRole('button', { name: /target #/ })
    .first()
    .click()
  await page.getByRole('button', { name: /Continue/ }).click() // → Collection page
  await page.locator('#cmf-name').fill(name)
  // Style URI now lives on the Collection-page step (it's a page concern, not a contract one).
  // Distinctive inline CSS scoped to the documented body flag.
  await page
    .getByLabel(/^Style URI/)
    .fill('data:text/css,body.has-project-style{--seed-style-applied:1}')
  await page.getByRole('button', { name: /Continue/ }).click() // → Review & deploy

  await page.getByRole('button', { name: 'Deploy collection' }).click()
  await page.waitForURL(/\/collection\/0x[0-9a-fA-F]{40}/, { timeout: 30_000 })

  // The renderer reads styleUri(), injects the CSS, and flags <body>.
  await expect(page.locator('body.has-project-style')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('style[data-project-style]')).toHaveCount(1)
  const applied = await page.evaluate(() =>
    getComputedStyle(document.body).getPropertyValue('--seed-style-applied').trim(),
  )
  expect(applied).toBe('1')
})
