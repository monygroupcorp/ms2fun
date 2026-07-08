/**
 * @fork — write-path walk of the /admin console (Interface K, testnet program step 2 / B1-B4
 * re-verify), one representative write per HANDED-OVER registry, driven through the REAL admin UI as
 * the impersonated ADMIN wallet (SeedAnvil.s.sol `_transferAdmin` hands ADMIN the 5 platform
 * registries via the 2-step handover — see deploy.ts):
 *
 *   - MasterRegistryV1        → update an existing instance's metadata URI.
 *   - AlignmentRegistryV1     → register a brand-new alignment target.
 *   - AlignmentTargetRequestRegistry (the "target requests" section of AlignmentPanel) → register +
 *     approve a pending request (submitted as anvil #0 via viem — the REQUESTER-side UI walk is
 *     already covered by target-requests.spec; this spec's job is the ADMIN side through the real UI).
 *   - ComponentRegistry       → approve a component.
 *   - FeaturedQueueManager    → set the daily rent rate (via PlatformConfigPanel's featured-queue
 *     config section — the OTHER two PlatformConfigPanel sections, message-board + carve economics,
 *     are deployer-owned, not handed to ADMIN, so they're DEFERRED per the scout).
 *
 * TreasuryPanel + the deployer-owned PlatformConfig sections are DEFERRED (not part of the handover;
 * would need a deploy.ts extension — a separate item). EXEC404 portfolio writes are covered (deferred)
 * in portfolio.spec.
 *
 * Needs the local fork up + deployed (`pnpm chain:fork` then `pnpm chain:deploy`). Run via
 * `pnpm test:e2e` (tagged @fork, not @archive — it only reads locally-deployed contracts).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createPublicClient, createWalletClient, http, type Address } from 'viem'
import {
  adminTest as test,
  expect,
  connectWallet,
  ANVIL_RPC,
  TEST_ACCOUNT,
} from './fixtures/anvilWallet'

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
) as {
  contracts: {
    MasterRegistryV1: Address
    AlignmentRegistryV1: Address
    AlignmentTargetRequestRegistry: Address
    ComponentRegistry: Address
    FeaturedQueueManager: Address
  }
  factories: { ERC1155Factory: Address }
}
const MASTER_REGISTRY = deployment.contracts.MasterRegistryV1
const ALIGNMENT_REGISTRY = deployment.contracts.AlignmentRegistryV1
const REQUEST_REGISTRY = deployment.contracts.AlignmentTargetRequestRegistry
const COMPONENT_REGISTRY = deployment.contracts.ComponentRegistry
const FQM = deployment.contracts.FeaturedQueueManager

const client = createPublicClient({ chain: forkChain, transport: http(ANVIL_RPC) })
// anvil #0 is unlocked — used only to submit the target request this spec's admin side then processes.
const userWallet = createWalletClient({
  account: TEST_ACCOUNT,
  chain: forkChain,
  transport: http(ANVIL_RPC),
})

/** A unique, all-lowercase token address per run (dodges the request registry's dup guard). */
function freshToken(): Address {
  return `0x${BigInt(Date.now()).toString(16).padStart(40, '0')}` as Address
}

// ── ERC1155Factory: find the seeded "neon-drift" instance (already registered on MasterRegistry) ──
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

async function findErc1155ByName(name: string): Promise<Address> {
  const logs = await client.getLogs({
    address: deployment.factories.ERC1155Factory,
    event: INSTANCE_CREATED_1155,
    fromBlock: 0n,
    toBlock: 'latest',
  })
  const hit = logs.find((l) => l.args.name === name)
  if (!hit?.args.instance) throw new Error(`seeded ERC1155 instance "${name}" not found`)
  return hit.args.instance
}

const MASTER_ABI = [
  {
    type: 'function',
    name: 'getInstanceInfo',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'instance', type: 'address' },
          { name: 'factory', type: 'address' },
          { name: 'creator', type: 'address' },
          { name: 'vaults', type: 'address[]' },
          { name: 'name', type: 'string' },
          { name: 'metadataURI', type: 'string' },
          { name: 'nameHash', type: 'bytes32' },
          { name: 'registeredAt', type: 'uint256' },
        ],
      },
    ],
  },
] as const

