/**
 * Erc404AdminPanel — phase gate (noesis-209). A graduated collection must not offer bonding-lifecycle
 * actions (activate bonding, deploy liquidity, the two time setters) alongside the page's own
 * "graduated to DEX" notice; a still-bonding one must not have `deploy liquidity` hidden by the
 * stricter `canDeployLiquidity` helper (early graduation and a functionally-sold-out-but-not-`full`
 * curve are both real, on-chain-permitted cases — see the plan's corrections). Rows that remain valid
 * post-graduation (style/metadata, vault, fee claim, delegation, allowlist) must stay present
 * regardless of phase — the over-gating guard (test 2).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { formatEther } from 'viem'
import { carveCreatorNet } from '../../../lib/carve'
import type { BondingView } from './bondingPhase'
import { Erc404AdminPanel } from './Erc404AdminPanel'

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
}))

const mockWriteContract = vi.hoisted(() => vi.fn())

// The carve controls are driven by two on-chain reads: the immutable declared max, and `previewCarve`
// resolved for a given request in bps. Both are per-test fixtures so the panel can be mounted in the
// state that matters — a collection that DID declare carve rights, with the request left at its
// default of 0.
const mockDeclaredMax = vi.hoisted(() => vi.fn<() => number>())
const mockPreviewCarve = vi.hoisted(() => vi.fn<(bps: bigint) => bigint | undefined>())

vi.mock('wagmi', () => ({
  usePublicClient: () => undefined,
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
  useReadErc404BondingInstanceBondingMaturityTime: () => ({ data: 0n, refetch: vi.fn() }),
  useReadErc404BondingInstanceBondingOpenTime: () => ({ data: 0n, refetch: vi.fn() }),
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
// Functionally sold out (buys already revert `ExceedsBonding` against the capped supply) but the
// helper's RAW-`maxSupply` comparison still reads `full === false` — the exact case correction 1
// exists to route around.
const BONDING_SOLD_OUT_FULL_FALSE = view({
  totalBondingSupply: 999n,
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
})

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

test('bonding, functionally sold out but raw-maxSupply full is false: deploy liquidity is present', () => {
  mount(BONDING_SOLD_OUT_FULL_FALSE)
  expect(screen.getByTestId('erc404-admin-deploy-liquidity')).toBeInTheDocument()
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
