/**
 * The undelivered-cuts section on a vault page: when it appears, and what it sends.
 *
 * Both pushes revert on an empty accumulator, and neither means anything on an endowment vault, so
 * the section's whole job is to appear exactly where there is money to move. The delivery is
 * permissionless — that is the reason this lives on the vault's public page rather than behind an
 * owner gate — so nothing here is gated on the connected wallet.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { VaultDeliveries } from './VaultDeliveries'

type Result = { status: 'success'; result: bigint } | { status: 'failure' }

const mockReads = vi.hoisted(() =>
  vi.fn<() => { data: Result[] | undefined; refetch: () => void }>(),
)
vi.mock('wagmi', () => ({ useReadContracts: mockReads }))

const mockTargetActive = vi.hoisted(() => vi.fn<() => { data: boolean | undefined }>())
vi.mock('../../generated/contracts', () => ({
  alignmentEndowmentVaultAbi: [],
  useReadAlignmentRegistryV1IsAlignmentTargetActive: mockTargetActive,
}))

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

const VAULT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const

function reads(target: Result, protocolCut: Result) {
  mockReads.mockReturnValue({ data: [target, protocolCut], refetch: vi.fn() })
}

const ok = (v: bigint): Result => ({ status: 'success', result: v })
const failed: Result = { status: 'failure' }

afterEach(() => {
  cleanup()
  mockReads.mockReset()
  mockSend.mockReset()
  mockTargetActive.mockReset()
})

test('an endowment vault with a live target has neither push and no corpus exit', () => {
  mockTargetActive.mockReturnValue({ data: true })
  reads(ok(10n ** 18n), ok(10n ** 18n))
  render(<VaultDeliveries vault={VAULT} isEndowment targetId={1n} />)
  expect(screen.queryByTestId('vault-deliveries')).not.toBeInTheDocument()
})

test('a de-curated endowment target releases its stranded corpus to the community', () => {
  mockTargetActive.mockReturnValue({ data: false })
  mockReads.mockReturnValue({ data: [ok(3n * 10n ** 18n)], refetch: vi.fn() })
  render(<VaultDeliveries vault={VAULT} isEndowment targetId={1n} />)
  expect(screen.getByText('3 ETH')).toBeInTheDocument()
  fireEvent.click(screen.getByTestId('vault-release-corpus'))
  expect(mockSend).toHaveBeenLastCalledWith(
    expect.objectContaining({ address: VAULT, functionName: 'releaseCorpusToCommunity' }),
  )
})

test('a de-curated target with an empty corpus offers nothing — the release would move zero', () => {
  mockTargetActive.mockReturnValue({ data: false })
  mockReads.mockReturnValue({ data: [ok(0n)], refetch: vi.fn() })
  render(<VaultDeliveries vault={VAULT} isEndowment targetId={1n} />)
  expect(screen.queryByTestId('vault-release-corpus')).not.toBeInTheDocument()
})

test('a vault that answers neither read is not one of the liquidity families, and is skipped', () => {
  reads(failed, failed)
  render(<VaultDeliveries vault={VAULT} isEndowment={false} />)
  expect(screen.queryByTestId('vault-deliveries')).not.toBeInTheDocument()
})

test('nothing accrued means no section, rather than two buttons that revert', () => {
  reads(ok(0n), ok(0n))
  render(<VaultDeliveries vault={VAULT} isEndowment={false} />)
  expect(screen.queryByTestId('vault-deliveries')).not.toBeInTheDocument()
})

test('only the cut with a balance gets a row', () => {
  reads(ok(10n ** 15n), ok(0n))
  render(<VaultDeliveries vault={VAULT} isEndowment={false} />)
  expect(screen.getByTestId('vault-deliver-target')).toBeInTheDocument()
  expect(screen.queryByTestId('vault-deliver-protocol')).not.toBeInTheDocument()
})

test('each row sends its own push, to the vault, with no destination argument', () => {
  reads(ok(10n ** 15n), ok(2n * 10n ** 15n))
  render(<VaultDeliveries vault={VAULT} isEndowment={false} />)

  fireEvent.click(screen.getByTestId('vault-deliver-target'))
  expect(mockSend).toHaveBeenLastCalledWith(
    expect.objectContaining({ address: VAULT, functionName: 'withdrawTargetFees' }),
  )
  expect(mockSend.mock.calls[0]?.[0]).not.toHaveProperty('args')

  fireEvent.click(screen.getByTestId('vault-deliver-protocol'))
  expect(mockSend).toHaveBeenLastCalledWith(
    expect.objectContaining({ address: VAULT, functionName: 'withdrawProtocolFees' }),
  )
})
