/**
 * The browser's half of moving hosted art to IPFS: the regenerated metadata root, the CAR a creator
 * pins, and the check that a public gateway can actually serve the result.
 *
 *   hostedPieces        the hosted per-piece JSON, from the art host's metadata CAR, every block
 *                       checked against its CID
 *   regenerate          imgCid + hosted JSON → the migrated metadata DAG (see `ipfsMigration.ts`)
 *   buildMigrationCar   the hosted images + that DAG, under one root, ready for any pinning service
 *   checkRetrievable    a sample of both roots fetched from the public roster, never from our host
 *
 * Nothing here talks to a pinning service or holds a credential. The creator takes the CAR to the
 * service of their choice; the platform does not pin into an account of its own.
 */
import { CarBlockIterator } from '@ipld/car'
import * as dagPb from '@ipld/dag-pb'
import { CID } from 'multiformats/cid'
import { sha256 } from 'multiformats/hashes/sha2'

import { IPFS_GATEWAYS, gatewayUrl, type IpfsGateway } from '../metadata/gateways'
import { migrationFiles, samplePieces, type HostedPiece } from './ipfsMigration'
import { minifyJsonObject } from './pieceJson'
import { carHeader, carSection, dagOrder, importFiles, type ImportedDag } from './unixfs'

/** One piece of the migrated metadata: its file name (the piece number), its JSON and its image. */
export interface MigratedPiece {
  name: string
  json: string
  /** The image file under the images root this piece's JSON links. */
  image: string
}

export interface Regenerated extends ImportedDag {
  metaCid: string
  pieces: MigratedPiece[]
}

/** The migrated metadata DAG for a hosted upload. */
export async function regenerate(
  imgCid: string,
  hosted: readonly HostedPiece[],
): Promise<Regenerated> {
  const files = migrationFiles(imgCid, hosted)
  const dag = await importFiles(files)
  const decoder = new TextDecoder()
  const pieces = files.map((file) => {
    const json = decoder.decode(file.content)
    const parsed = minifyJsonObject(json)
    const image = parsed.ok ? /^ipfs:\/\/[^/]+\/(.+)$/.exec(String(parsed.image))?.[1] : undefined
    return { name: file.path, json, image: image ?? '' }
  })
  return { ...dag, metaCid: dag.root.toString(), pieces }
}

/** Just the migrated metadata root — what the "verified on IPFS" check compares the chain with. */
export async function migratedMetaCidOf(
  imgCid: string,
  hosted: readonly HostedPiece[],
): Promise<string> {
  return (await regenerate(imgCid, hosted)).metaCid
}

/** UnixFS `Data` for a plain directory: `{ Type: Directory }`, protobuf-encoded. */
const UNIXFS_DIRECTORY = new Uint8Array([0x08, 0x01])

/** The UnixFS node type of a dag-pb node's `Data`: 1 directory, 2 file, 5 sharded directory. */
function unixfsType(node: dagPb.PBNode): number | null {
  const data = node.Data
  // Field 1 (Type) is a varint and is written first; every type here fits in one byte.
  if (data === undefined || data[0] !== 0x08 || data[1] === undefined) return null
  return data[1]
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.byteLength === b.byteLength && a.every((byte, i) => byte === b[i])
}

async function verified(cid: CID, bytes: Uint8Array): Promise<void> {
  if (cid.multihash.code !== sha256.code) {
    throw new Error(`block ${cid.toString()} is not hashed with sha-256`)
  }
  const digest = await sha256.digest(bytes)
  if (!equalBytes(digest.digest, cid.multihash.digest)) {
    throw new Error(`block ${cid.toString()} does not match its CID`)
  }
}

/** A response body as an async iterable, whether or not this browser's streams are iterable. */
async function* bodyChunks(res: Response): AsyncGenerator<Uint8Array> {
  if (res.body === null) return
  const reader = res.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      yield value
    }
  } finally {
    reader.releaseLock()
  }
}

async function fetchCar(host: string, cid: string, fetcher: typeof fetch): Promise<Response> {
  const res = await fetcher(`${host}/car/${cid}`)
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? 'the art host no longer has this upload — use the CAR you downloaded at upload time'
        : `the art host answered ${res.status}`,
    )
  }
  return res
}

/** The files of a flat UnixFS directory (plain or sharded), by name. */
function listDirectory(root: CID, blocks: ReadonlyMap<string, Uint8Array>): Map<string, CID> {
  const out = new Map<string, CID>()
  const visit = (cid: CID, top: boolean) => {
    const bytes = blocks.get(cid.toString())
    if (bytes === undefined) throw new Error(`the hosted CAR is missing block ${cid.toString()}`)
    const node = dagPb.decode(bytes)
    const type = unixfsType(node)
    if (type === 1 && top) {
      for (const link of node.Links) out.set(link.Name ?? '', link.Hash)
    } else if (type === 5) {
      for (const link of node.Links) {
        const name = link.Name ?? ''
        if (name.length === 2) visit(link.Hash, false)
        else out.set(name.slice(2), link.Hash)
      }
    } else {
      throw new Error(`${cid.toString()} is not a flat directory`)
    }
  }
  visit(root, true)
  return out
}

