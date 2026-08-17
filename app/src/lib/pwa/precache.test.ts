import { describe, expect, it } from 'vitest'
import {
  findUncoveredFiles,
  findUnexpectedEntries,
  matchesGlob,
  parsePrecacheManifest,
  WORKBOX_MAX_FILE_BYTES,
} from './precache'

const PATTERNS = ['**/*.{js,css,html,woff2,wasm,svg,png}']

describe('matchesGlob', () => {
  const pattern = '**/*.{js,css,html,woff2,wasm,svg,png}'

  it('matches at the output root and at any depth', () => {
    expect(matchesGlob('index.html', pattern)).toBe(true)
    expect(matchesGlob('assets/index-BD4RGV1U.js', pattern)).toBe(true)
    expect(matchesGlob('fonts/syne/syne-700.woff2', pattern)).toBe(true)
  })

  it('does not match an extension outside the alternation', () => {
    expect(matchesGlob('_redirects', pattern)).toBe(false)
    expect(matchesGlob('assets/thing.jpg', pattern)).toBe(false)
    expect(matchesGlob('sw.js.map', pattern)).toBe(false)
  })

  it('keeps * inside a single path segment', () => {
    expect(matchesGlob('a/b.png', '*.png')).toBe(false)
    expect(matchesGlob('b.png', '*.png')).toBe(true)
  })

  it('matches an exact-path ignore entry', () => {
    expect(matchesGlob('exec-executives.png', 'exec-executives.png')).toBe(true)
    expect(matchesGlob('assets/exec-executives.png', 'exec-executives.png')).toBe(false)
  })
})

describe('findUncoveredFiles', () => {
  const built = [
    { path: 'index.html', bytes: 3_000 },
    { path: 'assets/index-abc.js', bytes: 262_451 },
    { path: 'exec-executives.png', bytes: 2_064_936 },
    { path: '_redirects', bytes: 19 },
  ]

  it('passes when every glob-matched file is in the manifest', () => {
    const manifest = ['index.html', 'assets/index-abc.js', 'exec-executives.png']
    expect(findUncoveredFiles(built, manifest, { patterns: PATTERNS })).toEqual([])
  })

  it('ignores files the glob patterns never matched', () => {
    // `_redirects` is absent from the manifest and must not be reported.
    const manifest = ['index.html', 'assets/index-abc.js', 'exec-executives.png']
    expect(
      findUncoveredFiles(built, manifest, { patterns: PATTERNS }).map((f) => f.path),
    ).not.toContain('_redirects')
  })

  it('reports a file dropped for exceeding the workbox size cap, and names that reason', () => {
    const grown = built.map((f) =>
      f.path === 'exec-executives.png' ? { ...f, bytes: WORKBOX_MAX_FILE_BYTES + 1 } : f,
    )
    const manifest = ['index.html', 'assets/index-abc.js'] // workbox silently dropped the PNG
    expect(findUncoveredFiles(grown, manifest, { patterns: PATTERNS })).toEqual([
      {
        path: 'exec-executives.png',
        bytes: WORKBOX_MAX_FILE_BYTES + 1,
        reason: 'over-workbox-size-cap',
      },
    ])
  })

  it('reports a file missing for any other reason without guessing at the cause', () => {
    const manifest = ['index.html', 'exec-executives.png']
    expect(findUncoveredFiles(built, manifest, { patterns: PATTERNS })).toEqual([
      { path: 'assets/index-abc.js', bytes: 262_451, reason: 'missing-from-manifest' },
    ])
  })

  it('exempts a file the ignore list deliberately excludes', () => {
    const manifest = ['index.html', 'assets/index-abc.js']
    expect(
      findUncoveredFiles(built, manifest, { patterns: PATTERNS, ignores: ['exec-executives.png'] }),
    ).toEqual([])
  })

  it("does not report workbox's own emitted runtime, which never precaches itself", () => {
    const withSw = [
      ...built,
      { path: 'sw.js', bytes: 12_000 },
      { path: 'workbox-9c191d2f.js', bytes: 20_000 },
    ]
    const manifest = ['index.html', 'assets/index-abc.js', 'exec-executives.png']
    expect(findUncoveredFiles(withSw, manifest, { patterns: PATTERNS })).toEqual([])
  })

  it('tolerates the leading slash workbox writes on some entries', () => {
    const manifest = ['/index.html', '/assets/index-abc.js', '/exec-executives.png']
    expect(findUncoveredFiles(built, manifest, { patterns: PATTERNS })).toEqual([])
  })
})

describe('findUnexpectedEntries', () => {
  it('flags an entry the ignore list says must not be precached', () => {
    expect(
      findUnexpectedEntries(['index.html', 'exec-executives.png'], {
        ignores: ['exec-executives.png'],
      }),
    ).toEqual(['exec-executives.png'])
  })

  it('is silent when the ignore list is empty', () => {
    expect(findUnexpectedEntries(['index.html', 'exec-executives.png'])).toEqual([])
  })

  it('does not flag workbox-injected entries passed as allowed extras', () => {
    expect(
      findUnexpectedEntries(['registerSW.js'], {
        ignores: ['registerSW.js'],
        allowExtra: ['registerSW.js'],
      }),
    ).toEqual([])
  })
})

describe('parsePrecacheManifest', () => {
  it('reads the urls out of an emitted sw.js', () => {
    const sw =
      'precacheAndRoute([{url:"index.html",revision:"a"},{url:"assets/x.js",revision:null}])'
    expect(parsePrecacheManifest(sw)).toEqual(['index.html', 'assets/x.js'])
  })

  it('returns an empty list when the source carries no manifest', () => {
    expect(parsePrecacheManifest('self.addEventListener("install", () => {})')).toEqual([])
  })
})
