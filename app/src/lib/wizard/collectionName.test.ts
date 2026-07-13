import { describe, expect, it } from 'vitest'
import { toSlug, validateCollectionName } from './collectionName'

// These cases mirror `MetadataUtils.isValidName` / `toNameHash`. If the Solidity changes, change both.
describe('validateCollectionName', () => {
  it('accepts the on-chain charset', () => {
    for (const ok of ['a', 'my-collection', 'My_Collection', 'abc123', '0', 'A'.repeat(64)])
      expect(validateCollectionName(ok), ok).toBeNull()
  })

  it('rejects spaces with a specific reason', () => {
    expect(validateCollectionName('My Collection')).toBe('No spaces. Use hyphens or underscores.')
  })

  it('rejects punctuation and unicode', () => {
    for (const bad of ['hello!', 'a.b', 'café', 'emoji😀', 'a/b'])
      expect(validateCollectionName(bad), bad).toBe(
        'Letters, numbers, hyphens, and underscores only.',
      )
  })

  it('rejects empty and over-long names', () => {
    expect(validateCollectionName('')).toBe('Required.')
    expect(validateCollectionName('   ')).toBe('Required.')
    expect(validateCollectionName('a'.repeat(65))).toBe('Too long — 64 characters max.')
  })
})

describe('toSlug', () => {
  it('lowercases, matching toNameHash', () => {
    expect(toSlug('Milady')).toBe('milady')
    expect(toSlug('  MILADY  ')).toBe('milady')
  })

  it('leaves an already-valid name otherwise untouched — there is no slugification step', () => {
    expect(toSlug('my-collection_2')).toBe('my-collection_2')
  })
})
