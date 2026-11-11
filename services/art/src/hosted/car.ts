/**
 * Reading an uploaded CAR without trusting a byte of it.
 *
 * An upload is a CAR (v1): a header naming its roots, then blocks, each a CID and the bytes that CID
 * claims to address. Nothing here takes a claim on faith. Every block is hashed as it streams past
 * and refused if its bytes are not what its CID says, and once the stream ends the whole DAG is
 * walked from the roots — so a CAR that names a block it does not carry, carries a block nothing
 * names, or has the wrong shape for hosting is refused before anything is indexed or served.
 *
 * WHY THIS IS THE WHOLE TRUST MODEL. Hosting serves bytes under a CID from our own origin. If the
 * bytes were not checked against the CID, an uploader could publish anything under any address —
 * including someone else's. Checked, the CID is a fact about the bytes, which is what makes this
 * content-addressed hosting and not a file share.
 *
 * Streaming, not buffering: the upload is piped straight to storage through {@link CarVerifier}, so
 * the worker never holds the CAR in memory. What it does keep is small — each block's offset, the
 * first bytes of each raw block, and the decoded directory and file nodes — and that is exactly what
 * the walk at the end needs to build the index the serving path reads.
 */
import * as dagCbor from '@ipld/dag-cbor'
import * as dagPb from '@ipld/dag-pb'
import { UnixFS } from 'ipfs-unixfs'
import { CID } from 'multiformats/cid'

import {
  HOSTED_IMAGE_TYPES,
  HOSTED_JSON_TYPE,
  HOSTING_LIMITS,
  PIECE_IMAGE_NAME,
  PIECE_JSON_NAME,
  hostedImageExt,
  sniffMatchesExt,
} from '../../../../app/src/lib/art/hostingLimits'

const RAW = 0x55
const DAG_PB = 0x70
const SHA2_256 = 0x12

/** Largest block accepted. The importer chunks at 256 KiB; a directory node is the only big one. */
const MAX_BLOCK_BYTES = 2 * 1024 * 1024
/** Largest CAR header accepted. Two roots need well under a hundred bytes. */
const MAX_HEADER_BYTES = 4096
/** Bytes of each raw block kept, for sniffing what a file really is. */
const HEAD_BYTES = 16
/** Most blocks one CAR may carry: every piece twice, chunked, plus directory shards — generously. */
const MAX_BLOCKS = HOSTING_LIMITS.maxFiles * 8 + 1024

/** Refused for a reason the uploader can act on; the message is returned to them. */
export class CarRejected extends Error {}

/** Where a block's DATA sits in the CAR, and the first bytes of it. */
export interface BlockAt {
  offset: number
  length: number
  head: Uint8Array
}

export interface VerifiedCar {
  roots: CID[]
  /** Total bytes of CAR read. */
  bytes: number
  blocks: Map<string, BlockAt>
  /** Every dag-pb block, decoded. Raw blocks are file bytes and are not kept. */
  nodes: Map<string, dagPb.PBNode>
  /** Every dag-pb block's bytes, as they arrived — small, and what a metadata CAR is built from. */
  nodeBytes: Map<string, Uint8Array>
}

/**
 * A queue of byte chunks that hands back exactly the span asked for.
 *
 * Chunks arrive at whatever size the network chose and a block can straddle many of them. Copying
 * the unread remainder into a fresh buffer on every chunk would copy a large block once per chunk;
 * this copies each byte at most once, when the span it belongs to is complete.
 */
class ByteQueue {
  private chunks: Uint8Array[] = []
  private head = 0
  length = 0

  push(chunk: Uint8Array): void {
    if (chunk.byteLength === 0) return
    this.chunks.push(chunk)
    this.length += chunk.byteLength
  }

  /** The first `n` bytes, without consuming them. `n` must be at most `length`. */
  peek(n: number): Uint8Array {
    const out = new Uint8Array(n)
    let filled = 0
    let offset = this.head
    for (const chunk of this.chunks) {
      if (filled === n) break
      const take = Math.min(n - filled, chunk.byteLength - offset)
      out.set(chunk.subarray(offset, offset + take), filled)
      filled += take
      offset = 0
    }
    return out
  }

  /** Consume and return the first `n` bytes. */
  take(n: number): Uint8Array {
    const out = this.peek(n)
    let left = n
    while (left > 0) {
      const chunk = this.chunks[0]!
      const available = chunk.byteLength - this.head
      if (left < available) {
        this.head += left
        left = 0
      } else {
        left -= available
        this.chunks.shift()
        this.head = 0
      }
    }
    this.length -= n
    return out
  }
}

