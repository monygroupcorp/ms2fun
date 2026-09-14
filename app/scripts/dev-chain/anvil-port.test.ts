import { describe, expect, it } from 'vitest'
import { DEFAULT_ANVIL_PORT, resolveAnvilPort } from './anvil-port'

describe('resolveAnvilPort', () => {
  it('defaults to 8545 when ANVIL_PORT is unset', () => {
    expect(resolveAnvilPort(undefined)).toBe(8545)
    expect(DEFAULT_ANVIL_PORT).toBe(8545)
  })

  it('treats an empty value as unset, so an exported-but-blank var is not an error', () => {
    expect(resolveAnvilPort('')).toBe(8545)
  })

  it('takes the overridden port', () => {
    expect(resolveAnvilPort('8546')).toBe(8546)
    expect(resolveAnvilPort('1')).toBe(1)
    expect(resolveAnvilPort('65535')).toBe(65535)
  })

  // A bad value must fail here rather than downstream: handed on, it reaches viem as an unreachable
  // URL and reports a connection failure that says nothing about the typo behind it.
  it.each(['abc', '85 45', '8546x', '-1', '85.45', ' 8546'])('rejects %o', (raw) => {
    expect(() => resolveAnvilPort(raw)).toThrow(/ANVIL_PORT must be a port number/)
  })

  it.each(['0', '65536', '99999'])('rejects %o as out of range', (raw) => {
    expect(() => resolveAnvilPort(raw)).toThrow(/between 1 and 65535/)
  })
})
