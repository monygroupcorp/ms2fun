/**
 * The service and the browser must arrive at the same migrated metadata root, or a finished move is
 * never recognised. This vector is the one `app/src/lib/art/ipfsMigration.test.ts` checks with the
 * app's importer; here it is computed with the service's own.
 */
import { describe, expect, it } from 'vitest'

import type { HostedPiece } from '../../../../app/src/lib/art/ipfsMigration'
import { migrationCidOf } from './migration'

const IMG = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
const HOST = 'https://art.example'
const VECTOR = 'bafybeif26azk5uoapwvutphkf2bq7jdgrt3m7tch3xhishtv72jb6zoupq'
const SHARDED_VECTOR = 'bafybeia3zy2dt2eoaokuvdp62xxaps37qdf52tgirrmquj4u66apwiprim'
const CREATOR_VECTOR = 'bafybeiel35qeghspixqdoehhpjrq5xsxva4s6ik7g5lpbez46vjmqxkwrm'

/** Hosted JSON in the shape uploads had before creators could bring their own metadata. */
function bare(names: readonly string[]): HostedPiece[] {
  return names.map((name) => {
    const n = Number.parseInt(name, 10)
    return { name: String(n), json: `{"name":"#${n}","image":"${HOST}/ipfs/${IMG}/${name}"}` }
  })
}

const CREATOR: HostedPiece[] = [1, 2, 3].map((n) => ({
  name: String(n),
  json:
    `{"name":"Sprite #${n}","description":"A sprite.","image":"${HOST}/ipfs/${IMG}/${n}.png",` +
    `"edition":${n},"attributes":[{"trait_type":"Eyes","value":"Laser"}],` +
    `"animation_url":"https://elsewhere.example/${n}.mp4"}`,
}))

describe('migrationCidOf', () => {
  it('matches the vector the app computes', async () => {
    expect(await migrationCidOf(IMG, bare(['1.png', '2.jpg', '3.webp', '10.gif']))).toBe(VECTOR)
    expect(await migrationCidOf(IMG, bare(['10.gif', '3.webp', '2.jpg', '1.png']))).toBe(VECTOR)
  })

  it("matches the app for a creator's own metadata", async () => {
    expect(await migrationCidOf(IMG, CREATOR)).toBe(CREATOR_VECTOR)
  })

  it('matches the app for a full-size collection, whose directory is sharded', async () => {
    // 10,000 pieces is past the importer's shard threshold, so this pins the HAMT layout too.
    const names = Array.from({ length: 10_000 }, (_, i) => `${i + 1}.png`)
    expect(await migrationCidOf(IMG, bare(names))).toBe(SHARDED_VECTOR)
  }, 60_000)
})
