/**
 * CommunityPayoutPanel — the app path by which a community's accrued cut actually leaves a vault.
 *
 * What is asserted here is the behaviour that makes the panel worth having rather than a second
 * read-only stat block: it sends the right permissionless call for the vault's family, it refuses to
 * offer a delivery that would revert (no sink wired, nothing accrued), and it offers the corpus
 * release exactly when the freeze applies — an endowment vault whose target has been de-curated —
 * because that call is the only exit the corpus has once ambassadors can no longer `execute`.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { CommunityPayoutPanel } from './CommunityPayoutPanel'

const VAULT = '0x0000000000000000000000000000000000000a11' as const
// Hoisted: `vi.mock` factories run above the module body, so a plain const here is still in its
// temporal dead zone when the addresses mock below is built.
const REGISTRY = vi.hoisted(() => '0x0000000000000000000000000000000000000bb1' as const)
const SINK = '0x0000000000000000000000000000000000000c1c' as const
const STORED = '0x0000000000000000000000000000000000000d1d' as const
const ZERO = '0x0000000000000000000000000000000000000000' as const

const chain = vi.hoisted(() => ({
  sink: '0x0000000000000000000000000000000000000c1c' as string,
  /** The endowment clone's own stored sink — what `_targetSink()` falls back to. */
  stored: '0x0000000000000000000000000000000000000000' as string,
  curated: true as boolean | undefined,
  seats: 2n as bigint | undefined,
  waiting: 0n as bigint | undefined,
  corpus: 0n as bigint | undefined,
}))

const send = vi.hoisted(() => vi.fn())

vi.mock('../../generated/contracts', () => ({
  useReadAlignmentRegistryV1GetCommunityPayout: () => ({
    data: chain.sink,
    refetch: vi.fn(),
  }),
  useReadAlignmentRegistryV1IsAlignmentTargetActive: () => ({ data: chain.curated }),
  useReadAlignmentRegistryV1AmbassadorCount: () => ({ data: chain.seats }),
}))

vi.mock('wagmi', () => ({
  useReadContract: ({ functionName }: { functionName: string }) => ({
    data:
      functionName === 'deployableCorpus'
        ? chain.corpus
        : functionName === 'communityPayout'
          ? chain.stored
          : chain.waiting,
    refetch: vi.fn(),
  }),
}))

vi.mock('../ui/useTxAction', () => ({
  useTxAction: () => ({
    send,
    reset: vi.fn(),
    state: 'idle',
    isBusy: false,
    hash: undefined,
    reason: undefined,
  }),
  txErrorReason: () => undefined,
}))

vi.mock('../../lib/addresses', () => ({
  forkAddresses: { AlignmentRegistryV1: REGISTRY },
  forkChainId: 1337,
}))

afterEach(() => {
  cleanup()
  send.mockReset()
  chain.sink = SINK
  chain.stored = ZERO
  chain.curated = true
  chain.seats = 2n
  chain.waiting = 0n
  chain.corpus = 0n
})

