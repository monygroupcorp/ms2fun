/**
 * The endowment vault's two actions, and who each one is offered to.
 *
 * The gating is the point. `claimYieldPurse` pays the collection's owner and reverts `NotAuthorized`
 * for anyone else, so a visitor must not be shown a claim button; `flushTargetFees` is permissionless
 * but reverts on nothing-to-do, so it appears only when there is something to move. There is no third
 * action here any more — deploying principal is the curated target's own `execute`, not a benefactor
 * or creator button, and there is no vest to offer once maturity is gone.
 *
 * The stats block these sit under has its own suite in VaultPanel.test.tsx, which drives the real
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

function state(overrides: Partial<EndowmentState> = {}): EndowmentState {
  return {
    isEndowment: true,
    principal: 0n,
    yield: 0n,
    claimable: 0n,
    undeliveredTargetFees: 0n,
    roundResidue: 0n,
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

test('there is no vest button — principal is deployed by the target, not offered here', () => {
  mount({ principal: 10n ** 18n })
  expect(screen.queryByTestId('vault-vest')).not.toBeInTheDocument()
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
