/**
 * Checking an upload's per-piece metadata, and keeping a CAR of just the metadata.
 *
 * The metadata is the creator's own JSON — any fields, any order — so the service cannot check it
 * against a template. What it does check, once the verified CAR is in storage and before anything
 * is indexed: every piece is UTF-8, one valid JSON object within the per-piece cap, and its `image`
 * links a file under THIS upload's images root (`https://<host>/ipfs/<imgCid>/<file>`). That last
 * rule is what keeps hosted metadata about hosted art, and what lets anyone work out the IPFS
 * version of it later by switching that one link (`app/src/lib/art/ipfsMigration.ts`).
 *
 * The metadata's bytes are read back with a few ranged reads: the browser writes the CAR in DAG
 * order, so the metadata sits together after the images. A CAR that scatters it is refused rather
 * than read with thousands of requests.
 *
 * The same read yields the metadata CAR (`GET /car/<metaCid>`): every block under the metadata root
 * and nothing else. It is what a visitor's browser downloads to check a collection's move to IPFS,
 * which would otherwise mean downloading every image too.
 */
import * as dagCbor from '@ipld/dag-cbor'
import { CID } from 'multiformats/cid'

import { HOSTING_LIMITS } from '../../../../app/src/lib/art/hostingLimits'
import { hostedImageFile, type HostedPiece } from '../../../../app/src/lib/art/ipfsMigration'
import { decodeUtf8, minifyJsonObject } from '../../../../app/src/lib/art/pieceJson'
import { CarRejected, type HostedFile, type RootIndex, type VerifiedCar } from './car'

const RAW = 0x55
const DAG_PB = 0x70

/** Bytes between two metadata blocks that one read still spans. */
const MAX_GAP = 64 * 1024
/** Largest single read. */
const MAX_SPAN = 8 * 1024 * 1024
/** Most reads the metadata may take. Far above what a DAG-ordered CAR needs (a handful). */
const MAX_READS = 64

/** An unsigned LEB128 varint. */
export function varint(value: number): Uint8Array {
  const out: number[] = []
  while (value >= 0x80) {
    out.push((value % 0x80) | 0x80)
    value = Math.floor(value / 0x80)
  }
  out.push(value)
  return new Uint8Array(out)
}

/** A CAR v1 header naming `roots`. */
export function carHeader(roots: readonly CID[]): Uint8Array {
  const header = dagCbor.encode({ roots: [...roots], version: 1 })
  const prefix = varint(header.byteLength)
  const out = new Uint8Array(prefix.byteLength + header.byteLength)
  out.set(prefix)
  out.set(header, prefix.byteLength)
  return out
}

function section(cid: CID, data: Uint8Array): Uint8Array[] {
  return [varint(cid.bytes.byteLength + data.byteLength), cid.bytes, data]
}

/** Ranges of one object, read with as few requests as the layout allows. */
export async function readRanges(
  bucket: R2Bucket,
  key: string,
  ranges: ReadonlyArray<[offset: number, length: number]>,
  maxReads = MAX_READS,
): Promise<Map<number, Uint8Array>> {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0])
  const spans: Array<{ offset: number; end: number; parts: Array<[number, number]> }> = []
  for (const [offset, length] of sorted) {
    const last = spans[spans.length - 1]
    if (
      last !== undefined &&
      offset >= last.end &&
      offset - last.end <= MAX_GAP &&
      offset + length - last.offset <= MAX_SPAN
    ) {
      last.parts.push([offset, length])
      last.end = offset + length
    } else {
      spans.push({ offset, end: offset + length, parts: [[offset, length]] })
    }
  }
  if (spans.length > maxReads) {
    throw new CarRejected('the metadata is scattered through the CAR; write it in DAG order')
  }
  const out = new Map<number, Uint8Array>()
  for (const span of spans) {
    const object = await bucket.get(key, {
      range: { offset: span.offset, length: span.end - span.offset },
    })
    if (object === null) throw new Error('the stored CAR went away while it was being read')
    const bytes = new Uint8Array(await object.arrayBuffer())
    for (const [offset, length] of span.parts) {
      out.set(offset, bytes.subarray(offset - span.offset, offset - span.offset + length))
    }
  }
  return out
}

