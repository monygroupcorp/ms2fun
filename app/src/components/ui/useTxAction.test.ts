import { describe, expect, it } from 'vitest'
import { deriveTxState, txErrorReason } from './useTxAction'

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

describe('txErrorReason', () => {
  it('returns undefined for no error', () => {
    expect(txErrorReason(null)).toBeUndefined()
    expect(txErrorReason(undefined)).toBeUndefined()
  })
  it('appends the decoded custom error from metaMessages to the base shortMessage', () => {
    // Shape of a viem ContractFunctionExecutionError on a custom-error revert.
    const err = {
      shortMessage: 'The contract function "mint" reverted.',
      metaMessages: ['Error: EditionNotFound()', 'Contract Call:', '  address: 0x…'],
    }
    expect(txErrorReason(err)).toBe('The contract function "mint" reverted. (EditionNotFound())')
  })
  it('falls back to shortMessage / details / message in order', () => {
    expect(txErrorReason({ shortMessage: 'Chain mismatch: expected 1337' })).toBe(
      'Chain mismatch: expected 1337',
    )
    expect(txErrorReason({ message: 'User rejected the request.' })).toBe('User rejected the request.')
  })
})
