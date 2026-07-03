import { describe, expect, it } from 'vitest'
import { parseUnits } from 'viem'
import { buyEthPresets, sellPctPresets } from './swapPresets'

describe('buyEthPresets', () => {
  it('are ETH-to-spend literals, label carries the unit', () => {
    expect(buyEthPresets()).toEqual([
      { label: '0.005 ETH', value: '0.005' },
      { label: '0.01 ETH', value: '0.01' },
      { label: '0.05 ETH', value: '0.05' },
      { label: '0.1 ETH', value: '0.1' },
    ])
  })
})

describe('sellPctPresets', () => {
  it('computes each % of the balance in display units', () => {
    const bal = parseUnits('80', 18) // 80 tokens
    const p = sellPctPresets(bal, 18)
    expect(p.map((x) => x.label)).toEqual(['25%', '50%', '75%', '100%'])
    expect(p.map((x) => x.value)).toEqual(['20', '40', '60', '80'])
  })

  it('100% uses the exact balance (no dust from rounding)', () => {
    const bal = 3n // 3 wei, indivisible by 4
    const p = sellPctPresets(bal, 18)
    // 100% must equal the full balance formatted, even though 25/50/75% floor toward zero.
    expect(p[3]).toEqual({ label: '100%', value: '0.000000000000000003' })
  })

  it('disables (undefined value) on a zero or missing balance', () => {
    for (const bal of [undefined, 0n]) {
      const p = sellPctPresets(bal, 18)
      expect(p.every((x) => x.value === undefined)).toBe(true)
      expect(p.map((x) => x.label)).toEqual(['25%', '50%', '75%', '100%'])
    }
  })
})
