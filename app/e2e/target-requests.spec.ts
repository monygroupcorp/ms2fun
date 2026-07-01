/**
 * @fork — write-path walk of the alignment-target request path (alignment-target-requests.md).
 *
 * Drives the REAL /request-target form with an injected, auto-signing anvil wallet to submit a target
 * request (permissionless, deposit-escrowed), asserts it on-chain + in the "my requests" UI, then
 * completes the ADMIN side via viem (impersonating the ADMIN owner): register the target (prefilled
 * from the request) + approve. Finally asserts the choke-point end-to-end — the new target is active
 * and its token resolves via isTokenInTarget, i.e. a vault could now bind to it — plus the deposit
 * refund and the requester's status flipping to Approved.
 *
 * Needs the local fork up + deployed (`pnpm chain:fork` then `pnpm chain:deploy`). Run via
 * `pnpm test:e2e` (tagged @fork).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  http,
  parseEventLogs,
  type Address,
} from 'viem'
import { test, expect, connectWallet, ANVIL_RPC, TEST_ACCOUNT } from './fixtures/anvilWallet'

const forkChain = {
  id: 1337,
  name: 'anvil-fork',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [ANVIL_RPC] } },
} as const

const ADMIN = '0x54EfD4549AE44bD03B2cCC1C72492CA9A3219C86' as Address

const deployment = JSON.parse(
  readFileSync(fileURLToPath(new URL('../src/config/local-deployment.json', import.meta.url)), 'utf8'),
) as { contracts: { AlignmentTargetRequestRegistry: Address; AlignmentRegistryV1: Address } }
const REQ = deployment.contracts.AlignmentTargetRequestRegistry
const REGISTRY = deployment.contracts.AlignmentRegistryV1

/** A unique, all-lowercase token address per run (no existing target → passes the dup guard). */
function freshToken(): Address {
  return `0x${BigInt(Date.now()).toString(16).padStart(40, '0')}` as Address
}

