/**
 * @fork — write-path walk of the metadata-resolution stack (ADR-0006/0007).
 *
 * Drives the REAL stepped launch wizard with an injected, auto-signing anvil wallet to create an
 * ERC-404 collection whose metadata stack is wired + sealed in the SAME create tx:
 *   resolver (MetadataResolverRouter) → [overlay (MetadataOverlayModule), tier (TierRevealModule)]
 * with a single sealed tier row (ids 1-2 reveal "rare-<id>" once the holder clears a 2-unit
 * threshold; teaser "locked-" below it).
 *
 * Then it proves the seam actually composes on-chain (the thing unit tests can't: UI → factory
 * metadata overload → modules sealed → `_tokenURI` seam), reading everything back with viem:
 *   1. wiring — instance.modules[METADATA_RESOLVER] == router; router children == [overlay, tier]
 *      in precedence order; tier table sealed with the row we authored; overlay configured.
 *   2. precedence + tier reveal FLIPS WITH BALANCE — buy 1 unit → tokenURI(1) == "locked-"
 *      (below threshold); buy a 2nd unit → tokenURI(1) == "rare-1" (crossed the threshold).
 *   3. overlay over base — a PAY commission on id 3 (outside the tier range) unlocks to
 *      "commission-3"; then a holder BASE pin declines the overlay → falls through to base "3".
 *
 * Needs the local fork up + deployed (`pnpm chain:fork` then `pnpm chain:deploy`). Run via
 * `pnpm test:e2e` (tagged @fork, not @archive — it only reads locally-deployed contracts).
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toHex,
  parseEther,
  type Address,
  type Hex,
} from 'viem'
import { test, expect, connectWallet, ANVIL_RPC, TEST_ACCOUNT } from './fixtures/anvilWallet'

const forkChain = {
  id: 1337,
  name: 'anvil-fork',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [ANVIL_RPC] } },
} as const

// The instance's generic module slot key — keccak256("metadata.resolver") (see ERC404BondingInstance).
const METADATA_RESOLVER = keccak256(toHex('metadata.resolver'))
const ZERO32 = `0x${'0'.repeat(64)}` as Hex

// ── ABIs (minimal, hand-written — these modules aren't in the frontend deployment subset) ─────
const INSTANCE_ABI = [
  {
    type: 'function',
    name: 'modules',
    stateMutability: 'view',
    inputs: [{ type: 'bytes32' }],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'unit',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'owner',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'mirrorERC721',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  // NB: tokenURI lives on the DN404 *mirror* (ERC-721), not the base instance — read it there.
  {
    type: 'function',
    name: 'tokenURI',
    stateMutability: 'view',
    inputs: [{ type: 'uint256' }],
    outputs: [{ type: 'string' }],
  },
  {
    type: 'function',
    name: 'setBondingOpenTime',
    stateMutability: 'nonpayable',
    inputs: [{ type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setBondingActive',
    stateMutability: 'nonpayable',
    inputs: [{ type: 'bool' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'buyBonding',
    stateMutability: 'payable',
    inputs: [
      { type: 'uint256' }, // amount
      { type: 'uint256' }, // maxCost
      { type: 'bool' }, // mintNFT
      { type: 'bytes32' }, // passwordHash
      { type: 'bytes' }, // messageData
      { type: 'uint256' }, // deadline
    ],
    outputs: [],
  },
] as const

const ROUTER_ABI = [
  {
    type: 'function',
    name: 'resolverCount',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'resolvers',
    stateMutability: 'view',
    inputs: [{ type: 'address' }, { type: 'uint256' }],
    outputs: [{ type: 'address' }],
  },
] as const

const TIER_ABI = [
  {
    type: 'function',
    name: 'tierCount',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'tiers',
    stateMutability: 'view',
    inputs: [{ type: 'address' }, { type: 'uint256' }],
    outputs: [
      { type: 'uint256', name: 'idStart' },
      { type: 'uint256', name: 'idEnd' },
      { type: 'uint256', name: 'minBalance' },
      { type: 'string', name: 'baseURI' },
      { type: 'string', name: 'lockedURI' },
    ],
  },
] as const

const OVERLAY_ABI = [
  {
    type: 'function',
    name: 'configured',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'setCommission',
    stateMutability: 'nonpayable',
    inputs: [
      { type: 'address' }, // inst
      { type: 'uint256' }, // id
      { type: 'string' }, // uri
      { type: 'uint8' }, // CommCond (0=NONE, 1=PAY)
      { type: 'uint256' }, // price
      { type: 'uint8' }, // Payout (0=ARTIST, 1=SPLIT)
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'unlock',
    stateMutability: 'payable',
    inputs: [{ type: 'address' }, { type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'select',
    stateMutability: 'nonpayable',
    inputs: [{ type: 'address' }, { type: 'uint256' }, { type: 'uint256' }],
    outputs: [],
  },
] as const

const publicClient = createPublicClient({ chain: forkChain, transport: http(ANVIL_RPC) })
// anvil account #0 is UNLOCKED on the fork → a JSON-RPC (address) account: anvil signs
// eth_sendTransaction itself, exactly like the injected wallet the UI uses.
const walletClient = createWalletClient({
  account: TEST_ACCOUNT,
  chain: forkChain,
  transport: http(ANVIL_RPC),
})

const COMM_PAY = 1
const PAYOUT_ARTIST = 0
const SEL_BASE = 1n // MetadataOverlayModule pointer: 1 = BASE (decline overlay → lower stack/base)

/** Wait for a write (from account #0) to mine. Call as `await send(walletClient.writeContract({…}))`
 *  so writeContract's per-abi overload types the request (and allows `value` on payable fns). */