function fileText(file: HostedFile, bytes: ReadonlyMap<number, Uint8Array>): Uint8Array {
  const out = new Uint8Array(file.size)
  let at = 0
  for (const [offset] of file.ranges) {
    const part = bytes.get(offset)!
    out.set(part, at)
    at += part.byteLength
  }
  return out
}

/**
 * Check every piece's metadata in a stored, verified CAR, and return it with a CAR of just the
 * metadata. Throws {@link CarRejected} naming the piece that fails.
 */
export async function checkMetadata(
  bucket: R2Bucket,
  key: string,
  car: VerifiedCar,
  indexes: { images: RootIndex; metadata: RootIndex },
): Promise<{ pieces: HostedPiece[]; metaCar: Blob }> {
  const metaRoot = CID.parse(indexes.metadata.root)
  const imgCid = indexes.images.root

  // Every block under the metadata root, children first, the order the metadata CAR is written in.
  const order: CID[] = []
  const seen = new Set<string>()
  const visit = (cid: CID) => {
    const k = cid.toString()
    if (seen.has(k)) return
    seen.add(k)
    if (cid.code === DAG_PB) for (const link of car.nodes.get(k)!.Links) visit(link.Hash)
    order.push(cid)
  }
  visit(metaRoot)

  const leaves = order.filter((cid) => cid.code === RAW).map((cid) => car.blocks.get(cid.toString())!)
  const total = leaves.reduce((n, at) => n + at.length, 0)
  if (total > HOSTING_LIMITS.maxMetadataBytes) {
    throw new CarRejected(
      `the metadata is ${total} bytes; an upload's metadata may be at most ${HOSTING_LIMITS.maxMetadataBytes}`,
    )
  }
  const bytes = await readRanges(
    bucket,
    key,
    leaves.map((at) => [at.offset, at.length]),
  )

  const pieces: HostedPiece[] = []
  for (const [name, file] of Object.entries(indexes.metadata.files)) {
    const text = decodeUtf8(fileText(file, bytes))
    if (text === null) throw new CarRejected(`metadata ${name} is not UTF-8`)
    const parsed = minifyJsonObject(text)
    if (!parsed.ok) {
      throw new CarRejected(
        `metadata ${name}, line ${parsed.problem.line}, column ${parsed.problem.column}: ${parsed.problem.message}`,
      )
    }
    const image = hostedImageFile(parsed.image, imgCid)
    if (image === null || !Object.prototype.hasOwnProperty.call(indexes.images.files, image)) {
      throw new CarRejected(`metadata ${name} does not link one of this upload's images`)
    }
    pieces.push({ name, json: text })
  }

  const parts: Uint8Array[] = [carHeader([metaRoot])]
  for (const cid of order) {
    const k = cid.toString()
    const data = cid.code === DAG_PB ? car.nodeBytes.get(k)! : bytes.get(car.blocks.get(k)!.offset)!
    parts.push(...section(cid, data))
  }
  return { pieces, metaCar: new Blob(parts, { type: 'application/vnd.ipld.car' }) }
}

/**
 * The hosted per-piece JSON of a stored upload, from its metadata index: what the watcher works the
 * migrated root out from. Read from the whole upload's CAR, so it works for uploads stored before
 * metadata CARs were kept.
 */
export async function readHostedPieces(
  bucket: R2Bucket,
  index: Pick<RootIndex, 'files'> & { car: string },
): Promise<HostedPiece[]> {
  const ranges = Object.values(index.files).flatMap((file) => file.ranges)
  const bytes = await readRanges(bucket, index.car, ranges)
  const decoder = new TextDecoder()
  return Object.entries(index.files).map(([name, file]) => ({
    name,
    json: decoder.decode(fileText(file, bytes)),
  }))
}