/** An unsigned LEB128 varint at the start of `bytes`: [value, bytes used], or null if incomplete. */
export function readVarint(bytes: Uint8Array): [number, number] | null {
  let value = 0
  let scale = 1
  for (let i = 0; i < bytes.byteLength && i < 8; i++) {
    const byte = bytes[i]!
    value += (byte & 0x7f) * scale
    if ((byte & 0x80) === 0) return [value, i + 1]
    scale *= 128
  }
  if (bytes.byteLength >= 8) throw new CarRejected('malformed CAR: a length prefix is too long')
  return null
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false
  return true
}

/**
 * Parses a CAR as it streams, verifying each block against its CID.
 *
 * Feed it with {@link push} in order and call {@link finish} at the end. `onRoots` runs once, as
 * soon as the header has been read, so a caller can refuse an upload by its roots (a denied CID)
 * before the rest of it is read.
 */
export class CarVerifier {
  private readonly queue = new ByteQueue()
  private offset = 0
  private roots: CID[] | null = null
  private readonly blocks = new Map<string, BlockAt>()
  private readonly nodes = new Map<string, dagPb.PBNode>()
  private readonly nodeBytes = new Map<string, Uint8Array>()

  constructor(private readonly onRoots?: (roots: CID[]) => void) {}

  async push(chunk: Uint8Array): Promise<void> {
    this.queue.push(chunk)
    for (;;) {
      const prefix = readVarint(this.queue.peek(Math.min(this.queue.length, 8)))
      if (prefix === null) return
      const [length, used] = prefix
      const limit = this.roots === null ? MAX_HEADER_BYTES : MAX_BLOCK_BYTES
      if (length === 0 || length > limit) {
        throw new CarRejected(`malformed CAR: a section of ${length} bytes is out of bounds`)
      }
      if (this.queue.length < used + length) return
      this.queue.take(used)
      const start = this.offset + used
      const section = this.queue.take(length)
      this.offset = start + length
      if (this.roots === null) this.readHeader(section)
      else await this.readBlock(section, start)
    }
  }

  finish(): VerifiedCar {
    if (this.queue.length !== 0) throw new CarRejected('malformed CAR: it ends partway through')
    if (this.roots === null) throw new CarRejected('malformed CAR: it has no header')
    return {
      roots: this.roots,
      bytes: this.offset,
      blocks: this.blocks,
      nodes: this.nodes,
      nodeBytes: this.nodeBytes,
    }
  }

  private readHeader(section: Uint8Array): void {
    let header: unknown
    try {
      header = dagCbor.decode(section)
    } catch {
      throw new CarRejected('malformed CAR: the header does not decode')
    }
    const { version, roots } = (header ?? {}) as { version?: unknown; roots?: unknown }
    if (version !== 1) throw new CarRejected('only CAR version 1 is accepted')
    if (!Array.isArray(roots) || !roots.every((root) => CID.asCID(root) !== null)) {
      throw new CarRejected('malformed CAR: the header roots are not CIDs')
    }
    this.roots = roots.map((root) => CID.asCID(root)!)
    this.onRoots?.(this.roots)
  }

  private async readBlock(section: Uint8Array, start: number): Promise<void> {
    let cid: CID
    let data: Uint8Array
    try {
      ;[cid, data] = CID.decodeFirst(section)
    } catch {
      throw new CarRejected('malformed CAR: a block does not begin with a CID')
    }
    if (cid.version !== 1) throw new CarRejected('only CIDv1 blocks are accepted')
    if (cid.code !== RAW && cid.code !== DAG_PB) {
      throw new CarRejected(`block ${cid} uses a codec hosting does not accept`)
    }
    if (cid.multihash.code !== SHA2_256 || cid.multihash.digest.byteLength !== 32) {
      throw new CarRejected(`block ${cid} uses a hash hosting does not accept`)
    }
    if (!sameBytes(await sha256(data), cid.multihash.digest)) {
      throw new CarRejected(`block ${cid} does not match its bytes`)
    }
    const key = cid.toString()
    if (this.blocks.has(key)) return
    if (this.blocks.size >= MAX_BLOCKS) throw new CarRejected('the CAR carries too many blocks')
    this.blocks.set(key, {
      offset: start + (section.byteLength - data.byteLength),
      length: data.byteLength,
      head: data.slice(0, HEAD_BYTES),
    })
    if (cid.code === DAG_PB) {
      try {
        this.nodes.set(key, dagPb.decode(data))
        this.nodeBytes.set(key, data)
      } catch {
        throw new CarRejected(`block ${cid} is not valid dag-pb`)
      }
    }
  }
}

