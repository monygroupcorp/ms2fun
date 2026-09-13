/**
 * ActivityLine — the one transcript line every activity surface draws. These pin the parts that
 * used to be redrawn per surface: whether a URL in a post is live, how a channel is named, and
 * that a surface may leave out a part it does not know without inventing a second design for it.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ActivityLine } from './ActivityLine'
import { channelRef } from './messageMeta'

afterEach(cleanup)

const WALLET = '0x1234567890abcdef1234567890abcdef12345678' as const
const COLLECTION = '0xaaaabbbbccccddddeeeeffff0000111122223333' as const

describe('ActivityLine', () => {
  it('attributes the sender with a link to their profile — there are no anonymous posts', () => {
    render(<ActivityLine sender={WALLET} say="a considered thing" />)
    expect(screen.getByRole('link', { name: '0x1234…5678' })).toHaveAttribute(
      'href',
      `/profile/${WALLET}`,
    )
  })

  it('linkifies what was said, on every surface at once', () => {
    render(<ActivityLine sender={WALLET} say="see https://noesis.example/work" />)
    const link = screen.getByRole('link', { name: 'https://noesis.example/work' })
    expect(link).toHaveAttribute('href', 'https://noesis.example/work')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('reads a wall channel as the salon and a collection channel as an arrow', () => {
    const { rerender } = render(
      <ActivityLine sender={WALLET} channel={channelRef({ instance: WALLET, sender: WALLET })} />,
    )
    expect(screen.getByRole('link', { name: '· on the salon' })).toHaveAttribute(
      'href',
      `/profile/${WALLET}`,
    )

    rerender(
      <ActivityLine
        sender={WALLET}
        channel={channelRef({ instance: COLLECTION, sender: WALLET })}
      />,
    )
    expect(screen.getByRole('link', { name: '→ 0xaaaa…3333' })).toHaveAttribute(
      'href',
      `/collection/${COLLECTION}`,
    )
  })

  it('omits the channel entirely on a single-room log, rather than pointing at a room it is in', () => {
    render(<ActivityLine sender={WALLET} verb="bought" say="gm" />)
    // The byline is the only link on the line.
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })

  it('names the event only when given one, so a plain post says nothing extra', () => {
    const { rerender } = render(<ActivityLine sender={WALLET} say="a considered thing" />)
    expect(screen.queryByText('posted')).toBeNull()

    rerender(<ActivityLine sender={WALLET} verb="replied" say="a considered thing" />)
    expect(screen.getByText('replied')).toBeInTheDocument()
  })

  it('shows a time only where the surface knows one', () => {
    const { rerender } = render(<ActivityLine sender={WALLET} when="3mo ago" say="gm" />)
    expect(screen.getByText('· 3mo ago')).toBeInTheDocument()

    // The board feed carries no block times, so it passes nothing — and an empty string is nothing,
    // not a "· " with a hole after it.
    rerender(<ActivityLine sender={WALLET} when="" say="gm" />)
    expect(screen.queryByText(/·/)).toBeNull()
  })

  it('hangs trailing blocks under the line, not inside its paragraph', () => {
    const { container } = render(
      <ActivityLine sender={WALLET} say="gm">
        <div data-testid="attachment" />
      </ActivityLine>,
    )
    // A block inside a <p> is invalid markup the browser silently reflows.
    expect(container.querySelector('p [data-testid="attachment"]')).toBeNull()
    expect(screen.getByTestId('attachment')).toBeInTheDocument()
  })
})
