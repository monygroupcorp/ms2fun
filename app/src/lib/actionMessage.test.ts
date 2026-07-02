import { describe, expect, it } from 'vitest'
import { decodeAbiParameters } from 'viem'
import { encodeActionMessage } from './actionMessage'
import { ZERO_BYTES32 } from '../components/collection/erc404/gating'

const TUPLE = [
  { name: 'messageType', type: 'uint8' },
  { name: 'refId', type: 'uint256' },
  { name: 'actionRef', type: 'bytes32' },
  { name: 'metadata', type: 'bytes32' },
  { name: 'content', type: 'string' },
] as const

describe('encodeActionMessage', () => {
  it('round-trips to a POST (type 0) with the content and zeroed refs', () => {
    const encoded = encodeActionMessage('gm, aped in')
    const [messageType, refId, actionRef, metadata, content] = decodeAbiParameters(TUPLE, encoded)
    expect(messageType).toBe(0)
    expect(refId).toBe(0n)
    expect(actionRef).toBe(ZERO_BYTES32)
    expect(metadata).toBe(ZERO_BYTES32)
    expect(content).toBe('gm, aped in')
  })

  it('preserves unicode + emoji content', () => {
    const msg = 'aligned 🔥 — 日本語'
    const [, , , , content] = decodeAbiParameters(TUPLE, encodeActionMessage(msg))
    expect(content).toBe(msg)
  })

  it('encodes empty content without throwing (caller gates on non-empty)', () => {
    const [, , , , content] = decodeAbiParameters(TUPLE, encodeActionMessage(''))
    expect(content).toBe('')
  })
})
