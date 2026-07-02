/**
 * @fork — embedded post-graduation swap (B19). Proves the graduated ERC-404 surface trades IN-SITE
 * through zRouter instead of linking out, for BOTH zRouter-native venues:
 *   - `molten-ready` → real ZAMM pool (swapVZ)
 *   - `cinder-ready` → real Uni-V4 native-ETH pool (swapV4)
 * The seed binds each to its real LP deployer, matured so it can graduate. For each, the spec:
 *   1. (Node/viem) finds the instance via the ERC404 factory logs and graduates it (deployLiquidity)
 *      if it hasn't been already — graduation stands up the real pool.
 *   2. (UI) opens the collection, asserts the embedded GraduatedSwapPanel renders (not the link-out)
 *      with the right venue label, buys with ETH, and asserts the swap confirms — i.e. quote (sim) →
 *      write → receipt all wire up.
 *
 * Needs the local fork up + deployed (`pnpm chain:fork` then `pnpm chain:deploy`).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createPublicClient, createWalletClient, http, type Address } from 'viem'
import { test, expect, connectWallet, ANVIL_RPC, TEST_ACCOUNT } from './fixtures/anvilWallet'

const forkChain = {
  id: 1337,
  name: 'anvil-fork',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [ANVIL_RPC] } },
} as const

const deployment = JSON.parse(
  readFileSync(fileURLToPath(new URL('../src/config/local-deployment.json', import.meta.url)), 'utf8'),
) as { contracts: { ERC404Factory: Address } }
const FACTORY = deployment.contracts.ERC404Factory

/** keccak256("InstanceCreated(address,address,address,string,string)") — instance is topic[1]. */
const INSTANCE_CREATED = '0xef385e577da1427cc970a482e2560d72afabebdae40f0b84044f73fe332117cb'

const INSTANCE_ABI = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'graduated', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'deployLiquidity', stateMutability: 'nonpayable', inputs: [], outputs: [] },
] as const

const client = createPublicClient({ chain: forkChain, transport: http(ANVIL_RPC) })
const wallet = createWalletClient({ account: TEST_ACCOUNT, chain: forkChain, transport: http(ANVIL_RPC) })

/** Find a seeded ERC-404 instance by name via the factory's InstanceCreated logs. */
async function findInstanceByName(target: string): Promise<Address> {
  const logs = await client.getLogs({ address: FACTORY, fromBlock: 0n, toBlock: 'latest' })
  for (const log of logs) {
    if (log.topics[0] !== INSTANCE_CREATED || !log.topics[1]) continue
    const instance = `0x${log.topics[1].slice(26)}` as Address
    const name = await client
      .readContract({ address: instance, abi: INSTANCE_ABI, functionName: 'name' })
      .catch(() => '')
    if (name === target) return instance
  }
  throw new Error(`seeded instance "${target}" not found — is the fork deployed?`)
}

/** Graduate the instance if needed, open its page, and drive a buy through the embedded panel. */
async function verifyEmbeddedBuy(
  page: import('@playwright/test').Page,
  name: string,
  venueLabel: string,
): Promise<void> {
  const instance = await findInstanceByName(name)
  const already = await client.readContract({ address: instance, abi: INSTANCE_ABI, functionName: 'graduated' })
  if (!already) {
    const hash = await wallet.writeContract({
      address: instance,
      abi: INSTANCE_ABI,
      functionName: 'deployLiquidity',
      gas: 9_000_000n,
    })
    await client.waitForTransactionReceipt({ hash })
  }
  expect(await client.readContract({ address: instance, abi: INSTANCE_ABI, functionName: 'graduated' })).toBe(true)

  await page.goto(`/collection/${instance}`)
  await connectWallet(page)

  // The graduated phase embeds the swap panel (in-site), NOT the Uniswap link-out, and names the venue.
  const swap = page.getByTestId('erc404-graduated-swap')
  await expect(swap).toBeVisible({ timeout: 20_000 })
  await expect(swap).toContainText(venueLabel)
  await expect(page.getByTestId('erc404-graduated-trade')).toHaveCount(0)

  // Buy with ETH: enter an amount, wait for the live sim quote, submit, assert confirmation.
  await page.getByTestId('erc404-graduated-amount-input').fill('0.01')
  await expect(page.getByTestId('erc404-graduated-quote')).not.toContainText('—', { timeout: 20_000 })
  await page.getByTestId('erc404-graduated-swap-submit').click()
  await expect(swap).toContainText('tx confirmed', { timeout: 30_000 })
}

test('graduated ERC-404 (ZAMM) trades in-site via zRouter swapVZ @fork', async ({ page }) => {
  test.setTimeout(90_000)
  await verifyEmbeddedBuy(page, 'molten-ready', 'ZAMM')
})

test('graduated ERC-404 (Uni-V4) trades in-site via zRouter swapV4 @fork', async ({ page }) => {
  test.setTimeout(90_000)
  await verifyEmbeddedBuy(page, 'cinder-ready', 'Uniswap V4')
})
