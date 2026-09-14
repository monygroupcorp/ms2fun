import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { activeNetworkName } from '../../lib/network'
import type { CollectionHeroCard } from './CollectionHero'
import { CollectionHero } from './CollectionHero'

// ── The hero speaks the same two words as the browse chip, or none ──────────────────────────────
//
// The breadcrumb used to read `Collections / Ended` for four unrelated states, so a drop scheduled
// for next week announced itself as something that had already happened. The kicker now carries a
// status segment only when there is a status to carry: Live, Soon, or nothing at all. Asserted on
// the segment's ABSENCE, not on an empty one, because a dangling ` / ` is the same epitaph with the
// word rubbed off.

// The cover art is not the subject and would reach for a gateway.
vi.mock('../ui/IpfsImage', () => ({ IpfsImage: () => null }))

afterEach(cleanup)

const ADDR = '0x1111111111111111111111111111111111aAaA' as const

function card(overrides: Partial<CollectionHeroCard>): CollectionHeroCard {
  return {
    name: 'Specimen',
    creator: ADDR,
    isActive: false,
    opensAt: 0n,
    currentPrice: 0n,
    totalSupply: 0n,
    maxSupply: 0n,
    vault: ADDR,
    vaultName: '',
    contractType: 'ERC404',
    factoryTitle: '',
    ...overrides,
  }
}

/** The breadcrumb line — the hero's first paragraph, and the only place a status is spelled. */
function kicker(container: HTMLElement) {
  return container.querySelector('p')
}

function renderHero(c: CollectionHeroCard) {
  const { hook } = memoryLocation({ path: '/1/specimen' })
  return render(
    <Router hook={hook}>
      <CollectionHero instance={ADDR} card={c} metadata={undefined} />
    </Router>,
  )
}

describe('CollectionHero status segment', () => {
  it('names Live while the collection is buyable', () => {
    const { container } = renderHero(card({ isActive: true }))
    expect(kicker(container)).toHaveTextContent(`Collections / Live · ${activeNetworkName}`)
  })

  it('names Soon while the opening is still ahead', () => {
    const { container } = renderHero(card({ opensAt: 1_900_000_000n }))
    expect(kicker(container)).toHaveTextContent(`Collections / Soon · ${activeNetworkName}`)
  })

  it('drops the segment once the collection is over', () => {
    // A curve bought out or graduated, an auction settled, an edition run finished: one state on
    // this leg, and the breadcrumb says nothing about any of them.
    const { container } = renderHero(card({}))
    expect(kicker(container)).toHaveTextContent(`Collections · ${activeNetworkName}`)
    expect(kicker(container)?.textContent).not.toContain('/')
    expect(kicker(container)?.textContent).not.toContain('Ended')
  })
})
