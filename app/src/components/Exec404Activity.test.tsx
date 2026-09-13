/**
 * Exec404Activity — the fossil's legacy chatter is the SAME designed thing as every other activity
 * surface. It used to be a second one: its own bordered card, its own uppercase heading, its own
 * byline stack with a boxed BOUGHT/SOLD pill, its own hand-rolled state notes. These pin that it is
 * drawn in the shared chat box, through the shared transcript line, with the shared state device.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const reads = vi.hoisted(() => ({ total: undefined as unknown, batch: undefined as unknown }))

vi.mock('wagmi', () => ({
  useReadContract: ({ functionName }: { functionName: string }) => {
    const data = functionName === 'totalMessages' ? reads.total : reads.batch
    return { data, isPending: data === undefined, isError: false }
  },
}))

afterEach(cleanup)

const A = '0x1234567890abcdef1234567890abcdef12345678' as const
const B = '0xaaaabbbbccccddddeeeeffff0000111122223333' as const

/** `getMessagesBatch` returns parallel arrays: senders, timestamps, amounts, isBuys, texts. */
function batch(rows: [`0x${string}`, number, boolean, string][]) {
  return [
    rows.map((r) => r[0]),
    rows.map((r) => BigInt(r[1])),
    rows.map(() => 0n),
    rows.map((r) => r[2]),
    rows.map((r) => r[3]),
  ]
}

async function mount() {
  const { Exec404Activity } = await import('./Exec404Activity')
  return render(<Exec404Activity />)
}

describe('Exec404Activity', () => {
  it('is the shared chat box, named for the room, with no composer on a closed curve', async () => {
    reads.total = 1n
    reads.batch = batch([[A, 1_700_000_000, true, 'gm']])
    const { container } = await mount()

    expect(screen.getByText('Legacy activity')).toBeInTheDocument()
    expect(screen.getByTestId('exec404-activity')).toBeInTheDocument()
    // The curve is closed — there is nothing to say here, so the box ends at the transcript.
    expect(container.querySelector('textarea')).toBeNull()
  })

  it('draws each message as a shared transcript line — attributed, linkified, timed', async () => {
    reads.total = 1n
    reads.batch = batch([
      [A, Math.floor(Date.now() / 1000) - 86_400, true, 'see https://x.example'],
    ])
    await mount()

    expect(screen.getByRole('link', { name: '0x1234…5678' })).toHaveAttribute(
      'href',
      `/profile/${A}`,
    )
    expect(screen.getByText('bought')).toBeInTheDocument()
    expect(screen.getByText('· 1d ago')).toBeInTheDocument()
    // The old card rendered the body as plain text; the shared line linkifies it.
    expect(screen.getByRole('link', { name: 'https://x.example' })).toHaveAttribute(
      'href',
      'https://x.example',
    )
  })

  it('names the event with the curve’s own two verbs', async () => {
    reads.total = 1n
    reads.batch = batch([
      [A, 1_700_000_000, true, 'in'],
      [B, 1_700_000_001, false, 'out'],
    ])
    await mount()

    expect(screen.getByText('bought')).toBeInTheDocument()
    expect(screen.getByText('sold')).toBeInTheDocument()
  })

  it('skips trades that carried no note — it is a message log, not a trade log', async () => {
    reads.total = 2n
    reads.batch = batch([
      [A, 1_700_000_000, true, '   '],
      [B, 1_700_000_001, false, 'said something'],
    ])
    await mount()

    expect(screen.getAllByText(/said something/)).toHaveLength(1)
    expect(screen.queryByText('bought')).toBeNull()
  })

  it('says an empty room through the shared state device, not a bespoke note', async () => {
    reads.total = 0n
    reads.batch = undefined
    const { container } = await mount()

    const empty = screen.getByTestId('exec404-activity-empty')
    expect(empty).toHaveTextContent('no legacy messages')
    expect(empty.className).toContain('noesis-state')
    expect(container.querySelector('h2')).toBeNull()
  })
})
