/**
 * Test fixtures for hosting: CARs built the way the browser builds them, an in-memory bucket, and
 * the ledger's SQL on a real SQLite. Imported only by tests; nothing in the worker reaches it.
 *
 * The CAR builder mirrors `app/src/lib/art/` rather than importing it, because this package is
 * installed and tested on its own in CI and cannot resolve the app's dependencies. The app's test
 * suite checks its builder against the release packer, and the end-to-end check in the README
 * uploads a CAR the app built; this copy only has to produce valid input for the verifier.
 */
import * as dagPb from '@ipld/dag-pb'
import { CarWriter } from '@ipld/car'
import { importer } from 'ipfs-unixfs-importer'
import { CID } from 'multiformats/cid'

import type { Sql } from './ledger'

export const HOST = 'https://art.example'

/** Bytes that sniff as a PNG, distinct per `seed`, `size` long. */
export function png(seed: number, size = 64): Uint8Array {
  const bytes = new Uint8Array(size)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  for (let i = 8; i < size; i++) bytes[i] = (seed * 31 + i * 7) & 0xff
  return bytes
}

export interface BuiltDag {
  root: CID
  blocks: Map<string, Uint8Array>
}

export async function importDir(
  files: ReadonlyArray<{ path: string; content: Uint8Array }>,
  shardSplitThresholdBytes?: number,
): Promise<BuiltDag> {
  const blocks = new Map<string, Uint8Array>()
  const store = {
    put: async (cid: CID, bytes: Uint8Array) => {
      blocks.set(cid.toString(), bytes)
      return cid
    },
  }
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  let root: CID | null = null
  for await (const entry of importer(sorted, store as never, {
    cidVersion: 1,
    rawLeaves: true,
    wrapWithDirectory: true,
    ...(shardSplitThresholdBytes === undefined ? {} : { shardSplitThresholdBytes }),
  })) {
    root = entry.cid
  }
  return { root: root!, blocks }
}

/** Every block under `roots`, children first — the order the browser writes. */
export function dagOrder(roots: readonly CID[], blocks: ReadonlyMap<string, Uint8Array>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const visit = (cid: CID) => {
    const key = cid.toString()
    if (seen.has(key)) return
    seen.add(key)
    if (cid.code === dagPb.code) {
      for (const link of dagPb.decode(blocks.get(key)!).Links) visit(link.Hash)
    }
    out.push(key)
  }
  roots.forEach(visit)
  return out
}

/** A CAR of exactly these blocks, in this order, under these roots — malformed if asked to be. */
export async function writeCar(
  roots: readonly CID[],
  entries: ReadonlyArray<[string, Uint8Array]>,
): Promise<Uint8Array> {
  const { writer, out } = CarWriter.create([...roots])
  const chunks: Uint8Array[] = []
  const drain = (async () => {
    for await (const chunk of out) chunks.push(chunk)
  })()
  for (const [key, bytes] of entries) await writer.put({ cid: CID.parse(key), bytes })
  await writer.close()
  await drain
  const car = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0))
  let at = 0
  for (const chunk of chunks) {
    car.set(chunk, at)
    at += chunk.byteLength
  }
  return car
}

export interface BuiltUpload {
  car: Uint8Array
  images: BuiltDag
  metadata: BuiltDag
  imgCid: string
  metaCid: string
}

/** An upload in the shape the browser builds: images, then per-piece JSON naming them. */
export async function buildUpload(
  images: ReadonlyArray<{ name: string; bytes: Uint8Array }>,
  options: {
    order?: 'dag' | 'cid'
    shardSplitThresholdBytes?: number
    /** The JSON for one piece, given its number and hosted image link. Default: the bare shape. */
    metadata?: (piece: string, image: string) => string
  } = {},
): Promise<BuiltUpload> {
  const imageDag = await importDir(
    images.map((i) => ({ path: i.name, content: i.bytes })),
    options.shardSplitThresholdBytes,
  )
  const imgCid = imageDag.root.toString()
  const json = images.map((image) => ({
    path: image.name.replace(/\..*$/, ''),
    content: new TextEncoder().encode(
      (options.metadata ??
        ((piece: string, link: string) => JSON.stringify({ name: `#${piece}`, image: link })))(
        image.name.replace(/\..*$/, ''),
        `${HOST}/ipfs/${imgCid}/${image.name}`,
      ),
    ),
  }))
  const metaDag = await importDir(json, options.shardSplitThresholdBytes)
  const roots = [imageDag.root, metaDag.root]
  const blocks = new Map([...imageDag.blocks, ...metaDag.blocks])
  const keys = options.order === 'cid' ? [...blocks.keys()].sort() : dagOrder(roots, blocks)
  const car = await writeCar(
    roots,
    keys.map((k) => [k, blocks.get(k)!]),
  )
  return { car, images: imageDag, metadata: metaDag, imgCid, metaCid: metaDag.root.toString() }
}

