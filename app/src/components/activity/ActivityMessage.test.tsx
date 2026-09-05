/**
 * ActivityMessage — the one post every activity surface draws. These pin the behaviours that used
 * to differ per surface: where a channel link goes, how a message type is named, and whether the
 * endorse/reply controls appear at all.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FeedMessage } from '../useMessageFeed'
import type { ThreadView } from '../threadMessages'
import { ActivityMessage } from './ActivityMessage'

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: '0x1111111111111111111111111111111111111111' }),
}))

vi.mock('../board/boardCart', () => ({
  ZERO_BYTES32: `0x${'0'.repeat(64)}`,
  useBoardCart: () => ({ add: vi.fn(), remove: vi.fn(), items: [] }),
}))

afterEach(cleanup)

const WALLET = '0x1234567890abcdef1234567890abcdef12345678' as const
const COLLECTION = '0xaaaabbbbccccddddeeeeffff0000111122223333' as const

function message(over: Partial<FeedMessage> = {}): FeedMessage {
  return {
    messageId: 1n,
    instance: COLLECTION,
    sender: WALLET,
    messageType: 0,
    refId: 0n,
    value: 0n,
    content: 'a considered thing',
    ...over,
  }
}

const EMPTY_VIEW: ThreadView = { threads: [], reactions: new Map() }

describe('ActivityMessage', () => {
  it('links a wall post at the sender’s profile, not a collection page that does not exist', () => {
    render(<ActivityMessage message={message({ instance: WALLET })} />)
    const channel = screen.getByRole('link', { name: '· on the salon' })
    expect(channel).toHaveAttribute('href', `/profile/${WALLET}`)
  })

  it('links a collection post at the collection', () => {
    render(<ActivityMessage message={message()} />)
    expect(screen.getByRole('link', { name: '→ 0xaaaa…3333' })).toHaveAttribute(
      'href',
      `/collection/${COLLECTION}`,
    )
  })

  it('always attributes the sender with a link to their profile', () => {
    render(<ActivityMessage message={message()} />)
    expect(screen.getByRole('link', { name: '0x1234…5678' })).toHaveAttribute(
      'href',
      `/profile/${WALLET}`,
    )
  })

  it('says nothing extra about a plain post, and names every other event', () => {
    const { unmount } = render(<ActivityMessage message={message()} />)
    expect(screen.queryByText('posted')).not.toBeInTheDocument()
    unmount()

    render(<ActivityMessage message={message({ messageType: 1, content: 'quite' })} />)
    expect(screen.getByText('replied')).toBeInTheDocument()
  })

  it('renders a quote as a card pointing back at the channel it quotes', () => {
    render(<ActivityMessage message={message({ messageType: 2 })} />)
    expect(screen.getByText('re: 0xaaaa…3333')).toBeInTheDocument()
  })

  it('renders no endorse or reply control on a read-only surface', () => {
    render(<ActivityMessage message={message()} />)
    expect(screen.queryByTestId('board-react')).not.toBeInTheDocument()
    expect(screen.queryByTestId('board-reply-toggle')).not.toBeInTheDocument()
  })

  it('offers endorse and reply once a surface asks for actions and a wallet is connected', () => {
    render(<ActivityMessage message={message()} actions={{ view: EMPTY_VIEW, connected: true }} />)
    expect(screen.getByTestId('board-react')).toBeInTheDocument()
    expect(screen.getByTestId('board-reply-toggle')).toBeInTheDocument()
  })

  it('withholds the reply control from a disconnected visitor but still shows the tally', () => {
    render(<ActivityMessage message={message()} actions={{ view: EMPTY_VIEW, connected: false }} />)
    expect(screen.getByTestId('board-react')).toBeInTheDocument()
    expect(screen.queryByTestId('board-reply-toggle')).not.toBeInTheDocument()
  })
})