async function send(hash: Promise<Hex>) {
  await publicClient.waitForTransactionReceipt({ hash: await hash })
}

const tokenURI = (mirror: Address, id: bigint) =>
  publicClient.readContract({
    address: mirror,
    abi: INSTANCE_ABI,
    functionName: 'tokenURI',
    args: [id],
  })

test('metadata stack: wizard-create seals resolver→[overlay,tier], reveal flips with balance, overlay over base @fork', async ({
  page,
}) => {
  const THRESHOLD = 2n * 10n ** 24n // 2 units at preset-1 unit (1e24) — see the "Min balance" field below

  // ── STEP 01 · Contract — ERC-404 + core details ─────────────────────────────
  await page.goto('/launch')
  await connectWallet(page)

  // Selecting the ERC-404 card resets the wizard to this contract type (default is ERC-1155).
  await page.getByRole('button', { name: 'ERC-404' }).click()

  // On-chain name rules (MetadataUtils.isValidName): [A-Za-z0-9_-], ≤64, no spaces. Randomize to
  // dodge isNameTaken collisions across re-runs.
  // Labels carry a required-asterisk span (+ a unit span on some), so match by prefix, not exact.
  const name = `E2E-Meta-${Date.now()}`
  await page.getByLabel(/^Name/).fill(name)
  await page.getByLabel(/^Symbol/).fill('PRISM')
  // Core `metadataURI` is validated-but-unused (submit uses the collection-page editor's data URI);
  // fill it just to pass the form.
  await page.getByLabel(/^Collection metadata/).fill('data:application/json,{}')
  // Owner is validated here but the create always uses the connected wallet as owner (see submit.ts).
  await page.getByLabel(/^Owner/).fill(TEST_ACCOUNT)
  await page.getByLabel(/^NFT supply/).fill('20')
  // Preset 1 (STANDARD) → unit = 1e24. selectOption commits the value to form state (a plain default
  // isn't submitted). Leave "Token base URI" blank so the base tokenURI is the bare id.
  await page.getByLabel(/^Launch preset/).selectOption('1')
  await page.getByRole('button', { name: /Continue/ }).click()

  // ── STEP 02 · Modules — wire the resolver stack + author the sealed tier table ────
  await page.getByRole('button', { name: 'Metadata Resolver' }).click() // router → METADATA_RESOLVER slot
  await page.getByRole('button', { name: 'Artist Overlay' }).click() // child 0 (precedence: overlay first)
  await page.getByRole('button', { name: 'Rarity Tiers' }).click() // child 1 (rarity reveal)

  // One tier row: ids 1-2 reveal "rare-<id>" once the holder clears 2 units; teaser "locked-" below.
  // The table is captured as parallel lists (mirrors password-tier-gating), so add + fill each column.
  await page.getByRole('button', { name: '+ Add Start id' }).click()
  await page.getByLabel('Start id 1', { exact: true }).fill('1')
  await page.getByRole('button', { name: '+ Add End id' }).click()
  await page.getByLabel('End id 1', { exact: true }).fill('2')
  await page.getByRole('button', { name: '+ Add Min balance' }).click()
  await page.getByLabel('Min balance 1', { exact: true }).fill(THRESHOLD.toString())
  await page.getByRole('button', { name: '+ Add Revealed URI' }).click()
  await page.getByLabel('Revealed URI 1', { exact: true }).fill('rare-')
  await page.getByRole('button', { name: '+ Add Locked URI' }).click()
  await page.getByLabel('Locked URI 1', { exact: true }).fill('locked-')
  await page.getByRole('button', { name: /Continue/ }).click()

  // ── STEP 03 · Gating — leave open (skip) ────────────────────────────────────
  await page.getByRole('button', { name: /Continue/ }).click()

  // ── STEP 04 · Liquidity — required; pick the ZAMM deployer (mirrors the seed's stacked collection) ─
  await page.getByRole('button', { name: 'ZAMM Deployer' }).click()
  await page.getByRole('button', { name: /Continue/ }).click()

  // ── STEP 05 · Alignment — family → venue picker: pick Yield (Aave), then its venue ───
  await page.getByRole('button', { name: /^Yield/ }).click()
  await page
    .getByRole('button', { name: /target #/ })
    .first()
    .click()
  await page.getByRole('button', { name: /Continue/ }).click()

  // ── STEP 06 · Collection page — a name is required to deploy ─────────────────
  await page.locator('#cmf-name').fill(name)
  await page.getByRole('button', { name: /Continue/ }).click()

  // ── STEP 07 · Review & deploy — the injected wallet auto-signs ───────────────
  await page.getByRole('button', { name: 'Deploy collection' }).click()
  await page.waitForURL(/\/collection\/0x[0-9a-fA-F]{40}/, { timeout: 30_000 })
  const instance = page.url().match(/\/collection\/(0x[0-9a-fA-F]{40})/)![1] as Address

  // ── Wiring — everything sealed in the ONE create tx ─────────────────────────
  const readResolverSlot = () =>
    publicClient.readContract({
      address: instance,
      abi: INSTANCE_ABI,
      functionName: 'modules',
      args: [METADATA_RESOLVER],
    })
  await expect
    .poll(readResolverSlot, { timeout: 15_000 })
    .not.toBe('0x0000000000000000000000000000000000000000')
  const router = (await readResolverSlot()) as Address

  expect(
    await publicClient.readContract({
      address: router,
      abi: ROUTER_ABI,
      functionName: 'resolverCount',
      args: [instance],
    }),
  ).toBe(2n)
  const overlay = (await publicClient.readContract({
    address: router,
    abi: ROUTER_ABI,
    functionName: 'resolvers',
    args: [instance, 0n],
  })) as Address
  const tier = (await publicClient.readContract({
    address: router,
    abi: ROUTER_ABI,
    functionName: 'resolvers',
    args: [instance, 1n],
  })) as Address

  // Child 0 is the overlay (has `configured`), child 1 is the tier (has the sealed table) — proves ORDER.
  expect(
    await publicClient.readContract({
      address: overlay,
      abi: OVERLAY_ABI,
      functionName: 'configured',
      args: [instance],
    }),
  ).toBe(true)
  expect(
    await publicClient.readContract({
      address: tier,
      abi: TIER_ABI,
      functionName: 'tierCount',
      args: [instance],
    }),
  ).toBe(1n)
  const row = (await publicClient.readContract({
    address: tier,
    abi: TIER_ABI,
    functionName: 'tiers',
    args: [instance, 0n],
  })) as readonly [bigint, bigint, bigint, string, string]
  expect(row[0]).toBe(1n) // idStart
  expect(row[1]).toBe(2n) // idEnd
  expect(row[2]).toBe(THRESHOLD) // minBalance survived the number input intact
  expect(row[3]).toBe('rare-') // baseURI
  expect(row[4]).toBe('locked-') // lockedURI

  const unit = (await publicClient.readContract({
    address: instance,
    abi: INSTANCE_ABI,
    functionName: 'unit',
  })) as bigint
  expect(THRESHOLD).toBe(2n * unit) // sanity: the threshold we set is exactly 2 units for this preset

  // tokenURI (and the metadata seam) is served by the DN404 mirror, not the base instance.
  const mirror = (await publicClient.readContract({
    address: instance,
    abi: INSTANCE_ABI,
    functionName: 'mirrorERC721',
  })) as Address

  // ── Behaviour — mint tokens through the bonding curve, then read the seam ────
  // Owner (account #0) opens + activates bonding so buyBonding is callable (openTime need not elapse).
  const now = (await publicClient.getBlock()).timestamp
  await send(
    walletClient.writeContract({
      address: instance,
      abi: INSTANCE_ABI,
      functionName: 'setBondingOpenTime',
      args: [now + 3600n],
      chain: forkChain,
      account: TEST_ACCOUNT,
    }),
  )
  await send(
    walletClient.writeContract({
      address: instance,
      abi: INSTANCE_ABI,
      functionName: 'setBondingActive',
      args: [true],
      chain: forkChain,
      account: TEST_ACCOUNT,
    }),
  )

  const buyOneUnit = () =>
    send(
      walletClient.writeContract({
        address: instance,
        abi: INSTANCE_ABI,
        functionName: 'buyBonding',
        // amount=1 unit, mintNFT=true → mints the next sequential id to the buyer. Over-send + refund.
        args: [unit, parseEther('50'), true, ZERO32, '0x', 0n],
        value: parseEther('50'),
        chain: forkChain,
        account: TEST_ACCOUNT,
      }),
    )

  // Buy 1 unit → owns id 1, balance 1 unit < 2-unit threshold → tier serves the locked teaser.
  await buyOneUnit()
  expect(
    await publicClient.readContract({
      address: instance,
      abi: INSTANCE_ABI,
      functionName: 'balanceOf',
      args: [TEST_ACCOUNT],
    }),
  ).toBe(unit)
  await expect.poll(() => tokenURI(mirror, 1n), { timeout: 15_000 }).toBe('locked-')

  // Buy a 2nd unit → balance 2 units ≥ threshold → SAME id 1 flips to the revealed "rare-1".
  await buyOneUnit()
  await expect.poll(() => tokenURI(mirror, 1n), { timeout: 15_000 }).toBe('rare-1')

  // Buy a 3rd unit → owns id 3, which is OUTSIDE the tier range → stack yields "" → base is the bare id.
  await buyOneUnit()
  await expect.poll(() => tokenURI(mirror, 3n), { timeout: 15_000 }).toBe('3')

  // ── Overlay over base — a paid commission on id 3, then a holder BASE pin ────
  // Artist (owner) sets a PAY commission, holder pays to unlock+pin it in one tx.
  await send(
    walletClient.writeContract({
      address: overlay,
      abi: OVERLAY_ABI,
      functionName: 'setCommission',
      args: [instance, 3n, 'commission-3', COMM_PAY, parseEther('0.01'), PAYOUT_ARTIST],
      chain: forkChain,
      account: TEST_ACCOUNT,
    }),
  )
  await send(
    walletClient.writeContract({
      address: overlay,
      abi: OVERLAY_ABI,
      functionName: 'unlock',
      args: [instance, 3n],
      value: parseEther('0.01'),
      chain: forkChain,
      account: TEST_ACCOUNT,
    }),
  )
  await expect.poll(() => tokenURI(mirror, 3n), { timeout: 15_000 }).toBe('commission-3')

  // Holder pins BASE → overlay declines → tier has nothing for id 3 → falls through to base "3".
  await send(
    walletClient.writeContract({
      address: overlay,
      abi: OVERLAY_ABI,
      functionName: 'select',
      args: [instance, 3n, SEL_BASE],
      chain: forkChain,
      account: TEST_ACCOUNT,
    }),
  )
  await expect.poll(() => tokenURI(mirror, 3n), { timeout: 15_000 }).toBe('3')
})
