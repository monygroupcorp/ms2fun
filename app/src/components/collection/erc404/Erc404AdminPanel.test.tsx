/**
 * Erc404AdminPanel — phase gate (noesis-209). A graduated collection must not offer bonding-lifecycle
 * actions (activate bonding, deploy liquidity, the two time setters) alongside the page's own
 * "graduated to DEX" notice; a still-bonding one must not have `deploy liquidity` hidden by the
 * stricter `canDeployLiquidity` helper (early graduation and a functionally-sold-out-but-not-`full`
 * curve are both real, on-chain-permitted cases — see the plan's corrections). Rows that remain valid
 * post-graduation (style/metadata, vault, fee claim, delegation, allowlist) must stay present
 * regardless of phase — the over-gating guard (test 2).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { formatEther } from 'viem'
import { carveCreatorNet } from '../../../lib/carve'
import type { BondingView } from './bondingPhase'
import { Erc404AdminPanel } from './Erc404AdminPanel'
import { formatMoment, openWindow } from './bondingSchedule'
import { localInputFromEpoch } from '../../../lib/time/scheduleInput'

const NOW = 1_000_000n

const mockBondingData = vi.hoisted(() => vi.fn<() => { view: BondingView | undefined }>())
vi.mock('./useBondingData', () => ({ useBondingData: mockBondingData }))

const mockNowSec = vi.hoisted(() => vi.fn<() => bigint>())
vi.mock('./useNowSec', () => ({ useNowSec: mockNowSec }))

vi.mock('../../ui/useOwnerGate', () => ({
  useOwnerGate: () => ({
    isOwner: true,
    owner: '0x1111111111111111111111111111111111111111',
    connected: '0x1111111111111111111111111111111111111111',
  }),
}))

vi.mock('./MetadataArtistPanel', () => ({ MetadataArtistPanel: () => null }))

// The stranded-tithe row's only logic is the hint it picks from the module's stash; resolving WHICH
// module holds it is useGraduatedVenue's job and is covered there. Mocked here so this file keeps
// testing the panel's rows rather than the venue-detection chain behind one of them.
const mockStrandedTithe = vi.hoisted(() =>
  vi.fn(() => ({
    amount: undefined as bigint | undefined,
    canFlush: false,
    flush: vi.fn(),
    tx: {
      state: 'idle',
      reset: vi.fn(),
      send: vi.fn(),
      isBusy: false,
      hash: undefined,
      reason: undefined,
    },
  })),
)
vi.mock('./useStrandedTithe', () => ({ useStrandedTithe: mockStrandedTithe }))

vi.mock('../../useCollection', () => ({
  useCollection: () => ({ data: { metadataURI: 'ipfs://placeholder' } }),
}))
vi.mock('../../useCollectionMetadata', () => ({ useCollectionMetadata: () => undefined }))

vi.mock('../useCollectionChain', () => ({
  useCollectionChainId: () => 1,
  useCollectionAddresses: () => ({
    DeployBondEscrow: '0x3333333333333333333333333333333333333333',
    MasterRegistryV1: '0x4444444444444444444444444444444444444444',
  }),
}))

// The shared invalidation seam (noesis-352) needs a QueryClient; these tests aren't exercising
// caching, so a stub with a spy-able `invalidateQueries` is enough (no QueryClientProvider needed).
const mockInvalidateQueries = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
  // ArtPointerNotice probes the art pointer through react-query. The panel is mounted whole here
  // (test 2 asserts no row is over-gated), so the hook must resolve — an idle query is enough: the
  // mocked `useCollectionMetadata` returns undefined, so the notice renders nothing either way.
  useQuery: () => ({ data: undefined, isPending: false }),
}))

const mockWriteContract = vi.hoisted(() => vi.fn())

// The carve controls are driven by two on-chain reads: the immutable declared max, and `previewCarve`
// resolved for a given request in bps. Both are per-test fixtures so the panel can be mounted in the
// state that matters — a collection that DID declare carve rights, with the request left at its
// default of 0.
// The open/maturity times stored on chain, as the schedule rows read them (0 = not set).
const mockStoredTimes = vi.hoisted(() =>
  vi.fn<() => { open: bigint; maturity: bigint }>(() => ({ open: 0n, maturity: 0n })),
)
const mockDeclaredMax = vi.hoisted(() => vi.fn<() => number>())
const mockPreviewCarve = vi.hoisted(() => vi.fn<(bps: bigint) => bigint | undefined>())

// The schedule rows read the chain's clock from the pending block. Undefined (the default) leaves
// them on the wall clock; a test that needs the chain ahead points this at a client.
const mockPublicClient = vi.hoisted(() => vi.fn<() => unknown>(() => undefined))

vi.mock('wagmi', () => ({
  usePublicClient: () => mockPublicClient(),
  useBalance: () => ({ data: undefined, refetch: vi.fn() }),
  useWriteContract: () => ({
    writeContract: mockWriteContract,
    data: undefined,
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  }),
  useWaitForTransactionReceipt: () => ({
    isLoading: false,
    isSuccess: false,
    isError: false,
    error: null,
    data: undefined,
  }),
  useBlock: () => ({ data: { timestamp: NOW } }),
}))

vi.mock('../../../generated/contracts', () => ({
  erc404BondingInstanceAbi: [],
  deployBondEscrowAbi: [],
  liquidityDeployerModuleAbi: [],
  masterRegistryV1Abi: [],
  merkleGatingModuleAbi: [],
  useReadDeployBondEscrowBonds: () => ({ data: undefined, refetch: vi.fn() }),
  useReadErc404BondingInstanceAgentDelegationEnabled: () => ({ data: true, refetch: vi.fn() }),
  useReadErc404BondingInstanceBondingActive: () => ({ data: true, refetch: vi.fn() }),
  useReadErc404BondingInstanceBondingMaturityTime: () => ({
    data: mockStoredTimes().maturity,
    refetch: vi.fn(),
  }),
  useReadErc404BondingInstanceBondingOpenTime: () => ({
    data: mockStoredTimes().open,
    refetch: vi.fn(),
  }),
  useReadErc404BondingInstanceDeclaredMaxAllowanceBps: () => ({ data: mockDeclaredMax() }),
  useReadErc404BondingInstanceLiquidityDeployer: () => ({ data: undefined }),
  useReadErc404BondingInstanceGatingModule: () => ({
    data: '0x5555555555555555555555555555555555555555',
  }),
  useReadErc404BondingInstanceGraduated: () => ({ data: false }),
  useReadErc404BondingInstancePreviewCarve: (cfg: { args: readonly [bigint] }) => ({
    data: mockPreviewCarve(cfg.args[0]),
  }),
  useReadErc404BondingInstanceStakingActive: () => ({ data: false, refetch: vi.fn() }),
  useReadErc404BondingInstanceReserve: () => ({ data: 0n, refetch: vi.fn() }),
  useReadErc404BondingInstanceStakingReserve: () => ({ data: 0n, refetch: vi.fn() }),
  // `unit()` — coin per whole NFT. The allowlist row roots its tree at this scale (noesis-266).
  useReadErc404BondingInstanceUnit: () => ({ data: 10n ** 24n }),
}))

const INSTANCE = '0x2222222222222222222222222222222222222222' as const

function view(overrides: Partial<BondingView>): BondingView {
  return {
    bondingActive: true,
    bondingOpenTime: NOW - 100n,
    bondingMaturityTime: 0n,
    graduated: false,
    totalBondingSupply: 0n,
    maxSupply: 1000n,
    // A tenth of supply held for the graduation pool, which is what every shipped preset reserves,
    // so the buyable ceiling in these fixtures is 900 and not `maxSupply`.
    liquidityReserve: 100n,
    freeMintAllocation: 0n,
    unit: 10n ** 24n,
    ...overrides,
  }
}

const GRADUATED = view({ graduated: true })
const BONDING_NOT_FULL_NOT_MATURED = view({
  totalBondingSupply: 100n,
  maxSupply: 1000n,
  bondingMaturityTime: NOW + 100n,
})
const BONDING_MATURED = view({
  totalBondingSupply: 100n,
  maxSupply: 1000n,
  bondingMaturityTime: NOW - 100n,
})
// Sold out: the supply has reached the BUYABLE ceiling (1000 − 100 reserved), so every further buy
// reverts `ExceedsBonding` even though it is short of `maxSupply`. Against raw `maxSupply` this read
// `full === false` and the panel told the creator that graduating would close the sale early — on a
// curve with nothing left to sell.
const BONDING_SOLD_OUT_AT_CEILING = view({
  totalBondingSupply: 900n,
  maxSupply: 1000n,
  bondingMaturityTime: NOW + 100n,
})
const PREOPEN = view({ bondingActive: false, bondingOpenTime: NOW + 100n })

function mount(fixture: BondingView) {
  mockBondingData.mockReturnValue({ view: fixture })
  mockNowSec.mockReturnValue(NOW)
  render(<Erc404AdminPanel instance={INSTANCE} />)
}

/** No declared carve rights, no carve previewable — the default the phase-gate tests assume. */
function noCarveRights() {
  mockDeclaredMax.mockReturnValue(0)
  mockPreviewCarve.mockReturnValue(0n)
}

