import { describe, expect, it } from 'vitest'
import { logWindowForChain } from './logWindow'

describe('logWindowForChain', () => {
  it('keeps mainnet windows inside the 10,000-block cap of its public endpoints', () => {
    expect(logWindowForChain(1)).toBe(10_000n)
  })

  it('keeps the wider window on Sepolia', () => {
    expect(logWindowForChain(11155111)).toBe(50_000n)
  })
})
