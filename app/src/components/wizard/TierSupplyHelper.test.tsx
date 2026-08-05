import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { TierSupplyHelper } from './TierSupplyHelper'

afterEach(cleanup)

// rth's canonical 4,400 case, re-read for Token Tiers: 4000 mintable ids + a 400-id tier band
// RESERVED above them (4001–4400). The band must start above the supply, not inside it.
const BAND_4001 = { 'tierIdStarts.0': '4001', 'tierIdEnds.0': '4400' }

describe('TierSupplyHelper', () => {
  test('band above supply → shows the math + ✓', () => {
    render(<TierSupplyHelper nftCount={4000n} values={BAND_4001} />)
    const el = screen.getByTestId('tier-supply-helper')
    expect(el).toHaveAttribute('data-above', 'true')
    expect(el.textContent).toContain('NFT supply: 4000')
    expect(el.textContent).toContain('bands reserve 4001–4400 (400 ids)')
    expect(el.textContent).toContain('4000 mintable')
    expect(el.textContent).toContain('✓ above supply')
    expect(el.textContent).not.toContain('✗')
  })

  test('band 4001–4400 with supply 4400 → ✗ overlaps supply + fix nudge', () => {
    render(<TierSupplyHelper nftCount={4400n} values={BAND_4001} />)
    const el = screen.getByTestId('tier-supply-helper')
    expect(el).toHaveAttribute('data-above', 'false')
    expect(el.textContent).toContain('✗ overlaps supply')
    expect(el.textContent).toContain('collide')
    expect(el.textContent).toContain('Start the band above the NFT supply')
  })

  test('a band starting exactly AT the supply still overlaps (boundary is inclusive)', () => {
    render(
      <TierSupplyHelper
        nftCount={4000n}
        values={{ 'tierIdStarts.0': '4000', 'tierIdEnds.0': '4400' }}
      />,
    )
    expect(screen.getByTestId('tier-supply-helper')).toHaveAttribute('data-above', 'false')
  })

  test('supply not yet entered (0) → no verdict, no false ✗', () => {
    render(<TierSupplyHelper nftCount={0n} values={BAND_4001} />)
    const el = screen.getByTestId('tier-supply-helper')
    expect(el).toHaveAttribute('data-above', 'unknown')
    expect(el.textContent).toContain('NFT supply: —')
    expect(el.textContent).toContain('bands reserve 4001–4400 (400 ids)')
    expect(el.textContent).not.toContain('✓')
    expect(el.textContent).not.toContain('✗')
  })

  test('no band rows yet → no coverage, no verdict', () => {
    render(<TierSupplyHelper nftCount={4400n} values={{}} />)
    const el = screen.getByTestId('tier-supply-helper')
    expect(el.textContent).toContain('no tier bands yet')
    expect(el.textContent).not.toContain('✓')
    expect(el.textContent).not.toContain('✗')
  })
})
