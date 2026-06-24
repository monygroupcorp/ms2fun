import { describe, expect, it } from 'vitest'
import { keccak256, toHex } from 'viem'
import {
  encodeMintMessage,
  GatingScope,
  hasGatingModule,
  isFreeMintGated,
  isPaidMintGated,
  passwordToBytes,
  passwordToBytes32,
  resolveMerkleGatingData,
  ZERO_BYTES32,
} from './gatingMint'

const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as const
const MODULE = '0x1111111111111111111111111111111111111111' as const

describe('hasGatingModule', () => {
  it('false for undefined/zero', () => {
    expect(hasGatingModule(undefined)).toBe(false)
    expect(hasGatingModule(ZERO_ADDR)).toBe(false)
  })
  it('true for a real address', () => {
    expect(hasGatingModule(MODULE)).toBe(true)
  })
})

describe('isPaidMintGated', () => {
  it('false without a module', () => {
    expect(isPaidMintGated(ZERO_ADDR, GatingScope.BOTH)).toBe(false)
  })
  it('false when scope is FREE_MINT_ONLY (paid is open)', () => {
    expect(isPaidMintGated(MODULE, GatingScope.FREE_MINT_ONLY)).toBe(false)
  })
  it('true for BOTH and PAID_ONLY', () => {
    expect(isPaidMintGated(MODULE, GatingScope.BOTH)).toBe(true)
    expect(isPaidMintGated(MODULE, GatingScope.PAID_ONLY)).toBe(true)
  })
})

describe('isFreeMintGated', () => {
  it('false without a module', () => {
    expect(isFreeMintGated(ZERO_ADDR, GatingScope.BOTH)).toBe(false)
  })
  it('false when scope is PAID_ONLY (free mints are open FCFS)', () => {
    expect(isFreeMintGated(MODULE, GatingScope.PAID_ONLY)).toBe(false)
  })
  it('true for BOTH and FREE_MINT_ONLY', () => {
    expect(isFreeMintGated(MODULE, GatingScope.BOTH)).toBe(true)
    expect(isFreeMintGated(MODULE, GatingScope.FREE_MINT_ONLY)).toBe(true)
  })
})

describe('passwordToBytes32', () => {
  it('empty → zero bytes32', () => {
    expect(passwordToBytes32('')).toBe(ZERO_BYTES32)
    expect(passwordToBytes32('   ')).toBe(ZERO_BYTES32)
  })
  it('hashes the trimmed plaintext with keccak256', () => {
    expect(passwordToBytes32(' open-sesame ')).toBe(keccak256(toHex('open-sesame')))
  })
})

describe('passwordToBytes', () => {
  it('empty → 0x', () => {
    expect(passwordToBytes('')).toBe('0x')
  })
  it('same hash as the bytes32 form', () => {
    expect(passwordToBytes('hunter2')).toBe(passwordToBytes32('hunter2'))
  })
})

describe('encodeMintMessage', () => {
  it('empty → 0x', () => {
    expect(encodeMintMessage('')).toBe('0x')
    expect(encodeMintMessage('  ')).toBe('0x')
  })
  it('encodes a non-empty message as a 5-field ABI tuple', () => {
    const encoded = encodeMintMessage('gm')
    expect(encoded.startsWith('0x')).toBe(true)
    // Deterministic + stable: re-encoding yields the same bytes.
    expect(encodeMintMessage('gm')).toBe(encoded)
    // Distinct messages encode differently.
    expect(encodeMintMessage('gn')).not.toBe(encoded)
  })
})

describe('resolveMerkleGatingData (seam)', () => {
  it('returns the zero credential for now', () => {
    expect(resolveMerkleGatingData()).toBe(ZERO_BYTES32)
  })
})
