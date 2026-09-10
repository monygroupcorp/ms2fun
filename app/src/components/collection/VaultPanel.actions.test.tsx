/**
 * The endowment vault's three actions, and who each one is offered to.
 *
 * The gating is the point. `claimYieldPurse` pays the collection's owner and reverts `NotAuthorized`
 * for anyone else, so a visitor must not be shown a claim button; `vest` and `flushTargetFees` are
 * permissionless but revert on nothing-to-do, so they appear only when there is something to move.
 * Every one of these was unreachable in the app before — the per-type admin panels route to
 * `claimFees`, which this vault family implements by reverting.
 *
 * The maturity stat these sit under has its own suite in VaultPanel.test.tsx, which drives the real
 * `useEndowment` against mocked reads; this one mocks the hook so each action's gate can be set
 * directly.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { VaultPanel } from './VaultPanel'
import type { EndowmentState } from './useEndowment'

const mockEndowment = vi.hoisted(() => vi.fn<() => EndowmentState>())
vi.mock('./useEndowment', () => ({ useEndowment: mockEndowment }))

const mockIsOwner = vi.hoisted(() => vi.fn<() => boolean>())
vi.mock('../ui/useOwnerGate', () => ({
  useOwnerGate: () => ({
    isOwner: mockIsOwner(),
    owner: '0x1111111111111111111111111111111111111111',
    connected: '0x1111111111111111111111111111111111111111',
  }),
}))

vi.mock('./useCollectionChain', () => ({ useCollectionChainId: () => 1 }))

const mockSend = vi.hoisted(() => vi.fn())
vi.mock('../ui/useTxAction', () => ({
  useTxAction: () => ({
    send: mockSend,
    reset: vi.fn(),
    state: 'idle',
    isBusy: false,
    hash: undefined,
    reason: undefined,
  }),
}))

vi.mock('wagmi', () => ({
  useWaitForTransactionReceipt: () => ({ isLoading: false, isSuccess: false }),
}))

vi.mock('../../generated/contracts', () => ({
  alignmentEndowmentVaultAbi: [],
  useWriteAlignmentEndowmentVaultHarvest: () => ({
    writeContract: vi.fn(),
    data: undefined,
    isPending: false,
    reset: vi.fn(),
  }),
}))

const VAULT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const
const INSTANCE = '0x2222222222222222222222222222222222222222' as const

const WEEK = 604_800n
const NOW_SEC = BigInt(Math.floor(Date.now() / 1000))
const PAST = NOW_SEC - WEEK
const FUTURE = NOW_SEC + WEEK

function state(overrides: Partial<EndowmentState> = {}): EndowmentState {
  return {
    isEndowment: true,
    principal: 0n,
    depositTime: 1n,
    vestDuration: 26n * WEEK,
    earliestMaturity: FUTURE,
    fullyVested: false,
    yield: 0n,
    claimable: 0n,
    vested: 0n,
    undeliveredTargetFees: 0n,
    totalPrincipal: 0n,
    communityPayout: '0x3333333333333333333333333333333333333333',
    isPending: false,
    refetch: vi.fn(),
    ...overrides,
  }
}

function mount(overrides: Partial<EndowmentState> = {}) {
  mockEndowment.mockReturnValue(state(overrides))
  render(<VaultPanel vault={VAULT} benefactor={INSTANCE} />)
}

beforeEach(() => mockIsOwner.mockReturnValue(true))

afterEach(() => {
  cleanup()
  mockEndowment.mockReset()
  mockIsOwner.mockReset()
  mockSend.mockReset()
})

test('the creator claims their accrued yield through claimYieldPurse, not claimFees', () => {
  mount({ claimable: 5_000_000_000_000_000n })
  const button = screen.getByTestId('vault-claim-yield')
  expect(button).toBeEnabled()
  fireEvent.click(button)
  expect(mockSend).toHaveBeenCalledWith(
    expect.objectContaining({
      address: VAULT,
      functionName: 'claimYieldPurse',
      args: [INSTANCE],
    }),
  )
})

test('the claim is not offered to a visitor — the contract pays the owner and reverts for others', () => {
  mockIsOwner.mockReturnValue(false)
  mount({ claimable: 5_000_000_000_000_000n })
  expect(screen.queryByTestId('vault-claim-yield')).not.toBeInTheDocument()
})

test('the claim is disabled with nothing accrued rather than sending a no-op transaction', () => {
  mount({ claimable: 0n })
  expect(screen.getByTestId('vault-claim-yield')).toBeDisabled()
})

test('vest appears once the earliest tranche is due and there is escrowed principal left', () => {
  mount({ earliestMaturity: FUTURE, principal: 10n ** 18n })
  expect(screen.queryByTestId('vault-vest')).not.toBeInTheDocument()

  cleanup()
  mount({ earliestMaturity: PAST, principal: 0n })
  expect(screen.queryByTestId('vault-vest')).not.toBeInTheDocument()

  cleanup()
  mount({ earliestMaturity: PAST, principal: 10n ** 18n })
  fireEvent.click(screen.getByTestId('vault-vest'))
  expect(mockSend).toHaveBeenCalledWith(
    expect.objectContaining({ functionName: 'vest', args: [INSTANCE] }),
  )
})

test('the community delivery appears only with an undelivered share, and needs a wired sink', () => {
  mount({ undeliveredTargetFees: 0n })
  expect(screen.queryByTestId('vault-flush-target')).not.toBeInTheDocument()

  cleanup()
  mount({ undeliveredTargetFees: 10n ** 15n, communityPayout: undefined })
  expect(screen.getByTestId('vault-flush-target')).toBeDisabled()

  cleanup()
  mount({ undeliveredTargetFees: 10n ** 15n })
  fireEvent.click(screen.getByTestId('vault-flush-target'))
  expect(mockSend).toHaveBeenCalledWith(
    expect.objectContaining({ functionName: 'flushTargetFees' }),
  )
})

test('a non-endowment vault renders nothing at all', () => {
  mockEndowment.mockReturnValue(state({ isEndowment: false }))
  render(<VaultPanel vault={VAULT} benefactor={INSTANCE} />)
  expect(screen.queryByTestId('vault-panel')).not.toBeInTheDocument()
})
