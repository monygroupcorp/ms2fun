import { describe, expect, it } from 'vitest'
import { decodeAbiParameters, keccak256, toHex } from 'viem'
import {
  encodeMintMessage,
  encodePasswordGatingData,
  GatingScope,
  hasGatingModule,
  isFreeMintGated,
  isPaidMintGated,
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

describe('encodePasswordGatingData', () => {
  // The merged PasswordTierGatingModule.canMint decodes exactly this out of `data` (#25):
  //   abi.decode(data, (bytes32 passwordHash))   — openTime is now a separate canMint param.
  const decoderShape = [{ name: 'passwordHash', type: 'bytes32' }] as const

  it('round-trips through the merged canMint decoder (abi.decode(data,(bytes32)))', () => {
    const encoded = encodePasswordGatingData('hunter2')
    const [hash] = decodeAbiParameters(decoderShape, encoded)
    expect(hash).toBe(passwordToBytes32('hunter2'))
    expect(hash).toBe(keccak256(toHex('hunter2')))
  })

  it('empty password → abi.encode(bytes32(0)) → module reads the open tier (0)', () => {
    const [hash] = decodeAbiParameters(decoderShape, encodePasswordGatingData(''))
    expect(hash).toBe(ZERO_BYTES32)
  })

  it('encodes to a single 32-byte word (the merged decoder reads one bytes32)', () => {
    // abi.encode(bytes32) is 32 bytes = 64 hex chars + '0x'. Byte-identical to the raw hash, which is
    // what the module receives as `data` and abi.decode((bytes32))s back.
    expect(encodePasswordGatingData('x').length).toBe(2 + 64)
    expect(encodePasswordGatingData('x')).toBe(passwordToBytes32('x'))
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