/** A file's bytes: one raw leaf, or a file node's raw leaves in order. */
function fileBytes(cid: CID, blocks: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const bytes = blocks.get(cid.toString())
  if (bytes === undefined) throw new Error(`the hosted CAR is missing block ${cid.toString()}`)
  if (cid.code !== dagPb.code) return bytes
  const node = dagPb.decode(bytes)
  if (unixfsType(node) !== 2) throw new Error(`${cid.toString()} is not a file`)
  const parts = node.Links.map((link) => fileBytes(link.Hash, blocks))
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.byteLength
  }
  return out
}

export interface HostedMetadata {
  pieces: HostedPiece[]
  /** Every block of the hosted metadata DAG, so a full-upload CAR can be told apart from it. */
  cids: Set<string>
}

/**
 * The hosted per-piece JSON under `metaCid`, read from the art host's CAR for that root and checked
 * block by block against its CID, so a host that served anything else produces an error rather
 * than a regenerated root that matches nothing.
 *
 * The host serves a CAR of just the metadata for uploads made since it kept one, and the whole
 * upload for older ones; either works, because only what `metaCid` reaches is read.
 */
export async function hostedPieces(
  host: string,
  metaCid: string,
  fetcher: typeof fetch = fetch,
): Promise<HostedMetadata> {
  const res = await fetchCar(host, metaCid, fetcher)
  const blocks = new Map<string, Uint8Array>()
  const iterator = await CarBlockIterator.fromIterable(bodyChunks(res))
  for await (const block of iterator) {
    await verified(block.cid, block.bytes)
    blocks.set(block.cid.toString(), block.bytes)
  }
  const root = CID.parse(metaCid)
  const entries = listDirectory(root, blocks)
  const cids = new Set<string>()
  const reach = (cid: CID) => {
    if (cids.has(cid.toString())) return
    cids.add(cid.toString())
    if (cid.code === dagPb.code) {
      for (const link of dagPb.decode(blocks.get(cid.toString())!).Links) reach(link.Hash)
    }
  }
  reach(root)
  const decoder = new TextDecoder()
  const pieces = [...entries].map(([name, cid]) => ({
    name,
    json: decoder.decode(fileBytes(cid, blocks)),
  }))
  return { pieces, cids }
}

/** The migrated root for a hosted collection, from the host's copy of its metadata. */
export async function migrationOf(
  host: string,
  imgCid: string,
  metaCid: string,
  fetcher: typeof fetch = fetch,
): Promise<Regenerated> {
  const { pieces } = await hostedPieces(host, metaCid, fetcher)
  return regenerate(imgCid, pieces)
}

const sizeOf = (blocks: ReadonlyMap<string, Uint8Array>) =>
  [...blocks.values()].reduce((n, b) => n + b.byteLength, 0)

export interface MigrationCar {
  /** The one root the CAR carries: a directory holding `images` and `metadata`. Pin this. */
  rootCid: string
  imgCid: string
  /** The migrated metadata root. The collection's new base is `ipfs://<metaCid>/`. */
  metaCid: string
  car: Blob
  pieces: MigratedPiece[]
}

export type MigrationStage = 'downloading' | 'verifying' | 'regenerating' | 'packing'

/** Bytes gathered before they are handed to a Blob, which the browser may keep out of memory. */
const FLUSH_BYTES = 32 * 1024 * 1024

/**
 * Build the CAR a creator pins: the hosted images, byte for byte, and the regenerated metadata.
 *
 * The metadata comes from the host's metadata CAR and the images from the whole upload's
 * (`/car/<imgCid>`), and every block is hashed against its CID here before it goes in, so a host
 * that served the wrong bytes produces an error rather than a CAR whose images root is not the one
 * on chain.
 *
 * STREAMED, because a full-size collection is gigabytes: image blocks are verified as they arrive
 * and passed straight into Blobs, which a browser may keep on disk, so the images are never held in
 * memory all at once. The CAR header names a root that depends on the images' total size, so it is
 * worked out last and placed first — a Blob is assembled from its parts without copying them.
 *
 * ONE ROOT, a directory with two entries (`images`, `metadata`). Some pinning services pin only a
 * CAR's first root; under one root, pinning it pins both, and each is still fetchable by its own
 * CID on any gateway.
 */