beforeEach(noCarveRights)

afterEach(() => {
  cleanup()
  mockBondingData.mockReset()
  mockNowSec.mockReset()
  mockDeclaredMax.mockReset()
  mockPreviewCarve.mockReset()
  mockWriteContract.mockReset()
  mockStrandedTithe.mockReset()
  mockStoredTimes.mockReset()
  mockStoredTimes.mockReturnValue({ open: 0n, maturity: 0n })
  mockPublicClient.mockReset()
  mockPublicClient.mockReturnValue(undefined)
  strandedTithe({ amount: undefined, canFlush: false })
})

/** Point the mocked hook at one stash state; returns the flush spy the row is wired to. */
function strandedTithe({ amount, canFlush }: { amount: bigint | undefined; canFlush: boolean }) {
  const flush = vi.fn()
  mockStrandedTithe.mockReturnValue({
    amount,
    canFlush,
    flush,
    tx: {
      state: 'idle',
      reset: vi.fn(),
      send: vi.fn(),
      isBusy: false,
      hash: undefined,
      reason: undefined,
    },
  })
  return flush
}

test('graduated: activate bonding, deploy liquidity, and both time setters are hidden', () => {
  mount(GRADUATED)
  expect(screen.queryByTestId('erc404-admin-set-active')).not.toBeInTheDocument()
  expect(screen.queryByTestId('erc404-admin-deploy-liquidity')).not.toBeInTheDocument()
  expect(screen.queryByTestId('erc404-admin-open-time')).not.toBeInTheDocument()
  expect(screen.queryByTestId('erc404-admin-open-time-input')).not.toBeInTheDocument()
  expect(screen.queryByTestId('erc404-admin-maturity')).not.toBeInTheDocument()
  expect(screen.queryByTestId('erc404-admin-maturity-input')).not.toBeInTheDocument()
  // The absence reads as a state, not a missing feature.
  expect(screen.getByTestId('erc404-admin-graduated-note')).toHaveTextContent(/graduated/i)
})

