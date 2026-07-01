/**
 * Board transaction cart (B13) — opt-in batching. Queue two posts via "add to batch", then finalize
 * them in a SINGLE postBatch tx; assert both land and the cart clears. Reuses the injected anvil
 * wallet. @fork: needs the local deploy (GlobalMessageRegistry).
 */
import { test, connectWallet, expect } from './fixtures/anvilWallet'

test('board cart: two queued posts finalize in one postBatch @fork', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/board')
  await connectWallet(page)
  await page.waitForTimeout(600)

  const ta = page.getByPlaceholder('write something…').first()
  const a = `batch-a-${Date.now().toString().slice(-6)}`
  const b = `batch-b-${Date.now().toString().slice(-6)}`

  await ta.fill(a)
  await page.getByRole('button', { name: 'add to batch' }).first().click()
  await ta.fill(b)
  await page.getByRole('button', { name: 'add to batch' }).first().click()

  const cart = page.getByTestId('board-cart')
  await expect(cart).toBeVisible()
  await expect(cart).toContainText('2 not yet on-chain', { ignoreCase: true })

  await page.getByTestId('board-cart-finalize').click()

  // One tx settles the whole batch: the cart clears and both messages appear.
  await expect(cart).toBeHidden({ timeout: 20_000 })
  await expect(page.locator('body')).toContainText(a)
  await expect(page.locator('body')).toContainText(b)
})
