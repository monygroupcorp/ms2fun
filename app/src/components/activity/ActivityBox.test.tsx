/**
 * ActivityBox — the window every activity surface is drawn in. These pin the contract the three
 * surfaces rely on: the room is always named, the transcript takes whatever the surface hands it
 * (states included), and the well only exists where there is something to say from.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ActivityBox } from './ActivityBox'

afterEach(cleanup)

describe('ActivityBox', () => {
  it('names the room, and says nothing in the plate’s right slot until given something', () => {
    const { unmount } = render(<ActivityBox room="All discourse">…</ActivityBox>)
    expect(screen.getByText('All discourse')).toBeInTheDocument()
    expect(screen.queryByText('12 posts')).not.toBeInTheDocument()
    unmount()

    render(
      <ActivityBox room="All discourse" status="12 posts">
        …
      </ActivityBox>,
    )
    expect(screen.getByText('12 posts')).toBeInTheDocument()
  })

  it('puts everything the surface hands it in the transcript, states included', () => {
    render(
      <ActivityBox room="Activity" logTestId="message-feed">
        <p>no activity yet</p>
      </ActivityBox>,
    )
    expect(screen.getByTestId('message-feed')).toHaveTextContent('no activity yet')
  })

  it('has no well on a read-only surface, and docks the composer in one when given', () => {
    const { unmount } = render(<ActivityBox room="Recent activity">…</ActivityBox>)
    expect(screen.queryByTestId('composer')).not.toBeInTheDocument()
    unmount()

    render(
      <ActivityBox room="Activity" composer={<button data-testid="composer">say something</button>}>
        …
      </ActivityBox>,
    )
    expect(screen.getByTestId('composer')).toBeInTheDocument()
  })
})
