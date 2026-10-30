/**
 * noesis-330 — the portfolio's own Claim button, for the vaults that actually implement the write.
 *
 * `claimFees()` is real on the Uni and ZAMM liquidity families (it pays `msg.sender`'s own accrued
 * share) and a `pure` revert stub on the Aave endowment vault, whose payout path is
 * `claimYieldPurse` on the vault's own page instead. Before this, the button was permanently
 * disabled for every family — including the two where the write is proven and the ETH shown beside
 * it is real and reachable nowhere else in the product. The tests that matter are the ones that
 * keep the button honest about WHICH vault it is pointed at: wired when `vaultType()` answers a
 * liquidity family, disabled (with copy that blames no vault) while that read is in flight or
 * answers the endowment.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ClaimButton } from './PortfolioPanels'

type Result = { status: 'success'; result: unknown } | { status: 'failure' }

const mockReads = vi.hoisted(() => vi.fn<() => { data: Result[] | undefined }>())
vi.mock('wagmi', () => ({ useReadContracts: mockReads }))

const mockSend = vi.hoisted(() => vi.fn())
const mockState = vi.hoisted(() => vi.fn<() => string>())
vi.mock('../ui/useTxAction', () => ({
  useTxAction: () => ({
    send: mockSend,
    reset: vi.fn(),
    state: mockState(),
    isBusy: false,
    hash: undefined,
    reason: undefined,
  }),
}))

const VAULT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const

const ok = (v: unknown): Result => ({ status: 'success', result: v })

afterEach(() => {
  cleanup()
  mockReads.mockReset()
  mockSend.mockReset()
  mockState.mockReset()
})

test('while the vault family read is in flight, the button is disabled and names no vault', () => {
  mockReads.mockReturnValue({ data: undefined })
  mockState.mockReturnValue('idle')
  render(<ClaimButton vault={VAULT} />)
  const btn = screen.getByTestId('vault-claim')
  expect(btn).toBeDisabled()
  expect(btn.getAttribute('title')).not.toMatch(/Aave|T4|endowment/i)
})

test('an Aave endowment vault stays disabled, and the copy blames no vault at all', () => {
  mockReads.mockReturnValue({ data: [ok('AaveEndowment')] })
  mockState.mockReturnValue('idle')
  render(<ClaimButton vault={VAULT} />)
  const btn = screen.getByTestId('vault-claim')
  expect(btn).toBeDisabled()
  // The old defect: the tooltip named a vault family the button's own vault was never in.
  expect(btn.getAttribute('title')).toMatch(/claim yield purse/i)
})

test('a Uni/ZAMM liquidity vault wires the button to the vault it is actually shown beside', () => {
  mockReads.mockReturnValue({ data: [ok('UniswapV4LP')] })
  mockState.mockReturnValue('idle')
  render(<ClaimButton vault={VAULT} />)
  const btn = screen.getByTestId('vault-claim')
  expect(btn).not.toBeDisabled()
  fireEvent.click(btn)
  expect(mockSend).toHaveBeenCalledWith(
    expect.objectContaining({ address: VAULT, functionName: 'claimFees' }),
  )
})

test('a ZAMM vault wires the same way — the family, not a hardcoded venue, decides it', () => {
  mockReads.mockReturnValue({ data: [ok('ZAMMLP')] })
  mockState.mockReturnValue('idle')
  render(<ClaimButton vault={VAULT} />)
  expect(screen.getByTestId('vault-claim')).not.toBeDisabled()
})

test('a vault the family read cannot answer (allowFailure tripped) fails closed, not open', () => {
  mockReads.mockReturnValue({ data: [{ status: 'failure' }] })
  mockState.mockReturnValue('idle')
  render(<ClaimButton vault={VAULT} />)
  expect(screen.getByTestId('vault-claim')).toBeDisabled()
})
