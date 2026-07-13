import { describe, expect, it } from 'vitest'
import { embedBreakdown } from './deployGasBreakdown'
import { estimateEmbedGas } from './embedGas'
import type { CollectionMetadata } from '../metadata/schemas'

const base: CollectionMetadata = {
  schemaVersion: 1,
  name: 'Test',
  description: 'A collection',
  image: '',
  banner: '',
  category: '',
  links: [],
}

const line = (b: ReturnType<typeof embedBreakdown>, key: 'cover' | 'banner' | 'text') =>
  b.lines.find((l) => l.key === key)!

describe('embedBreakdown', () => {
  it('reports zero-byte image lines when nothing is embedded', () => {
    const b = embedBreakdown(base)
    expect(line(b, 'cover').bytes).toBe(0)
    expect(line(b, 'banner').bytes).toBe(0)
    expect(line(b, 'cover').gas).toBe(0)
    // Text still costs — name/description/JSON scaffolding are on-chain.
    expect(line(b, 'text').bytes).toBeGreaterThan(0)
  })

  it('charges a hosted pointer (ipfs) as a few bytes, flagged as a link not embedded', () => {
    const b = embedBreakdown({ ...base, image: 'ipfs://QmHash' })
    const cover = line(b, 'cover')
    expect(cover.bytes).toBeGreaterThan(0)
    expect(cover.bytes).toBeLessThan(100)
    expect(cover.embedded).toBe(false)
  })

  it('charges an embedded data URI as its full marginal size, flagged embedded', () => {
    const dataUri = `data:image/webp;base64,${'A'.repeat(4000)}`
    const b = embedBreakdown({ ...base, image: dataUri })
    const cover = line(b, 'cover')
    expect(cover.bytes).toBeGreaterThan(3000)
    expect(cover.embedded).toBe(true)
    expect(cover.gas).toBe(estimateEmbedGas(cover.bytes))
  })

  it('lines sum to the total gas', () => {
    const b = embedBreakdown({
      ...base,
      image: `data:image/webp;base64,${'A'.repeat(2000)}`,
      banner: 'https://example.com/b.png',
    })
    const sum = b.lines.reduce((s, l) => s + l.gas, 0)
    expect(sum).toBe(b.totalGas)
  })

  it('cover + banner + text bytes account for the whole blob', () => {
    const b = embedBreakdown({
      ...base,
      image: `data:image/webp;base64,${'A'.repeat(1000)}`,
    })
    const bytesSum = b.lines.reduce((s, l) => s + l.bytes, 0)
    expect(bytesSum).toBe(b.totalBytes)
  })
})