export async function buildMigrationCar(
  host: string,
  imgCid: string,
  metaCid: string,
  onStage?: (stage: MigrationStage) => void,
  fetcher: typeof fetch = fetch,
): Promise<MigrationCar> {
  onStage?.('downloading')
  const hosted = await hostedPieces(host, metaCid, fetcher)
  onStage?.('regenerating')
  const meta = await regenerate(imgCid, hosted.pieces)

  onStage?.('downloading')
  const res = await fetchCar(host, imgCid, fetcher)
  onStage?.('verifying')
  const parts: BlobPart[] = []
  let pending: Uint8Array[] = []
  let pendingBytes = 0
  const push = (chunk: Uint8Array) => {
    pending.push(chunk)
    pendingBytes += chunk.byteLength
    if (pendingBytes >= FLUSH_BYTES) {
      parts.push(new Blob(pending as BlobPart[]))
      pending = []
      pendingBytes = 0
    }
  }
  const sizes = new Map<string, number>()
  const links = new Map<string, CID[]>()
  const iterator = await CarBlockIterator.fromIterable(bodyChunks(res))
  for await (const block of iterator) {
    const key = block.cid.toString()
    if (hosted.cids.has(key) || sizes.has(key)) continue
    await verified(block.cid, block.bytes)
    sizes.set(key, block.bytes.byteLength)
    if (block.cid.code === dagPb.code)
      links.set(
        key,
        dagPb.decode(block.bytes).Links.map((l) => l.Hash),
      )
    for (const chunk of carSection(block.cid, block.bytes)) push(chunk)
  }

  // Every image block, and nothing else, must have arrived.
  const images = CID.parse(imgCid)
  const reached = new Set<string>()
  const reach = (cid: CID) => {
    const key = cid.toString()
    if (reached.has(key)) return
    if (!sizes.has(key)) throw new Error(`the hosted CAR is missing block ${key}`)
    reached.add(key)
    for (const link of links.get(key) ?? []) reach(link)
  }
  reach(images)
  if (reached.size !== sizes.size) {
    throw new Error('the hosted CAR carries blocks that are not part of the images')
  }
  const imagesSize = [...sizes.values()].reduce((n, s) => n + s, 0)

  onStage?.('packing')
  const wrapper = dagPb.encode(
    dagPb.prepare({
      Data: UNIXFS_DIRECTORY,
      Links: [
        { Name: 'images', Hash: images, Tsize: imagesSize },
        { Name: 'metadata', Hash: meta.root, Tsize: sizeOf(meta.blocks) },
      ],
    }),
  )
  const root = CID.createV1(dagPb.code, await sha256.digest(wrapper))
  for (const key of dagOrder([meta.root], meta.blocks)) {
    for (const chunk of carSection(CID.parse(key), meta.blocks.get(key)!)) push(chunk)
  }
  for (const chunk of carSection(root, wrapper)) push(chunk)
  parts.push(new Blob(pending as BlobPart[]))
  return {
    rootCid: root.toString(),
    imgCid,
    metaCid: meta.metaCid,
    car: new Blob([(await carHeader([root])) as BlobPart, ...parts], {
      type: 'application/vnd.ipld.car',
    }),
    pieces: meta.pieces,
  }
}

export interface RetrievalResult {
  ok: boolean
  /** The gateway operator that served every sample, when one did. */
  operator: string | null
  /** One line per gateway that did not, saying which file failed and how. */
  problems: string[]
}

/**
 * Ask public gateways — the app's own roster, never the art host — for a sample of the migrated
 * art: each sampled piece's regenerated JSON, compared byte for byte, and its image, of which only
 * the response headers are read.
 *
 * Passing means somebody other than us is serving both roots right now, which is the one fact that
 * makes pointing the collection at them safe. One gateway answering every sample is enough; they
 * are tried in roster order, one at a time, for the same metering reason as everywhere else.
 */
export async function checkRetrievable(
  imgCid: string,
  metaCid: string,
  pieces: readonly MigratedPiece[],
  options: {
    gateways?: readonly IpfsGateway[]
    fetcher?: typeof fetch
    timeoutMs?: number
  } = {},
): Promise<RetrievalResult> {
  const gateways = options.gateways ?? IPFS_GATEWAYS
  const fetcher = options.fetcher ?? fetch
  const timeoutMs = options.timeoutMs ?? 20_000
  const sample = samplePieces([...pieces].sort((a, b) => Number(a.name) - Number(b.name)))
  const problems: string[] = []
  for (const gateway of gateways) {
    const problem = await firstFailure(gateway, imgCid, metaCid, sample, fetcher, timeoutMs)
    if (problem === null) return { ok: true, operator: gateway.operator, problems }
    problems.push(`${gateway.operator}: ${problem}`)
  }
  return { ok: false, operator: null, problems }
}

async function firstFailure(
  gateway: IpfsGateway,
  imgCid: string,
  metaCid: string,
  pieces: readonly MigratedPiece[],
  fetcher: typeof fetch,
  timeoutMs: number,
): Promise<string | null> {
  for (const { name, json: expected, image } of pieces) {
    const jsonUrl = gatewayUrl(gateway, `${metaCid}/${name}`)
    const imageUrl = gatewayUrl(gateway, `${imgCid}/${image}`)
    if (jsonUrl === null || imageUrl === null) return 'cannot address these CIDs'
    try {
      const json = await fetcher(jsonUrl, { signal: AbortSignal.timeout(timeoutMs) })
      if (!json.ok) return `metadata #${name} answered ${json.status}`
      const text = await json.text()
      if (text !== expected) return `metadata #${name} is not the regenerated JSON`
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const res = await fetcher(imageUrl, { signal: controller.signal })
        if (!res.ok) return `image ${image} answered ${res.status}`
      } finally {
        // Only the status was wanted; stop the image body rather than download it.
        controller.abort()
        clearTimeout(timer)
      }
    } catch {
      return `no answer for piece #${name}`
    }
  }
  return null
}
