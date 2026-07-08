/**
 * @fork — write-path walk of the permissionless FeaturedPanel economics (Interface H, testnet program
 * step 2 / B1-B4 re-verify). Drives a FRESH collection (created through the real launch wizard, so it
 * starts unfeatured) through the REAL FeaturedPanel UI as anvil #0 (permissionless — no ownership
 * gate): rentFeatured -> boostRank -> renewDuration -> pruneExpired. Every write is asserted on-chain
 * (via viem `getRentalInfo`) so a wrong-chain/reverted write fails loudly instead of silently no-op'ing
 * (the exact B1-B4 failure mode this step re-verifies).
 *
 * pruneExpired needs the slot to actually be expired. The FeaturedPanel gates the "prune" control on a
 * BROWSER wall-clock comparison (`Date.now()` vs the on-chain `expiresAt`), while anvil's own clock is
 * separately advanced (evm_increaseTime) to make the CONTRACT see it expired too — so both the UI and
 * the chain agree the slot lapsed. Playwright's Clock API fast-forwards the browser side; the anvil
 * side is bracketed in an evm_snapshot/evm_revert so the large time jump doesn't leak into whatever
 * else is running against the same shared fork.
 *
 * Needs the local fork up + deployed (`pnpm chain:fork` then `pnpm chain:deploy`). Run via
 * `pnpm test:e2e` (tagged @fork, not @archive — it only reads locally-deployed contracts).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createPublicClient, createTestClient, http, type Address } from 'viem'
import { test, expect, connectWallet, ANVIL_RPC, TEST_ACCOUNT } from './fixtures/anvilWallet'

const deployment = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../src/config/local-deployment.json', import.meta.url)),
    'utf8',
  ),
) as { contracts: { FeaturedQueueManager: Address } }
const FQM = deployment.contracts.FeaturedQueueManager

const forkChain = {
  id: 1337,
  name: 'anvil-fork',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [ANVIL_RPC] } },
} as const

const FQM_ABI = [
  {
    type: 'function',
    name: 'getRentalInfo',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [
      { name: 'renter', type: 'address' },
      { name: 'effectiveRank', type: 'uint256' },
      { name: 'expiresAt', type: 'uint256' },
      { name: 'isActive', type: 'bool' },
    ],
  },
] as const

const client = createPublicClient({ chain: forkChain, transport: http(ANVIL_RPC) })
const testClient = createTestClient({ mode: 'anvil', chain: forkChain, transport: http(ANVIL_RPC) })

const rentalInfo = (instance: Address) =>
  client.readContract({
    address: FQM,
    abi: FQM_ABI,
    functionName: 'getRentalInfo',
    args: [instance],
  })

const DAY = 24 * 60 * 60

test('featured queue: rent, boost, renew, then prune once expired, all as anvil #0 @fork', async ({
  page,
}) => {
  test.setTimeout(90_000)

  // ── Create a fresh, unfeatured collection to exercise the queue against ────────────────────
  await page.goto('/launch')
  await connectWallet(page)

  const name = `E2E-Featured-${Date.now()}`
  await page.getByLabel(/^Name/).fill(name)
  await page.getByLabel(/^Collection metadata/).fill('data:application/json,{}')
  await page.getByLabel(/^Creator/).fill(TEST_ACCOUNT)
  await page.getByRole('button', { name: /Continue/ }).click() // → Gating
  await page.getByRole('button', { name: /Continue/ }).click() // → Alignment (leave open)

  await page.getByRole('button', { name: /^Yield/ }).click()
  await page
    .getByRole('button', { name: /target #/ })
    .first()
    .click()
  await page.getByRole('button', { name: /Continue/ }).click() // → Collection page

  await page.locator('#cmf-name').fill(name)
  await page.getByRole('button', { name: /Continue/ }).click() // → Review & deploy
  await page.getByRole('button', { name: 'Deploy collection' }).click()
  await page.waitForURL(/\/collection\/0x[0-9a-fA-F]{40}/, { timeout: 30_000 })
  const instance = page.url().match(/\/collection\/(0x[0-9a-fA-F]{40})/)![1] as Address

  // Fresh collection starts unfeatured.
  const before = await rentalInfo(instance)
  expect(before[3]).toBe(false)

  // ── Rent a featured slot (MIN_DAYS = 7) ─────────────────────────────────────────────────────
  const featured = page.getByTestId('featured-panel')
  await expect(featured).toBeVisible()
  await featured.locator('summary').click() // open the <details> disclosure — content is hidden until then
  await page.getByLabel(/duration \(days/).fill('7')
  await expect
    .poll(() => featured.getByTestId('featured-rent').isEnabled(), { timeout: 15_000 })
    .toBe(true)
  await featured.getByTestId('featured-rent').click()
  await expect(featured.getByTestId('featured-rent-success')).toBeVisible({ timeout: 20_000 })

  const afterRent = await rentalInfo(instance)
  expect(afterRent[0].toLowerCase()).toBe(TEST_ACCOUNT.toLowerCase())
  expect(afterRent[3]).toBe(true)
  const rankAfterRent = afterRent[1] as bigint
  const expiresAfterRent = afterRent[2] as bigint

  // ── Boost rank ───────────────────────────────────────────────────────────────────────────────
  await page.getByLabel('rank boost in ETH', { exact: true }).fill('0.02')
  await featured.getByTestId('featured-boost').click()
  await expect(featured.getByTestId('featured-boost-success')).toBeVisible({ timeout: 20_000 })

  const afterBoost = await rentalInfo(instance)
  expect(afterBoost[1] as bigint).toBeGreaterThan(rankAfterRent)

  // ── Renew duration (+7 more days) ────────────────────────────────────────────────────────────
  await page.getByLabel(/additional days/).fill('7')
  await expect
    .poll(() => featured.getByTestId('featured-renew').isEnabled(), { timeout: 15_000 })
    .toBe(true)
  await featured.getByTestId('featured-renew').click()
  await expect(featured.getByTestId('featured-renew-success')).toBeVisible({ timeout: 20_000 })

  const afterRenew = await rentalInfo(instance)
  expect(afterRenew[2] as bigint).toBeGreaterThan(expiresAfterRent)
  const expiresAfterRenew = Number(afterRenew[2] as bigint)

  // ── Warp past expiry (chain + browser clock), then prune ────────────────────────────────────
  // Bracket the chain-time jump so it doesn't leak into other specs sharing this fork.
  const snapshot = await testClient.snapshot()
  try {
    const nowSec = Math.floor(Date.now() / 1000)
    const forwardSecs = expiresAfterRenew - nowSec + DAY // land a day past the (renewed) expiry
    await testClient.increaseTime({ seconds: forwardSecs })
    await testClient.mine({ blocks: 1 })

    // Move the browser's Date.now() the same distance so FeaturedPanel's client-side `expired` flag
    // (which the "prune" control is gated on) agrees with the chain. `install` with a future `time`
    // sets the clock directly — no timer replay, unlike `fastForward` over a multi-day span.
    await page.clock.install({ time: Date.now() + forwardSecs * 1000 })
    await page.reload()
    await connectWallet(page)

    const expired = page.getByTestId('featured-panel')
    await expect(expired).toBeVisible({ timeout: 15_000 })
    await expired.locator('summary').click() // reload reset the <details> to collapsed — reopen it
    await expect(expired.getByTestId('featured-prune')).toBeVisible({ timeout: 15_000 })
    await expired.getByTestId('featured-prune').click()
    await expect(expired.getByTestId('featured-prune-success')).toBeVisible({ timeout: 20_000 })

    const afterPrune = await rentalInfo(instance)
    expect(afterPrune[3]).toBe(false)
  } finally {
    await testClient.revert({ id: snapshot })
  }
})