const REGISTRY_ABI = [
  {
    type: 'function',
    name: 'getAlignmentTarget',
    stateMutability: 'view',
    inputs: [{ type: 'uint256' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'title', type: 'string' },
          { name: 'description', type: 'string' },
          { name: 'metadataURI', type: 'string' },
          { name: 'active', type: 'bool' },
          { name: 'approvedAt', type: 'uint256' },
        ],
      },
    ],
  },
  {
    type: 'event',
    name: 'AlignmentTargetRegistered',
    inputs: [
      { name: 'targetId', type: 'uint256', indexed: true },
      { name: 'title', type: 'string', indexed: false },
    ],
  },
] as const

const REQ_ABI = [
  {
    type: 'function',
    name: 'requestDeposit',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'nextRequestId',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'submitRequest',
    stateMutability: 'payable',
    inputs: [
      { type: 'address' },
      { type: 'string' },
      { type: 'string' },
      { type: 'string' },
      {
        type: 'tuple[]',
        components: [
          { name: 'token', type: 'address' },
          { name: 'symbol', type: 'string' },
          { name: 'info', type: 'string' },
          { name: 'metadataURI', type: 'string' },
        ],
      },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getRequest',
    stateMutability: 'view',
    inputs: [{ type: 'uint256' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'requester', type: 'address' },
          { name: 'token', type: 'address' },
          { name: 'title', type: 'string' },
          { name: 'description', type: 'string' },
          { name: 'metadataURI', type: 'string' },
          { name: 'deposit', type: 'uint256' },
          { name: 'submittedAt', type: 'uint40' },
          { name: 'status', type: 'uint8' },
        ],
      },
    ],
  },
] as const

const COMPONENT_ABI = [
  {
    type: 'function',
    name: 'getApprovedComponents',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address[]' }],
  },
] as const