describe('CommunityPayoutPanel', () => {
  test('renders nothing for a vault bound to no target', () => {
    const { container } = render(
      <CommunityPayoutPanel vault={VAULT} targetId={undefined} isEndowment={false} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  test('an LP vault delivers with withdrawTargetFees', () => {
    chain.waiting = 190000000000000000n
    render(<CommunityPayoutPanel vault={VAULT} targetId={7n} isEndowment={false} />)

    expect(screen.getByTestId('vault-payout-waiting').textContent).toBe('0.19 ETH')
    fireEvent.click(screen.getByRole('button', { name: /deliver to the community/i }))
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      address: VAULT,
      functionName: 'withdrawTargetFees',
    })
  })

  test('an endowment vault delivers with flushTargetFees', () => {
    chain.waiting = 1n
    render(<CommunityPayoutPanel vault={VAULT} targetId={7n} isEndowment />)

    fireEvent.click(screen.getByRole('button', { name: /deliver to the community/i }))
    expect(send.mock.calls[0]?.[0]).toMatchObject({ functionName: 'flushTargetFees' })
  })

  test('an unwired sink disables delivery and says the cut is still accruing', () => {
    chain.sink = ZERO
    chain.waiting = 190000000000000000n
    render(<CommunityPayoutPanel vault={VAULT} targetId={7n} isEndowment={false} />)

    const button = screen.getByRole('button', { name: /deliver to the community/i })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId('vault-payout-sink').textContent).toMatch(/not wired yet/i)
    expect(screen.getByText(/until a payout address is set/i)).toBeTruthy()
  })

  test('an endowment vault falls back to its own stored sink when the registry has none', () => {
    chain.sink = ZERO
    chain.stored = STORED
    chain.waiting = 190000000000000000n
    render(<CommunityPayoutPanel vault={VAULT} targetId={7n} isEndowment />)

    // The vault's `_targetSink()` would deliver here, so the panel must not grey the button out.
    const sinkCell = screen.getByTestId('vault-payout-sink')
    expect(sinkCell.textContent).toContain(STORED)
    expect(sinkCell.textContent).toMatch(/the vault.s own fallback/i)
    expect(
      (screen.getByRole('button', { name: /deliver to the community/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(false)
  })

  test('the registry sink outranks the stored one, as it does at send time', () => {
    chain.stored = STORED
    chain.waiting = 1n
    render(<CommunityPayoutPanel vault={VAULT} targetId={7n} isEndowment />)

    const sinkCell = screen.getByTestId('vault-payout-sink')
    expect(sinkCell.textContent).toContain(SINK)
    expect(sinkCell.textContent).not.toContain(STORED)
    expect(sinkCell.textContent).not.toMatch(/fallback/i)
  })

  test('nothing accrued disables delivery without claiming the capability is missing', () => {
    render(<CommunityPayoutPanel vault={VAULT} targetId={7n} isEndowment={false} />)

    const button = screen.getByRole('button', { name: /deliver to the community/i })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/nothing has accrued for the community yet/i)).toBeTruthy()
  })

  test('a curated target shows no freeze notice and no corpus release', () => {
    chain.corpus = 5n
    render(<CommunityPayoutPanel vault={VAULT} targetId={7n} isEndowment />)

    expect(screen.getByTestId('vault-payout-curation').textContent).toBe('active')
    expect(screen.queryByTestId('vault-payout-decurated')).toBeNull()
    expect(screen.queryByTestId('vault-payout-release')).toBeNull()
  })

  test('a de-curated endowment vault offers the corpus release, the freeze’s only exit', () => {
    chain.curated = false
    chain.corpus = 3000000000000000000n
    render(<CommunityPayoutPanel vault={VAULT} targetId={7n} isEndowment />)

    expect(screen.getByTestId('vault-payout-curation').textContent).toBe('withdrawn')
    expect(screen.getByTestId('vault-payout-decurated').textContent).toMatch(
      /no longer spend from this vault/i,
    )
    expect(screen.getByTestId('vault-payout-corpus').textContent).toBe('3 ETH')

    fireEvent.click(screen.getByRole('button', { name: /release the corpus/i }))
    expect(send.mock.calls[0]?.[0]).toMatchObject({ functionName: 'releaseCorpusToCommunity' })
  })

  test('a de-curated LP vault gets the notice but no corpus release — it has no corpus', () => {
    chain.curated = false
    render(<CommunityPayoutPanel vault={VAULT} targetId={7n} isEndowment={false} />)

    expect(screen.getByTestId('vault-payout-decurated')).toBeTruthy()
    expect(screen.queryByTestId('vault-payout-release')).toBeNull()
  })

  test('the ambassador seats that outlive curation are stated', () => {
    chain.curated = false
    chain.seats = 3n
    render(<CommunityPayoutPanel vault={VAULT} targetId={7n} isEndowment />)
    expect(screen.getByTestId('vault-payout-seats').textContent).toBe('3')
  })

  test('curation is not called withdrawn before the read lands', () => {
    chain.curated = undefined
    render(<CommunityPayoutPanel vault={VAULT} targetId={7n} isEndowment />)

    expect(screen.getByTestId('vault-payout-curation').textContent).toBe('—')
    expect(screen.queryByTestId('vault-payout-decurated')).toBeNull()
  })
})
