/**
 * @fork — proves the styleUri renderer: a collection created WITH a styleUri has that CSS applied to
 * its page (the `has-project-style` body flag + an injected <style data-project-style>). Drives the
 * real wizard with the injected auto-signing wallet. See docs/testing-write-path-e2e.md.
 */
import { test, expect, connectWallet } from './fixtures/anvilWallet'

test('a collection styleUri is fetched and applied to its page @fork', async ({ page }) => {
  await page.goto('/launch')
  await connectWallet(page)

  const name = `Styled-${Date.now()}`
  const details = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Details', exact: true }) })
  await details.getByLabel(/^Name/).fill(name)
  await details.getByLabel(/^Collection metadata/).fill('data:application/json,{}')
  await details.getByLabel(/^Creator/).fill('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266')
  // Distinctive inline CSS scoped to the documented body flag.
  await details
    .getByLabel(/^Style URI/)
    .fill('data:text/css,body.has-project-style{--seed-style-applied:1}')

  await page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Alignment vault' }) })
    .getByRole('button')
    .first()
    .click()

  await page.locator('#cmf-name').fill(name)
  await page.getByRole('button', { name: 'Launch collection' }).click()
  await page.waitForURL(/\/collection\/0x[0-9a-fA-F]{40}/, { timeout: 30_000 })

  // The renderer reads styleUri(), injects the CSS, and flags <body>.
  await expect(page.locator('body.has-project-style')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('style[data-project-style]')).toHaveCount(1)
  const applied = await page.evaluate(() =>
    getComputedStyle(document.body).getPropertyValue('--seed-style-applied').trim(),
  )
  expect(applied).toBe('1')
})
