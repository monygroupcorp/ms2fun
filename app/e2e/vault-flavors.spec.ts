/**
 * @fork — write-path walk of the vault-flavors family → venue picker (vault-flavors.md, exit #3).
 *
 * Drives the REAL stepped launch wizard with an injected, auto-signing anvil wallet to prove the
 * alignment step renders the two-level picker grouped off on-chain `vaultType()`:
 *   - Level 1: the two economic families — Yield (Aave endowment) and Liquidity (LP).
 *   - Level 2: the venues under the chosen family — Liquidity ⇒ Uniswap V4 / ZAMM / Cypher (all
 *     deployed + liquidity-ready on the fork), Yield ⇒ Aave.
 * Then it creates an ERC-1155 collection aligned to the Liquidity → Uniswap V4 venue and asserts on
 * -chain (via viem) that the bound vault is actually a `UniswapV4LP` vault — i.e. picking a family
 * produced a working create tx bound to the venue the creator chose.
 *
 * Needs the local fork up + deployed (`pnpm chain:fork` then `pnpm chain:deploy`). Run via
 * `pnpm test:e2e` (tagged @fork, not @archive — it only reads locally-deployed contracts).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createPublicClient, http, type Address } from 'viem'
import { test, expect, connectWallet, ANVIL_RPC, TEST_ACCOUNT } from './fixtures/anvilWallet'

const forkChain = {
  id: 1337,
  name: 'anvil-fork',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [ANVIL_RPC] } },
} as const

// Read the locally-deployed MasterRegistry from the deploy-generated config (the spec body runs in
// Node; importing the JSON via ESM would need an import attribute Playwright's transform lacks).
const deployment = JSON.parse(
  readFileSync(fileURLToPath(new URL('../src/config/local-deployment.json', import.meta.url)), 'utf8'),
) as { contracts: { MasterRegistryV1: Address } }
const MASTER_REGISTRY = deployment.contracts.MasterRegistryV1

const REGISTRY_ABI = [
  { type: 'function', name: 'getActiveVault', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'address' }] },
] as const
const VAULT_ABI = [
  { type: 'function', name: 'vaultType', stateMutability: 'pure', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'isLiquidityReady', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
] as const

const client = createPublicClient({ chain: forkChain, transport: http(ANVIL_RPC) })

test('vault flavors: alignment step is a family → venue picker; Liquidity → Uni binds a UniswapV4LP vault @fork', async ({
  page,
}) => {
  await page.goto('/launch')
  await connectWallet(page)

  // ── STEP 01 · Contract — ERC-1155 is the wizard default; fill core details. ──
  const name = `E2E-Flavor-${Date.now()}`
  await page.getByLabel(/^Name/).fill(name)
  await page.getByLabel(/^Collection metadata/).fill('data:application/json,{}')
  await page.getByLabel(/^Creator/).fill(TEST_ACCOUNT)
  await page.getByRole('button', { name: /Continue/ }).click() // → Gating

  // ── STEP · Gating — leave open (skip). ──
  await page.getByRole('button', { name: /Continue/ }).click() // → Alignment

  // ── STEP · Alignment — the two-level picker. ──────────────────────────────
  // Level 1: both economic families present. (Anchored `^` avoids the stepper's "04 Liquidity"
  // button, whose accessible name starts with the step number, not the label.)
  const yieldFamily = page.getByRole('button', { name: /^Yield/ })
  const lpFamily = page.getByRole('button', { name: /^Liquidity/ })
  await expect(yieldFamily).toBeVisible()
  await expect(lpFamily).toBeVisible()

  // Level 2 under Liquidity: all three LP venues are deployed + liquidity-ready on the fork.
  await lpFamily.click()
  await expect(page.getByRole('button', { name: /^Uniswap V4/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^ZAMM/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Cypher/ })).toBeVisible()

  // Switching to Yield swaps the venue set to the endowment (Aave) and drops the LP venues.
  await yieldFamily.click()
  await expect(page.getByRole('button', { name: /^Aave/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Uniswap V4/ })).toHaveCount(0)

  // Pick Liquidity → Uniswap V4 (the workhorse venue) and continue.
  await lpFamily.click()
  await page.getByRole('button', { name: /^Uniswap V4/ }).click()
  await page.getByRole('button', { name: /Continue/ }).click() // → Collection page

  // ── STEP · Collection page — a name is required to deploy. ──
  await page.locator('#cmf-name').fill(name)
  await page.getByRole('button', { name: /Continue/ }).click() // → Review & deploy

  // ── STEP · Review — the injected wallet auto-signs; wait for the collection redirect. ──
  await page.getByRole('button', { name: 'Deploy collection' }).click()
  await page.waitForURL(/\/collection\/0x[0-9a-fA-F]{40}/, { timeout: 30_000 })
  const instance = page.url().match(/\/collection\/(0x[0-9a-fA-F]{40})/)![1] as Address

  // ── On-chain — the bound vault is the Uni LP venue the creator picked. ──────
  const readVault = () =>
    client.readContract({ address: MASTER_REGISTRY, abi: REGISTRY_ABI, functionName: 'getActiveVault', args: [instance] })
  await expect
    .poll(() => readVault().catch(() => '0x'), { timeout: 15_000 })
    .not.toBe('0x')
  const vault = (await readVault()) as Address

  expect(await client.readContract({ address: vault, abi: VAULT_ABI, functionName: 'vaultType' })).toBe('UniswapV4LP')
  expect(await client.readContract({ address: vault, abi: VAULT_ABI, functionName: 'isLiquidityReady' })).toBe(true)
})
