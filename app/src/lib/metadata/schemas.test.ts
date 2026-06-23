import { describe, expect, it } from 'vitest'
import { parseCollection, parseProfile } from './schemas'

// ── parseProfile ──────────────────────────────────────────────────────────────

describe('parseProfile', () => {
  describe('safe defaults', () => {
    it('returns safe defaults for undefined input', () => {
      const result = parseProfile(undefined)
      expect(result.schemaVersion).toBe(1)
      expect(result.name).toBe('')
      expect(result.handle).toBe('')
      expect(result.bio).toBe('')
      expect(result.avatar).toBe('')
      expect(result.banner).toBe('')
      expect(result.links).toEqual([])
      expect(result.socials).toEqual({})
    })

    it('returns safe defaults for null input', () => {
      const result = parseProfile(null)
      expect(result.schemaVersion).toBe(1)
      expect(result.name).toBe('')
      expect(result.links).toEqual([])
    })

    it('returns safe defaults for empty object', () => {
      const result = parseProfile({})
      expect(result.schemaVersion).toBe(1)
      expect(result.name).toBe('')
    })

    it('never throws on any input', () => {
      expect(() => parseProfile(42)).not.toThrow()
      expect(() => parseProfile('string')).not.toThrow()
      expect(() => parseProfile([])).not.toThrow()
      expect(() => parseProfile({ name: 123, links: 'bad' })).not.toThrow()
    })
  })

  describe('well-formed input', () => {
    it('passes through all string fields', () => {
      const input = {
        schemaVersion: 2,
        name: 'Alice',
        handle: 'alice.eth',
        bio: 'DeFi builder',
        avatar: 'ipfs://QmAvatar',
        banner: 'https://example.com/banner.png',
      }
      const result = parseProfile(input)
      expect(result.schemaVersion).toBe(2)
      expect(result.name).toBe('Alice')
      expect(result.handle).toBe('alice.eth')
      expect(result.bio).toBe('DeFi builder')
      expect(result.avatar).toBe('ipfs://QmAvatar')
      expect(result.banner).toBe('https://example.com/banner.png')
    })

    it('passes through valid links array', () => {
      const input = {
        links: [
          { label: 'Website', url: 'https://alice.dev' },
          { label: 'GitHub', url: 'https://github.com/alice' },
        ],
      }
      const result = parseProfile(input)
      expect(result.links).toHaveLength(2)
      expect(result.links[0]).toEqual({ label: 'Website', url: 'https://alice.dev' })
      expect(result.links[1]).toEqual({ label: 'GitHub', url: 'https://github.com/alice' })
    })

    it('passes through valid socials record', () => {
      const input = {
        socials: { x: 'https://x.com/alice', farcaster: 'alice' },
      }
      const result = parseProfile(input)
      expect(result.socials).toEqual({ x: 'https://x.com/alice', farcaster: 'alice' })
    })
  })

  describe('wrong-typed field coercion', () => {
    it('coerces number name to empty string', () => {
      expect(parseProfile({ name: 123 }).name).toBe('')
    })

    it('coerces boolean bio to empty string', () => {
      expect(parseProfile({ bio: true }).bio).toBe('')
    })

    it('coerces object handle to empty string', () => {
      expect(parseProfile({ handle: {} }).handle).toBe('')
    })

    it('coerces non-finite number schemaVersion to default 1', () => {
      expect(parseProfile({ schemaVersion: NaN }).schemaVersion).toBe(1)
      expect(parseProfile({ schemaVersion: Infinity }).schemaVersion).toBe(1)
    })

    it('coerces string schemaVersion to default 1', () => {
      expect(parseProfile({ schemaVersion: '2' }).schemaVersion).toBe(1)
    })

    it('coerces non-array links to empty array', () => {
      expect(parseProfile({ links: 'not-array' }).links).toEqual([])
      expect(parseProfile({ links: 42 }).links).toEqual([])
      expect(parseProfile({ links: {} }).links).toEqual([])
    })

    it('coerces non-object socials to empty record', () => {
      expect(parseProfile({ socials: 'bad' }).socials).toEqual({})
      expect(parseProfile({ socials: 42 }).socials).toEqual({})
      expect(parseProfile({ socials: [] }).socials).toEqual({})
    })
  })

  describe('avatar fallback to image', () => {
    it('uses avatar when present', () => {
      const result = parseProfile({ avatar: 'ipfs://QmAvatar', image: 'ipfs://QmImage' })
      expect(result.avatar).toBe('ipfs://QmAvatar')
    })

    it('falls back to image when avatar is missing', () => {
      const result = parseProfile({ image: 'ipfs://QmImage' })
      expect(result.avatar).toBe('ipfs://QmImage')
    })

    it('returns empty string when both avatar and image are missing', () => {
      const result = parseProfile({})
      expect(result.avatar).toBe('')
    })

    it('falls back to image when avatar is a non-string', () => {
      // A malformed (non-string) avatar coerces to '' and then falls back to image:
      // str(o.avatar) || str(o.image).
      const result = parseProfile({ avatar: 42, image: 'ipfs://QmImage' })
      expect(result.avatar).toBe('ipfs://QmImage')
    })
  })

  describe('links filtering and coercion', () => {
    it('filters out entries with empty url', () => {
      const result = parseProfile({
        links: [
          { label: 'Good', url: 'https://example.com' },
          { label: 'Bad', url: '' },
        ],
      })
      expect(result.links).toHaveLength(1)
      expect(result.links[0]).toEqual({ label: 'Good', url: 'https://example.com' })
    })

    it('filters out entries with missing url', () => {
      const result = parseProfile({
        links: [{ label: 'No URL' }],
      })
      expect(result.links).toHaveLength(0)
    })

    it('coerces non-string label to empty string', () => {
      const result = parseProfile({
        links: [{ label: 42, url: 'https://example.com' }],
      })
      expect(result.links).toHaveLength(1)
      expect(result.links[0]).toEqual({ label: '', url: 'https://example.com' })
    })

    it('coerces non-string url to empty string, then filters it out', () => {
      const result = parseProfile({
        links: [{ label: 'test', url: 123 }],
      })
      expect(result.links).toHaveLength(0)
    })

    it('handles null/undefined entries inside links array gracefully', () => {
      const result = parseProfile({ links: [null, undefined, { url: 'https://ok.com' }] })
      expect(result.links).toHaveLength(1)
    })
  })

  describe('socials filtering', () => {
    it('keeps only string values', () => {
      const result = parseProfile({
        socials: { x: 'alice', count: 42, nested: {}, arr: [] },
      })
      expect(result.socials).toEqual({ x: 'alice' })
    })

    it('handles empty socials object', () => {
      expect(parseProfile({ socials: {} }).socials).toEqual({})
    })
  })
})

