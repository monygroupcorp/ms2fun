/**
 * VaultPanel — the maturity stat must never claim a benefactor's principal has vested while any of
 * it is still escrowed.
 *
 * The vault writes `depositTime` on the FIRST deposit only, then gives every deposit its own tranche
 * clock (`vest()` matures each at `depositTs + VEST_DURATION`). Reading `depositTime + VEST_DURATION`
 * as "the holding has vested" is therefore wrong for anyone who topped up: at 30 weeks after a first
 * deposit, a 20-week-old top-up is still escrowed and `vest()` reverts for it, while the panel used to
 * read `vested ✓`. The only completed-vest claim the exposed state supports is `principalOf == 0`.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { VaultPanel } from './VaultPanel'

const VAULT = '0x1111111111111111111111111111111111111111' as const
const BENEFACTOR = '0x2222222222222222222222222222222222222222' as const
const COMMUNITY = '0x3333333333333333333333333333333333333333' as const

const WEEK = 604_800n
const VEST_DURATION = 26n * WEEK
const NOW_SEC = BigInt(Math.floor(Date.now() / 1000))

const mockPrincipal = vi.hoisted(() => vi.fn<() => bigint>())
const mockDepositTime = vi.hoisted(() => vi.fn<() => bigint>())

vi.mock('./useCollectionChain', () => ({ useCollectionChainId: () => 1 }))

vi.mock('wagmi', () => ({
  useWaitForTransactionReceipt: () => ({ isLoading: false, isSuccess: false }),
}))

vi.mock('../../generated/contracts', () => ({
  useReadAlignmentEndowmentVaultVaultType: () => ({ data: 'AaveEndowment', isPending: false }),
  useReadAlignmentEndowmentVaultPrincipalOf: () => ({
    data: mockPrincipal(),
    isPending: false,
    refetch: vi.fn(),
  }),
  useReadAlignmentEndowmentVaultDepositTime: () => ({
    data: mockDepositTime(),
    isPending: false,
  }),
  useReadAlignmentEndowmentVaultAccumulatedFees: () => ({
    data: 0n,
    isPending: false,
    refetch: vi.fn(),
  }),
  useReadAlignmentEndowmentVaultTotalPrincipalLocked: () => ({ data: 0n, isPending: false }),
  useReadAlignmentEndowmentVaultCommunityPayout: () => ({ data: COMMUNITY, isPending: false }),
  useReadAlignmentEndowmentVaultVestDuration: () => ({ data: VEST_DURATION, isPending: false }),
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

test('a top-up still escrowed is not reported as vested, even 30 weeks past the first deposit', () => {
  // First deposit 30 weeks ago (its own 26-week clock has elapsed), 2 ETH still escrowed — which can
  // only be a later tranche that has not matured. This is the case the old `now >= depositTime +
  // VEST_DURATION` label got wrong; it rendered `vested ✓`.
  mockDepositTime.mockReturnValue(NOW_SEC - 30n * WEEK)
  mockPrincipal.mockReturnValue(2_000_000_000_000_000_000n)

  render(<VaultPanel vault={VAULT} benefactor={BENEFACTOR} />)

  expect(screen.queryByText('vested ✓')).toBeNull()
  expect(screen.getByText(/^earliest /)).toBeTruthy()
  expect(screen.getByText(/each top-up vests on its own clock/)).toBeTruthy()
  expect(screen.getByText(/26-week vest/)).toBeTruthy()
})

test('nothing escrowed is the one completed-vest claim the panel may make', () => {
  mockDepositTime.mockReturnValue(NOW_SEC - 30n * WEEK)
  mockPrincipal.mockReturnValue(0n)

  render(<VaultPanel vault={VAULT} benefactor={BENEFACTOR} />)

  expect(screen.getByText('vested ✓')).toBeTruthy()
  expect(screen.queryByText(/each top-up vests on its own clock/)).toBeNull()
})

test('a benefactor who never deposited gets no maturity claim at all', () => {
  mockDepositTime.mockReturnValue(0n)
  mockPrincipal.mockReturnValue(0n)

  render(<VaultPanel vault={VAULT} benefactor={BENEFACTOR} />)

  expect(screen.queryByText('vested ✓')).toBeNull()
  expect(screen.queryByText(/each top-up vests on its own clock/)).toBeNull()
})
