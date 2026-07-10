import { describe, expect, it } from 'vitest'
import { decodeAbiParameters, keccak256, stringToBytes, stringToHex } from 'viem'
import {
  CURVE_COMPUTER_TAG,
  EMPTY_BYTES,
  ZERO_BYTES32,
  encodeBuyGatingData,
  encodeGatingData,
  encodeMessageData,
  resolveBuyPasswordHash,
} from './gating'

describe('resolveBuyPasswordHash', () => {
  it('empty/whitespace → zero sentinel (open tier)', () => {
    expect(resolveBuyPasswordHash('')).toBe(ZERO_BYTES32)
    expect(resolveBuyPasswordHash('   ')).toBe(ZERO_BYTES32)
  })
  it('matches keccak256(utf8(password)) (legacy parity)', () => {
    expect(resolveBuyPasswordHash('hunter2')).toBe(keccak256(stringToBytes('hunter2')))
  })
  it('trims surrounding whitespace before hashing', () => {
    expect(resolveBuyPasswordHash('  hunter2  ')).toBe(keccak256(stringToBytes('hunter2')))
  })
})

describe('encodeGatingData', () => {
  it('round-trips (bytes32 passwordHash, uint256 openTime)', () => {
    const hash = keccak256(stringToBytes('pw'))
    const encoded = encodeGatingData(hash, 1234n)
    const [decodedHash, decodedTime] = decodeAbiParameters(
      [
        { name: 'passwordHash', type: 'bytes32' },
        { name: 'openTime', type: 'uint256' },
      ],
      encoded,
    )
    expect(decodedHash).toBe(hash)
    expect(decodedTime).toBe(1234n)
  })
})

describe('encodeBuyGatingData', () => {
  it('round-trips through the merged canMint decoder (abi.decode(data,(bytes32)))', () => {
    const hash = keccak256(stringToBytes('pw'))
    const encoded = encodeBuyGatingData(hash)
    const [decodedHash] = decodeAbiParameters([{ name: 'passwordHash', type: 'bytes32' }], encoded)
    expect(decodedHash).toBe(hash)
  })
  it('is a single 32-byte word, byte-identical to the raw hash (abi.encode(bytes32))', () => {
    const hash = keccak256(stringToBytes('pw'))
    expect(encodeBuyGatingData(hash)).toBe(hash)
    expect(encodeBuyGatingData(hash).length).toBe(2 + 64)
  })
  it('open tier: encodes bytes32(0) for the zero-sentinel password', () => {
    expect(encodeBuyGatingData(ZERO_BYTES32)).toBe(ZERO_BYTES32)
  })
})

describe('encodeMessageData', () => {
  it('empty content → 0x (no post)', () => {
    expect(encodeMessageData('')).toBe(EMPTY_BYTES)
    expect(encodeMessageData('   ')).toBe(EMPTY_BYTES)
  })
  it('non-empty content decodes back to a POST tuple', () => {
    const encoded = encodeMessageData('gm')
    const [messageType, refId, , , content] = decodeAbiParameters(
      [
        { name: 'messageType', type: 'uint8' },
        { name: 'refId', type: 'uint256' },
        { name: 'actionRef', type: 'bytes32' },
        { name: 'metadata', type: 'bytes32' },
        { name: 'content', type: 'string' },
      ],
      encoded,
    )
    expect(messageType).toBe(0)
    expect(refId).toBe(0n)
    expect(content).toBe('gm')
  })
})

describe('CURVE_COMPUTER_TAG', () => {
  it('is the right-padded bytes32 of "curve_computer" (Solidity bytes32(string))', () => {
    // bytes32("curve_computer") = utf8 bytes left-aligned, zero-padded to 32 bytes.
    const utf8Hex = stringToHex('curve_computer').slice(2)
    expect(CURVE_COMPUTER_TAG).toBe(`0x${utf8Hex.padEnd(64, '0')}`)
  })
})
