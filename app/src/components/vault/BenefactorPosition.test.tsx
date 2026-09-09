/**
 * The benefactor's own position on a vault page: when it appears, what it states, and what it sends.
 *
 * The point of the section is that every other figure on the page is the vault's. So the tests that
 * matter are the ones that keep it honest about WHOSE numbers these are: it renders only for a
 * connected wallet, only on a liquidity family, and it says plainly when the connected wallet has no
 * stake rather than showing an empty position as if it were a real one.
 *
 * The endowment case is the load-bearing one. That family implements claimFees, delegateBenefactor
 * and claimFeesAsDelegate by reverting NotSupported, so a rendered panel would be three buttons that
 * cannot do anything but fail.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { BenefactorPosition, parseAddressList } from './BenefactorPosition'

type Result = { status: 'success'; result: unknown } | { status: 'failure' }

const mockReads = vi.hoisted(() =>
  vi.fn<() => { data: Result[] | undefined; refetch: () => void }>(),
)
const mockAccount = vi.hoisted(() => vi.fn<() => { address: string | undefined }>())
vi.mock('wagmi', () => ({ useReadContracts: mockReads, useAccount: mockAccount }))

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
const WALLET = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const
const DELEGATE = '0xcccccccccccccccccccccccccccccccccccccccc' as const
const ZERO = '0x0000000000000000000000000000000000000000' as const

const ok = (v: unknown): Result => ({ status: 'success', result: v })
const failed: Result = { status: 'failure' }

function position(
  opts: {
    contribution?: Result
    shares?: Result
    delegate?: Result
    claimable?: Result
  } = {},
) {
  mockReads.mockReturnValue({
    data: [
      opts.contribution ?? ok(10n ** 18n),
      opts.shares ?? ok(500n),
      opts.delegate ?? ok(ZERO),
      opts.claimable ?? ok(2n * 10n ** 15n),
    ],
    refetch: vi.fn(),
  })
}

afterEach(() => {
  cleanup()
  mockReads.mockReset()
  mockAccount.mockReset()
  mockSend.mockReset()
})

test('an endowment vault reverts every write here, so it gets no panel at all', () => {
  mockAccount.mockReturnValue({ address: WALLET })
  position()
  render(<BenefactorPosition vault={VAULT} isEndowment />)
  expect(screen.queryByTestId('vault-benefactor-position')).not.toBeInTheDocument()
})

test('with no wallet connected there is no "your position" to state', () => {
  mockAccount.mockReturnValue({ address: undefined })
  position()
  render(<BenefactorPosition vault={VAULT} isEndowment={false} />)
  expect(screen.queryByTestId('vault-benefactor-position')).not.toBeInTheDocument()
})

test('a vault that answers none of the reads is not a liquidity family, and is skipped', () => {
  mockAccount.mockReturnValue({ address: WALLET })
  position({ contribution: failed, shares: failed, delegate: failed, claimable: failed })
  render(<BenefactorPosition vault={VAULT} isEndowment={false} />)
  expect(screen.queryByTestId('vault-benefactor-position')).not.toBeInTheDocument()
})

test('the four per-benefactor reads are stated as the reader’s own', () => {
  mockAccount.mockReturnValue({ address: WALLET })
  position({ delegate: ok(DELEGATE) })
  render(<BenefactorPosition vault={VAULT} isEndowment={false} />)

  expect(screen.getByTestId('vault-position-contribution')).toHaveTextContent('1 ETH')
  expect(screen.getByTestId('vault-position-shares')).toHaveTextContent('500')
  expect(screen.getByTestId('vault-position-delegate')).toHaveTextContent(DELEGATE)
  expect(screen.getByTestId('vault-position-claimable')).toHaveTextContent('0.002 ETH')
})

test('a wallet with no stake is told so, rather than shown a zero position as a real one', () => {
  mockAccount.mockReturnValue({ address: WALLET })
  position({ contribution: ok(0n), shares: ok(0n), claimable: ok(0n) })
  render(<BenefactorPosition vault={VAULT} isEndowment={false} />)
  expect(screen.getByTestId('vault-position-empty')).toBeInTheDocument()
})

test('no delegate set reads as nobody, not as a blank', () => {
  mockAccount.mockReturnValue({ address: WALLET })
  position({ delegate: ok(ZERO) })
  render(<BenefactorPosition vault={VAULT} isEndowment={false} />)
  expect(screen.getByTestId('vault-position-delegate')).toHaveTextContent('nobody')
})

test('claimFees takes no argument — a delegate presses it, nobody redirects it', () => {
  mockAccount.mockReturnValue({ address: WALLET })
  position()
  render(<BenefactorPosition vault={VAULT} isEndowment={false} />)

  fireEvent.click(screen.getByTestId('vault-position-claim'))
  expect(mockSend).toHaveBeenLastCalledWith(
    expect.objectContaining({ address: VAULT, functionName: 'claimFees' }),
  )
  expect(mockSend.mock.calls[0]?.[0]).not.toHaveProperty('args')
})

test('no shares is the one certain revert, so that is what greys the claim', () => {
  mockAccount.mockReturnValue({ address: WALLET })
  position({ shares: ok(0n), contribution: ok(10n ** 18n) })
  render(<BenefactorPosition vault={VAULT} isEndowment={false} />)
  expect(screen.getByTestId('vault-position-claim')).toBeDisabled()
})

test('a zero settled figure does NOT grey the claim — the claim sweeps fresh fees first', () => {
  mockAccount.mockReturnValue({ address: WALLET })
  position({ shares: ok(500n), claimable: ok(0n) })
  render(<BenefactorPosition vault={VAULT} isEndowment={false} />)
  expect(screen.getByTestId('vault-position-claim')).not.toBeDisabled()
})

test('the claimable figure is presented as a floor, never as a quote', () => {
  mockAccount.mockReturnValue({ address: WALLET })
  position({ claimable: ok(2n * 10n ** 15n) })
  render(<BenefactorPosition vault={VAULT} isEndowment={false} />)
  expect(screen.getByText(/claimable — at least/)).toBeInTheDocument()
})

test('setting a delegate sends the typed address', () => {
  mockAccount.mockReturnValue({ address: WALLET })
  position()
  render(<BenefactorPosition vault={VAULT} isEndowment={false} />)

  fireEvent.change(screen.getByTestId('vault-position-delegate-input'), {
    target: { value: DELEGATE },
  })
  fireEvent.click(screen.getByTestId('vault-position-delegate-btn'))
  expect(mockSend).toHaveBeenLastCalledWith(
    expect.objectContaining({ functionName: 'delegateBenefactor', args: [DELEGATE] }),
  )
})

test('an empty delegate box revokes, which the contract spells as the zero address', () => {
  mockAccount.mockReturnValue({ address: WALLET })
  position({ delegate: ok(DELEGATE) })
  render(<BenefactorPosition vault={VAULT} isEndowment={false} />)

  fireEvent.click(screen.getByTestId('vault-position-delegate-btn'))
  expect(mockSend).toHaveBeenLastCalledWith(
    expect.objectContaining({ functionName: 'delegateBenefactor', args: [ZERO] }),
  )
})

test('a delegate box that is not an address cannot be sent', () => {
  mockAccount.mockReturnValue({ address: WALLET })
  position()
  render(<BenefactorPosition vault={VAULT} isEndowment={false} />)

  fireEvent.change(screen.getByTestId('vault-position-delegate-input'), {
    target: { value: 'not-an-address' },
  })
  expect(screen.getByTestId('vault-position-delegate-btn')).toBeDisabled()
})

test('claiming as a delegate sends the named benefactors as a list', () => {
  mockAccount.mockReturnValue({ address: WALLET })
  position()
  render(<BenefactorPosition vault={VAULT} isEndowment={false} />)

  fireEvent.change(screen.getByTestId('vault-position-claim-for-input'), {
    target: { value: `${DELEGATE}, ${WALLET}` },
  })
  fireEvent.click(screen.getByTestId('vault-position-claim-for-btn'))
  expect(mockSend).toHaveBeenLastCalledWith(
    expect.objectContaining({
      functionName: 'claimFeesAsDelegate',
      args: [[DELEGATE, WALLET]],
    }),
  )
})

test('claiming for nobody is not offered', () => {
  mockAccount.mockReturnValue({ address: WALLET })
  position()
  render(<BenefactorPosition vault={VAULT} isEndowment={false} />)
  expect(screen.getByTestId('vault-position-claim-for-btn')).toBeDisabled()
})

test('the address list takes commas, spaces and newlines, and drops what is not an address', () => {
  expect(parseAddressList(`${DELEGATE}, ${WALLET}`)).toEqual([DELEGATE, WALLET])
  expect(parseAddressList(`${DELEGATE}\n${WALLET}`)).toEqual([DELEGATE, WALLET])
  expect(parseAddressList(`${DELEGATE} nonsense 0x1234`)).toEqual([DELEGATE])
  expect(parseAddressList('')).toEqual([])
})
