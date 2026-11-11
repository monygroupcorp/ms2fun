// @vitest-environment node
/**
 * The migrated metadata must come out the same in every browser and in the art service, or the
 * service never recognises a finished move and the "verified on IPFS" badge never shows. The vector
 * below is repeated, on purpose, in `services/art/src/hosted/migration.test.ts`, which computes it
 * with the service's own importer: if either side drifts, one of the two tests fails.
 *
 * Node environment: a 10,000-file import runs out of memory under the test DOM, though not in a
 * browser or in Node itself.
 */
import { describe, expect, it } from 'vitest'

import {
  isMigratedBase,
  migratedBaseUri,
  migratedPieceJson,
  migrationFiles,
  pieceOfImageName,
  samplePieces,
} from './ipfsMigration'
import { migratedMetaCidOf } from './migrate'

const IMG = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
const NAMES = ['1.png', '2.jpg', '3.webp', '10.gif']
/** The shared vector. Changing it is changing every migrated collection's expected CID. */
const VECTOR = 'bafybeif26azk5uoapwvutphkf2bq7jdgrt3m7tch3xhishtv72jb6zoupq'
/** The same for 10,000 pieces, whose directory is sharded — so the HAMT layout is pinned too. */
const SHARDED_VECTOR = 'bafybeia3zy2dt2eoaokuvdp62xxaps37qdf52tgirrmquj4u66apwiprim'

describe('migrated piece JSON', () => {
  it('is the hosted shape with an ipfs:// image, fixed key order and no whitespace', () => {
    expect(migratedPieceJson(7, IMG, '7.png')).toBe(`{"name":"#7","image":"ipfs://${IMG}/7.png"}`)
  })

  it('names each file by bare piece number, ordered by piece', () => {
    const files = migrationFiles(IMG, ['10.gif', '2.jpg', '1.png'])
    expect(files.map((f) => f.path)).toEqual(['1', '2', '10'])
    expect(new TextDecoder().decode(files[2]!.content)).toBe(migratedPieceJson(10, IMG, '10.gif'))
  })

  it('refuses names that did not come from a hosted upload', () => {
    expect(() => migrationFiles(IMG, ['cover.png'])).toThrow(/not a hosted piece image/)
    expect(() => migrationFiles(IMG, ['1.png', '1.jpg'])).toThrow(/more than one image/)
    expect(() => migrationFiles(IMG, [])).toThrow(/no images/)
    expect(pieceOfImageName('0.png')).toBeNull()
    expect(pieceOfImageName('12.webp')).toBe(12)
  })
})

describe('the migrated metadata root', () => {
  it('matches the shared vector', async () => {
    expect(await migratedMetaCidOf(IMG, NAMES)).toBe(VECTOR)
  })

  it('does not depend on the order the names arrive in', async () => {
    expect(await migratedMetaCidOf(IMG, [...NAMES].reverse())).toBe(VECTOR)
  })

  it('matches the shared vector for a full-size, sharded collection', async () => {
    const names = Array.from({ length: 10_000 }, (_, i) => `${i + 1}.png`)
    expect(await migratedMetaCidOf(IMG, names)).toBe(SHARDED_VECTOR)
  }, 60_000)

  it('changes with the images root', async () => {
    const other = 'bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy'
    expect(await migratedMetaCidOf(other, NAMES)).not.toBe(VECTOR)
  })
})

describe('the migrated base', () => {
  it('is ipfs://<root>/ and nothing looser', () => {
    expect(migratedBaseUri(VECTOR)).toBe(`ipfs://${VECTOR}/`)
    expect(isMigratedBase(`ipfs://${VECTOR}/`, VECTOR)).toBe(true)
    expect(isMigratedBase(` ipfs://${VECTOR}/ `, VECTOR)).toBe(true)
    expect(isMigratedBase(`ipfs://${VECTOR}`, VECTOR)).toBe(false)
    expect(isMigratedBase(`https://art.example/ipfs/${VECTOR}/`, VECTOR)).toBe(false)
  })
})

describe('samplePieces', () => {
  it('takes the first, the last and one between', () => {
    expect(samplePieces([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toEqual([1, 4, 10])
    expect(samplePieces([1, 2])).toEqual([1, 2])
    expect(samplePieces([1, 2, 3, 4])).toEqual([1, 2, 4])
  })
})
