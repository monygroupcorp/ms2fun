/**
 * The salon's zero-state — noesis-427 clause 1, "one state device".
 *
 * The box's empty state was keyed on the RAW feed (`data.length === 0`) while the transcript
 * renders the filtered rows. Pick a channel whose posts all sit under the spam threshold — or raise
 * the threshold past everything on the board — and `data` is full while the transcript is bare, so
 * the window drew nothing at all: no lines and no state. Every other activity surface says
 * something there. These pin that the salon does too, in both of its views.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { parseEther } from 'viem'
import { BoardPage } from './BoardPage'
import type { FeedMessage } from '../components/useMessageFeed'

const chain = vi.hoisted(() => ({ threshold: 0n as bigint }))

vi.mock('wagmi', () => ({
  usePublicClient: () => undefined,
  useAccount: () => ({ address: undefined }),
}))

vi.mock('../generated/contracts', () => ({
  globalMessageRegistryAbi: [],
  useReadQueryAggregatorGetHomePageData: () => ({ data: undefined }),
  useReadGlobalMessageRegistryPostThreshold: () => ({ data: chain.threshold }),
}))

vi.mock('../lib/vaults/useAllVaults', () => ({
  useAllVaults: () => ({ vaults: [] }),
}))

// The endorse control on a rendered line wants the board cart's provider; this page's zero-state is
// not what that context decides.
vi.mock('../components/board/boardCart', () => ({
  ZERO_BYTES32: `0x${'0'.repeat(64)}`,
  useBoardCart: () => ({ add: vi.fn(), remove: vi.fn(), items: [] }),
}))

afterEach(cleanup)
beforeEach(() => {
  chain.threshold = 0n
})

const SENDER = '0x1234567890abcdef1234567890abcdef12345678' as const

function post(over: Partial<FeedMessage> = {}): FeedMessage {
  return {
    messageId: 1n,
    instance: SENDER,
    sender: SENDER,
    messageType: 0,
    refId: 0n,
    value: 0n,
    content: 'a considered thing',
    ...over,
  }
}

/** Mount the board over a cache already holding one window of the global feed. */
function mount(messages: FeedMessage[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['message-feed', 'global'], {
    pages: [{ messages, nextCursor: null }],
    pageParams: [null],
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(<BoardPage />, { wrapper: Wrapper })
}

describe('the salon’s zero-state', () => {
  it('says the wall is empty when the feed itself is empty', () => {
    mount([])
    expect(screen.getByTestId('board-empty')).toHaveTextContent('this wall is empty')
  })

  it('still says something when the feed is full but the threshold hides every post', () => {
    chain.threshold = parseEther('1')
    mount([post({ value: 0n })])

    // The regression: rows are filtered out, so the transcript is bare — and it used to stay bare
    // and silent, because the state was keyed on the unfiltered feed.
    expect(screen.queryByTestId('board-thread')).toBeNull()
    expect(screen.getByTestId('board-empty')).toHaveTextContent('nothing to show in this view')
  })

  it('says nothing at all once there is a line to show', () => {
    mount([post()])
    expect(screen.getByTestId('board-thread')).toBeInTheDocument()
    expect(screen.queryByTestId('board-empty')).toBeNull()
  })

  // The discourse view draws threads; an endorsement (type 3) folds into a count on the message it
  // targets and is never a thread. A board holding only endorsements is empty to this view with
  // nothing filtering it, so measuring it against the raw event count blamed the channel and the
  // spam lever for posts that were never there.
  it('says the wall is empty when the only events on it are endorsements', () => {
    mount([post({ messageId: 7n, messageType: 3, refId: 1n, content: '' })])

    const state = screen.getByTestId('board-empty')
    expect(state).toHaveTextContent('this wall is empty')
    expect(state).not.toHaveTextContent('nothing to show in this view')
  })
})
