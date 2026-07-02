/**
 * Board transaction cart (B13 + M4) — board actions AUTO-BATCH. "Post" queues each message into the
 * cart (no separate "add to batch" button); finalize commits them in a SINGLE postBatch tx. Assert
 * both land and the cart clears. Reuses the injected anvil wallet. @fork: needs the local deploy.
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

  // Each "Post" auto-queues to the cart (and clears the textarea) rather than posting immediately.
  await ta.fill(a)
  await page.getByRole('button', { name: 'Post' }).first().click()
  await ta.fill(b)
  await page.getByRole('button', { name: 'Post' }).first().click()

  const cart = page.getByTestId('board-cart')
  await expect(cart).toBeVisible()
  await expect(cart).toContainText('2 not yet on-chain', { ignoreCase: true })

  await page.getByTestId('board-cart-finalize').click()

  // One tx settles the whole batch: the cart clears and both messages appear.
  await expect(cart).toBeHidden({ timeout: 20_000 })
  await expect(page.locator('body')).toContainText(a)
  await expect(page.locator('body')).toContainText(b)
})