const FQM_ABI = [
  {
    type: 'function',
    name: 'dailyRate',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const

test('admin console: one write per handed-over registry, all through the real UI as ADMIN @fork', async ({
  page,
}) => {
  test.setTimeout(90_000)

  // ── Setup (viem, anvil #0): a pending target request for the admin console to process ────────
  const deposit = (await client.readContract({
    address: REQUEST_REGISTRY,
    abi: REQ_ABI,
    functionName: 'requestDeposit',
  })) as bigint
  const REQ_TOKEN = freshToken()
  const submitHash = await userWallet.writeContract({
    address: REQUEST_REGISTRY,
    abi: REQ_ABI,
    functionName: 'submitRequest',
    args: [
      REQ_TOKEN,
      'E2E Admin-Console Target',
      'submitted for the admin console @fork walk',
      'ipfs://meta',
      [{ token: REQ_TOKEN, symbol: 'E2EAC', info: 'e2e asset' }],
    ],
    value: deposit,
    chain: forkChain,
    account: TEST_ACCOUNT,
  })
  await client.waitForTransactionReceipt({ hash: submitHash })
  const reqId = (await client.readContract({
    address: REQUEST_REGISTRY,
    abi: REQ_ABI,
    functionName: 'nextRequestId',
  })) as bigint // submitRequest returns id = ++nextRequestId, so this IS the id just submitted

  // ── Open the admin console as ADMIN ─────────────────────────────────────────────────────────
  await page.goto('/admin')
  await connectWallet(page)
  await expect(page.getByTestId('admin-console')).toBeVisible()

  // ── 1 · MasterRegistryV1 — update an existing (seeded) instance's metadata ──────────────────
  const neonDrift = await findErc1155ByName('neon-drift')
  const newUri = `data:application/json,{"e2e":${Date.now()}}`
  await page.getByTestId('admin-update-instance-meta-address').fill(neonDrift)
  await page.getByTestId('admin-update-instance-meta-uri').fill(newUri)
  await page.getByTestId('admin-update-instance-meta').click()
  await expect(page.getByTestId('admin-update-instance-meta-success')).toBeVisible({
    timeout: 20_000,
  })

  const info = (await client.readContract({
    address: MASTER_REGISTRY,
    abi: MASTER_ABI,
    functionName: 'getInstanceInfo',
    args: [neonDrift],
  })) as { metadataURI: string }
  expect(info.metadataURI).toBe(newUri)

  // ── 2 · AlignmentRegistryV1 — register a brand-new target ──────────────────────────────────
  const targetTitle = `E2E Admin Target ${Date.now()}`
  const targetToken = freshToken()
  await page.getByLabel('target title').fill(targetTitle)
  await page.getByLabel('target description').fill('registered from the admin console @fork')
  await page.getByLabel('target metadata URI').fill('ipfs://meta')
  await page.getByLabel('asset token address').fill(targetToken)
  await page.getByLabel('asset symbol').fill('E2EAT')
  await page.getByLabel('asset info').fill('e2e asset')
  await page.getByTestId('admin-register-target').click()
  await expect(page.getByTestId('admin-register-target-success')).toBeVisible({ timeout: 20_000 })

  const regLogs = await client.getLogs({
    address: ALIGNMENT_REGISTRY,
    event: REGISTRY_ABI[1],
    fromBlock: 0n,
    toBlock: 'latest',
  })
  const registered = regLogs.filter((l) => l.args.title === targetTitle)
  expect(registered.length).toBeGreaterThan(0)
  const targetId = registered[registered.length - 1]!.args.targetId!
  const target = (await client.readContract({
    address: ALIGNMENT_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: 'getAlignmentTarget',
    args: [targetId],
  })) as { title: string; active: boolean }
  expect(target.title).toBe(targetTitle)
  expect(target.active).toBe(true)

  // ── 3 · AlignmentTargetRequestRegistry — register + approve the pending request, via the real
  //        admin UI (the requester-side UI walk is covered by target-requests.spec) ─────────────
  const requestsSection = page.getByTestId('admin-target-requests')
  await expect(requestsSection).toBeVisible()
  await expect(requestsSection.getByTestId(`request-${reqId}-readout`)).toContainText(
    'E2E Admin-Console Target',
    { timeout: 15_000 },
  )

  await requestsSection.getByTestId(`request-${reqId}-register`).click()
  await expect(requestsSection.getByTestId(`request-${reqId}-register-success`)).toBeVisible({
    timeout: 20_000,
  })
  await requestsSection.getByTestId(`request-${reqId}-approve`).click()
  await expect(requestsSection.getByTestId(`request-${reqId}-approve-success`)).toBeVisible({
    timeout: 20_000,
  })

  const req = (await client.readContract({
    address: REQUEST_REGISTRY,
    abi: REQ_ABI,
    functionName: 'getRequest',
    args: [reqId],
  })) as { status: number; deposit: bigint }
  expect(req.status).toBe(2) // Approved
  expect(req.deposit).toBe(0n)

  // ── 4 · ComponentRegistry — approve a component ─────────────────────────────────────────────
  // Any deployed contract address qualifies as a "component" for this registry's purposes; the
  // MasterRegistry itself is already deployed and stable, so reuse it as the subject address.
  const componentAddr = MASTER_REGISTRY
  await page.getByTestId('admin-component-address').fill(componentAddr)
  await page.getByTestId('admin-component-tag').fill('e2e_component')
  await page.getByTestId('admin-component-name').fill('E2E Component')
  await page.getByTestId('admin-approve-component').click()
  await expect(page.getByTestId('admin-approve-component-success')).toBeVisible({ timeout: 20_000 })

  const approved = (await client.readContract({
    address: COMPONENT_REGISTRY,
    abi: COMPONENT_ABI,
    functionName: 'getApprovedComponents',
  })) as Address[]
  expect(approved.map((a) => a.toLowerCase())).toContain(componentAddr.toLowerCase())

  // ── 5 · FeaturedQueueManager — set the daily rent rate (PlatformConfigPanel) ────────────────
  const before = (await client.readContract({
    address: FQM,
    abi: FQM_ABI,
    functionName: 'dailyRate',
  })) as bigint
  await page.getByTestId('admin-daily-rate-input').fill('0.002')
  await page.getByTestId('admin-set-daily-rate').click()
  await expect(page.getByTestId('admin-set-daily-rate-success')).toBeVisible({ timeout: 20_000 })

  const after = (await client.readContract({
    address: FQM,
    abi: FQM_ABI,
    functionName: 'dailyRate',
  })) as bigint
  expect(after).toBe(2_000_000_000_000_000n) // 0.002 ETH in wei
  expect(after).not.toBe(before)
})
