/**
 * Where hosted art lives, and how a file is read back out of it.
 *
 * One upload is stored as the CAR it arrived as, byte for byte, plus one small index per root
 * naming each file and the CAR ranges its bytes occupy. Keeping the CAR whole is deliberate: it is
 * the thing a creator downloads to move the art to IPFS (`GET /car/<cid>`), and it is what any IPFS
 * node imports to serve the same CIDs. Splitting it into per-file objects at upload would mean
 * thousands of writes per collection to produce something that has to be reassembled later anyway.
 *
 *   hosted/car/<draft>.car     the upload, verified
 *   hosted/idx/<cid>.json      one per root: file name -> size, type, ranges
 *
 * The index existing IS what "hosted" means to the serving path. It is written only after the CAR
 * has verified and the ledger has accepted it, and deleted with the CAR when hosting ends, so the
 * serving path never needs to ask the ledger anything.
 */
import type { HostedFile, HostedIndex } from './car'

export function carKey(draftId: string): string {
  return `hosted/car/${draftId}.car`
}

export function indexKey(cid: string): string {
  return `hosted/idx/${cid}.json`
}

/**
 * Parsed indexes, per isolate, most recently used last.
 *
 * A grid asks for many files under one root in quick succession, and the index is the same object
 * every time; reading and parsing it per request would be most of the cost of serving a small file.
 * An index never changes once written, so there is nothing to invalidate — only an entry that is
 * gone, which {@link loadIndex} re-checks by reading storage when it is not cached here.
 */
const INDEX_CACHE = new Map<string, HostedIndex>()
const INDEX_CACHE_SIZE = 16

/** Forget a cached index — when hosting for a root ends, or when it is denied. */
export function forgetIndex(cid: string): void {
  INDEX_CACHE.delete(cid)
}

export async function loadIndex(bucket: R2Bucket, cid: string): Promise<HostedIndex | null> {
  const cached = INDEX_CACHE.get(cid)
  if (cached !== undefined) {
    INDEX_CACHE.delete(cid)
    INDEX_CACHE.set(cid, cached)
    return cached
  }
  const object = await bucket.get(indexKey(cid))
  if (object === null) return null
  const index = JSON.parse(await object.text()) as HostedIndex
  INDEX_CACHE.set(cid, index)
  while (INDEX_CACHE.size > INDEX_CACHE_SIZE) {
    INDEX_CACHE.delete(INDEX_CACHE.keys().next().value!)
  }
  return index
}

/**
 * The file's ranges grouped into spans that one ranged read can cover.
 *
 * In a CAR each block's bytes are preceded by its length and CID, so the chunks of one file are
 * never strictly adjacent. The browser writes them in DAG order, which puts them a few dozen bytes
 * apart; reading straight across those gaps and dropping them costs far less than one read per
 * chunk. A gap wider than `MAX_GAP` — a CAR written in another order — starts a new span instead.
 */
export function spansOf(
  ranges: HostedFile['ranges'],
): Array<{ offset: number; length: number; keep: Array<[number, number]> }> {
  const MAX_GAP = 512
  const spans: Array<{ offset: number; length: number; keep: Array<[number, number]> }> = []
  for (const [offset, length] of ranges) {
    const last = spans[spans.length - 1]
    const end = last === undefined ? 0 : last.offset + last.length
    if (last !== undefined && offset >= end && offset - end <= MAX_GAP) {
      last.keep.push([offset - last.offset, length])
      last.length = offset + length - last.offset
    } else {
      spans.push({ offset, length, keep: [[0, length]] })
    }
  }
  return spans
}

/** The bytes of one hosted file, read from its CAR. Null if the CAR has gone. */
export async function readHostedFile(
  bucket: R2Bucket,
  index: HostedIndex,
  file: HostedFile,
): Promise<Uint8Array | null> {
  // Files are small by rule (an image is at most 10 MiB, a piece's JSON a few KiB), so reading the
  // spans whole and copying out the kept parts is simpler than a streaming splice, and bounded.
  const out = new Uint8Array(file.size)
  let filled = 0
  for (const span of spansOf(file.ranges)) {
    const object = await bucket.get(index.car, {
      range: { offset: span.offset, length: span.length },
    })
    if (object === null) return null
    const bytes = new Uint8Array(await object.arrayBuffer())
    for (const [from, length] of span.keep) {
      out.set(bytes.subarray(from, from + length), filled)
      filled += length
    }
  }
  return filled === file.size ? out : null
}
