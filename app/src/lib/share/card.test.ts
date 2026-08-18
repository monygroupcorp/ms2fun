import { describe, expect, it } from 'vitest'
import {
  REQUIRED_CARD_TAGS,
  distPathOf,
  extractMetaTags,
  findCardTagFaults,
  findOriginSplit,
  isAbsoluteUrl,
  originOf,
  readPngDimensions,
} from './card'

function html(tags: Record<string, string>): string {
  const metas = Object.entries(tags)
    .map(([key, content]) =>
      key.startsWith('twitter:')
        ? `<meta name="${key}" content="${content}" />`
        : `<meta property="${key}" content="${content}" />`,
    )
    .join('\n')
  return `<!doctype html><html><head>${metas}</head><body></body></html>`
}

const wholeCard: Record<string, string> = Object.fromEntries(
  REQUIRED_CARD_TAGS.map((tag) => {
    if (tag === 'og:image' || tag === 'twitter:image')
      return [tag, 'https://example.test/icon-512.png']
    if (tag === 'og:url') return [tag, 'https://example.test']
    if (tag === 'og:image:width' || tag === 'og:image:height') return [tag, '512']
    return [tag, 'value']
  }),
)

describe('extractMetaTags', () => {
  it('reads both property= and name= keyed tags', () => {
    const tags = extractMetaTags(html({ 'og:title': 'a', 'twitter:card': 'summary' }))
    expect(tags.get('og:title')).toBe('a')
    expect(tags.get('twitter:card')).toBe('summary')
  })

  it('is attribute-order agnostic, so a minifier reordering does not go red', () => {
    const tags = extractMetaTags('<meta content="summary" property="og:type">')
    expect(tags.get('og:type')).toBe('summary')
  })

  it('records a content-less tag as empty rather than dropping it', () => {
    expect(extractMetaTags('<meta property="og:url" />').get('og:url')).toBe('')
  })
})

describe('findCardTagFaults', () => {
  it('passes a whole card', () => {
    expect(findCardTagFaults(extractMetaTags(html(wholeCard)))).toEqual([])
  })

  it('names a missing tag rather than counting', () => {
    const rest = Object.fromEntries(Object.entries(wholeCard).filter(([tag]) => tag !== 'og:image'))
    expect(findCardTagFaults(extractMetaTags(html(rest)))).toEqual([
      { tag: 'og:image', reason: 'missing' },
    ])
  })

  it('fails an empty content — the %VITE_PUBLIC_ORIGIN% failure mode', () => {
    expect(findCardTagFaults(extractMetaTags(html({ ...wholeCard, 'og:url': '' })))).toEqual([
      { tag: 'og:url', reason: 'empty' },
    ])
  })

  it('fails whitespace-only content too', () => {
    expect(findCardTagFaults(extractMetaTags(html({ ...wholeCard, 'og:title': '   ' })))).toEqual([
      { tag: 'og:title', reason: 'empty' },
    ])
  })
})

describe('isAbsoluteUrl', () => {
  it.each([
    ['https://example.test/icon-512.png', true],
    ['http://example.test/icon-512.png', true],
    ['/icon-512.png', false],
    ['icon-512.png', false],
    ['//example.test/icon-512.png', false],
  ])('%s → %s', (value, expected) => {
    expect(isAbsoluteUrl(value)).toBe(expected)
  })
})

describe('findOriginSplit', () => {
  it('passes when all three share an origin', () => {
    expect(findOriginSplit(extractMetaTags(html(wholeCard)))).toBeNull()
  })

  it('catches a partial origin substitution — the noesis-230 failure mode', () => {
    const split = findOriginSplit(
      extractMetaTags(html({ ...wholeCard, 'og:image': 'https://other.test/icon-512.png' })),
    )
    expect(split).toEqual(['https://example.test', 'https://other.test', 'https://example.test'])
  })

  it('treats a relative url as a split rather than as agreement', () => {
    expect(
      findOriginSplit(extractMetaTags(html({ ...wholeCard, 'twitter:image': '/icon-512.png' }))),
    ).toContain('unparseable')
  })

  it('distinguishes a port and a scheme', () => {
    expect(
      findOriginSplit(
        extractMetaTags(html({ ...wholeCard, 'og:url': 'https://example.test:8443' })),
      ),
    ).not.toBeNull()
    expect(
      findOriginSplit(extractMetaTags(html({ ...wholeCard, 'og:url': 'http://example.test' }))),
    ).not.toBeNull()
  })
})

describe('originOf / distPathOf', () => {
  it('drops the leading slash so the path indexes emitted output', () => {
    expect(distPathOf('https://example.test/icon-512.png')).toBe('icon-512.png')
    expect(distPathOf('https://example.test/assets/a/b.png')).toBe('assets/a/b.png')
  })

  it('decodes a percent-escaped path', () => {
    expect(distPathOf('https://example.test/icon%20512.png')).toBe('icon 512.png')
  })

  it('ignores query and hash', () => {
    expect(distPathOf('https://example.test/icon-512.png?v=2#x')).toBe('icon-512.png')
  })

  it('returns null for an unparseable url', () => {
    expect(distPathOf('/icon-512.png')).toBeNull()
    expect(originOf('nonsense')).toBeNull()
  })
})

describe('readPngDimensions', () => {
  function pngHeader(width: number, height: number): Uint8Array {
    const bytes = new Uint8Array(24)
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
    const view = new DataView(bytes.buffer)
    view.setUint32(8, 13)
    bytes.set([0x49, 0x48, 0x44, 0x52], 12)
    view.setUint32(16, width)
    view.setUint32(20, height)
    return bytes
  }

  it('reads IHDR width and height', () => {
    expect(readPngDimensions(pngHeader(512, 512))).toEqual({ width: 512, height: 512 })
    expect(readPngDimensions(pngHeader(1024, 512))).toEqual({ width: 1024, height: 512 })
  })

  it('returns null for a non-PNG rather than a false red', () => {
    expect(readPngDimensions(new Uint8Array([0x3c, 0x73, 0x76, 0x67]))).toBeNull()
    expect(readPngDimensions(new Uint8Array(0))).toBeNull()
  })

  it('returns null when the first chunk is not IHDR', () => {
    const bytes = pngHeader(512, 512)
    bytes.set([0x49, 0x44, 0x41, 0x54], 12)
    expect(readPngDimensions(bytes)).toBeNull()
  })
})
