import { describe, expect, it } from 'vitest'
import {
  buildCollectionJson,
  buildProfileJson,
  collectionToDataUri,
  profileToDataUri,
  toJsonDataUri,
} from './encode'
import { parseCollection, parseProfile } from './schemas'
import type { CollectionMetadata, ProfileMetadata } from './schemas'

// ── helpers ───────────────────────────────────────────────────────────────────

function decodeDataUri(uri: string): unknown {
  const prefix = 'data:application/json,'
  return JSON.parse(decodeURIComponent(uri.slice(prefix.length)))
}

// ── buildProfileJson ──────────────────────────────────────────────────────────

describe('buildProfileJson', () => {
  it('always keeps schemaVersion even when all other fields are empty', () => {
    const p: ProfileMetadata = {
      schemaVersion: 1,
      name: '',
      handle: '',
      bio: '',
      avatar: '',
      banner: '',
      links: [],
      socials: {},
    }
    const json = buildProfileJson(p)
    const obj = JSON.parse(json)
    expect(obj.schemaVersion).toBe(1)
    expect(obj).not.toHaveProperty('name')
    expect(obj).not.toHaveProperty('handle')
    expect(obj).not.toHaveProperty('bio')
    expect(obj).not.toHaveProperty('avatar')
    expect(obj).not.toHaveProperty('banner')
    expect(obj).not.toHaveProperty('links')
    expect(obj).not.toHaveProperty('socials')
  })

  it('omits empty strings but keeps non-empty fields', () => {
    const p: ProfileMetadata = {
      schemaVersion: 2,
      name: 'Alice',
      handle: '',
      bio: 'Builder',
      avatar: '',
      banner: 'https://example.com/banner.png',
      links: [],
      socials: {},
    }
    const obj = JSON.parse(buildProfileJson(p))
    expect(obj.name).toBe('Alice')
    expect(obj.bio).toBe('Builder')
    expect(obj.banner).toBe('https://example.com/banner.png')
    expect(obj).not.toHaveProperty('handle')
    expect(obj).not.toHaveProperty('avatar')
    expect(obj).not.toHaveProperty('links')
    expect(obj).not.toHaveProperty('socials')
  })

  it('includes links and socials when non-empty', () => {
    const p: ProfileMetadata = {
      schemaVersion: 1,
      name: 'Bob',
      handle: 'bob.eth',
      bio: '',
      avatar: 'ipfs://QmAvatar',
      banner: '',
      links: [{ label: 'Site', url: 'https://bob.dev' }],
      socials: { x: 'bobonx' },
    }
    const obj = JSON.parse(buildProfileJson(p))
    expect(obj.links).toEqual([{ label: 'Site', url: 'https://bob.dev' }])
    expect(obj.socials).toEqual({ x: 'bobonx' })
  })

  it('round-trips through parseProfile for a fully-populated profile', () => {
    const p: ProfileMetadata = {
      schemaVersion: 2,
      name: 'Alice',
      handle: 'alice.eth',
      bio: 'DeFi builder',
      avatar: 'ipfs://QmAvatar',
      banner: 'https://example.com/banner.png',
      links: [{ label: 'GitHub', url: 'https://github.com/alice' }],
      socials: { x: 'aliceonx', farcaster: 'alice' },
    }
    const parsed = parseProfile(JSON.parse(buildProfileJson(p)))
    expect(parsed.schemaVersion).toBe(p.schemaVersion)
    expect(parsed.name).toBe(p.name)
    expect(parsed.handle).toBe(p.handle)
    expect(parsed.bio).toBe(p.bio)
    expect(parsed.avatar).toBe(p.avatar)
    expect(parsed.banner).toBe(p.banner)
    expect(parsed.links).toEqual(p.links)
    expect(parsed.socials).toEqual(p.socials)
  })

  it('survives special characters in fields (ampersand, hash, emoji, quotes)', () => {
    const p: ProfileMetadata = {
      schemaVersion: 1,
      name: 'R&B "#1" 🎵',
      handle: 'handle',
      bio: 'Quote: "hello" & <world>',
      avatar: '',
      banner: '',
      links: [{ label: 'Special & Link', url: 'https://example.com/?a=1&b=2#frag' }],
      socials: { x: 'user_🚀' },
    }
    const parsed = parseProfile(JSON.parse(buildProfileJson(p)))
    expect(parsed.name).toBe(p.name)
    expect(parsed.bio).toBe(p.bio)
    expect(parsed.links[0]?.url).toBe('https://example.com/?a=1&b=2#frag')
    expect(parsed.socials.x).toBe('user_🚀')
  })
})

// ── buildCollectionJson ───────────────────────────────────────────────────────

