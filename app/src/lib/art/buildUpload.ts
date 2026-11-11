/**
 * Turn a planned collection (`layout.ts`) into what hosting stores: two IPFS directories and one
 * CAR.
 *
 *   images     `<piece>.<ext>` — the creator's images, renamed to their token id
 *   metadata   `<piece>`       — the creator's JSON for that piece, exactly as written apart from
 *                                `image`, which names the hosted copy; or, for a piece that came
 *                                with none, JSON written from the creator's name pattern
 *
 * `tokenURI(id)` on the collection is `base + id`, and what it returns must be JSON with an `image`
 * field, which is why the metadata files are named by bare id with no extension and why the base
 * written on-chain is the METADATA directory: `https://<host>/ipfs/<metaCid>/`.
 *
 * Each `image` link is gateway-shaped (`https://<host>/ipfs/<imgCid>/<piece>.<ext>`). While hosted,
 * the host serves it; once the art has moved to IPFS, the same link is still a CID and a path, which
 * the app resolves through any gateway — so neither the JSON nor the on-chain base ever has to
 * change.
 *
 * BUILT FOR FULL-SIZE COLLECTIONS. A 2 GiB collection cannot be held in a browser tab three times
 * over (files, DAG, CAR), so the CAR is never assembled. The images are read once, one at a time, to
 * work out their CIDs; only directory and file nodes are kept. The CAR is then a list of segments —
 * small byte arrays, and ranges of the creator's files — whose total length is known exactly, and
 * {@link BuiltUpload.read} produces any byte range of it on demand, re-reading the image files it
 * covers. That is what lets the uploader send part 37 of 128 after a page reload without rebuilding
 * anything but the CIDs.
 *
 * Built entirely in the browser with the shared UnixFS core, so the CIDs shown to the creator are
 * the CIDs the art will have on any IPFS node that imports the CAR.
 */
import * as dagPb from '@ipld/dag-pb'
import { CID } from 'multiformats/cid'
import * as raw from 'multiformats/codecs/raw'
import { sha256 } from 'multiformats/hashes/sha2'

import { hostedImageName, sniffMatchesExt } from './hostingLimits'
import { generatedJson, type ArtPlan, type PlannedPiece } from './layout'
import { withImage, type MinifiedObject } from './pieceJson'
import type { InputFile } from './sources'
import { carHeader, carSectionPrefix, importFiles, type ImportFile } from './unixfs'

/** The importer's chunk size. Pinned by `UNIXFS_OPTIONS`' defaults; checked by the CID tests. */
const CHUNK = 262_144

export interface Naming {
  /** Name for pieces that came with no metadata; `{n}` is the piece number. Default `#{n}`. */
  pattern: string
  description: string
}

/** One piece's metadata before its image link is known. */
export function metadataOf(piece: PlannedPiece, naming: Naming): MinifiedObject {
  return piece.meta ?? generatedJson(piece.piece, naming.pattern, naming.description)
}

export interface BuiltUpload {
  imgCid: string
  metaCid: string
  /** The value to write as the collection's per-token base. */
  baseUri: string
  /** Bytes of CAR. */
  size: number
  pieces: number
  /** Bytes `[start, end)` of the CAR. */
  read(start: number, end: number): Promise<Uint8Array>
}

export type BuildStage = 'images' | 'metadata' | 'car'

interface Segment {
  at: number
  length: number
  bytes?: Uint8Array
  source?: InputFile
  offset?: number
}

/**
 * Work out the upload's CIDs and lay out its CAR.
 *
 * Each image's first bytes are checked against its extension here too, so a file changed since the
 * plan was made is caught before anything is signed or sent.
 */
