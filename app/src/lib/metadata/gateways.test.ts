import { describe, expect, it } from 'vitest'
import { gatewayUrl, IPFS_GATEWAYS, isSubdomainSafeCid } from './gateways'

/**
 * That this module imports NOTHING is enforced by eslint (`eslint.config.js`, the
 * `src/lib/metadata/gateways.ts` override) rather than asserted here: a lint rule reads the real
 * import graph, where a test would only read the file as text. The split exists so the art
 * delivery service, which runs in a worker with no browser globals, can share this roster instead
 * of keeping a second copy of it to drift.
 */

describe('roster', () => {
  it('spans more than one operator, so one outage is not every outage', () => {
    expect(new Set(IPFS_GATEWAYS.map((g) => g.operator)).size).toBeGreaterThan(1)
  })

  it('builds a path-form URL by appending the CID', () => {
    const path = IPFS_GATEWAYS.find((g) => g.form === 'path')!
    expect(gatewayUrl(path, 'bafyfoo/1')).toBe(`${path.base}bafyfoo/1`)
  })

  it('refuses a CIDv0 on a subdomain gateway rather than emitting a URL that 400s', () => {
    const sub = IPFS_GATEWAYS.find((g) => g.form === 'subdomain')
    if (!sub) return
    expect(isSubdomainSafeCid('QmFoo')).toBe(false)
    expect(gatewayUrl(sub, 'QmFoo/1')).toBeNull()
  })
})
