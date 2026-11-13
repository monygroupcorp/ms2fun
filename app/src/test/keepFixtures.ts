/**
 * Collections as the art host and the public gateways hold them, for the "keep this collection
 * alive" tests: a hosted upload (images + per-piece JSON naming them on the host), its metadata-only
 * CAR, and the CARs a trustless gateway answers `?format=car` with.
 */
import { CarBlockIterator } from '@ipld/car'
import { CID } from 'multiformats/cid'

import { regenerate } from '../lib/art/migrate'
import { importFiles, writeCarChunks, type ImportedDag } from '../lib/art/unixfs'
import { png } from './artFixtures'

export const HOST = 'https://art.example'

export async function carBytes(
  roots: CID[],
  blocks: ReadonlyMap<string, Uint8Array>,
  order: 'dag' | 'cid' = 'dag',
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  await writeCarChunks(roots, blocks, (chunk) => void chunks.push(chunk), order)
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0))
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.byteLength
  }
  return out
}

export interface HostedFixture {
  images: ImportedDag
  metadata: ImportedDag
  imgCid: string
  metaCid: string
  /** The regenerated (migrated) metadata root. */
  nextMetaCid: string
  /** The whole upload, as `/car/<imgCid>` serves it. */
  uploadCar: Uint8Array
  /** Just the metadata, as `/car/<metaCid>` serves it. */
  metaCar: Uint8Array
}

/** A hosted upload of `count` pieces. Images are `size` bytes, so a large size spans chunks. */
export async function hostedFixture(count = 3, size = 64): Promise<HostedFixture> {
  const images = await importFiles(
    Array.from({ length: count }, (_, i) => ({ path: `${i + 1}.png`, content: png(i + 1, size) })),
  )
  const imgCid = images.root.toString()
  const pieces = Array.from({ length: count }, (_, i) => ({
    path: String(i + 1),
    content: new TextEncoder().encode(
      JSON.stringify({ name: `#${i + 1}`, image: `${HOST}/ipfs/${imgCid}/${i + 1}.png` }),
    ),
  }))
  const metadata = await importFiles(pieces)
  const metaCid = metadata.root.toString()
  const decoder = new TextDecoder()
  const next = await regenerate(
    imgCid,
    pieces.map((p) => ({ name: p.path, json: decoder.decode(p.content) })),
  )
  const all = new Map([...images.blocks, ...metadata.blocks])
  return {
    images,
    metadata,
    imgCid,
    metaCid,
    nextMetaCid: next.metaCid,
    uploadCar: await carBytes([images.root, metadata.root], all),
    metaCar: await carBytes([metadata.root], metadata.blocks),
  }
}

export interface IpfsFixture {
  imgCid: string
  metaCid: string
  /** `?format=car` for the images root. */
  imagesCar: Uint8Array
  /** `?format=car` for the metadata root. */
  metaCar: Uint8Array
}

/** A collection that was always on IPFS: per-piece JSON naming `ipfs://<imgCid>/<n>.png`. */
export async function ipfsFixture(count = 3): Promise<IpfsFixture> {
  const images = await importFiles(
    Array.from({ length: count }, (_, i) => ({ path: `${i + 1}.png`, content: png(i + 50) })),
  )
  const imgCid = images.root.toString()
  const metadata = await importFiles(
    Array.from({ length: count }, (_, i) => ({
      path: String(i + 1),
      content: new TextEncoder().encode(
        JSON.stringify({ name: `Piece ${i + 1}`, image: `ipfs://${imgCid}/${i + 1}.png` }),
      ),
    })),
  )
  return {
    imgCid,
    metaCid: metadata.root.toString(),
    imagesCar: await carBytes([images.root], images.blocks),
    metaCar: await carBytes([metadata.root], metadata.blocks),
  }
}

/** A Response streaming `bytes`, the way a host or gateway answers. */
export function carResponse(bytes: Uint8Array): Response {
  return new Response(bytes as BodyInit, {
    status: 200,
    headers: { 'content-type': 'application/vnd.ipld.car' },
  })
}

/** Every block in a CAR, and its roots. */
export async function readCar(car: Blob): Promise<{ roots: string[]; cids: string[] }> {
  const bytes = new Uint8Array(await car.arrayBuffer())
  const iterator = await CarBlockIterator.fromBytes(bytes)
  const cids: string[] = []
  for await (const block of iterator) cids.push(block.cid.toString())
  return { roots: (await iterator.getRoots()).map((r) => r.toString()), cids }
}

/**
 * The upload CAR with one byte of one raw block changed: what a host that tampered with an image
 * would serve. The CID in front of the block is left as it was.
 */
export function tamper(car: Uint8Array, rawBlockBytes: Uint8Array): Uint8Array {
  const out = car.slice()
  for (let i = 0; i + rawBlockBytes.byteLength <= out.byteLength; i++) {
    let match = true
    for (let j = 0; j < rawBlockBytes.byteLength; j++) {
      if (out[i + j] !== rawBlockBytes[j]) {
        match = false
        break
      }
    }
    if (match) {
      const at = i + rawBlockBytes.byteLength - 1
      out[at] = out[at]! ^ 0xff
      return out
    }
  }
  throw new Error('block not found in CAR')
}

/** The bytes of the first raw (image) block of a DAG. */
export function firstRawBlock(dag: ImportedDag): Uint8Array {
  for (const [key, bytes] of dag.blocks) if (CID.parse(key).code === 0x55) return bytes
  throw new Error('no raw block')
}