/**
 * A TransformStream that passes the upload through untouched while verifying it.
 *
 * Any refusal ERRORS the stream, which fails the storage write it feeds — a CAR that does not
 * verify is never committed as a complete object. `result` settles once the stream has closed.
 */
export function verifyingStream(onRoots?: (roots: CID[]) => void): {
  stream: TransformStream<Uint8Array, Uint8Array>
  result: Promise<VerifiedCar>
  /** Why verification refused the CAR, once it has; null while it has not. */
  refusal: () => CarRejected | null
} {
  const verifier = new CarVerifier(onRoots)
  let refused: CarRejected | null = null
  let settle!: (car: VerifiedCar) => void
  let reject!: (reason: unknown) => void
  const result = new Promise<VerifiedCar>((resolve, rejectWith) => {
    settle = resolve
    reject = rejectWith
  })
  const fail = (error: unknown) => {
    if (error instanceof CarRejected) refused = error
    reject(error)
  }
  // Observed here so a refusal that the caller learns about through the storage write instead is
  // never also reported as an unhandled rejection.
  result.catch(() => undefined)
  const stream = new TransformStream<Uint8Array, Uint8Array>({
    async transform(chunk, controller) {
      try {
        await verifier.push(chunk)
      } catch (error) {
        fail(error)
        throw error
      }
      controller.enqueue(chunk)
    },
    flush() {
      try {
        settle(verifier.finish())
      } catch (error) {
        fail(error)
        throw error
      }
    },
  })
  return { stream, result, refusal: () => refused }
}

/** One served file: its size, content type and the CAR ranges its bytes occupy, in order. */
export interface HostedFile {
  size: number
  type: string
  ranges: Array<[offset: number, length: number]>
}

/** What the serving path reads for one root: which file names exist and where their bytes are. */
export interface HostedIndex {
  root: string
  kind: 'images' | 'metadata'
  /** The storage key of the CAR the ranges point into. */
  car: string
  /** For a metadata root: the storage key of a CAR holding just the metadata, when one was kept. */
  metaCar?: string
  files: Record<string, HostedFile>
}

/** A walk of one root that has not been placed in storage yet. */
export type RootIndex = Omit<HostedIndex, 'car'>

/**
 * Walk the verified DAG and build the index for both roots.
 *
 * THE SHAPE IS FIXED, and the browser builds exactly this shape: two roots, in this order —
 *  1. a flat directory of images named `<piece>.<ext>`, and
 *  2. a flat directory of per-piece JSON named `<piece>`, each naming its image under root 1
 *     (checked once the bytes are stored: see `metadata.ts`).
 * Anything else is refused. Accepting arbitrary DAGs would make this a general file host, and the
 * narrow shape is what lets every served byte carry a content type we chose.
 */
export function indexCar(car: VerifiedCar): { images: RootIndex; metadata: RootIndex } {
  if (car.roots.length !== 2) {
    throw new CarRejected('the CAR must have exactly two roots: the images, then the metadata')
  }
  const visited = new Set<string>()
  const images = indexRoot(car, car.roots[0]!, 'images', visited)
  const metadata = indexRoot(car, car.roots[1]!, 'metadata', visited)
  if (visited.size !== car.blocks.size) {
    throw new CarRejected(`${car.blocks.size - visited.size} block(s) are not part of either root`)
  }
  if (Object.keys(metadata.files).length === 0) throw new CarRejected('the metadata is empty')
  return { images, metadata }
}