test('graduated: activate staking stays present — it has no graduation guard on-chain', () => {
  mount(GRADUATED)
  expect(screen.getByTestId('erc404-admin-activate-staking')).toBeInTheDocument()
})

test('graduated: rows that remain valid post-graduation are not over-gated', () => {
  mount(GRADUATED)
  expect(screen.getByTestId('erc404-admin-style')).toBeInTheDocument()
  expect(screen.getByTestId('erc404-admin-metadata')).toBeInTheDocument()
  expect(screen.getByTestId('erc404-admin-migrate-vault')).toBeInTheDocument()
  expect(screen.getByTestId('erc404-admin-claim-all-fees')).toBeInTheDocument()
  expect(screen.getByTestId('erc404-admin-delegation')).toBeInTheDocument()
  expect(screen.getByTestId('erc404-allowlist-mode-hosted')).toBeInTheDocument()
})

test('bonding, not full, not matured: deploy liquidity is present with the early-close hint', () => {
  mount(BONDING_NOT_FULL_NOT_MATURED)
  const button = screen.getByTestId('erc404-admin-deploy-liquidity')
  expect(button).toBeInTheDocument()
  expect(screen.getByText(/closes the sale early/i)).toBeInTheDocument()
})

test('bonding and matured: deploy liquidity is present without the early-close hint', () => {
  mount(BONDING_MATURED)
  expect(screen.getByTestId('erc404-admin-deploy-liquidity')).toBeInTheDocument()
  expect(screen.queryByText(/closes the sale early/i)).not.toBeInTheDocument()
})

