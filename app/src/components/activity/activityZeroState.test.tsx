/**
 * The zero-state of the other two activity surfaces — noesis-427 clause 1, "one state device".
 *
 * The salon was fixed on its own (see `BoardPage.emptyState.test.tsx`); the collection/vault/
 * profile feed and home's preview had the same bug and kept it, because each surface hand-rolled
 * its own states. Both filter their feed by the spam threshold and both then worded the zero-state
 * as though the room itself were empty — so a collection whose posts all sat under the threshold
 * read "no activity yet", and the landing page invited you to "be the first to post" on a board
 * that already had posts in it.
 *
 * Both now draw `ActivityStates`, so these pin the wiring: that each surface hands it the count it
 * FETCHED as well as the count it SHOWS, which is the whole of what tells the two apart.
 *
 * The same sentence is wrong a second way on the profile wall, where the feed is filtered by sender:
 * there is no room to be first in and no composer for a visitor, so these also pin that a wall says
 * what it is, and that a surface which knows better can say so itself.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseEther } from 'viem'
import { MessageFeed } from '../MessageFeed'
import { ActivityPreview } from '../home/ActivityPreview'
import type { FeedMessage } from '../useMessageFeed'

const feed = vi.hoisted(() => ({
  messages: [] as FeedMessage[],
  threshold: 0n as bigint,
}))

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: undefined }),
}))

vi.mock('../useMessageFeed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../useMessageFeed')>()),
  useMessageFeed: () => ({ data: feed.messages, isPending: false, isError: false }),
  usePostThreshold: () => feed.threshold,
}))

vi.mock('../home/useGlobalActivity', () => ({
  useGlobalActivity: () => ({ data: feed.messages, isPending: false, isError: false }),
}))

afterEach(cleanup)
beforeEach(() => {
  feed.messages = []
  feed.threshold = 0n
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

describe('the collection/vault/profile feed’s zero-state', () => {
  it('invites the first word when the feed itself is empty', () => {
    render(<MessageFeed filter={{ instance: SENDER }} />)
    expect(screen.getByTestId('message-feed-empty')).toHaveTextContent('no activity yet')
  })

  it('names the threshold when the feed is full but every post sits under it', () => {
    feed.threshold = parseEther('1')
    feed.messages = [post({ value: 0n })]

    render(<MessageFeed filter={{ instance: SENDER }} />)

    const state = screen.getByTestId('message-feed-empty')
    expect(state).toHaveTextContent('nothing to show in this view')
    expect(state).not.toHaveTextContent('no activity yet')
  })
})

describe('home’s recent-activity preview', () => {
  it('invites the first post when the board itself is empty', () => {
    render(<ActivityPreview />)
    expect(screen.getByTestId('home-activity-empty')).toHaveTextContent(
      'be the first to post on the board',
    )
  })

  it('does not invite the first post onto a board that already has posts', () => {
    feed.threshold = parseEther('1')
    feed.messages = [post({ value: 0n })]

    render(<ActivityPreview />)

    const state = screen.getByTestId('home-activity-empty')
    expect(state).toHaveTextContent('nothing to show in this view')
    expect(state).not.toHaveTextContent('be the first')
  })
})

describe('the profile wall’s zero-state', () => {
  it('does not invite a visitor to speak on a wall nobody can post to', () => {
    render(<MessageFeed filter={{ sender: SENDER }} />)

    const state = screen.getByTestId('message-feed-empty')
    expect(state).toHaveTextContent('nothing from this address yet')
    expect(state).not.toHaveTextContent('be the first')
  })

  it('takes the surface’s own words when it has them — the owner, who does have a composer', () => {
    render(
      <MessageFeed
        filter={{ sender: SENDER }}
        empty="nothing from you yet — anything you post lands here."
      />,
    )

    expect(screen.getByTestId('message-feed-empty')).toHaveTextContent('nothing from you yet')
  })

  it('names the threshold on a wall whose every post sits under it', () => {
    feed.threshold = parseEther('1')
    feed.messages = [post({ value: 0n })]

    render(<MessageFeed filter={{ sender: SENDER }} />)

    const state = screen.getByTestId('message-feed-empty')
    expect(state).toHaveTextContent('nothing to show in this view')
    expect(state).not.toHaveTextContent('nothing from this address yet')
  })
})
