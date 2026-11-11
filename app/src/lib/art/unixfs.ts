/**
 * The UnixFS import core: files in, a content-addressed DAG and a CAR out, with no daemon.
 *
 * Shared by two callers that must agree exactly. The IPFS distribution build
 * (`scripts/ipfs-dist/pack.ts`) packs the app itself; the wizard packs a creator's art in the
 * browser before uploading it for hosting. The service that receives an upload recomputes nothing —
 * it checks every block against its CID — so the CIDs a creator sees here are the ones the art will
 * have on any IPFS node that later pins the same CAR. That only holds if both callers import with
 * the same parameters, which is why those parameters live here and nowhere else.
 *
 * Browser-safe: nothing here touches node APIs. File contents go in as bytes or as an async
 * iterable of chunks, so a large image can be streamed from a `File` rather than read whole first.
 */
import { CarWriter } from '@ipld/car'
import * as dagPb from '@ipld/dag-pb'
import { importer, type ImportCandidate } from 'ipfs-unixfs-importer'
import { CID } from 'multiformats/cid'

/** UnixFS import parameters, pinned rather than defaulted — CIDv1 with raw leaves, wrapped in a
 * directory, which is the shape `ipfs add --recursive --cid-version=1` produces and what a gateway
 * expects to serve a directory from. Pinned because a library default that moves in a minor release
 * would silently move every CID built with it; `pack.test.ts` records the resulting CID for a
 * fixture so such a move fails a test instead of shipping a different identity. */
export const UNIXFS_OPTIONS = {
  cidVersion: 1,
  rawLeaves: true,
  wrapWithDirectory: true,
} as const

/** One file to import: a directory-relative POSIX path and its bytes. */
export interface ImportFile {
  path: string
  content: Uint8Array | AsyncIterable<Uint8Array>
}

/** A DAG built in memory: its root and every block, keyed by CID string. */
export interface ImportedDag {
  root: CID
  blocks: Map<string, Uint8Array>
}

/** A blockstore that keeps the DAG in memory. The importer only ever writes here, and a persistent
 * store would let a stale block from an earlier build survive into a CAR. */
export class MemoryBlocks {
  readonly blocks = new Map<string, Uint8Array>()

  async put(cid: CID, block: Uint8Array): Promise<CID> {
    this.blocks.set(cid.toString(), block)
    return cid
  }

  async get(cid: CID): Promise<Uint8Array> {
    const block = this.blocks.get(cid.toString())
    if (block === undefined) throw new Error(`block not in store: ${cid.toString()}`)
    return block
  }

  async has(cid: CID): Promise<boolean> {
    return this.blocks.has(cid.toString())
  }
}

/**
 * Bytes the importer will accept. It checks chunks with `instanceof Uint8Array`, which fails for an
 * array made in another realm — a `TextEncoder` result under a test DOM, for one — so such an array
 * is viewed afresh in this realm. A view, not a copy: the bytes are not duplicated.
 */
function sameRealm(content: ImportFile['content']): ImportFile['content'] {
  if (content instanceof Uint8Array || !ArrayBuffer.isView(content)) return content
  const view = content as unknown as ArrayBufferView
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
}

/**
 * Import files into one wrapping directory and return its root and blocks.
 *
 * The files are SORTED BY PATH before import, here rather than by the caller, because import order
 * is an input to the DAG shape and a caller that forgot to sort would build a different CID for the
 * same files.
 */
export async function importFiles(files: readonly ImportFile[]): Promise<ImportedDag> {
  if (files.length === 0) throw new Error('nothing to import')
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const store = new MemoryBlocks()
  const source: ImportCandidate[] = sorted.map((file) => ({
    path: file.path,
    content: sameRealm(file.content),
  }))

  let root: CID | null = null
  for await (const entry of importer(source, store, UNIXFS_OPTIONS)) {
    // The wrapping directory is emitted last, once every child is persisted.
    root = entry.cid
  }
  if (root === null) throw new Error('importer produced no root')
  return { root, blocks: store.blocks }
}

/**
 * The order blocks are written into a CAR.
 *
 *  - `cid`  sorts by CID string. Byte-reproducible and order-free; what the release CAR uses.
 *  - `dag`  walks each root depth-first and writes every node after its children, so the chunks of
 *           one file sit next to each other. Just as reproducible, and it is what lets the art
 *           service serve a hosted file with ONE ranged read of the CAR instead of one per chunk.
 */
export type CarOrder = 'cid' | 'dag'

/** Every block reachable from `roots`, children before parents, each block once. */
function dagOrder(roots: readonly CID[], blocks: ReadonlyMap<string, Uint8Array>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const visit = (cid: CID) => {
    const key = cid.toString()
    if (seen.has(key)) return
    seen.add(key)
    const bytes = blocks.get(key)
    if (bytes === undefined) throw new Error(`block not in store: ${key}`)
    if (cid.code === dagPb.code) {
      for (const link of dagPb.decode(bytes).Links) visit(link.Hash)
    }
    out.push(key)
  }
  for (const root of roots) visit(root)
  return out
}

/**
 * Serialise a CAR (v1) carrying `blocks` under `roots`, chunk by chunk, to `sink`.
 *
 * Every block in the map is written exactly once. In `dag` order a block no root reaches would be
 * dropped silently, so that is refused instead: a CAR should carry what its roots name and nothing
 * else, and the hosting service refuses one that does not.
 */
export async function writeCarChunks(
  roots: readonly CID[],
  blocks: ReadonlyMap<string, Uint8Array>,
  sink: (chunk: Uint8Array) => void | Promise<void>,
  order: CarOrder = 'cid',
): Promise<void> {
  const keys = order === 'cid' ? [...blocks.keys()].sort() : dagOrder(roots, blocks)
  if (order === 'dag' && keys.length !== blocks.size) {
    throw new Error(`${blocks.size - keys.length} block(s) are not reachable from the roots`)
  }
  const { writer, out } = CarWriter.create([...roots])
  const drain = (async () => {
    for await (const chunk of out) await sink(chunk)
  })()
  for (const key of keys) {
    const bytes = blocks.get(key)
    if (bytes === undefined) continue
    await writer.put({ cid: CID.parse(key), bytes })
  }
  await writer.close()
  await drain
}