test('bonding, sold out at the buyable ceiling: deploy liquidity is present and nothing is early', () => {
  mount(BONDING_SOLD_OUT_AT_CEILING)
  expect(screen.getByTestId('erc404-admin-deploy-liquidity')).toBeInTheDocument()
  // NON-VACUITY: revert the predicate to `totalBondingSupply >= maxSupply` and 900 < 1000 makes this
  // curve read not-full, the hint comes back, and this expectation fails.
  expect(screen.queryByText(/closes the sale early/i)).not.toBeInTheDocument()
})

test('bonding, one coin below the ceiling: the early-close hint is still shown', () => {
  mount(view({ totalBondingSupply: 899n, maxSupply: 1000n, bondingMaturityTime: NOW + 100n }))
  expect(screen.getByText(/closes the sale early/i)).toBeInTheDocument()
})

test('preopen: bonding-time setters are present, deploy liquidity is absent', () => {
  mount(PREOPEN)
  expect(screen.getByTestId('erc404-admin-open-time')).toBeInTheDocument()
  expect(screen.getByTestId('erc404-admin-maturity')).toBeInTheDocument()
  expect(screen.queryByTestId('erc404-admin-deploy-liquidity')).not.toBeInTheDocument()
})

// ── noesis-220: the carve is a one-shot, irreversible choice, and the panel is the only place it can
// be made. These assert what the panel SAYS. Nothing here asserts (or permits) a change to what is
// taken: the request still defaults to 0 and `deployLiquidity` still receives exactly that.

const DECLARED_MAX_BPS = 2500
const MAX_CARVE_GROSS = 6_500_000_000_000_000_000n // 6.5 ETH — previewCarve(10000) for this fixture
const MAX_CARVE_NET = carveCreatorNet(MAX_CARVE_GROSS) // 5.2 ETH — 80% after the 1/19 tithe

/** A collection that DID declare carve rights, still bonding, request untouched at its default. */
function mountWithCarveRights(requestedGross: bigint = 0n) {
  mockDeclaredMax.mockReturnValue(DECLARED_MAX_BPS)
  mockPreviewCarve.mockImplementation((bps) => (bps === 10_000n ? MAX_CARVE_GROSS : requestedGross))
  mount(BONDING_MATURED)
}

/** The carve row's full rendered prose — the hint, the permanence line, and the button label. */
function carveRowText(): string {
  const hint = screen.getByText(/graduate to the DEX/i).textContent ?? ''
  const warning = screen.queryByTestId('erc404-admin-carve-permanence')?.textContent ?? ''
  const button = screen.getByTestId('erc404-admin-deploy-liquidity').textContent ?? ''
  return [hint, warning, button].join(' | ')
}