export async function buildUpload(
  plan: ArtPlan,
  host: string,
  naming: Naming,
  onProgress?: (stage: BuildStage, fraction: number) => void,
): Promise<BuiltUpload> {
  if (plan.blockers.length > 0) throw new Error(plan.blockers[0])
  const pieces = plan.pieces.filter((p) => p.image !== null && p.ext !== null)
  if (pieces.length === 0 || pieces.length !== plan.pieces.length) {
    throw new Error('every piece needs an image to host')
  }

  // Raw leaves are located by their CID as they are hashed here; the importer produces the same
  // chunks, so the CAR can later read each one back from the creator's file.
  const leaves = new Map<string, { source: InputFile; offset: number; length: number }>()
  const total = pieces.reduce((n, p) => n + p.image!.size, 0)
  let read = 0
  const images: ImportFile[] = pieces.map((piece) => {
    const source = piece.image!
    const ext = piece.ext!
    return {
      path: hostedImageName(piece.piece, ext),
      content: (async function* () {
        const bytes = await source.bytes()
        if (!sniffMatchesExt(bytes.subarray(0, 16), ext)) {
          throw new Error(`${source.path} is not really a ${ext.toUpperCase()} image`)
        }
        for (let offset = 0; offset < bytes.byteLength; offset += CHUNK) {
          const chunk = bytes.subarray(offset, Math.min(offset + CHUNK, bytes.byteLength))
          const cid = CID.createV1(raw.code, await sha256.digest(chunk))
          leaves.set(cid.toString(), { source, offset, length: chunk.byteLength })
          yield chunk
        }
        read += bytes.byteLength
        onProgress?.('images', total === 0 ? 1 : read / total)
      })(),
    }
  })
  onProgress?.('images', 0)
  const imageDag = await importFiles(images, { keepRaw: false, fileConcurrency: 1 })
  const imgCid = imageDag.root.toString()

  onProgress?.('metadata', 0)
  const encoder = new TextEncoder()
  const metadata: ImportFile[] = pieces.map((piece) => ({
    path: String(piece.piece),
    content: encoder.encode(
      withImage(
        metadataOf(piece, naming),
        `${host}/ipfs/${imgCid}/${hostedImageName(piece.piece, piece.ext!)}`,
      ),
    ),
  }))
  const metaDag = await importFiles(metadata)
  const metaCid = metaDag.root.toString()

  onProgress?.('car', 0)
  const roots = [imageDag.root, metaDag.root]
  const segments: Segment[] = []
  let at = 0
  const pushBytes = (bytes: Uint8Array) => {
    segments.push({ at, length: bytes.byteLength, bytes })
    at += bytes.byteLength
  }
  pushBytes(await carHeader(roots))
  // DAG order — children before parents, each file's chunks together — so the service reads a file
  // in one go. The same order `writeCarChunks(..., 'dag')` writes.
  const seen = new Set<string>()
  const visit = (cid: CID) => {
    const key = cid.toString()
    if (seen.has(key)) return
    seen.add(key)
    const node = imageDag.blocks.get(key) ?? metaDag.blocks.get(key)
    if (node !== undefined) {
      if (cid.code === dagPb.code) for (const link of dagPb.decode(node).Links) visit(link.Hash)
      pushBytes(carSectionPrefix(cid, node.byteLength))
      pushBytes(node)
      return
    }
    const leaf = leaves.get(key)
    if (leaf === undefined) throw new Error(`block ${key} was not located`)
    pushBytes(carSectionPrefix(cid, leaf.length))
    segments.push({ at, length: leaf.length, source: leaf.source, offset: leaf.offset })
    at += leaf.length
  }
  for (const root of roots) visit(root)
  const size = at

  // The last few files read, so consecutive parts that share a file read it once.
  const cache: Array<[InputFile, Promise<Uint8Array>]> = []
  const bytesOf = (source: InputFile) => {
    const hit = cache.find(([s]) => s === source)
    if (hit !== undefined) return hit[1]
    const promise = source.bytes()
    cache.push([source, promise])
    if (cache.length > 4) cache.shift()
    return promise
  }

  onProgress?.('car', 1)
  return {
    imgCid,
    metaCid,
    baseUri: `${host}/ipfs/${metaCid}/`,
    size,
    pieces: pieces.length,
    async read(start, end) {
      const out = new Uint8Array(Math.max(0, Math.min(end, size) - start))
      // Binary search for the first segment that reaches past `start`.
      let lo = 0
      let hi = segments.length - 1
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        const s = segments[mid]!
        if (s.at + s.length <= start) lo = mid + 1
        else hi = mid
      }
      for (let i = lo; i < segments.length; i++) {
        const s = segments[i]!
        if (s.at >= start + out.byteLength) break
        const from = Math.max(start, s.at)
        const to = Math.min(start + out.byteLength, s.at + s.length)
        let bytes = s.bytes
        let base = 0
        if (bytes === undefined) {
          bytes = await bytesOf(s.source!)
          base = s.offset!
          if (bytes.byteLength < base + s.length) {
            throw new Error(`${s.source!.path} changed since it was read; choose the files again`)
          }
        }
        out.set(bytes.subarray(base + from - s.at, base + to - s.at), from - start)
      }
      return out
    },
  }
}

/** The whole CAR as a Blob, read a part at a time. For tests and small uploads. */
export async function carBlob(built: BuiltUpload, step = 16 * 1024 * 1024): Promise<Blob> {
  const parts: BlobPart[] = []
  for (let at = 0; at < built.size; at += step) {
    parts.push((await built.read(at, Math.min(at + step, built.size))) as BlobPart)
  }
  return new Blob(parts, { type: 'application/vnd.ipld.car' })
}

export interface MetadataOnly {
  metaCid: string
  /** `ipfs://<metaCid>/`, the value for the paste field once the CAR is pinned. */
  baseUri: string
  car: Blob
}

/**
 * The "already on IPFS" path: the creator's metadata as it is — every `image` already links their
 * IPFS art — in one directory named by token id, ready to pin. Nothing is hosted.
 */
export async function buildMetadataOnly(plan: ArtPlan): Promise<MetadataOnly> {
  if (plan.ipfs === null) throw new Error('these pieces do not link their art on IPFS')
  if (plan.ipfs.blockers.length > 0) throw new Error(plan.ipfs.blockers[0])
  const encoder = new TextEncoder()
  const dag = await importFiles(
    plan.pieces.map((piece) => ({
      path: String(piece.piece),
      content: encoder.encode(piece.meta!.text),
    })),
  )
  const header = await carHeader([dag.root])
  const parts: BlobPart[] = [header as BlobPart]
  const seen = new Set<string>()
  const visit = (cid: CID) => {
    const key = cid.toString()
    if (seen.has(key)) return
    seen.add(key)
    const bytes = dag.blocks.get(key)!
    if (cid.code === dagPb.code) for (const link of dagPb.decode(bytes).Links) visit(link.Hash)
    parts.push(carSectionPrefix(cid, bytes.byteLength) as BlobPart, bytes as BlobPart)
  }
  visit(dag.root)
  const metaCid = dag.root.toString()
  return {
    metaCid,
    baseUri: `ipfs://${metaCid}/`,
    car: new Blob(parts, { type: 'application/vnd.ipld.car' }),
  }
}
