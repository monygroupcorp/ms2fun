import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { TierSupplyHelper } from './TierSupplyHelper'

afterEach(cleanup)

// rth's canonical 4,400 case: 4000 base + a 400-id tier (4001–4400).
const TIER_4400 = { 'tierIdStarts.0': '4001', 'tierIdEnds.0': '4400' }

describe('TierSupplyHelper', () => {
  test('4,400 case within supply → shows the math + ✓', () => {
    render(<TierSupplyHelper nftCount={4400n} values={TIER_4400} />)
    const el = screen.getByTestId('tier-supply-helper')
    expect(el).toHaveAttribute('data-within', 'true')
    expect(el.textContent).toContain('NFT supply: 4400')
    expect(el.textContent).toContain('tiers cover 4001–4400 (400 ids)')
    expect(el.textContent).toContain('4000 untiered')
    expect(el.textContent).toContain('✓ within supply')
    expect(el.textContent).not.toContain('✗')
  })

  test('tier 4001–4400 with supply 4000 → ✗ exceeds supply + fix nudge', () => {
    render(<TierSupplyHelper nftCount={4000n} values={TIER_4400} />)
    const el = screen.getByTestId('tier-supply-helper')
    expect(el).toHaveAttribute('data-within', 'false')
    expect(el.textContent).toContain('✗ exceeds supply')
    expect(el.textContent).toContain('never mint')
  })

  test('supply not yet entered (0) → no verdict, no false ✗', () => {
    render(<TierSupplyHelper nftCount={0n} values={TIER_4400} />)
    const el = screen.getByTestId('tier-supply-helper')
    expect(el).toHaveAttribute('data-within', 'unknown')
    expect(el.textContent).toContain('NFT supply: —')
    expect(el.textContent).toContain('tiers cover 4001–4400 (400 ids)')
    expect(el.textContent).not.toContain('✓')
    expect(el.textContent).not.toContain('✗')
  })

  test('no tier rows yet → no coverage, no verdict', () => {
    render(<TierSupplyHelper nftCount={4400n} values={{}} />)
    const el = screen.getByTestId('tier-supply-helper')
    expect(el.textContent).toContain('no tier ranges yet')
    expect(el.textContent).not.toContain('✓')
    expect(el.textContent).not.toContain('✗')
  })
})
