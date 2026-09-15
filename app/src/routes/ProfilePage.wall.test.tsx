/**
 * The profile wall is drawn in the box like every other activity surface — noesis-427 clause 1,
 * "one component … one state device".
 *
 * The collection feed, the vault board and the salon all dock their composer in the box's well, so
 * an empty transcript reads directly above the thing that answers it. The wall alone rendered the
 * owner's composer as a detached form ABOVE the box, which put the owner's zero-state — "nothing
 * from you yet" — below the form it is an invitation to use, and drew the one surface that is meant
 * to be the same room as a form over a list. These pin the well: the owner speaks from inside the
 * box, and a visitor, who cannot post to a wall at all, gets no well.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { ProfilePage } from './ProfilePage'
import type { FeedMessage } from '../components/useMessageFeed'

const OWNER = '0x1234567890abcdef1234567890abcdef12345678' as const
const VISITOR = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as const

const wallet = vi.hoisted(() => ({ address: undefined as `0x${string}` | undefined }))
const route = vi.hoisted(() => ({
  address: '0x1234567890abcdef1234567890abcdef12345678' as string,
}))
const feed = vi.hoisted(() => ({ messages: [] as FeedMessage[] }))

vi.mock('wouter', () => ({
  useParams: () => ({ address: route.address }),
  Link: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: wallet.address }),
  usePublicClient: () => undefined,
  useWriteContract: () => ({ writeContract: vi.fn(), data: undefined, reset: vi.fn() }),
  useWaitForTransactionReceipt: () => ({ isLoading: false, isSuccess: false }),
}))

vi.mock('../components/useMessageFeed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../components/useMessageFeed')>()),
  useMessageFeed: () => ({ data: feed.messages, isPending: false, isError: false }),
  usePostThreshold: () => 0n,
}))

vi.mock('../generated/contracts', () => ({
  profileRegistryAbi: [],
  useReadProfileRegistryProfileUri: () => ({
    data: '',
    isPending: false,
    isError: false,
    queryKey: ['profile-uri'],
  }),
  useWriteProfileRegistrySetProfile: () => ({
    writeContract: vi.fn(),
    isPending: false,
    isSuccess: false,
  }),
}))

vi.mock('../components/useProfileMetadata', () => ({
  useProfileMetadata: () => undefined,
}))

vi.mock('../components/portfolio/usePortfolio', () => ({
  usePortfolio: () => ({ data: undefined, isPending: false, isError: false, truncated: false }),
}))

vi.mock('../components/CreatorCollections', () => ({
  CreatorCollections: () => <div />,
}))

// The composer queues into the board cart, which the profile route does not provide.
vi.mock('../components/board/boardCart', () => ({
  ZERO_BYTES32: `0x${'0'.repeat(64)}`,
  useBoardCart: () => ({ add: vi.fn(), remove: vi.fn(), items: [] }),
}))

afterEach(cleanup)
beforeEach(() => {
  wallet.address = undefined
  feed.messages = []
})

function renderWall() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ProfilePage />
    </QueryClientProvider>,
  )
}

describe('the profile wall’s composer', () => {
  it('docks in the box’s well for the owner, below the transcript it writes into', () => {
    wallet.address = OWNER

    renderWall()

    const composer = screen.getByPlaceholderText('write something…')
    const log = screen.getByTestId('message-feed')

    // Inside the same box as the transcript, not a sibling section above it.
    expect(log.contains(composer)).toBe(false)
    expect(log.parentElement?.contains(composer)).toBe(true)

    // …and after it, so the owner's zero-state reads as the line above the well.
    const empty = screen.getByTestId('message-feed-empty')
    expect(empty.compareDocumentPosition(composer)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(empty).toHaveTextContent('nothing from you yet')
  })

  it('leaves the box with no well for a visitor, who cannot post to a wall', () => {
    wallet.address = VISITOR

    renderWall()

    expect(screen.queryByPlaceholderText('write something…')).toBeNull()
    expect(screen.getByTestId('message-feed-empty')).toHaveTextContent(
      'nothing from this address yet',
    )
  })
})
