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
  hostedImageFile,
  isMigratedBase,
  migratedBaseUri,
  migratedPieceJson,
  migrationFiles,
  pieceOfImageName,
  samplePieces,
  type HostedPiece,
} from './ipfsMigration'
import { migratedMetaCidOf } from './migrate'

const IMG = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
const HOST = 'https://art.example'
const NAMES = ['1.png', '2.jpg', '3.webp', '10.gif']

/** Hosted JSON in the shape uploads had before creators could bring their own metadata. */
function bare(names: readonly string[]): HostedPiece[] {
  return names.map((name) => {
    const n = Number.parseInt(name, 10)
    return { name: String(n), json: `{"name":"#${n}","image":"${HOST}/ipfs/${IMG}/${name}"}` }
  })
}

/** Hosted JSON a creator brought: their fields, in their order, with the hosted image link. */
const CREATOR: HostedPiece[] = [1, 2, 3].map((n) => ({
  name: String(n),
  json:
    `{"name":"Sprite #${n}","description":"A sprite.","image":"${HOST}/ipfs/${IMG}/${n}.png",` +
    `"edition":${n},"attributes":[{"trait_type":"Eyes","value":"Laser"}],` +
    `"animation_url":"https://elsewhere.example/${n}.mp4"}`,
}))

/**
 * The shared vectors. Changing one is changing every migrated collection's expected CID.
 * `VECTOR` is unchanged from before creators brought metadata: a bare upload migrates exactly as it
 * always did.
 */
const VECTOR = 'bafybeif26azk5uoapwvutphkf2bq7jdgrt3m7tch3xhishtv72jb6zoupq'
/** The same for 10,000 pieces, whose directory is sharded — so the HAMT layout is pinned too. */
const SHARDED_VECTOR = 'bafybeia3zy2dt2eoaokuvdp62xxaps37qdf52tgirrmquj4u66apwiprim'
/** A creator's own metadata, migrated. */
const CREATOR_VECTOR = 'bafybeiel35qeghspixqdoehhpjrq5xsxva4s6ik7g5lpbez46vjmqxkwrm'

describe('migrated piece JSON', () => {
  it('is the hosted JSON with only the image switched to ipfs://', () => {
    expect(migratedPieceJson(CREATOR[0]!.json, IMG)).toBe(
      `{"name":"Sprite #1","description":"A sprite.","image":"ipfs://${IMG}/1.png",` +
        `"edition":1,"attributes":[{"trait_type":"Eyes","value":"Laser"}],` +
        `"animation_url":"https://elsewhere.example/1.mp4"}`,
    )
  })

  it('is what a bare upload always migrated to', () => {
    expect(migratedPieceJson(bare(['7.png'])[0]!.json, IMG)).toBe(
      `{"name":"#7","image":"ipfs://${IMG}/7.png"}`,
    )
  })

  it('accepts the hosted link under any host, since the CID and path are what count', () => {
    expect(hostedImageFile(`https://other.example/ipfs/${IMG}/4.gif`, IMG)).toBe('4.gif')
    expect(hostedImageFile(`https://other.example/ipfs/${IMG}/a/4.gif`, IMG)).toBeNull()
    expect(hostedImageFile(`ipfs://${IMG}/4.gif`, IMG)).toBeNull()
  })

  it('refuses JSON that did not come from a hosted upload', () => {
    expect(() => migratedPieceJson('{"name":"x"}', IMG)).toThrow(/does not link an image/)
    expect(() => migratedPieceJson('{"name":', IMG)).toThrow(/not valid JSON/)
    const other = 'bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy'
    expect(() => migratedPieceJson(`{"image":"${HOST}/ipfs/${other}/1.png"}`, IMG)).toThrow(
      /does not link an image/,
    )
  })

  it('names each file by bare piece number, ordered by piece', () => {
    const files = migrationFiles(IMG, bare(['10.gif', '2.jpg', '1.png']))
    expect(files.map((f) => f.path)).toEqual(['1', '2', '10'])
  })

  it('refuses names that are not piece numbers, or repeat', () => {
    expect(() => migrationFiles(IMG, [{ name: 'cover', json: '{}' }])).toThrow(/not a piece number/)
    expect(() => migrationFiles(IMG, [...bare(['1.png']), ...bare(['1.jpg'])])).toThrow(
      /more than once/,
    )
    expect(() => migrationFiles(IMG, [])).toThrow(/no pieces/)
    expect(pieceOfImageName('0.png')).toBeNull()
    expect(pieceOfImageName('12.webp')).toBe(12)
  })
})

describe('the migrated metadata root', () => {
  it('matches the shared vector', async () => {
    expect(await migratedMetaCidOf(IMG, bare(NAMES))).toBe(VECTOR)
  })

  it('does not depend on the order the pieces arrive in', async () => {
    expect(await migratedMetaCidOf(IMG, bare([...NAMES].reverse()))).toBe(VECTOR)
  })

  it("matches the shared vector for a creator's own metadata", async () => {
    expect(await migratedMetaCidOf(IMG, CREATOR)).toBe(CREATOR_VECTOR)
  })

  it('matches the shared vector for a full-size, sharded collection', async () => {
    const names = Array.from({ length: 10_000 }, (_, i) => `${i + 1}.png`)
    expect(await migratedMetaCidOf(IMG, bare(names))).toBe(SHARDED_VECTOR)
  }, 60_000)

  it('changes with the images root', async () => {
    const other = 'bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy'
    const moved = bare(NAMES).map((p) => ({ ...p, json: p.json.replace(IMG, other) }))
    expect(await migratedMetaCidOf(other, moved)).not.toBe(VECTOR)
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