test('leg 1 — declared max > 0 with the request at its default: the panel says the choice is permanent and names the forfeited NET', () => {
  mountWithCarveRights()
  const warning = screen.getByTestId('erc404-admin-carve-permanence')
  expect(warning).toHaveTextContent(/permanent/i)
  expect(warning).toHaveTextContent(/graduates once/i)
  expect(warning).toHaveTextContent(/no setter and no second chance/i)
  expect(warning).toHaveTextContent(/forfeits the entire carve/i)
  // Priced, not abstract: the figure named is the creator's take-home, not the gross.
  expect(formatEther(MAX_CARVE_NET)).toBe('5.2')
  expect(warning).toHaveTextContent(`${formatEther(MAX_CARVE_NET)} ETH net to you`)
})

test('leg 1 (near miss) — a request below the declared max forfeits the difference, permanently', () => {
  const requested = 2_000_000_000_000_000_000n // previewCarve for a partial request
  mockDeclaredMax.mockReturnValue(DECLARED_MAX_BPS)
  mockPreviewCarve.mockImplementation((bps) => (bps === 10_000n ? MAX_CARVE_GROSS : requested))
  mount(BONDING_MATURED)
  fireEvent.change(screen.getByTestId('erc404-admin-carve-bps-input'), {
    target: { value: '1000' },
  })

  const warning = screen.getByTestId('erc404-admin-carve-permanence')
  expect(warning).toHaveTextContent(/permanent/i)
  expect(warning).toHaveTextContent(/requesting 1000 bps instead of the declared max 2500 bps/i)
  const forgone = carveCreatorNet(MAX_CARVE_GROSS) - carveCreatorNet(requested)
  expect(warning).toHaveTextContent(`${formatEther(forgone)} ETH net to you`)
})

test('leg 1 — the full-max request has nothing left to forfeit, so no permanence line is shown', () => {
  mockDeclaredMax.mockReturnValue(DECLARED_MAX_BPS)
  mockPreviewCarve.mockReturnValue(MAX_CARVE_GROSS)
  mount(BONDING_MATURED)
  fireEvent.change(screen.getByTestId('erc404-admin-carve-bps-input'), {
    target: { value: '2500' },
  })
  expect(screen.queryByTestId('erc404-admin-carve-permanence')).not.toBeInTheDocument()
})

test('leg 1 — a collection with no declared carve rights gets no permanence line, and keeps its own sentence', () => {
  mount(BONDING_MATURED)
  expect(screen.queryByTestId('erc404-admin-carve-permanence')).not.toBeInTheDocument()
  expect(screen.getByText(/declared no carve rights/i)).toBeInTheDocument()
})

test('leg 1 — the statement is not a guardrail: the graduate button is never disabled by it', () => {
  mountWithCarveRights()
  expect(screen.getByTestId('erc404-admin-carve-permanence')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /deploy liquidity/i })).toBeEnabled()
})

test('leg 3 — every carve ETH figure rendered in the row is labelled net or gross', () => {
  mountWithCarveRights()
  const text = carveRowText()
  // Both the ceiling and the current request are shown in BOTH terms: the net is what the creator
  // decides on, the gross is what leaves the pool.
  expect(text).toContain('6.5 ETH gross / 5.2 ETH net to you')
  expect(text).toContain('0 ETH gross / 0 ETH net to you')
  // And no bare figure escapes a label — asserted on the rendered text, not on the source.
  const unlabelled = text.match(/[\d.]+ ETH(?! gross)(?! net)/g)
  expect(unlabelled).toBeNull()
})

test('leg 7 — the request still defaults to 0 and deployLiquidity is still called with exactly it', () => {
  mountWithCarveRights()
  const input = screen.getByTestId('erc404-admin-carve-bps-input')
  expect(input).toHaveValue(0)

  fireEvent.click(screen.getByRole('button', { name: /deploy liquidity/i }))
  expect(mockWriteContract).toHaveBeenCalledTimes(1)
  expect(mockWriteContract.mock.calls[0]?.[0]).toMatchObject({
    address: INSTANCE,
    functionName: 'deployLiquidity',
    args: [0n],
  })
})

