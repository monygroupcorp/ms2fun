/**
 * The CAR a holder keeps is checked in the browser, block by block and root by root, whoever served
 * it: a tampered block, a missing block, or a root the chain does not name is refused before it can
 * reach a node or a download.
 */
import { CID } from 'multiformats/cid'
import { describe, expect, it } from 'vitest'

import type { IpfsGateway } from '../../metadata/gateways'
import {
  HOST,
  carBytes,
  carResponse,
  firstRawBlock,
  hostedFixture,
  ipfsFixture,
  readCar,
  tamper,
  type HostedFixture,
} from '../../../test/keepFixtures'
import { buildKeepCar, checkKeepCar, sharedImageRoot } from './build'
import { keepPlan, type KeepPlan } from './plan'

const GATEWAY: IpfsGateway = { operator: 'Public', form: 'path', base: 'https://gw.example/ipfs/' }

function hostFetcher(cars: Record<string, Uint8Array>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    const match = /\/car\/([^/?]+)$/.exec(url)
    const bytes = match === null ? undefined : cars[match[1]!]
    return bytes === undefined
      ? new Response('not hosted here', { status: 404 })
      : carResponse(bytes)
  }) as typeof fetch
}

function hostedPlan(f: HostedFixture): KeepPlan {
  return keepPlan(
    `${HOST}/ipfs/${f.metaCid}/`,
    {
      instance: '0x1',
      state: 'hosted',
      imgCid: f.imgCid,
      metaCid: f.metaCid,
      migrationCid: f.nextMetaCid,
      pieces: ['1.png', '2.png', '3.png'],
      migrated: false,
      boundAt: 0,
      graduatedAt: null,
      migratedAt: null,
    },
    HOST,
  )!
}

describe('buildKeepCar from the art host', () => {
  it('keeps the images, the hosted metadata, and the metadata a move will name', async () => {
    const f = await hostedFixture()
    const plan = hostedPlan(f)
    const keep = await buildKeepCar(plan, {
      fetcher: hostFetcher({ [f.imgCid]: f.uploadCar, [f.metaCid]: f.metaCar }),
      gateways: [],
    })
    expect(keep.roots).toEqual([
      { role: 'images', cid: f.imgCid },
      { role: 'metadata', cid: f.metaCid },
      { role: 'next-metadata', cid: f.nextMetaCid },
    ])
    await checkKeepCar(keep, plan)
    const { roots, cids } = await readCar(keep.car)
    expect(roots).toEqual([f.imgCid, f.metaCid, f.nextMetaCid])
    for (const key of f.images.blocks.keys()) expect(cids).toContain(key)
    for (const key of f.metadata.blocks.keys()) expect(cids).toContain(key)
    expect(cids).toContain(f.nextMetaCid)
    expect(new Set(cids).size).toBe(cids.length)
  })

  it('refuses a CAR whose image bytes were changed', async () => {
    const f = await hostedFixture()
    const bad = tamper(f.uploadCar, firstRawBlock(f.images))
    await expect(
      buildKeepCar(hostedPlan(f), {
        fetcher: hostFetcher({ [f.imgCid]: bad, [f.metaCid]: f.metaCar }),
        gateways: [],
      }),
    ).rejects.toThrow(/does not match its CID/)
  })

  it('refuses a CAR with a block missing', async () => {
    const f = await hostedFixture()
    const blocks = new Map([...f.images.blocks, ...f.metadata.blocks])
    blocks.delete([...f.images.blocks.keys()].find((k) => CID.parse(k).code === 0x55)!)
    const partial = await carBytes([f.images.root, f.metadata.root], blocks, 'cid')
    await expect(
      buildKeepCar(hostedPlan(f), {
        fetcher: hostFetcher({ [f.imgCid]: partial, [f.metaCid]: f.metaCar }),
        gateways: [],
      }),
    ).rejects.toThrow(/missing block/)
  })

  it('refuses metadata that is not under the root the chain names', async () => {
    const f = await hostedFixture()
    const other = await hostedFixture(2)
    // The host answers the chain's metadata root with another collection's metadata.
    await expect(
      buildKeepCar(hostedPlan(f), {
        fetcher: hostFetcher({ [f.imgCid]: f.uploadCar, [f.metaCid]: other.metaCar }),
        gateways: [],
      }),
    ).rejects.toThrow()
  })
})

