/**
 * ActivityStates — the three states of a transcript, now decided in one place. These pin the part
 * that was wrong in two of the four surfaces before it was shared: a window whose filters hide
 * every line must not claim the room is empty, because the invitation it prints ("be the first to
 * post") is a false statement about a board that has posts in it.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ActivityStates, ActivityThresholdNote } from './ActivityStates'

afterEach(cleanup)

const EMPTY = 'no activity yet — be the first to post on the board.'

function states(props: Partial<Parameters<typeof ActivityStates>[0]> = {}) {
  return (
    <ActivityStates
      subject="activity"
      isPending={false}
      isError={false}
      fetched={0}
      shown={0}
      empty={EMPTY}
      emptyTestId="states-empty"
      {...props}
    />
  )
}

describe('ActivityStates', () => {
  it('names what it is loading, so every window loads in the same sentence', () => {
    render(states({ isPending: true }))
    expect(screen.getByText('loading activity…')).toBeInTheDocument()

    cleanup()
    render(states({ isPending: true, subject: 'legacy messages' }))
    expect(screen.getByText('loading legacy messages…')).toBeInTheDocument()
  })

  it('reports a fault without instructing — a visitor cannot act on a network fault', () => {
    render(states({ isError: true }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      "couldn't load activity — no response from the network.",
    )
  })

  it('invites the first word only when the room is genuinely empty', () => {
    render(states({ fetched: 0, shown: 0 }))
    expect(screen.getByTestId('states-empty')).toHaveTextContent(EMPTY)
  })

  it('says the filters are hiding the room, not that the room is empty', () => {
    render(states({ fetched: 12, shown: 0 }))
    const note = screen.getByTestId('states-empty')
    expect(note).toHaveTextContent('nothing to show in this view')
    expect(note).toHaveTextContent('the current threshold hides every post in the feed.')
    expect(note).not.toHaveTextContent('be the first')
  })

  it('names the filters the surface actually has', () => {
    render(states({ fetched: 12, shown: 0, filters: 'the current channel and threshold' }))
    expect(screen.getByTestId('states-empty')).toHaveTextContent(
      'the current channel and threshold hides every post in the feed.',
    )
  })

  it('stays quiet while the feed is unanswered and once there are lines on screen', () => {
    const { rerender } = render(states({ fetched: undefined }))
    expect(screen.queryByTestId('states-empty')).toBeNull()

    rerender(states({ fetched: 3, shown: 3 }))
    expect(screen.queryByTestId('states-empty')).toBeNull()
  })
})

describe('ActivityThresholdNote', () => {
  it('renders nothing while the lever is off', () => {
    const { container } = render(<ActivityThresholdNote threshold={0n} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('names the lever and the floor it sets, in one sentence for every surface', () => {
    render(<ActivityThresholdNote threshold={10_000_000_000_000_000n} testId="note" />)
    expect(screen.getByTestId('note')).toHaveTextContent(
      'spam lever on: showing posts of 0.01 ETH or more — cheaper posts are hidden until the threshold is lowered.',
    )
  })
})
