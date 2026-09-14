/**
 * @fork — write-path walk of the two portfolio-side actions (testnet program step 2 / B1-B4
 * re-verify), both driven as the SEEDED holder ADMIN (SeedAnvil.s.sol hands ADMIN a whole vapor-mid
 * NFT-unit + ownership of neon-drift — see `_seedErc404MidCurve` / `_transferAdmin`), through the REAL
 * per-collection UI:
 *
 *   - `rerollSelectedNFTs` on the seeded "vapor-mid" ERC404 (Erc404Portfolio's reroll control).
 *   - `claimYieldPurse` on the seeded "neon-drift" ERC1155's Aave endowment vault (VaultPanel).
 *     The endowment vault carries one pooled principal that is never withdrawn by a benefactor —
 *     it is permanent until the curated target deploys it (`execute`), on no clock the app can wait
 *     out — so there is no maturity to warp past and no principal-withdraw button any more. The
 *     benefactor-reachable write left in the app is the creator's yield claim, gated on harvested
 *     yield existing to claim.
 *
 * EXEC404 portfolio writes (a real EXEC holder) are DEFERRED per the scout — out of scope here.
 *
 * Needs the local fork up + deployed (`pnpm chain:fork` then `pnpm chain:deploy`). Run via
 * `pnpm test:e2e` (tagged @fork, not @archive — it only reads locally-deployed contracts).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createPublicClient, createTestClient, formatUnits, http, type Address } from 'viem'
import { adminTest as test, expect, connectWallet, ADMIN, ANVIL_RPC } from './fixtures/anvilWallet'

const forkChain = {
  id: 1337,
  name: 'anvil-fork',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [ANVIL_RPC] } },
} as const

const deployment = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../src/config/local-deployment.json', import.meta.url)),
    'utf8',
  ),
) as { factories: { ERC404Factory: Address; ERC1155Factory: Address } }

const client = createPublicClient({ chain: forkChain, transport: http(ANVIL_RPC) })
const testClient = createTestClient({ mode: 'anvil', chain: forkChain, transport: http(ANVIL_RPC) })

// ── Locate the seeded instances by name via their factories' InstanceCreated logs ────────────────
const INSTANCE_CREATED_404 = {
  type: 'event',
  name: 'InstanceCreated',
  inputs: [
    { name: 'instance', type: 'address', indexed: true },
    { name: 'creator', type: 'address', indexed: true },
    { name: 'name', type: 'string', indexed: false },
    { name: 'symbol', type: 'string', indexed: false },
    { name: 'vault', type: 'address', indexed: true },
  ],
} as const
const INSTANCE_CREATED_1155 = {
  type: 'event',
  name: 'InstanceCreated',
  inputs: [
    { name: 'instance', type: 'address', indexed: true },
    { name: 'creator', type: 'address', indexed: true },
    { name: 'name', type: 'string', indexed: false },
    { name: 'vault', type: 'address', indexed: true },
  ],
} as const

async function findByName(
  factory: Address,
  event: typeof INSTANCE_CREATED_404 | typeof INSTANCE_CREATED_1155,
  name: string,
): Promise<Address> {
  const logs = await client.getLogs({ address: factory, event, fromBlock: 0n, toBlock: 'latest' })
  const hit = logs.find((l) => l.args.name === name)
  if (!hit?.args.instance) throw new Error(`seeded instance "${name}" not found`)
  return hit.args.instance
}

const ERC404_ABI = [
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const

const VAULT_ABI = [
  {
    type: 'function',
    name: 'calculateClaimableAmount',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'principalOf',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'harvest',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
] as const

test('portfolio: reroll (vapor-mid) + claim yield (neon-drift), both as seeded holder ADMIN @fork', async ({
  page,
}) => {
  test.setTimeout(90_000)

  const vaporMid = await findByName(
    deployment.factories.ERC404Factory,
    INSTANCE_CREATED_404,
    'vapor-mid',
  )
  const neonDrift = await findByName(
    deployment.factories.ERC1155Factory,
    INSTANCE_CREATED_1155,
    'neon-drift',
  )

  // ── 1 · rerollSelectedNFTs on vapor-mid, as ADMIN (seeded with a whole 1e24-unit NFT) ─────────
  const balanceBefore = (await client.readContract({
    address: vaporMid,
    abi: ERC404_ABI,
    functionName: 'balanceOf',
    args: [ADMIN],
  })) as bigint
  expect(balanceBefore).toBeGreaterThan(0n)

  const decimals = (await client
    .readContract({ address: vaporMid, abi: ERC404_ABI, functionName: 'decimals' })
    .catch(() => 18)) as number
  const rerollAmountStr = formatUnits(balanceBefore, decimals)

  await page.goto(`/collection/${vaporMid}`)
  await connectWallet(page)

  const portfolio = page.getByTestId('erc404-portfolio')
  await expect(portfolio).toBeVisible({ timeout: 15_000 })
  await portfolio.getByTestId('erc404-reroll-disclosure').click()
  await portfolio.getByTestId('erc404-reroll-amount').fill(rerollAmountStr)
  await portfolio.getByTestId('erc404-reroll').click()
  // The reroll disclosure has no dedicated success testid; the reroll button itself is disabled again
  // (amount field clears via onDone) once the tx confirms — poll balance for the definitive signal.
  await expect
    .poll(
      async () =>
        client.readContract({
          address: vaporMid,
          abi: ERC404_ABI,
          functionName: 'balanceOf',
          args: [ADMIN],
        }),
      { timeout: 20_000 },
    )
    .toBe(balanceBefore) // reroll re-assigns NFT ids for the same token amount — balance is invariant

  // ── 2 · claimYieldPurse on neon-drift's Aave endowment vault, as ADMIN (the instance owner) ──
  // There is no maturity clock and no benefactor withdraw any more: principal is permanent, pooled,
  // and leaves only when the curated target deploys it via `execute`. The one write a benefactor's
  // own collection page still offers is the creator's yield claim, gated on harvested yield existing
  // to claim — so the chain clock is warped to let Aave interest accrue, then `harvest()` is called
  // directly (permissionless, off-UI) to crystallize it before the claim button is exercised.
  await page.goto(`/collection/${neonDrift}`)
  await connectWallet(page)

  const vaultPanel = page.getByTestId('vault-panel')
  await expect(vaultPanel).toBeVisible({ timeout: 15_000 })

  // Read the vault address straight off the panel's own on-chain reads isn't exposed to the test, so
  // resolve it via MasterRegistry (the panel derives it from `getInstanceVaults`/`getActiveVault`,
  // same source the app itself trusts).
  const MASTER_ABI = [
    {
      type: 'function',
      name: 'getActiveVault',
      stateMutability: 'view',
      inputs: [{ type: 'address' }],
      outputs: [{ type: 'address' }],
    },
  ] as const
  const localDeployment = JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../src/config/local-deployment.json', import.meta.url)),
      'utf8',
    ),
  ) as { contracts: { MasterRegistryV1: Address } }
  const vault = (await client.readContract({
    address: localDeployment.contracts.MasterRegistryV1,
    abi: MASTER_ABI,
    functionName: 'getActiveVault',
    args: [neonDrift],
  })) as Address

  const principalBefore = (await client.readContract({
    address: vault,
    abi: VAULT_ABI,
    functionName: 'principalOf',
    args: [neonDrift],
  })) as bigint
  expect(principalBefore).toBeGreaterThan(0n) // the seed deposit — permanent, not gated on anything

  const snapshot = await testClient.snapshot()
  try {
    // A year of Aave interest is plenty to crystallize into a nonzero creator leg. `harvest()` is
    // permissionless, so any unlocked anvil account can send it — impersonate ADMIN rather than pull
    // in a second funded key for a single call.
    await testClient.increaseTime({ seconds: 365 * 24 * 3600 })
    await testClient.mine({ blocks: 1 })
    await testClient.impersonateAccount({ address: ADMIN })
    await testClient.sendTransaction({
      account: ADMIN,
      to: vault,
      data: '0x4641257d', // harvest()
    })
    await testClient.mine({ blocks: 1 })
    await testClient.stopImpersonatingAccount({ address: ADMIN })

    const claimableAfterHarvest = (await client.readContract({
      address: vault,
      abi: VAULT_ABI,
      functionName: 'calculateClaimableAmount',
      args: [neonDrift],
    })) as bigint
    expect(claimableAfterHarvest).toBeGreaterThan(0n)

    await page.reload()
    await connectWallet(page)
    const panel = page.getByTestId('vault-panel')
    await expect(panel).toBeVisible({ timeout: 15_000 })
    await panel.locator('summary').click() // open the <details> disclosure — content is hidden until then
    await expect(panel.getByTestId('vault-claim-yield')).toBeEnabled({ timeout: 20_000 })
    await panel.getByTestId('vault-claim-yield').click()
    await expect(panel.getByTestId('vault-claim-yield-success')).toBeVisible({ timeout: 20_000 })

    // Claiming yield never touches principal — it is a separate, permanent bucket.
    const principalAfter = (await client.readContract({
      address: vault,
      abi: VAULT_ABI,
      functionName: 'principalOf',
      args: [neonDrift],
    })) as bigint
    expect(principalAfter).toBe(principalBefore)
  } finally {
    await testClient.revert({ id: snapshot })
  }
})
