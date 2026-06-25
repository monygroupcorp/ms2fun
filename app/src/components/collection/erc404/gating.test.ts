import { describe, expect, it } from 'vitest'
import { decodeAbiParameters, keccak256, stringToBytes, stringToHex } from 'viem'
import {
  CURVE_COMPUTER_TAG,
  EMPTY_BYTES,
  ZERO_BYTES32,
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
