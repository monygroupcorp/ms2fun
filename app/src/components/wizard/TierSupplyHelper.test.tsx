import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { TierSupplyHelper } from './TierSupplyHelper'

afterEach(cleanup)

// rth's canonical 4,400 case, re-read for the derived ladder: 4000 mintable ids and a ×10 tier. The
// creator types the DENOMINATION; the contract derives the 400-id band at 4001–4400 above the supply.
const LADDER_X10 = { 'tierWeights.0': '10' }

describe('TierSupplyHelper', () => {
  test('derives the range, the count, and the count the supply could back', () => {
    render(<TierSupplyHelper nftCount={4000n} values={LADDER_X10} />)
    const el = screen.getByTestId('tier-supply-helper')
    expect(el).toHaveAttribute('data-derived', 'true')
    expect(el.textContent).toContain('NFT supply: 4000')
    expect(el.textContent).toContain('ids 4001–4400')
    expect(el.textContent).toContain('400 of 400 possible')
    expect(el.textContent).toContain('×10')
    expect(el.textContent).toContain('bands reserve 400 ids above the supply')
    expect(el.textContent).toContain('metadata must state its denomination')
    expect(el.textContent).toContain('a tier 1 piece is worth ×10 in coin')
  })

  test('a capped tier reads as scarce, showing what it gets vs what it could have', () => {
    render(
      <TierSupplyHelper
        nftCount={4000n}
        values={{ 'tierWeights.0': '10', 'tierCounts.0': '40' }}
      />,
    )
    const el = screen.getByTestId('tier-supply-helper')
    expect(el.textContent).toContain('40 of 400 possible')
    expect(el.textContent).toContain('ids 4001–4040')
    expect(el.querySelector('[data-scarce="true"]')).not.toBeNull()
    expect(el.textContent).toMatch(/sells out while coin remains/i)
  })

  test('a two-rung ladder packs contiguously above the supply', () => {
    render(
      <TierSupplyHelper
        nftCount={1000n}
        values={{ 'tierWeights.0': '10', 'tierWeights.1': '100' }}
      />,
    )
    const el = screen.getByTestId('tier-supply-helper')
    expect(el.textContent).toContain('ids 1001–1100')
    expect(el.textContent).toContain('ids 1101–1110')
    expect(el.textContent).toContain('bands reserve 110 ids above the supply')
    // Nothing is scarce here, so the scarcity nudge stays out of the way.
    expect(el.querySelector('[data-scarce="true"]')).toBeNull()
  })

  test('supply not yet entered (0) → no invented ranges', () => {
    render(<TierSupplyHelper nftCount={0n} values={LADDER_X10} />)
    const el = screen.getByTestId('tier-supply-helper')
    expect(el).toHaveAttribute('data-derived', 'false')
    expect(el.textContent).toContain('NFT supply: —')
    expect(el.textContent).toContain('enter an NFT supply')
    expect(el.textContent).not.toContain('ids 4001')
  })

  test('no ladder rows yet → nothing to derive', () => {
    render(<TierSupplyHelper nftCount={4400n} values={{}} />)
    const el = screen.getByTestId('tier-supply-helper')
    expect(el).toHaveAttribute('data-derived', 'false')
    expect(el.textContent).toContain('no tiers yet')
    expect(el.textContent).not.toContain('metadata must state its denomination')
  })
})
