import { describe, expect, it } from 'vitest'
import { parseAmount } from './parseAmount'

describe('parseAmount', () => {
  it('parses a whole number to wei (18 decimals default)', () => {
    expect(parseAmount('1')).toBe(1_000000000000000000n)
  })
  it('parses a decimal', () => {
    expect(parseAmount('0.5')).toBe(500000000000000000n)
  })
  it('honors a custom decimals', () => {
    expect(parseAmount('1', 6)).toBe(1_000000n)
  })
  it('empty → undefined', () => {
    expect(parseAmount('')).toBeUndefined()
    expect(parseAmount('   ')).toBeUndefined()
  })
  it('non-numeric → undefined', () => {
    expect(parseAmount('abc')).toBeUndefined()
    expect(parseAmount('1.2.3')).toBeUndefined()
    expect(parseAmount('.')).toBeUndefined()
  })
  it('negative → undefined (regex rejects the sign)', () => {
    expect(parseAmount('-1')).toBeUndefined()
  })
  it('bare decimal forms parse', () => {
    expect(parseAmount('.5')).toBe(500000000000000000n)
    expect(parseAmount('5.')).toBe(5_000000000000000000n)
  })
})