describe('buildKeepCar for a collection that moved to IPFS', () => {
  function migratedPlan(f: HostedFixture, onChain: string): KeepPlan {
    return keepPlan(
      `ipfs://${onChain}/`,
      {
        instance: '0x1',
        state: 'migrated',
        imgCid: f.imgCid,
        metaCid: f.metaCid,
        migrationCid: onChain,
        pieces: ['1.png', '2.png', '3.png'],
        migrated: true,
        boundAt: 0,
        graduatedAt: 1,
        migratedAt: 2,
      },
      HOST,
    )!
  }

  it('keeps the IPFS version — images and the regenerated metadata — not the hosted one', async () => {
    const f = await hostedFixture()
    const plan = migratedPlan(f, f.nextMetaCid)
    expect(plan.kind).toBe('migrated')
    const keep = await buildKeepCar(plan, {
      fetcher: hostFetcher({ [f.imgCid]: f.uploadCar, [f.metaCid]: f.metaCar }),
      gateways: [],
    })
    await checkKeepCar(keep, plan)
    const { roots, cids } = await readCar(keep.car)
    expect(roots).toEqual([f.imgCid, f.nextMetaCid])
    expect(cids).not.toContain(f.metaCid)
  })

  it('refuses when the hosted metadata does not rebuild to the root on chain', async () => {
    const f = await hostedFixture()
    const other = await ipfsFixture()
    const plan = { ...migratedPlan(f, f.nextMetaCid), metaCid: other.metaCid }
    await expect(
      buildKeepCar(plan, {
        fetcher: hostFetcher({ [f.imgCid]: f.uploadCar, [f.metaCid]: f.metaCar }),
        gateways: [],
      }),
    ).rejects.toThrow(/rebuilds to/)
  })
})

describe('buildKeepCar from the public roster', () => {
  function rosterFetcher(cars: Record<string, Uint8Array>, seen: string[] = []): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      seen.push(url)
      expect(new Headers(init?.headers).get('accept')).toBe('application/vnd.ipld.car')
      const match = /\/ipfs\/([^/?]+)\?format=car/.exec(url)
      const bytes = match === null ? undefined : cars[match[1]!]
      return bytes === undefined ? new Response('', { status: 404 }) : carResponse(bytes)
    }) as typeof fetch
  }

  it('rebuilds the metadata and its one images root, checked like any other', async () => {
    const f = await ipfsFixture()
    const plan = keepPlan(`ipfs://${f.metaCid}/`, null, null)!
    const seen: string[] = []
    const keep = await buildKeepCar(plan, {
      fetcher: rosterFetcher({ [f.metaCid]: f.metaCar, [f.imgCid]: f.imagesCar }, seen),
      gateways: [GATEWAY],
    })
    await checkKeepCar(keep, plan)
    expect(keep.roots).toEqual([
      { role: 'images', cid: f.imgCid },
      { role: 'metadata', cid: f.metaCid },
    ])
    expect((await readCar(keep.car)).roots).toEqual([f.imgCid, f.metaCid])
    expect(seen.every((url) => url.startsWith('https://gw.example/'))).toBe(true)
  })

  it('moves on to the next gateway when one serves a tampered CAR', async () => {
    const f = await ipfsFixture()
    const plan = keepPlan(`ipfs://${f.metaCid}/`, null, null)!
    const second: IpfsGateway = {
      operator: 'Second',
      form: 'path',
      base: 'https://gw2.example/ipfs/',
    }
    const bad = f.imagesCar.slice()
    bad[bad.byteLength - 1] = bad[bad.byteLength - 1]! ^ 0xff
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes(f.metaCid)) return carResponse(f.metaCar)
      return carResponse(url.startsWith('https://gw.example/') ? bad : f.imagesCar)
    }) as typeof fetch
    const keep = await buildKeepCar(plan, { fetcher, gateways: [GATEWAY, second] })
    expect(keep.source).toBe('Second')
  })
})

describe('checkKeepCar', () => {
  it('refuses a CAR whose header names other roots than the ones proved', async () => {
    const f = await ipfsFixture()
    const plan = keepPlan(`ipfs://${f.metaCid}/`, null, null)!
    const car = new Blob([f.imagesCar as BlobPart])
    await expect(
      checkKeepCar({ car, roots: [{ role: 'metadata', cid: f.metaCid }], source: 'x' }, plan),
    ).rejects.toThrow(/header/)
  })
})

describe('sharedImageRoot', () => {
  it('finds the one root every piece names, and nothing when they name several', () => {
    const a = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
    const b = 'bafybeif26azk5uoapwvutphkf2bq7jdgrt3m7tch3xhishtv72jb6zoupq'
    expect(sharedImageRoot([{ json: `{"image":"ipfs://${a}/1.png"}` }])).toBe(a)
    expect(
      sharedImageRoot([
        { json: `{"image":"ipfs://${a}/1.png"}` },
        { json: `{"image":"https://x.example/ipfs/${b}/2.png"}` },
      ]),
    ).toBeNull()
    expect(sharedImageRoot([{ json: '{"image":"https://x.example/1.png"}' }])).toBeNull()
  })
})
