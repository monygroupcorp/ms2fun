import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertPublishable } from './assert-publishable'

const here = dirname(fileURLToPath(import.meta.url))
const committedConfig = JSON.parse(
  readFileSync(resolve(here, '../src/config/local-deployment.json'), 'utf-8'),
)

function realFixture(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: '2026-08-18T12:00:00.000Z',
    chainId: 8453,
    deployer: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb9226',
    contracts: {
      MasterRegistryV1: '0x1111111111111111111111111111111111111111',
      AlignmentRegistryV1: '0x2222222222222222222222222222222222222222',
    },
    ...overrides,
  }
}

describe('assertPublishable', () => {
  it('refuses the committed placeholder with all three reason classes', () => {
    const reasons = assertPublishable(committedConfig)
    expect(reasons.some((r) => r.includes('1337'))).toBe(true)
    expect(reasons.some((r) => r.includes('zero address'))).toBe(true)
    expect(reasons.some((r) => r.includes('epoch sentinel'))).toBe(true)
  })

  it('accepts a synthetic artifact with a real chain id, non-zero addresses and a real timestamp', () => {
    expect(assertPublishable(realFixture())).toEqual([])
  })

  it('refuses on chainId alone (1337, otherwise real)', () => {
    const reasons = assertPublishable(realFixture({ chainId: 1337 }))
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toContain('1337')
  })

  it('refuses on a zero address alone (otherwise real)', () => {
    const reasons = assertPublishable(
      realFixture({
        contracts: {
          MasterRegistryV1: '0x1111111111111111111111111111111111111111',
          AlignmentRegistryV1: '0x0000000000000000000000000000000000000000',
        },
      }),
    )
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toContain('AlignmentRegistryV1')
  })

  it('refuses on the epoch sentinel alone (otherwise real)', () => {
    const reasons = assertPublishable(realFixture({ generatedAt: '1970-01-01T00:00:00.000Z' }))
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toContain('epoch sentinel')
  })

  it('honours an explicit allowChainIds list', () => {
    expect(assertPublishable(realFixture({ chainId: 84532 }), { allowChainIds: [84532] })).toEqual(
      [],
    )
    expect(assertPublishable(realFixture({ chainId: 1337 }), { allowChainIds: [1337] })).toEqual([])
  })
})