const REQ_ABI = [
  { type: 'function', name: 'requestDeposit', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'nextRequestId', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approveRequest', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }], outputs: [] },
  {
    type: 'function', name: 'getRequest', stateMutability: 'view', inputs: [{ type: 'uint256' }],
    outputs: [{
      type: 'tuple', components: [
        { name: 'requester', type: 'address' }, { name: 'token', type: 'address' },
        { name: 'title', type: 'string' }, { name: 'description', type: 'string' },
        { name: 'metadataURI', type: 'string' }, { name: 'deposit', type: 'uint256' },
        { name: 'submittedAt', type: 'uint40' }, { name: 'status', type: 'uint8' },
      ],
    }],
  },
  {
    type: 'function', name: 'getRequestAssets', stateMutability: 'view', inputs: [{ type: 'uint256' }],
    outputs: [{
      type: 'tuple[]', components: [
        { name: 'token', type: 'address' }, { name: 'symbol', type: 'string' },
        { name: 'info', type: 'string' }, { name: 'metadataURI', type: 'string' },
      ],
    }],
  },
] as const

const REGISTRY_ABI = [
  {
    type: 'function', name: 'registerAlignmentTarget', stateMutability: 'nonpayable',
    inputs: [
      { type: 'string' }, { type: 'string' }, { type: 'string' },
      { type: 'tuple[]', components: [
        { name: 'token', type: 'address' }, { name: 'symbol', type: 'string' },
        { name: 'info', type: 'string' }, { name: 'metadataURI', type: 'string' },
      ] },
    ],
    outputs: [{ type: 'uint256' }],
  },
  { type: 'function', name: 'isAlignmentTargetActive', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'isTokenInTarget', stateMutability: 'view', inputs: [{ type: 'uint256' }, { type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'event', name: 'AlignmentTargetRegistered', inputs: [{ name: 'targetId', type: 'uint256', indexed: true }, { name: 'title', type: 'string', indexed: false }] },
] as const

const publicClient = createPublicClient({ chain: forkChain, transport: http(ANVIL_RPC) })
const testClient = createTestClient({ chain: forkChain, mode: 'anvil', transport: http(ANVIL_RPC) })
const adminWallet = createWalletClient({ account: ADMIN, chain: forkChain, transport: http(ANVIL_RPC) })

test('target request: submit via the form, admin register+approve, target goes active + refunded @fork', async ({
  page,
}) => {
  const deposit = (await publicClient.readContract({ address: REQ, abi: REQ_ABI, functionName: 'requestDeposit' })) as bigint
  const title = `E2E Target ${Date.now()}`
  const TOKEN = freshToken()
  // Snapshot pre-submit so the walk is robust to any residual requests from a prior run.
  const idBefore = (await publicClient.readContract({ address: REQ, abi: REQ_ABI, functionName: 'nextRequestId' })) as bigint
  const escrowBefore = await publicClient.getBalance({ address: REQ })

  // ── Requester — submit through the real form ────────────────────────────────
  await page.goto('/request-target')
  await connectWallet(page)

  await page.getByLabel('community token address').fill(TOKEN)
  await page.getByLabel('target title').fill(title)
  await page.getByLabel('target description').fill('an e2e community')
  await page.getByLabel('target metadata URI').fill('ipfs://meta')
  await page.getByLabel('asset 1 token address').fill(TOKEN)
  await page.getByLabel('asset 1 symbol').fill('E2E')
  await page.getByLabel('asset 1 info').fill('e2e asset')

  await page.getByTestId('submit-request').click()

  // One submit → id == idBefore + 1 (post-increment).
  await expect
    .poll(async () => (await publicClient.readContract({ address: REQ, abi: REQ_ABI, functionName: 'nextRequestId' })) as bigint, { timeout: 20_000 })
    .toBeGreaterThan(idBefore)
  const id = idBefore + 1n

  const req = (await publicClient.readContract({ address: REQ, abi: REQ_ABI, functionName: 'getRequest', args: [id] })) as {
    requester: Address; token: Address; title: string; deposit: bigint; status: number
  }
  expect(req.requester.toLowerCase()).toBe(TEST_ACCOUNT.toLowerCase())
  expect(req.token.toLowerCase()).toBe(TOKEN.toLowerCase())
  expect(req.title).toBe(title)
  expect(req.deposit).toBe(deposit)
  expect(req.status).toBe(1) // Pending
  // escrow grew by exactly one deposit
  expect(await publicClient.getBalance({ address: REQ })).toBe(escrowBefore + deposit)
  // the requester sees it as pending in "my requests"
  await expect(page.getByTestId(`my-request-${id}`)).toContainText('Pending', { timeout: 15_000 })

  // ── Admin — register the target (prefilled) + approve, as the ADMIN owner ────
  const assets = (await publicClient.readContract({ address: REQ, abi: REQ_ABI, functionName: 'getRequestAssets', args: [id] })) as readonly {
    token: Address; symbol: string; info: string; metadataURI: string
  }[]

  await testClient.impersonateAccount({ address: ADMIN })

  const regHash = await adminWallet.writeContract({
    address: REGISTRY, abi: REGISTRY_ABI, functionName: 'registerAlignmentTarget',
    args: [req.title, 'an e2e community', 'ipfs://meta', assets.map((a) => ({ ...a })) as never],
    chain: forkChain, account: ADMIN,
  })
  const regReceipt = await publicClient.waitForTransactionReceipt({ hash: regHash })
  const [regEvent] = parseEventLogs({ abi: REGISTRY_ABI, eventName: 'AlignmentTargetRegistered', logs: regReceipt.logs })
  const targetId = (regEvent as unknown as { args: { targetId: bigint } }).args.targetId

  const approveHash = await adminWallet.writeContract({
    address: REQ, abi: REQ_ABI, functionName: 'approveRequest', args: [id], chain: forkChain, account: ADMIN,
  })
  await publicClient.waitForTransactionReceipt({ hash: approveHash })

  await testClient.stopImpersonatingAccount({ address: ADMIN })

  // ── Choke-point end-to-end — the target is now bindable, deposit refunded ────
  expect(await publicClient.readContract({ address: REGISTRY, abi: REGISTRY_ABI, functionName: 'isAlignmentTargetActive', args: [targetId] })).toBe(true)
  expect(await publicClient.readContract({ address: REGISTRY, abi: REGISTRY_ABI, functionName: 'isTokenInTarget', args: [targetId, TOKEN] })).toBe(true)

  const after = (await publicClient.readContract({ address: REQ, abi: REQ_ABI, functionName: 'getRequest', args: [id] })) as { deposit: bigint; status: number }
  expect(after.status).toBe(2) // Approved
  expect(after.deposit).toBe(0n)
  expect(await publicClient.getBalance({ address: REQ })).toBe(escrowBefore) // my deposit refunded out
})
