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

// ── The alignment line names a payee and never a source ─────────────────────────────────────────
//
// The hero used to read "19% of fees route to the community on every mint". The card it renders
// from carries `vaultName` and no `vaultType()`, so the hero cannot tell an LP vault (which splits
// trading fees) from an endowment one (which splits the yield on a corpus) — the sentence was one
// family's reading printed over both. "On every mint" was wrong on a third axis besides: the bind
// lands at edition mint, auction close or ERC404 graduation depending on the standard.

describe('CollectionHero alignment line', () => {
  it('names the vault it is bound to', () => {
    const { getByTestId } = renderHero(card({ vaultName: 'Nouns' }))
    expect(getByTestId('hero-alignment-law')).toHaveTextContent('Nouns')
  })

  it('claims no source for the 19% — no fees, no yield, no per-mint trigger', () => {
    const line = renderHero(card({ vaultName: 'Nouns' })).getByTestId('hero-alignment-law')
    expect(line.textContent ?? '').not.toMatch(/fees?|yield|every mint/i)
  })

  it("still says the split is not the creator's to change", () => {
    const { getByTestId } = renderHero(card({ vaultName: 'Nouns' }))
    expect(getByTestId('hero-alignment-law')).toHaveTextContent(/nobody can change|can’t change/i)
  })
})
