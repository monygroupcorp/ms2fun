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
  curated: true as boolean | undefined,
  seats: 2n as bigint | undefined,
  waiting: 0n as bigint | undefined,
  corpus: 0n as bigint | undefined,
  residue: 0n as bigint | undefined,
  /** The connected wallet. The move-payout row shows only to whoever the payout currently points at. */
  connected: undefined as string | undefined,
}))

const send = vi.hoisted(() => vi.fn())

vi.mock('../../generated/contracts', () => ({
  alignmentRegistryV1Abi: [],
  useReadAlignmentRegistryV1GetCommunityPayout: () => ({
    data: chain.sink,
    refetch: vi.fn(),
  }),
  useReadAlignmentRegistryV1IsAlignmentTargetActive: () => ({ data: chain.curated }),
  useReadAlignmentRegistryV1AmbassadorCount: () => ({ data: chain.seats }),
}))

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: chain.connected }),
  useReadContract: ({ functionName }: { functionName: string }) => ({
    data:
      functionName === 'deployableCorpus'
        ? chain.corpus
        : functionName === 'roundResidue'
          ? chain.residue
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
  chain.curated = true
  chain.seats = 2n
  chain.waiting = 0n
  chain.corpus = 0n
  chain.residue = 0n
  chain.connected = undefined
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

  test('an endowment vault with no registry sink reads as unwired, with no fallback behind it', () => {
    chain.sink = ZERO
    chain.waiting = 190000000000000000n
    render(<CommunityPayoutPanel vault={VAULT} targetId={7n} isEndowment />)

    // The endowment clone used to carry an owner-writable sink of its own that `_targetSink()` fell
    // back to. Naming such an address here would show a community a payout it never chose and cannot
    // rotate, and offer a delivery button aimed at it.
    const sinkCell = screen.getByTestId('vault-payout-sink')
    expect(sinkCell.textContent).toMatch(/not wired yet/i)
    expect(sinkCell.textContent).not.toMatch(/fallback/i)
    expect(
      (screen.getByRole('button', { name: /deliver to the community/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  test('the registry sink is the whole answer on the endowment family too', () => {
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

    fireEvent.click(screen.getByRole('button', { name: /release the principal/i }))
    expect(send.mock.calls[0]?.[0]).toMatchObject({ functionName: 'releaseCorpusToCommunity' })
  })

  test('a de-curated endowment vault folds any parked residue into the release figure', () => {
    chain.curated = false
    chain.corpus = 3000000000000000000n
    chain.residue = 500000000000000000n
    render(<CommunityPayoutPanel vault={VAULT} targetId={7n} isEndowment />)

    expect(screen.getByTestId('vault-payout-corpus').textContent).toBe('3.5 ETH')
    // The residue-flush row is curated-only — once de-curated, `flushRoundResidue` reverts and only
    // the release above can move it.
    expect(screen.queryByTestId('vault-payout-residue')).toBeNull()
  })

  test('a curated endowment vault with parked residue offers the permissionless flush', () => {
    chain.residue = 250000000000000000n
    render(<CommunityPayoutPanel vault={VAULT} targetId={7n} isEndowment />)

    expect(screen.getByTestId('vault-payout-residue-figure').textContent).toBe('0.25 ETH')
    fireEvent.click(screen.getByRole('button', { name: /deliver the residue/i }))
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      address: VAULT,
      functionName: 'flushRoundResidue',
    })
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

  // ── moving the payout: the one authority here that is the community's alone ──────────

  test('the payee sees the move-payout row and it sends rotateCommunityPayout', () => {
    chain.connected = SINK
    render(<CommunityPayoutPanel vault={VAULT} targetId={7n} isEndowment />)

    fireEvent.change(screen.getByTestId('vault-payout-rotate-input'), {
      target: { value: STORED },
    })
    fireEvent.click(screen.getByRole('button', { name: /move the payout/i }))

    expect(send.mock.calls[0]?.[0]).toMatchObject({
      address: REGISTRY,
      functionName: 'rotateCommunityPayout',
      args: [7n, STORED],
    })
  })

  test('the row is matched case-insensitively against the connected wallet', () => {
    // Wallets and registry reads disagree on checksum casing all the time; comparing raw would hide
    // the row from the very address that holds the authority.
    chain.connected = SINK.toUpperCase().replace('0X', '0x')
    render(<CommunityPayoutPanel vault={VAULT} targetId={7n} isEndowment />)

    expect(screen.getByTestId('vault-payout-rotate')).toBeTruthy()
  })

  test('nobody but the current payee sees the move-payout row', () => {
    // Not the operator, not a passer-by, and not yesterday's payee. The contract would revert them
    // all; showing the row would be claiming an authority the app does not have.
    for (const who of [undefined, STORED, REGISTRY]) {
      chain.connected = who
      const { unmount } = render(<CommunityPayoutPanel vault={VAULT} targetId={7n} isEndowment />)
      expect(screen.queryByTestId('vault-payout-rotate')).toBeNull()
      unmount()
    }
  })

  test('an unset payout offers nobody the row — there is nothing to move yet', () => {
    chain.sink = ZERO
    chain.connected = SINK
    render(<CommunityPayoutPanel vault={VAULT} targetId={7n} isEndowment />)

    expect(screen.queryByTestId('vault-payout-rotate')).toBeNull()
  })

  test('the move button stays disabled until the address entered is a real one', () => {
    chain.connected = SINK
    render(<CommunityPayoutPanel vault={VAULT} targetId={7n} isEndowment />)

    const button = screen.getByRole('button', { name: /move the payout/i }) as HTMLButtonElement
    expect(button.disabled).toBe(true)

    fireEvent.change(screen.getByTestId('vault-payout-rotate-input'), {
      target: { value: '0xnope' },
    })
    expect(button.disabled).toBe(true)

    // Zero would burn the sink; the registry rejects it and so does the row.
    fireEvent.change(screen.getByTestId('vault-payout-rotate-input'), {
      target: { value: ZERO },
    })
    expect(button.disabled).toBe(true)

    fireEvent.change(screen.getByTestId('vault-payout-rotate-input'), {
      target: { value: STORED },
    })
    expect(button.disabled).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })
})