test('leg 7 — no control for the immutable declared max is offered anywhere in the panel', () => {
  mountWithCarveRights()
  expect(screen.queryByLabelText(/declared max/i)).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: /set declared max|declared max allowance/i }),
  ).not.toBeInTheDocument()
})

// ── stranded graduation tithe ──────────────────────────────────────────────────
//
// The cut is stashed on the liquidity module when the alignment vault refuses it, and re-sending it
// is permissionless. `flushPendingVaultCut` reverts `NoPendingVaultCut` on an empty stash, so the
// button being disabled at zero is the row's whole job — offering it would guarantee a failed
// transaction and a wasted fee.

test('stranded tithe: an unread stash offers the flush without asserting an amount', () => {
  strandedTithe({ amount: undefined, canFlush: false })
  mount(GRADUATED)
  const row = screen.getByTestId('erc404-admin-flush-tithe')
  expect(row).toBeInTheDocument()
  expect(screen.getByText(/permissionless — re-send a graduation cut/i)).toBeInTheDocument()
})

test('stranded tithe: an empty stash says so and does not offer a transaction that reverts', () => {
  strandedTithe({ amount: 0n, canFlush: false })
  mount(GRADUATED)
  expect(screen.getByTestId('erc404-admin-flush-tithe')).toBeDisabled()
  expect(screen.getByText(/nothing stranded/i)).toBeInTheDocument()
})

test('stranded tithe: a real stash names the amount and sends the flush', () => {
  const flush = strandedTithe({ amount: 1_000_000_000_000_000n, canFlush: true })
  mount(GRADUATED)
  const button = screen.getByTestId('erc404-admin-flush-tithe')
  expect(button).toBeEnabled()
  expect(screen.getByText(/0\.001 ETH stranded on the liquidity module/i)).toBeInTheDocument()
  fireEvent.click(button)
  expect(flush).toHaveBeenCalledTimes(1)
})

// ── the bonding schedule: every rule is stated before a pick, and an invalid pick cannot be sent.
// A tester got stuck here twice: the only rule shown was "must be after chain time (<ISO UTC>)",
// and only after a pick had already failed, on a chain whose clock ran ahead of theirs.

const wallNow = () => Math.floor(Date.now() / 1000)
const localClock = () => ({ wallNow: wallNow() })

test('schedule: the rules and the earliest open time are stated before anything is picked', () => {
  mount(PREOPEN)
  const rules = screen.getByTestId('erc404-admin-schedule-rules')
  const earliest = formatMoment(openWindow(wallNow(), 0).earliest, localClock())
  expect(within(rules).getByText(/when buying starts/i)).toBeInTheDocument()
  expect(rules.textContent).toContain(`Pick ${earliest} or later`)
  expect(rules.textContent).toMatch(/no more than 210 days after it/)
  expect(rules.textContent).toMatch(/in this order/)
  expect(rules.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}T/)
})

test('schedule: with no open time, maturity and activate say to set the open time first', () => {
  mount(PREOPEN)
  expect(screen.getByTestId('erc404-admin-maturity-input')).toBeDisabled()
  expect(screen.getByText(/^Set the open time first\./)).toBeInTheDocument()
  expect(screen.getByTestId('erc404-admin-set-active')).toBeDisabled()
  expect(screen.getByText(/Set the open time first \(step 1\), then activate/)).toBeInTheDocument()
})