describe('buildCollectionJson', () => {
  it('always keeps schemaVersion even when all other fields are empty', () => {
    const c: CollectionMetadata = {
      schemaVersion: 1,
      name: '',
      description: '',
      image: '',
      banner: '',
      category: '',
      links: [],
    }
    const obj = JSON.parse(buildCollectionJson(c))
    expect(obj.schemaVersion).toBe(1)
    expect(obj).not.toHaveProperty('name')
    expect(obj).not.toHaveProperty('description')
    expect(obj).not.toHaveProperty('links')
  })

  it('serializes ERC-7572 wire keys, not our in-memory field names', () => {
    const c: CollectionMetadata = {
      schemaVersion: 1,
      name: 'My Drop',
      description: '',
      image: '',
      banner: 'https://example.com/banner.png',
      category: '',
      links: [{ label: 'Docs', url: 'https://docs.example.com' }],
    }
    const obj = JSON.parse(buildCollectionJson(c))
    // Marketplaces read these; MasterRegistry is not a thing they know about.
    expect(obj.banner_image).toBe('https://example.com/banner.png')
    expect(obj.external_link).toBe('https://docs.example.com')
    expect(obj).not.toHaveProperty('banner')
  })

  it('omits external_link when there are no links', () => {
    const c: CollectionMetadata = {
      schemaVersion: 1,
      name: 'No Links',
      description: '',
      image: '',
      banner: '',
      category: '',
      links: [],
    }
    const obj = JSON.parse(buildCollectionJson(c))
    expect(obj).not.toHaveProperty('external_link')
    expect(obj).not.toHaveProperty('banner_image')
  })

  it('reads back a pre-rename `banner` key', () => {
    const parsed = parseCollection({ name: 'Old', banner: 'https://example.com/old.png' })
    expect(parsed.banner).toBe('https://example.com/old.png')
  })

  it('promotes a third-party `external_link` to a labelled link', () => {
    const parsed = parseCollection({ name: 'Foreign', external_link: 'https://foreign.xyz' })
    expect(parsed.links).toEqual([{ label: 'Website', url: 'https://foreign.xyz' }])
  })

  it('round-trips through parseCollection for a fully-populated collection', () => {
    const c: CollectionMetadata = {
      schemaVersion: 3,
      name: 'My Drop',
      description: 'An NFT drop',
      image: 'ipfs://QmImage',
      banner: 'https://example.com/banner.png',
      category: 'art',
      links: [{ label: 'Docs', url: 'https://docs.example.com' }],
    }
    const parsed = parseCollection(JSON.parse(buildCollectionJson(c)))
    expect(parsed.schemaVersion).toBe(c.schemaVersion)
    expect(parsed.name).toBe(c.name)
    expect(parsed.description).toBe(c.description)
    expect(parsed.image).toBe(c.image)
    expect(parsed.banner).toBe(c.banner)
    expect(parsed.category).toBe(c.category)
    expect(parsed.links).toEqual(c.links)
  })
})

// ── toJsonDataUri ─────────────────────────────────────────────────────────────

describe('toJsonDataUri', () => {
  it('produces a string starting with data:application/json,', () => {
    const uri = toJsonDataUri('{"schemaVersion":1}')
    expect(uri.startsWith('data:application/json,')).toBe(true)
  })

  it('round-trips through decodeURIComponent + JSON.parse', () => {
    const original = { schemaVersion: 1, name: 'Test' }
    const uri = toJsonDataUri(JSON.stringify(original))
    const decoded = decodeDataUri(uri)
    expect(decoded).toEqual(original)
  })

  it('survives special characters (ampersand, hash, quotes, emoji)', () => {
    const original = { name: 'R&B "#1" 🎵', bio: '<hello>' }
    const uri = toJsonDataUri(JSON.stringify(original))
    expect(uri.startsWith('data:application/json,')).toBe(true)
    const decoded = decodeDataUri(uri)
    expect(decoded).toEqual(original)
  })
})

// ── profileToDataUri ──────────────────────────────────────────────────────────

describe('profileToDataUri', () => {
  it('round-trips: data URI → decode → parseProfile equals original', () => {
    const p: ProfileMetadata = {
      schemaVersion: 1,
      name: 'Carol',
      handle: 'carol.eth',
      bio: '',
      avatar: 'ipfs://QmCarol',
      banner: '',
      links: [],
      socials: { farcaster: 'carol' },
    }
    const uri = profileToDataUri(p)
    expect(uri.startsWith('data:application/json,')).toBe(true)
    const decoded = decodeDataUri(uri)
    const parsed = parseProfile(decoded)
    expect(parsed.name).toBe(p.name)
    expect(parsed.handle).toBe(p.handle)
    expect(parsed.avatar).toBe(p.avatar)
    expect(parsed.socials).toEqual(p.socials)
  })
})

// ── collectionToDataUri ───────────────────────────────────────────────────────

describe('collectionToDataUri', () => {
  it('round-trips: data URI → decode → parseCollection equals original', () => {
    const c: CollectionMetadata = {
      schemaVersion: 2,
      name: 'Drop Alpha',
      description: 'First drop',
      image: 'ipfs://QmImg',
      banner: '',
      category: 'music',
      links: [{ label: 'Twitter', url: 'https://x.com/drop' }],
    }
    const uri = collectionToDataUri(c)
    expect(uri.startsWith('data:application/json,')).toBe(true)
    const decoded = decodeDataUri(uri)
    const parsed = parseCollection(decoded)
    expect(parsed.name).toBe(c.name)
    expect(parsed.description).toBe(c.description)
    expect(parsed.image).toBe(c.image)
    expect(parsed.category).toBe(c.category)
    expect(parsed.links).toEqual(c.links)
  })
})
