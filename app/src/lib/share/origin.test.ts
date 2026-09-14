import { describe, expect, it } from 'vitest'
import { findOriginSplit, extractMetaTags } from './card'
import {
  DEFAULT_PUBLIC_ORIGIN,
  PUBLIC_ORIGIN_PLACEHOLDER,
  injectPublicOrigin,
  resolvePublicOrigin,
} from './origin'

describe('resolvePublicOrigin', () => {
  it('falls back to the default when nothing is configured', () => {
    expect(resolvePublicOrigin(undefined)).toBe(DEFAULT_PUBLIC_ORIGIN)
    expect(resolvePublicOrigin('')).toBe(DEFAULT_PUBLIC_ORIGIN)
    expect(resolvePublicOrigin('   ')).toBe(DEFAULT_PUBLIC_ORIGIN)
  })

  it('defaults to a host this repository publishes to', () => {
    // `CNAME` at the repository root names this host. A card cannot default to a host nobody
    // chose, which is how `noesis.gwei.domains` came to be carded for a build that never served it.
    expect(DEFAULT_PUBLIC_ORIGIN).toBe('https://ms2.fun')
  })

  it('takes a configured origin over the default', () => {
    expect(resolvePublicOrigin('https://preview.example')).toBe('https://preview.example')
  })

  it('normalises a trailing slash, so one config value cannot make two sets of tags', () => {
    expect(resolvePublicOrigin('https://ms2.fun/')).toBe(resolvePublicOrigin('https://ms2.fun'))
  })

  it('keeps an explicit port', () => {
    expect(resolvePublicOrigin('http://localhost:4173')).toBe('http://localhost:4173')
  })

  it('refuses a value that is not a url', () => {
    expect(() => resolvePublicOrigin('ms2.fun')).toThrow(/not a url/)
  })

  it('refuses a non-http scheme — a scraper fetches over http(s) and nothing else', () => {
    expect(() => resolvePublicOrigin('ipfs://bafy')).toThrow(/must be http/)
  })

  it('refuses a path, query or fragment rather than silently dropping it', () => {
    expect(() => resolvePublicOrigin('https://ms2.fun/app')).toThrow(/bare origin/)
    expect(() => resolvePublicOrigin('https://ms2.fun?x=1')).toThrow(/bare origin/)
    expect(() => resolvePublicOrigin('https://ms2.fun#top')).toThrow(/bare origin/)
  })
})

describe('injectPublicOrigin', () => {
  const markup = [
    `<meta property="og:url" content="${PUBLIC_ORIGIN_PLACEHOLDER}" />`,
    `<meta property="og:image" content="${PUBLIC_ORIGIN_PLACEHOLDER}/icon-512.png" />`,
    `<meta name="twitter:image" content="${PUBLIC_ORIGIN_PLACEHOLDER}/icon-512.png" />`,
  ].join('\n')

  it('substitutes every site from one value', () => {
    const out = injectPublicOrigin(markup, 'https://example.test')
    expect(out).not.toContain(PUBLIC_ORIGIN_PLACEHOLDER)
    expect(findOriginSplit(extractMetaTags(out))).toBeNull()
  })

  it('leaves no origin split to find, whatever origin is configured', () => {
    for (const origin of ['https://ms2.fun', 'http://localhost:4173', 'https://preview.example']) {
      const tags = extractMetaTags(injectPublicOrigin(markup, origin))
      expect(findOriginSplit(tags)).toBeNull()
      expect(tags.get('og:url')).toBe(origin)
    }
  })

  it('refuses markup that carries no placeholder — an origin typed back into the file', () => {
    expect(() =>
      injectPublicOrigin('<meta property="og:url" content="https://noesis.gwei.domains" />', 'x'),
    ).toThrow(/carries no/)
  })
})