test('schedule: the open picker carries its earliest time as min, and an earlier pick names what to pick', () => {
  mount(PREOPEN)
  const input = screen.getByTestId('erc404-admin-open-time-input')
  const w = openWindow(wallNow(), 0)
  expect(input).toHaveAttribute('min', localInputFromEpoch(w.earliest))
  fireEvent.change(input, { target: { value: localInputFromEpoch(wallNow()) } })
  const problem = screen.getByTestId('erc404-admin-open-time-problem')
  expect(problem.textContent).toMatch(/^Pick .* or later\.$/)
  expect(problem.textContent).not.toMatch(/chain time|\d{4}-\d{2}-\d{2}T|UTC/)
  expect(screen.getByTestId('erc404-admin-open-time')).toBeDisabled()
})

/** A chain client whose pending block reads the wall clock plus `ahead` seconds. */
function chainClock(ahead = 0) {
  mockPublicClient.mockReturnValue({
    getBlock: () => Promise.resolve({ timestamp: BigInt(wallNow() + ahead) }),
  })
}

test('schedule: the send waits for the chain clock; the wall clock alone never sets a time', () => {
  // No client: the bounds rest on the wall clock, which a chain running ahead would refuse.
  mount(PREOPEN)
  fireEvent.click(screen.getByRole('button', { name: 'in 1 hour' }))
  expect(screen.getByTestId('erc404-admin-open-time-preview')).toBeInTheDocument()
  expect(screen.getByTestId('erc404-admin-open-time')).toBeDisabled()
})

test('schedule: "in 1 hour" fills a valid open time and the send carries it', async () => {
  chainClock()
  mount(PREOPEN)
  fireEvent.click(screen.getByRole('button', { name: 'in 1 hour' }))
  expect(screen.getByTestId('erc404-admin-open-time-preview').textContent).toMatch(/^Opens /)
  const button = screen.getByTestId('erc404-admin-open-time')
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
  const sent = mockWriteContract.mock.calls[0]![0] as { functionName: string; args: [bigint] }
  expect(sent.functionName).toBe('setBondingOpenTime')
  const at = Number(sent.args[0])
  expect(at).toBeGreaterThanOrEqual(wallNow() + 3600 - 60)
  expect(at % 60).toBe(0)
})

test('schedule: a chain clock ahead of the wall clock is said out loud and moves the bounds', async () => {
  const ahead = 2 * 3600
  chainClock(ahead)
  mount(PREOPEN)
  const note = await screen.findByTestId('erc404-admin-clock-skew')
  expect(note.textContent).toMatch(/2 hours ahead of your clock/)
  await waitFor(() =>
    expect(screen.getByTestId('erc404-admin-open-time-input')).toHaveAttribute(
      'min',
      localInputFromEpoch(openWindow(wallNow() + ahead, 0).earliest),
    ),
  )
  // A pick that is in the future by the creator's watch but not by the chain's is refused in words.
  fireEvent.change(screen.getByTestId('erc404-admin-open-time-input'), {
    target: { value: localInputFromEpoch(wallNow() + 3600) },
  })
  expect(screen.getByTestId('erc404-admin-open-time-problem').textContent).toMatch(/or later\.$/)
})

test('schedule: with an open time set, maturity offers "30 days after open" and caps its picker at 210 days', async () => {
  chainClock()
  const open = wallNow() + 86_400
  mockStoredTimes.mockReturnValue({ open: BigInt(open), maturity: 0n })
  mount(PREOPEN)
  const input = screen.getByTestId('erc404-admin-maturity-input')
  expect(input).toBeEnabled()
  expect(input).toHaveAttribute('max', localInputFromEpoch(open + 210 * 86_400))
  fireEvent.click(screen.getByRole('button', { name: '30 days after open' }))
  await waitFor(() => expect(screen.getByTestId('erc404-admin-maturity')).toBeEnabled())
  // Past the cap is refused with the latest allowed time named.
  fireEvent.change(input, { target: { value: localInputFromEpoch(open + 300 * 86_400) } })
  expect(screen.getByTestId('erc404-admin-maturity-problem').textContent).toMatch(/or earlier\.$/)
  expect(screen.getByTestId('erc404-admin-set-active')).toBeEnabled()
})
