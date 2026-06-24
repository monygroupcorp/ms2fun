import { describe, expect, it } from 'vitest'
import { deriveTxState } from './useTxAction'

const base = { signing: false, confirming: false, success: false, error: false }

describe('deriveTxState', () => {
  it('idle when nothing is happening', () => {
    expect(deriveTxState(base)).toBe('idle')
  })
  it('signing takes precedence (wallet prompt)', () => {
    expect(deriveTxState({ ...base, signing: true, confirming: true })).toBe('signing')
  })
  it('confirming while mining', () => {
    expect(deriveTxState({ ...base, confirming: true })).toBe('confirming')
  })
  it('success after the receipt lands', () => {
    expect(deriveTxState({ ...base, success: true })).toBe('success')
  })
  it('error when a write/wait failed', () => {
    expect(deriveTxState({ ...base, error: true })).toBe('error')
  })
  it('success beats error (a confirmed receipt is terminal-good)', () => {
    expect(deriveTxState({ ...base, success: true, error: true })).toBe('success')
  })
})
