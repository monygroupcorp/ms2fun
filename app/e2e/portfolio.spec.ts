/**
 * @fork — write-path walk of the two portfolio-side actions (testnet program step 2 / B1-B4
 * re-verify), both driven as the SEEDED holder ADMIN (SeedAnvil.s.sol hands ADMIN a whole vapor-mid
 * NFT-unit + ownership of neon-drift — see `_seedErc404MidCurve` / `_transferAdmin`), through the REAL
 * per-collection UI:
 *
 *   - `rerollSelectedNFTs` on the seeded "vapor-mid" ERC404 (Erc404Portfolio's reroll control).
 *   - `withdrawPrincipal` on the seeded "neon-drift" ERC1155's Aave endowment vault (VaultPanel).
 *     `calculateClaimableAmount` (what VaultPanel's withdraw button gates on) is 0 until the 365-day
 *     MATURITY_DURATION has elapsed, so the anvil chain clock is warped past it first — bracketed in
 *     an evm_snapshot/evm_revert so the jump doesn't leak into whatever else shares this fork.
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
    name: 'principal',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'depositTime',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'maturityDuration',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const

test('portfolio: reroll (vapor-mid) + withdraw principal (neon-drift, matured), both as seeded holder ADMIN @fork', async ({
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

  // ── 2 · withdrawPrincipal on neon-drift's Aave endowment vault, as ADMIN (the instance owner) ──
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

  const claimableBeforeWarp = (await client.readContract({
    address: vault,
    abi: VAULT_ABI,
    functionName: 'calculateClaimableAmount',
    args: [neonDrift],
  })) as bigint
  expect(claimableBeforeWarp).toBe(0n) // locked — the seed deposit hasn't matured yet

  const depositTime = (await client.readContract({
    address: vault,
    abi: VAULT_ABI,
    functionName: 'depositTime',
    args: [neonDrift],
  })) as bigint
  const maturityDuration = (await client.readContract({
    address: vault,
    abi: VAULT_ABI,
    functionName: 'maturityDuration',
  })) as bigint

  const snapshot = await testClient.snapshot()
  try {
    const nowSec = BigInt(Math.floor(Date.now() / 1000))
    const targetSec = depositTime + maturityDuration + 3600n // an hour past maturity
    const forwardSecs = Number(targetSec - nowSec)
    await testClient.increaseTime({ seconds: forwardSecs })
    await testClient.mine({ blocks: 1 })

    const claimableAfterWarp = (await client.readContract({
      address: vault,
      abi: VAULT_ABI,
      functionName: 'calculateClaimableAmount',
      args: [neonDrift],
    })) as bigint
    expect(claimableAfterWarp).toBeGreaterThan(0n)

    await page.reload()
    await connectWallet(page)
    const matured = page.getByTestId('vault-panel')
    await expect(matured).toBeVisible({ timeout: 15_000 })
    await matured.locator('summary').click() // open the <details> disclosure — content is hidden until then
    await expect(matured.getByTestId('vault-withdraw-principal')).toBeEnabled({ timeout: 20_000 })
    await matured.getByTestId('vault-withdraw-principal').click()
    await expect(matured.getByTestId('vault-withdraw-principal-success')).toBeVisible({
      timeout: 20_000,
    })

    const principalAfter = (await client.readContract({
      address: vault,
      abi: VAULT_ABI,
      functionName: 'principal',
      args: [neonDrift],
    })) as bigint
    expect(principalAfter).toBe(0n) // fully withdrawn — the ledger clears on withdraw
  } finally {
    await testClient.revert({ id: snapshot })
  }
})
