/**
 * Erc404AdminPanel — phase gate (noesis-209). A graduated collection must not offer bonding-lifecycle
 * actions (activate bonding, deploy liquidity, the two time setters) alongside the page's own
 * "graduated to DEX" notice; a still-bonding one must not have `deploy liquidity` hidden by the
 * stricter `canDeployLiquidity` helper (early graduation and a functionally-sold-out-but-not-`full`
 * curve are both real, on-chain-permitted cases — see the plan's corrections). Rows that remain valid
 * post-graduation (style/metadata, vault, fee claim, delegation, allowlist) must stay present
 * regardless of phase — the over-gating guard (test 2).
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
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

vi.mock('wagmi', () => ({
  useWriteContract: () => ({
    writeContract: vi.fn(),
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
  useReadErc404BondingInstanceDeclaredMaxAllowanceBps: () => ({ data: 0 }),
  useReadErc404BondingInstanceGatingModule: () => ({
    data: '0x5555555555555555555555555555555555555555',
  }),
  useReadErc404BondingInstanceGraduated: () => ({ data: false }),
  useReadErc404BondingInstancePreviewCarve: () => ({ data: 0n }),
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

afterEach(() => {
  cleanup()
  mockBondingData.mockReset()
  mockNowSec.mockReset()
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
