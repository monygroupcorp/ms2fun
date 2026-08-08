import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TypeLearnLink, buildDeployBlockers, slotErrorCount } from './WizardPage'
import { PROJECT_TYPES } from '../lib/wizard/projectTypes'
import { getConcept } from '../lib/learn/concepts'
import { validateMetadataConfig } from '../lib/wizard/metadataConfig'

const TIER_ADDR = '0x00000000000000000000000000000000000000a1' as `0x${string}`

/** A well-formed base of blocker input (nothing wrong) — each test perturbs one field. */
function okInput() {
  return {
    metadataName: 'My Collection',
    nameError: null,
    nameTaken: false,
    walletConnected: true,
    ownerNeedsAgent: false,
    vaultSelected: true,
    coreErrors: {},
    metaErrors: {},
  }
}

describe('deploy-blocker surfacing (W8/W7)', () => {
  it('a clean state produces no blockers', () => {
    expect(buildDeployBlockers(okInput())).toEqual([])
  })

  it('a collapsed/empty tier table surfaces the SPECIFIC tier error (not a coarse "metadata stack") and jumps to Modules', () => {
    // Real validator output: tier module selected, no rows entered.
    const metaErrors = validateMetadataConfig({ tier: TIER_ADDR }, {}, 0n)
    expect(Object.keys(metaErrors).length).toBeGreaterThan(0)

    const blockers = buildDeployBlockers({ ...okInput(), metaErrors })

    const tierLine = blockers.find((b) => /add at least one tier row/i.test(b.message))
    expect(tierLine, 'the specific tier error is surfaced').toBeDefined()
    expect(tierLine!.step).toBe('modules')
    // The old coarse catch-all is gone.
    expect(blockers.some((b) => /fix the metadata module config/i.test(b.message))).toBe(false)
  })

  it('a malformed tier rung surfaces the exact row + reason', () => {
    // Id ranges stopped being app input (noesis-160) — the contract derives them — so the row-level
    // validation that survives is the LADDER's own: row 1 carries a weight below the minimum.
    const metaErrors = validateMetadataConfig({ tier: TIER_ADDR }, { 'tierWeights.0': '1' }, 0n)
    const blockers = buildDeployBlockers({ ...okInput(), metaErrors })
    expect(blockers.some((b) => /tier 1: weight must be ≥ 2/i.test(b.message))).toBe(true)
  })

  it('a failing core field becomes its own line routed to its owning step', () => {
    const blockers = buildDeployBlockers({
      ...okInput(),
      coreErrors: { nftCount: 'Supply is required', styleUri: 'Bad URI' },
    })
    expect(blockers.find((b) => b.message === 'Supply is required')!.step).toBe('contract')
    // styleUri is authored on the Collection-page step.
    expect(blockers.find((b) => b.message === 'Bad URI')!.step).toBe('page')
  })

  it('name / wallet / vault gates each surface with a jump target', () => {
    const noName = buildDeployBlockers({ ...okInput(), metadataName: '  ' })
    expect(noName.find((b) => /set a collection name/i.test(b.message))!.step).toBe('page')

    const noVault = buildDeployBlockers({ ...okInput(), vaultSelected: false })
    expect(noVault.find((b) => /alignment vault/i.test(b.message))!.step).toBe('alignment')
  })

  it('slotErrorCount buckets a slot’s validation errors by key prefix', () => {
    // A non-increasing ladder: row 2's weight does not climb above row 1's.
    const metaErrors = validateMetadataConfig(
      { tier: TIER_ADDR },
      { 'tierWeights.0': '10', 'tierWeights.1': '10' },
      0n,
    )
    expect(slotErrorCount('tier', metaErrors)).toBeGreaterThan(0)
    expect(slotErrorCount('overlay', metaErrors)).toBe(0)
  })
})

describe('type-picker learn links', () => {
  it('every project type carries a learnMore slug that equals its key and resolves', () => {
    expect(PROJECT_TYPES.length).toBeGreaterThan(0)
    for (const pt of PROJECT_TYPES) {
      expect(pt.learnMore, `${pt.key} has no learnMore`).toBe(pt.key)
      expect(getConcept(pt.learnMore!), `no /learn concept for "${pt.key}"`).toBeDefined()
    }
  })

  it('TypeLearnLink renders an anchor to /learn/{key} opening in a new tab', () => {
    for (const pt of PROJECT_TYPES) {
      const { unmount } = render(<TypeLearnLink slug={pt.learnMore!} />)
      const link = screen.getByRole('link')
      expect(link.getAttribute('href')).toBe(`/learn/${pt.key}`)
      expect(link.getAttribute('target')).toBe('_blank')
      unmount()
    }
  })

  it('clicking the learn link does not bubble to the card (type-select stays distinct)', () => {
    const cardClick = vi.fn()
    render(
      <button type="button" onClick={cardClick}>
        <TypeLearnLink slug="erc404" />
      </button>,
    )
    fireEvent.click(screen.getByRole('link'))
    expect(cardClick).not.toHaveBeenCalled()
  })
})
