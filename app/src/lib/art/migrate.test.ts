import { CarBlockIterator } from '@ipld/car'
import * as dagPb from '@ipld/dag-pb'
import { CID } from 'multiformats/cid'
import { describe, expect, it, vi } from 'vitest'

import { collectFiles, hashLips, png } from '../../test/artFixtures'
import type { IpfsGateway } from '../metadata/gateways'
import { buildUpload, carBlob } from './buildUpload'
import { migratedPieceJson } from './ipfsMigration'
import { planArt } from './layout'
import {
  buildMigrationCar,
  checkRetrievable,
  hostedPieces,
  migratedMetaCidOf,
  type MigratedPiece,
} from './migrate'

const HOST = 'https://art.example'

async function hostedUpload() {
  const plan = await planArt(await collectFiles(hashLips(3)), { supply: 3 })
  const built = await buildUpload(plan, HOST, { pattern: '', description: '' })
  const car = new Uint8Array(await (await carBlob(built)).arrayBuffer())
  return { built, car }
}

/** A host serving the whole upload's CAR under both roots, as hosts before metadata CARs did. */
function serving(car: Uint8Array): typeof fetch {
  return vi.fn(async () => new Response(car.slice())) as unknown as typeof fetch
}

describe('hostedPieces', () => {
  it("reads the creator's hosted JSON out of the host's CAR", async () => {
    const { built, car } = await hostedUpload()
    const { pieces } = await hostedPieces(HOST, built.metaCid, serving(car))
    expect(pieces.map((p) => p.name).sort()).toEqual(['1', '2', '3'])
    const first = pieces.find((p) => p.name === '1')!
    expect(first.json).toContain('"dna":"dna1"')
    expect(first.json).toContain(`"image":"${HOST}/ipfs/${built.imgCid}/1.png"`)
  })
})

describe('buildMigrationCar', () => {
  it('carries the hosted images and the regenerated metadata under one root', async () => {
    const { built, car } = await hostedUpload()
    const fetcher = serving(car)
    const migration = await buildMigrationCar(HOST, built.imgCid, built.metaCid, undefined, fetcher)

    expect(fetcher).toHaveBeenCalledWith(`${HOST}/car/${built.metaCid}`)
    expect(fetcher).toHaveBeenCalledWith(`${HOST}/car/${built.imgCid}`)
    const { pieces: hosted } = await hostedPieces(HOST, built.metaCid, serving(car))
    expect(migration.metaCid).toBe(await migratedMetaCidOf(built.imgCid, hosted))
    expect(migration.metaCid).not.toBe(built.metaCid)

    const iterator = await CarBlockIterator.fromBytes(
      new Uint8Array(await migration.car.arrayBuffer()),
    )
    expect((await iterator.getRoots()).map(String)).toEqual([migration.rootCid])
    const blocks = new Map<string, Uint8Array>()
    for await (const block of iterator) blocks.set(block.cid.toString(), block.bytes)

    const root = dagPb.decode(blocks.get(migration.rootCid)!)
    expect(root.Links.map((l) => [l.Name, l.Hash.toString()])).toEqual([
      ['images', built.imgCid],
      ['metadata', migration.metaCid],
    ])
    // The old metadata, with its host-named image links, is left behind.
    expect(blocks.has(built.metaCid)).toBe(false)
    const firstJson = dagPb
      .decode(blocks.get(migration.metaCid)!)
      .Links.find((l) => l.Name === '1')!.Hash
    const text = new TextDecoder().decode(blocks.get(firstJson.toString()))
    expect(text).toBe(migratedPieceJson(hosted.find((p) => p.name === '1')!.json, built.imgCid))
    expect(text).toContain(`"image":"ipfs://${built.imgCid}/1.png"`)
    expect(text).toContain('"compiler":"HashLips Art Engine"')
    expect(migration.pieces.map((p) => [p.name, p.image])).toEqual([
      ['1', '1.png'],
      ['2', '2.png'],
      ['3', '3.png'],
    ])
  })

  it('refuses a host that serves bytes that do not match their CIDs', async () => {
    const { built, car } = await hostedUpload()
    const tampered = car.slice()
    // Flip a byte inside the first image block's data, early in the CAR.
    tampered[200]! ^= 0xff
    await expect(
      buildMigrationCar(HOST, built.imgCid, built.metaCid, undefined, serving(tampered)),
    ).rejects.toThrow(/does not match its CID|is not hashed|block/)
  })

  it('says so when the host no longer has the upload', async () => {
    const gone = vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch
    const cid = CID.parse('bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy')
    await expect(
      buildMigrationCar(HOST, cid.toString(), cid.toString(), undefined, gone),
    ).rejects.toThrow(/no longer has this upload/)
  })
})

describe('checkRetrievable', () => {
  const IMG = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
  const META = 'bafybeif26azk5uoapwvutphkf2bq7jdgrt3m7tch3xhishtv72jb6zoupq'
  const PIECES: MigratedPiece[] = [1, 2, 3, 4, 5].map((n) => ({
    name: String(n),
    json: `{"name":"#${n}","image":"ipfs://${IMG}/${n}.png"}`,
    image: `${n}.png`,
  }))
  const A: IpfsGateway = { operator: 'A', form: 'path', base: 'https://a.example/ipfs/' }
  const B: IpfsGateway = { operator: 'B', form: 'path', base: 'https://b.example/ipfs/' }

  /** A gateway that has the art when `has` says so, serving the regenerated JSON. */
  function gateways(has: (url: string) => boolean): typeof fetch {
    return vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (!has(url)) return new Response('not found', { status: 504 })
      const meta = new RegExp(`/ipfs/${META}/(\\d+)$`).exec(url)
      if (meta !== null) {
        const n = Number(meta[1])
        return new Response(PIECES[n - 1]!.json)
      }
      return new Response(png(1) as BlobPart)
    }) as unknown as typeof fetch
  }

  it('passes when one public gateway serves a sample of both roots', async () => {
    const fetcher = gateways((url) => url.startsWith('https://b.example'))
    const result = await checkRetrievable(IMG, META, PIECES, { gateways: [A, B], fetcher })
    expect(result.ok).toBe(true)
    expect(result.operator).toBe('B')
    expect(result.problems).toEqual(['A: metadata #1 answered 504'])
    const asked = (fetcher as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) =>
      String(c[0]),
    )
    expect(asked).toContain(`https://b.example/ipfs/${META}/5`)
    expect(asked).toContain(`https://b.example/ipfs/${IMG}/2.png`)
    expect(asked.every((url) => !url.startsWith('https://art.example'))).toBe(true)
  })

  it('fails when the metadata is not the regenerated JSON', async () => {
    const fetcher = vi.fn(async () => new Response('{"name":"#1"}')) as unknown as typeof fetch
    const result = await checkRetrievable(IMG, META, PIECES, { gateways: [A], fetcher })
    expect(result.ok).toBe(false)
    expect(result.problems).toEqual(['A: metadata #1 is not the regenerated JSON'])
  })

  it('fails when an image is missing even though the metadata is there', async () => {
    const fetcher = gateways((url) => !url.endsWith('/5.png'))
    const result = await checkRetrievable(IMG, META, PIECES, { gateways: [A], fetcher })
    expect(result.ok).toBe(false)
    expect(result.problems).toEqual(['A: image 5.png answered 504'])
  })
})
