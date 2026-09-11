/**
 * VaultPanel — there is no vesting, no maturity clock, and no vested/escrowed split any more: one
 * pooled principal, one flat split, forever. `principalOf` falls only when the curated target
 * actually deploys it (`execute`), never on a timer, so the panel must render a live number and
 * nothing that implies a maturity date or a completed vest.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { VaultPanel } from './VaultPanel'

const VAULT = '0x1111111111111111111111111111111111111111' as const
const BENEFACTOR = '0x2222222222222222222222222222222222222222' as const
const COMMUNITY = '0x3333333333333333333333333333333333333333' as const

const mockPrincipal = vi.hoisted(() => vi.fn<() => bigint>())

vi.mock('./useCollectionChain', () => ({ useCollectionChainId: () => 1 }))

vi.mock('wagmi', () => ({
  useWaitForTransactionReceipt: () => ({ isLoading: false, isSuccess: false }),
}))

// The claim/deliver row has its own suite in VaultPanel.actions.test.tsx. Here it is stubbed down to
// a visitor's view so these tests stay about the stats block alone.
vi.mock('../ui/useOwnerGate', () => ({
  useOwnerGate: () => ({ isOwner: false, owner: undefined, connected: undefined }),
}))
vi.mock('../ui/useTxAction', () => ({
  useTxAction: () => ({
    send: vi.fn(),
    reset: vi.fn(),
    state: 'idle',
    isBusy: false,
    hash: undefined,
    reason: undefined,
  }),
}))

vi.mock('../../generated/contracts', () => ({
  useReadAlignmentEndowmentVaultVaultType: () => ({ data: 'AaveEndowment', isPending: false }),
  useReadAlignmentEndowmentVaultPrincipalOf: () => ({
    data: mockPrincipal(),
    isPending: false,
    refetch: vi.fn(),
  }),
  useReadAlignmentEndowmentVaultAccumulatedFees: () => ({
    data: 0n,
    isPending: false,
    refetch: vi.fn(),
  }),
  useReadAlignmentEndowmentVaultTotalPrincipalLocked: () => ({ data: 0n, isPending: false }),
  useReadAlignmentEndowmentVaultTargetId: () => ({ data: 7n, isPending: false }),
  useReadAlignmentEndowmentVaultPendingYieldOf: () => ({ data: 0n, refetch: vi.fn() }),
  useReadAlignmentEndowmentVaultAccumulatedTargetFees: () => ({ data: 0n, refetch: vi.fn() }),
  useReadAlignmentEndowmentVaultRoundResidue: () => ({ data: 0n, refetch: vi.fn() }),
  alignmentEndowmentVaultAbi: [],
  // The community sink is registry state — the vault keeps no copy of it and exposes no read for one.
  useReadAlignmentRegistryV1GetCommunityPayout: () => ({ data: COMMUNITY, isPending: false }),
  useWriteAlignmentEndowmentVaultHarvest: () => ({
    writeContract: vi.fn(),
    data: undefined,
    isPending: false,
    reset: vi.fn(),
  }),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

test('a live principal renders as a plain figure with no maturity claim beside it', () => {
  mockPrincipal.mockReturnValue(2_000_000_000_000_000_000n)

  render(<VaultPanel vault={VAULT} benefactor={BENEFACTOR} />)

  const principalStat = screen.getByText(/this collection's principal/i).closest('div')
  expect(principalStat?.textContent).toMatch(/2 ETH/)
  expect(screen.queryByText('vested ✓')).toBeNull()
  expect(screen.queryByText(/earliest/)).toBeNull()
  expect(screen.queryByText(/\bvested\b/i)).toBeNull()
  expect(screen.queryByText(/maturity/i)).toBeNull()
  expect(screen.getByText(/leaves only when the target withdraws it/i)).toBeTruthy()
})

test('zero principal is stated as a live number, not a completed vest', () => {
  mockPrincipal.mockReturnValue(0n)

  render(<VaultPanel vault={VAULT} benefactor={BENEFACTOR} />)

  const principalStat = screen.getByText(/this collection's principal/i).closest('div')
  expect(principalStat?.textContent).toMatch(/0 ETH/)
  expect(screen.queryByText('vested ✓')).toBeNull()
  expect(screen.queryByText(/\bvested\b/i)).toBeNull()
})
