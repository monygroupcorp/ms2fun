/**
 * The ~ETH column is gas × a price. Gas is measured; the price is only measured when the chain
 * answers a fee call. These pin the difference to the pixels: a figure priced from the REF_GWEI
 * fallback must never be rendered while a live fee is in hand, and must never be described as live
 * when it is the fallback that priced it.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { DeployGasBreakdown } from './DeployGasBreakdown'
import type { GasPriceGwei } from './useGasPriceGwei'
import { REF_GWEI, humanEth } from '../../lib/wizard/embedGas'
import type { EmbedBreakdown } from '../../lib/wizard/deployGasBreakdown'

afterEach(cleanup)

const BREAKDOWN: EmbedBreakdown = {
  lines: [
    { key: 'cover', label: 'Cover image', bytes: 4096, gas: 2_900_000, embedded: true },
    { key: 'banner', label: 'Banner image', bytes: 0, gas: 0, embedded: false },
    { key: 'text', label: 'Text', bytes: 512, gas: 362_000, embedded: true },
  ],
  totalBytes: 4608,
  totalGas: 3_262_000,
}
const LIVE_GAS = 5_000_000n

const LIVE: GasPriceGwei = { gwei: 2.4, isLive: true, isLoading: false }
const FALLBACK: GasPriceGwei = { gwei: REF_GWEI, isLive: false, isLoading: false }

const cardText = () => screen.getByTestId('deploy-gas-breakdown').textContent ?? ''

describe('the ETH column is priced from the fee it was actually given', () => {
  test('a live fee prices every rendered figure, and no figure is the REF_GWEI one', () => {
    render(
      <DeployGasBreakdown
        breakdown={BREAKDOWN}
        liveGas={LIVE_GAS}
        liveLoading={false}
        gasPrice={LIVE}
      />,
    )
    const text = cardText()
    // Every row, the derived remainder, and the total: priced at 2.4 gwei, not at 15.
    for (const gas of [2_900_000, 362_000, Number(LIVE_GAS) - BREAKDOWN.totalGas, 5_000_000]) {
      expect(text).toContain(humanEth(gas, LIVE.gwei))
      expect(text).not.toContain(humanEth(gas, REF_GWEI))
    }
    expect(text).toContain('2.4 gwei')
    expect(text).not.toContain(`${REF_GWEI} gwei`)
  })

  test('with a live fee the note says the price was read, and never calls it a reference', () => {
    render(
      <DeployGasBreakdown
        breakdown={BREAKDOWN}
        liveGas={LIVE_GAS}
        liveLoading={false}
        gasPrice={LIVE}
      />,
    )
    expect(cardText()).toMatch(/network fee right now/i)
    expect(cardText()).not.toMatch(/reference/i)
  })
})

describe('the fallback price is rendered as a fallback', () => {
  test('no live fee: the figures are REF_GWEI-priced AND the card says so', () => {
    render(
      <DeployGasBreakdown
        breakdown={BREAKDOWN}
        liveGas={LIVE_GAS}
        liveLoading={false}
        gasPrice={FALLBACK}
      />,
    )
    const text = cardText()
    expect(text).toContain(humanEth(2_900_000, REF_GWEI))
    // The header chip marks the column, and the note says the fee could not be read.
    expect(text).toContain(`${REF_GWEI} gwei ref.`)
    expect(text).toMatch(/no network fee could be read/i)
    expect(text).toMatch(/not a live quote/i)
  })

  test('a fallback price is never described as a live estimate of cost', () => {
    render(
      <DeployGasBreakdown
        breakdown={BREAKDOWN}
        liveGas={LIVE_GAS}
        liveLoading={false}
        gasPrice={FALLBACK}
      />,
    )
    // The old string — "Live estimate for your exact deploy" — priced a constant and called the
    // whole figure live. Measured gas may be called measured; the ETH beside it may not.
    expect(cardText()).not.toMatch(/live estimate/i)
  })

  test('while the fee is still being read, no price is asserted at all', () => {
    render(
      <DeployGasBreakdown
        breakdown={BREAKDOWN}
        liveGas={LIVE_GAS}
        liveLoading={false}
        gasPrice={{ gwei: REF_GWEI, isLive: false, isLoading: true }}
      />,
    )
    expect(cardText()).toContain('reading fee')
    expect(cardText()).not.toMatch(/network fee right now/i)
  })
})

describe('the gas half of the sentence stays independent of the price half', () => {
  test('no wallet estimate: gas is qualified, and the live price still prices the embeddings', () => {
    render(
      <DeployGasBreakdown
        breakdown={BREAKDOWN}
        liveGas={undefined}
        liveLoading={false}
        gasPrice={LIVE}
      />,
    )
    const text = cardText()
    expect(text).toMatch(/full deploy total needs a connected wallet/i)
    expect(text).toMatch(/network fee right now/i)
    expect(text).toContain(humanEth(2_900_000, LIVE.gwei))
  })
})

describe('the fee is read off the chain the build talks to', () => {
  test('useGasPriceGwei asks that chain for a price, and converts wei to gwei', async () => {
    const useGasPrice = vi.fn(() => ({ data: 2_400_000_000n, isLoading: false }))
    vi.doMock('wagmi', () => ({ useGasPrice }))
    vi.resetModules()

    const { forkChainId } = await import('../../lib/addresses')
    const { useGasPriceGwei } = await import('./useGasPriceGwei')

    expect(useGasPriceGwei()).toEqual({ gwei: 2.4, isLive: true, isLoading: false })
    expect(useGasPrice).toHaveBeenCalledWith(expect.objectContaining({ chainId: forkChainId }))

    vi.doUnmock('wagmi')
    vi.resetModules()
  })

  test('a chain that cannot be asked yields the REF_GWEI fallback, flagged as not live', async () => {
    vi.doMock('wagmi', () => ({ useGasPrice: () => ({ data: undefined, isLoading: false }) }))
    vi.resetModules()

    const { useGasPriceGwei } = await import('./useGasPriceGwei')
    expect(useGasPriceGwei()).toEqual({ gwei: REF_GWEI, isLive: false, isLoading: false })

    vi.doUnmock('wagmi')
    vi.resetModules()
  })
})