function indexRoot(
  car: VerifiedCar,
  root: CID,
  kind: RootIndex['kind'],
  visited: Set<string>,
): RootIndex {
  if (root.code !== DAG_PB) throw new CarRejected(`root ${root} is not a directory`)
  const entries = new Map<string, CID>()
  listDirectory(car, root, entries, visited, true)
  if (entries.size === 0) throw new CarRejected(`root ${root} is an empty directory`)
  if (entries.size > HOSTING_LIMITS.maxFiles) {
    throw new CarRejected(`root ${root} holds more than ${HOSTING_LIMITS.maxFiles} files`)
  }

  const files: Record<string, HostedFile> = {}
  for (const [name, cid] of entries) {
    const ranges: Array<[number, number]> = []
    const heads: Uint8Array[] = []
    fileRanges(car, cid, ranges, heads, visited)
    const size = ranges.reduce((total, [, length]) => total + length, 0)
    const head = heads[0] ?? new Uint8Array(0)
    if (size === 0) throw new CarRejected(`${name} is empty`)

    if (kind === 'images') {
      const ext = hostedImageExt(name)
      if (!PIECE_IMAGE_NAME.test(name) || ext === null) {
        throw new CarRejected(`${name} is not an accepted image name`)
      }
      if (size > HOSTING_LIMITS.maxImageBytes) throw new CarRejected(`${name} is too large`)
      if (!sniffMatchesExt(head, ext)) {
        throw new CarRejected(`${name} is not the image format its name says`)
      }
      files[name] = { size, type: HOSTED_IMAGE_TYPES[ext], ranges }
    } else {
      if (!PIECE_JSON_NAME.test(name)) throw new CarRejected(`${name} is not a piece number`)
      if (size > HOSTING_LIMITS.maxPieceJsonBytes) throw new CarRejected(`${name} is too large`)
      if (head[0] !== 0x7b) throw new CarRejected(`${name} is not a JSON object`)
      files[name] = { size, type: HOSTED_JSON_TYPE, ranges }
    }
  }
  return { root: root.toString(), kind, files }
}

/** The entries of a directory or HAMT shard, into `out`. Nested directories are refused. */
function listDirectory(
  car: VerifiedCar,
  cid: CID,
  out: Map<string, CID>,
  visited: Set<string>,
  top: boolean,
): void {
  const key = cid.toString()
  const node = car.nodes.get(key)
  if (node === undefined) throw new CarRejected(`block ${cid} is named but not carried`)
  visited.add(key)
  const unixfs = unixfsOf(node, cid)
  if (unixfs.type === 'directory' && top) {
    for (const link of node.Links) addEntry(out, link.Name ?? '', link.Hash)
    return
  }
  if (unixfs.type === 'hamt-sharded-directory') {
    // A sharded directory's links are named with a two-character bucket prefix: a link whose name is
    // ONLY the prefix is a sub-shard, and anything longer is an entry named by what follows it.
    for (const link of node.Links) {
      const name = link.Name ?? ''
      if (name.length === 2) listDirectory(car, link.Hash, out, visited, false)
      else addEntry(out, name.slice(2), link.Hash)
    }
    return
  }
  throw new CarRejected(`block ${cid} is not a flat directory`)
}

function addEntry(out: Map<string, CID>, name: string, cid: CID): void {
  if (name === '' || out.has(name))
    throw new CarRejected('a directory entry is unnamed or repeated')
  out.set(name, cid)
}

/** The CAR ranges holding a file's bytes, in order, appended to `ranges`. */
function fileRanges(
  car: VerifiedCar,
  cid: CID,
  ranges: Array<[number, number]>,
  heads: Uint8Array[],
  visited: Set<string>,
): void {
  const key = cid.toString()
  const at = car.blocks.get(key)
  if (at === undefined) throw new CarRejected(`block ${cid} is named but not carried`)
  visited.add(key)
  if (cid.code === RAW) {
    ranges.push([at.offset, at.length])
    heads.push(at.head)
    return
  }
  const node = car.nodes.get(key)!
  const unixfs = unixfsOf(node, cid)
  if (unixfs.type !== 'file') throw new CarRejected(`block ${cid} is not a file`)
  // Raw leaves put every byte of content in leaf blocks; data inline in a file node is a shape this
  // importer never writes, so it is refused rather than given a second serving path.
  if (unixfs.data !== undefined && unixfs.data.byteLength > 0) {
    throw new CarRejected(`block ${cid} carries inline data`)
  }
  for (const link of node.Links) fileRanges(car, link.Hash, ranges, heads, visited)
}

function unixfsOf(node: dagPb.PBNode, cid: CID): UnixFS {
  if (node.Data === undefined) throw new CarRejected(`block ${cid} is not UnixFS`)
  try {
    return UnixFS.unmarshal(node.Data)
  } catch {
    throw new CarRejected(`block ${cid} is not UnixFS`)
  }
}
