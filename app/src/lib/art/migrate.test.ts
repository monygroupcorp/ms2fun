import { CarBlockIterator } from '@ipld/car'
import * as dagPb from '@ipld/dag-pb'
import { CID } from 'multiformats/cid'
import { describe, expect, it, vi } from 'vitest'

import type { IpfsGateway } from '../metadata/gateways'
import { buildUpload, planUpload, type PieceSource } from './buildUpload'
import { migratedPieceJson } from './ipfsMigration'
import { buildMigrationCar, checkRetrievable, migratedMetaCidOf } from './migrate'

const HOST = 'https://art.example'

function png(seed: number, size = 64): Uint8Array {
  const bytes = new Uint8Array(size)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  for (let i = 8; i < size; i++) bytes[i] = (seed * 31 + i * 7) & 0xff
  return bytes
}

function source(name: string, bytes: Uint8Array): PieceSource {
  return { name, size: bytes.byteLength, arrayBuffer: async () => bytes.slice().buffer }
}

async function hostedUpload() {
  const built = await buildUpload(
    planUpload([source('a.png', png(1)), source('b.png', png(2)), source('c.png', png(3))]),
    HOST,
  )
  const car = new Uint8Array(await built.car.arrayBuffer())
  return { built, car, names: ['1.png', '2.png', '3.png'] }
}

function serving(car: Uint8Array): typeof fetch {
  return vi.fn(async () => new Response(car.slice())) as unknown as typeof fetch
}

describe('buildMigrationCar', () => {
  it('carries the hosted images and the regenerated metadata under one root', async () => {
    const { built, car, names } = await hostedUpload()
    const fetcher = serving(car)
    const migration = await buildMigrationCar(HOST, built.imgCid, names, undefined, fetcher)

    expect(fetcher).toHaveBeenCalledWith(`${HOST}/car/${built.imgCid}`)
    expect(migration.metaCid).toBe(await migratedMetaCidOf(built.imgCid, names))
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
    expect(new TextDecoder().decode(blocks.get(firstJson.toString()))).toBe(
      migratedPieceJson(1, built.imgCid, '1.png'),
    )
  })

  it('refuses a host that serves bytes that do not match their CIDs', async () => {
    const { built, car, names } = await hostedUpload()
    const tampered = car.slice()
    // Flip a byte near the end, inside the last block's data.
    tampered[tampered.byteLength - 5]! ^= 0xff
    await expect(
      buildMigrationCar(HOST, built.imgCid, names, undefined, serving(tampered)),
    ).rejects.toThrow(/does not match its CID/)
  })

  it('says so when the host no longer has the upload', async () => {
    const gone = vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch
    await expect(
      buildMigrationCar(
        HOST,
        CID.parse('bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy').toString(),
        ['1.png'],
        undefined,
        gone,
      ),
    ).rejects.toThrow(/no longer has this upload/)
  })
})

describe('checkRetrievable', () => {
  const IMG = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
  const META = 'bafybeif26azk5uoapwvutphkf2bq7jdgrt3m7tch3xhishtv72jb6zoupq'
  const NAMES = ['1.png', '2.png', '3.png', '4.png', '5.png']
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
        return new Response(migratedPieceJson(n, IMG, `${n}.png`))
      }
      return new Response(png(1) as BlobPart)
    }) as unknown as typeof fetch
  }

  it('passes when one public gateway serves a sample of both roots', async () => {
    const fetcher = gateways((url) => url.startsWith('https://b.example'))
    const result = await checkRetrievable(IMG, META, NAMES, { gateways: [A, B], fetcher })
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
    const result = await checkRetrievable(IMG, META, NAMES, { gateways: [A], fetcher })
    expect(result.ok).toBe(false)
    expect(result.problems).toEqual(['A: metadata #1 is not the regenerated JSON'])
  })

  it('fails when an image is missing even though the metadata is there', async () => {
    const fetcher = gateways((url) => !url.endsWith('/5.png'))
    const result = await checkRetrievable(IMG, META, NAMES, { gateways: [A], fetcher })
    expect(result.ok).toBe(false)
    expect(result.problems).toEqual(['A: image 5.png answered 504'])
  })
})
