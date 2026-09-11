/**
 * The protocol-cut section on a vault page: when it appears, and what it sends.
 *
 * The push reverts on an empty accumulator and means nothing on an endowment vault, so the section's
 * whole job is to appear exactly where there is money to move. The delivery is permissionless — that
 * is the reason this lives on the vault's public page rather than behind an owner gate — so nothing
 * here is gated on the connected wallet.
 *
 * The community's leg of the same split is CommunityPayoutPanel's, and has its own suite.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { VaultDeliveries } from './VaultDeliveries'

type Result = { status: 'success'; result: bigint } | { status: 'failure' }

const mockReads = vi.hoisted(() =>
  vi.fn<() => { data: Result[] | undefined; refetch: () => void }>(),
)
vi.mock('wagmi', () => ({ useReadContracts: mockReads }))

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

const ok = (v: bigint): Result => ({ status: 'success', result: v })
const failed: Result = { status: 'failure' }

function reads(protocolCut: Result) {
  mockReads.mockReturnValue({ data: [protocolCut], refetch: vi.fn() })
}

afterEach(() => {
  cleanup()
  mockReads.mockReset()
  mockSend.mockReset()
})

test('an endowment vault has no protocol cut and gets no section', () => {
  reads(ok(10n ** 18n))
  render(<VaultDeliveries vault={VAULT} isEndowment />)
  expect(screen.queryByTestId('vault-deliveries')).not.toBeInTheDocument()
})

test('a vault that does not answer the read is not one of the liquidity families, and is skipped', () => {
  reads(failed)
  render(<VaultDeliveries vault={VAULT} isEndowment={false} />)
  expect(screen.queryByTestId('vault-deliveries')).not.toBeInTheDocument()
})

test('nothing accrued means no section, rather than a button that reverts', () => {
  reads(ok(0n))
  render(<VaultDeliveries vault={VAULT} isEndowment={false} />)
  expect(screen.queryByTestId('vault-deliveries')).not.toBeInTheDocument()
})

test('an accrued cut is shown and sent to the vault with no destination argument', () => {
  reads(ok(2n * 10n ** 15n))
  render(<VaultDeliveries vault={VAULT} isEndowment={false} />)

  expect(screen.getByText('0.002 ETH')).toBeInTheDocument()
  fireEvent.click(screen.getByTestId('vault-deliver-protocol'))
  expect(mockSend).toHaveBeenLastCalledWith(
    expect.objectContaining({ address: VAULT, functionName: 'withdrawProtocolFees' }),
  )
  expect(mockSend.mock.calls[0]?.[0]).not.toHaveProperty('args')
})