/** A stream of `bytes` in chunks of `size`, to exercise sections that straddle chunks. */
export function chunked(bytes: Uint8Array, size: number): ReadableStream<Uint8Array> {
  let at = 0
  return new ReadableStream({
    pull(controller) {
      if (at >= bytes.byteLength) return controller.close()
      controller.enqueue(bytes.slice(at, at + size))
      at += size
    },
  })
}

async function bytesOf(body: unknown): Promise<Uint8Array> {
  if (typeof body === 'string') return new TextEncoder().encode(body)
  if (body instanceof Uint8Array) return body
  if (body instanceof ArrayBuffer) return new Uint8Array(body)
  return new Uint8Array(await new Response(body as ReadableStream).arrayBuffer())
}

/**
 * An R2 stand-in that keeps bytes, honours ranged reads, fails a put whose stream errors, and does
 * multipart uploads with R2's rule that every part but the last is the same size.
 */
export function memoryBucket() {
  const objects = new Map<string, { bytes: Uint8Array; contentType?: string }>()
  const uploads = new Map<string, { key: string; parts: Map<number, Uint8Array> }>()
  let nextUpload = 0
  const multipart = (key: string, uploadId: string) => ({
    key,
    uploadId,
    async uploadPart(partNumber: number, body: unknown) {
      const upload = uploads.get(uploadId)
      if (upload === undefined) throw new Error('no such multipart upload')
      const bytes = await bytesOf(body)
      upload.parts.set(partNumber, bytes)
      return { partNumber, etag: `etag-${partNumber}-${bytes.byteLength}` }
    },
    async abort() {
      uploads.delete(uploadId)
    },
    async complete(parts: Array<{ partNumber: number; etag: string }>) {
      const upload = uploads.get(uploadId)
      if (upload === undefined) throw new Error('no such multipart upload')
      const chunks = parts.map((p) => {
        const bytes = upload.parts.get(p.partNumber)
        if (bytes === undefined || p.etag !== `etag-${p.partNumber}-${bytes.byteLength}`) {
          throw new Error(`part ${p.partNumber} is not uploaded`)
        }
        return bytes
      })
      if (chunks.slice(0, -1).some((c) => c.byteLength !== chunks[0]!.byteLength)) {
        throw new Error('every part but the last must be the same size')
      }
      const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0))
      let at = 0
      for (const chunk of chunks) {
        bytes.set(chunk, at)
        at += chunk.byteLength
      }
      objects.set(key, { bytes })
      uploads.delete(uploadId)
      return object(bytes)
    },
  })
  const object = (bytes: Uint8Array, contentType?: string) => ({
    size: bytes.byteLength,
    httpMetadata: contentType === undefined ? {} : { contentType },
    get body() {
      return new Response(bytes).body!
    },
    text: async () => new TextDecoder().decode(bytes),
    arrayBuffer: async () => bytes.slice().buffer,
  })
  return {
    objects,
    uploads,
    async createMultipartUpload(key: string) {
      const uploadId = `upload-${++nextUpload}`
      uploads.set(uploadId, { key, parts: new Map() })
      return multipart(key, uploadId)
    },
    resumeMultipartUpload(key: string, uploadId: string) {
      return multipart(key, uploadId)
    },
    async get(key: string, options?: { range?: { offset: number; length: number } }) {
      const found = objects.get(key)
      if (found === undefined) return null
      const range = options?.range
      const bytes =
        range === undefined
          ? found.bytes
          : found.bytes.subarray(range.offset, range.offset + range.length)
      return object(bytes, found.contentType)
    },
    async head(key: string) {
      const found = objects.get(key)
      return found === undefined ? null : object(found.bytes, found.contentType)
    },
    async put(key: string, body: unknown, options?: { httpMetadata?: { contentType?: string } }) {
      const bytes = await bytesOf(body)
      objects.set(key, { bytes, contentType: options?.httpMetadata?.contentType })
      return object(bytes)
    },
    async delete(keys: string | string[]) {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key)
    },
  }
}

interface SqliteStatement {
  all(...bindings: unknown[]): unknown[]
}
interface SqliteDatabase {
  prepare(query: string): SqliteStatement
}

/** The ledger's SQL surface on Node's built-in SQLite — the same engine a Durable Object runs. */
export function sqliteSql(): Sql {
  // Fetched from the runtime rather than imported, so this package's worker-only type
  // configuration never has to resolve a Node module, and the test bundler never tries to.
  const runtime = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } })
    .process
  const { DatabaseSync } = runtime!.getBuiltinModule!('node:sqlite') as {
    DatabaseSync: new (path: string) => SqliteDatabase
  }
  const db = new DatabaseSync(':memory:')
  return {
    exec<T>(query: string, ...bindings: unknown[]) {
      const rows = db.prepare(query).all(...bindings) as T[]
      return { toArray: () => rows.map((row) => ({ ...row })) }
    },
  }
}
