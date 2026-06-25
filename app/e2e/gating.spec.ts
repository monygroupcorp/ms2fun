/**
 * @fork — write-path walk of password-tier gating (interface B).
 *
 * Drives the REAL wizard UI with an injected, auto-signing anvil wallet:
 *   1. create an ERC1155 collection WITH a password tier in the same create tx, and
 *   2. edit the tiers afterwards from the creator-admin panel.
 * Each step is verified by reading the on-chain PasswordTierGatingModule directly with viem, so this
 * exercises UI → submit-builder → factory overload → module (create) and UI → configureFor (edit).
 *
 * Needs the local fork up + deployed (`pnpm chain:fork` then `pnpm chain:deploy`). Run via
 * `pnpm test:e2e` (this is tagged @fork, not @archive — it only reads locally-deployed contracts).
 */
import { createPublicClient, http, keccak256, toHex, type Address } from 'viem'
import { test, expect, connectWallet, ANVIL_RPC } from './fixtures/anvilWallet'

const forkChain = {
  id: 1337,
  name: 'anvil-fork',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [ANVIL_RPC] } },
} as const

const INSTANCE_ABI = [
  { type: 'function', name: 'gatingModule', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
] as const
const MODULE_ABI = [
  { type: 'function', name: 'configured', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'bool' }] },
  {
    type: 'function',
    name: 'tierByPasswordHash',
    stateMutability: 'view',
    inputs: [{ type: 'address' }, { type: 'bytes32' }],
    outputs: [{ type: 'uint256' }],
  },
] as const

const client = createPublicClient({ chain: forkChain, transport: http(ANVIL_RPC) })

// The gating module is the one wired onto the instance at create — read it from the instance itself
// (it isn't in the frontend deployment subset).
const moduleOf = (instance: Address) =>
  client.readContract({ address: instance, abi: INSTANCE_ABI, functionName: 'gatingModule' })
const tier = async (instance: Address, password: string) =>
  client.readContract({
    address: await moduleOf(instance),
    abi: MODULE_ABI,
    functionName: 'tierByPasswordHash',
    args: [instance, keccak256(toHex(password))],
  })
const configured = async (instance: Address) =>
  client.readContract({
    address: await moduleOf(instance),
    abi: MODULE_ABI,
    functionName: 'configured',
    args: [instance],
  })

test('gating config: set a tier at create, then replace it from creator admin @fork', async ({ page }) => {
  await page.goto('/launch')
  await connectWallet(page)

  // ── Core details (ERC1155 is the default type). metadataURI/creator are validated-but-derived;
  //    fill them just to pass the form. Randomize the on-chain name to avoid isNameTaken collisions.
  // On-chain name rules (MetadataUtils.isValidName): [A-Za-z0-9_-], ≤64 chars, no spaces.
  const name = `E2E-Gated-${Date.now()}`
  const details = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Details', exact: true }) })
  await details.getByLabel(/^Name/).fill(name)
  await details.getByLabel(/^Collection metadata/).fill('data:application/json,{}')
  await details.getByLabel(/^Creator/).fill('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266')

  // ── Alignment vault — pick the first registered vault card.
  const vaultSection = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Alignment vault' }) })
  await expect(vaultSection.getByRole('button').first()).toBeVisible({ timeout: 15_000 })
  await vaultSection.getByRole('button').first().click()

  // ── Gating module — select the real Password Tier Gating module, then fill one volume-cap tier.
  await page.getByRole('button', { name: /Password Tier Gating/ }).first().click()
  await page.getByRole('button', { name: '+ Add Password' }).click()
  await page.getByRole('textbox', { name: 'Password 1' }).fill('alpha')
  await page.getByRole('button', { name: '+ Add Volume cap' }).click()
  await page.getByRole('textbox', { name: 'Volume cap 1' }).fill('100')

  // ── Collection metadata name (separate from the on-chain name field).
  await page.locator('#cmf-name').fill(name)

  // ── Launch — the injected wallet auto-signs; wait for the redirect to the new collection.
  await page.getByRole('button', { name: 'Launch collection' }).click()
  await page.waitForURL(/\/collection\/0x[0-9a-fA-F]{40}/, { timeout: 30_000 })
  const instance = page.url().match(/\/collection\/(0x[0-9a-fA-F]{40})/)![1] as Address

  // ── Verify the tier landed in the SAME create tx (no second transaction).
  await expect.poll(() => configured(instance), { timeout: 15_000 }).toBe(true)
  expect(await tier(instance, 'alpha')).toBe(1n)

  // ── Edit path: replace the tiers from the creator-admin panel (owner-authored configureFor).
  const gatingRow = page
    .locator('[class*="row"]')
    .filter({ has: page.getByText('password tiers') })
  await expect(gatingRow.getByRole('button', { name: '+ Add Password' })).toBeVisible({
    timeout: 15_000,
  })
  await gatingRow.getByRole('button', { name: '+ Add Password' }).click()
  await gatingRow.getByRole('textbox', { name: 'Password 1' }).fill('beta')
  await gatingRow.getByRole('button', { name: '+ Add Volume cap' }).click()
  await gatingRow.getByRole('textbox', { name: 'Volume cap 1' }).fill('250')
  await gatingRow.getByRole('button', { name: 'save tiers' }).click()

  await expect(page.getByText('tiers saved — tx confirmed.')).toBeVisible({ timeout: 30_000 })

  // ── Verify the replacement: 'beta' is now tier 1 and 'alpha' was cleared.
  await expect.poll(() => tier(instance, 'beta'), { timeout: 15_000 }).toBe(1n)
  expect(await tier(instance, 'alpha')).toBe(0n)
})