// ── parseCollection ───────────────────────────────────────────────────────────

describe('parseCollection', () => {
  describe('safe defaults', () => {
    it('returns safe defaults for undefined input', () => {
      const result = parseCollection(undefined)
      expect(result.schemaVersion).toBe(1)
      expect(result.name).toBe('')
      expect(result.description).toBe('')
      expect(result.image).toBe('')
      expect(result.banner).toBe('')
      expect(result.category).toBe('')
      expect(result.links).toEqual([])
    })

    it('returns safe defaults for null input', () => {
      const result = parseCollection(null)
      expect(result.schemaVersion).toBe(1)
      expect(result.links).toEqual([])
    })

    it('returns safe defaults for empty object', () => {
      const result = parseCollection({})
      expect(result.schemaVersion).toBe(1)
      expect(result.name).toBe('')
    })

    it('never throws on any input', () => {
      expect(() => parseCollection(42)).not.toThrow()
      expect(() => parseCollection('string')).not.toThrow()
      expect(() => parseCollection([])).not.toThrow()
      expect(() => parseCollection({ name: {}, links: 'bad' })).not.toThrow()
    })
  })

  describe('well-formed input', () => {
    it('passes through all string fields', () => {
      const input = {
        schemaVersion: 3,
        name: 'My Collection',
        description: 'A test collection',
        image: 'ipfs://QmImage',
        banner: 'https://example.com/banner.png',
        category: 'art',
      }
      const result = parseCollection(input)
      expect(result.schemaVersion).toBe(3)
      expect(result.name).toBe('My Collection')
      expect(result.description).toBe('A test collection')
      expect(result.image).toBe('ipfs://QmImage')
      expect(result.banner).toBe('https://example.com/banner.png')
      expect(result.category).toBe('art')
    })

    it('passes through valid links array', () => {
      const input = {
        links: [{ label: 'Docs', url: 'https://docs.example.com' }],
      }
      const result = parseCollection(input)
      expect(result.links).toHaveLength(1)
      expect(result.links[0]).toEqual({ label: 'Docs', url: 'https://docs.example.com' })
    })
  })

  describe('wrong-typed field coercion', () => {
    it('coerces number name to empty string', () => {
      expect(parseCollection({ name: 999 }).name).toBe('')
    })

    it('coerces array description to empty string', () => {
      expect(parseCollection({ description: [] }).description).toBe('')
    })

    it('coerces non-finite schemaVersion to default 1', () => {
      expect(parseCollection({ schemaVersion: NaN }).schemaVersion).toBe(1)
    })

    it('coerces string schemaVersion to default 1', () => {
      expect(parseCollection({ schemaVersion: '3' }).schemaVersion).toBe(1)
    })

    it('coerces non-array links to empty array', () => {
      expect(parseCollection({ links: 'bad' }).links).toEqual([])
    })
  })

  describe('links filtering', () => {
    it('filters out entries with empty url', () => {
      const result = parseCollection({
        links: [
          { label: 'Docs', url: 'https://docs.com' },
          { label: 'Empty', url: '' },
        ],
      })
      expect(result.links).toHaveLength(1)
    })
  })
})
