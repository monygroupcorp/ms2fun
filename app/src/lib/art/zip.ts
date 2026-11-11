/**
 * Reading a zip in the browser without unpacking all of it.
 *
 * A full-size collection arrives as a zip of a gigabyte or two. Unpacking it into memory would hold
 * every image at once, so this reads the zip the way an archive tool does: the central directory at
 * the end says where each entry is, and an entry's bytes are read from the zip `Blob` — which the
 * browser keeps on disk — only when they are needed, one entry at a time. Stored entries are sliced
 * straight out; deflated ones are inflated with fflate, as a stream when only the first bytes are
 * wanted (to check an image really is the format its name says).
 *
 * ZIP64 is read too, because archive tools switch to it for large archives and many entries.
 * Encrypted entries and compression methods other than store and deflate are listed as unreadable
 * rather than guessed at.
 */
import { Inflate, inflateSync } from 'fflate'

/** One file inside a zip. `bytes()` and `head()` read it from the zip on demand. */
export interface ZipEntry {
  path: string
  size: number
  /** Why this entry cannot be read, when it cannot; null when it can. */
  unreadable: string | null
  bytes(): Promise<Uint8Array>
  head(n: number): Promise<Uint8Array>
}

export class ZipError extends Error {}

const EOCD = 0x06054b50
const ZIP64_LOCATOR = 0x07064b50
const ZIP64_EOCD = 0x06064b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50

async function read(blob: Blob, offset: number, length: number): Promise<DataView> {
  if (offset < 0 || offset + length > blob.size) {
    throw new ZipError('the zip is cut short: an entry points past its end')
  }
  const buffer = await blob.slice(offset, offset + length).arrayBuffer()
  return new DataView(buffer)
}

const u16 = (view: DataView, at: number) => view.getUint16(at, true)
const u32 = (view: DataView, at: number) => view.getUint32(at, true)
function u64(view: DataView, at: number): number {
  const value = view.getBigUint64(at, true)
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new ZipError('the zip is too large to read')
  return Number(value)
}

/** The end-of-central-directory record: where the directory is and how many entries it lists. */
async function directoryOf(zip: Blob): Promise<{ offset: number; size: number; count: number }> {
  // The record is 22 bytes plus a comment of up to 64 KiB, so it is somewhere in the last 64 KiB.
  const tailLength = Math.min(zip.size, 22 + 0xffff)
  const tailStart = zip.size - tailLength
  const tail = await read(zip, tailStart, tailLength)
  let at = -1
  for (let i = tailLength - 22; i >= 0; i--) {
    if (u32(tail, i) === EOCD) {
      at = i
      break
    }
  }
  if (at < 0) throw new ZipError('this is not a zip file, or it is damaged')
  let count = u16(tail, at + 10)
  let size = u32(tail, at + 12)
  let offset = u32(tail, at + 16)
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    // ZIP64: a locator sits just before the record and says where the 64-bit record is.
    const locatorAt = tailStart + at - 20
    const locator = await read(zip, locatorAt, 20)
    if (u32(locator, 0) !== ZIP64_LOCATOR) throw new ZipError('the zip64 directory is missing')
    const record = await read(zip, u64(locator, 8), 56)
    if (u32(record, 0) !== ZIP64_EOCD) throw new ZipError('the zip64 directory is damaged')
    count = u64(record, 32)
    size = u64(record, 40)
    offset = u64(record, 48)
  }
  return { offset, size, count }
}

/** The 64-bit values a zip64 "extra" field holds for whichever 32-bit fields overflowed. */
function zip64Extra(
  extra: DataView,
  wanted: { size: boolean; compressed: boolean; offset: boolean },
): { size?: number; compressed?: number; offset?: number } {
  let at = 0
  while (at + 4 <= extra.byteLength) {
    const id = u16(extra, at)
    const length = u16(extra, at + 2)
    if (id === 0x0001) {
      const out: { size?: number; compressed?: number; offset?: number } = {}
      let field = at + 4
      if (wanted.size) {
        out.size = u64(extra, field)
        field += 8
      }
      if (wanted.compressed) {
        out.compressed = u64(extra, field)
        field += 8
      }
      if (wanted.offset) out.offset = u64(extra, field)
      return out
    }
    at += 4 + length
  }
  return {}
}

const utf8 = new TextDecoder('utf-8')

/** Inflate just enough of a deflated entry to return its first `n` bytes. */
async function inflateHead(zip: Blob, start: number, compressed: number, n: number) {
  const out: Uint8Array[] = []
  let have = 0
  let done = false
  const inflater = new Inflate((chunk, final) => {
    out.push(chunk)
    have += chunk.byteLength
    if (final) done = true
  })
  const STEP = 16 * 1024
  for (let at = 0; at < compressed && have < n && !done; at += STEP) {
    const length = Math.min(STEP, compressed - at)
    const view = await read(zip, start + at, length)
    inflater.push(new Uint8Array(view.buffer), at + length >= compressed)
  }
  const head = new Uint8Array(Math.min(n, have))
  let filled = 0
  for (const chunk of out) {
    if (filled >= head.byteLength) break
    const take = Math.min(chunk.byteLength, head.byteLength - filled)
    head.set(chunk.subarray(0, take), filled)
    filled += take
  }
  return head
}

/**
 * The entries of a zip, in directory order, with folders left out. Reads only the directory; no
 * entry's bytes are touched until asked for.
 */
export async function readZip(zip: Blob): Promise<ZipEntry[]> {
  const directory = await directoryOf(zip)
  const view = await read(zip, directory.offset, directory.size)
  const entries: ZipEntry[] = []
  let at = 0
  for (let i = 0; i < directory.count; i++) {
    if (at + 46 > view.byteLength || u32(view, at) !== CENTRAL) {
      throw new ZipError('the zip directory is damaged')
    }
    const flags = u16(view, at + 8)
    const method = u16(view, at + 10)
    let compressed = u32(view, at + 20)
    let size = u32(view, at + 24)
    const nameLength = u16(view, at + 28)
    const extraLength = u16(view, at + 30)
    const commentLength = u16(view, at + 32)
    let localOffset = u32(view, at + 42)
    const name = utf8.decode(new Uint8Array(view.buffer, view.byteOffset + at + 46, nameLength))
    const extra = new DataView(view.buffer, view.byteOffset + at + 46 + nameLength, extraLength)
    const wide = zip64Extra(extra, {
      size: size === 0xffffffff,
      compressed: compressed === 0xffffffff,
      offset: localOffset === 0xffffffff,
    })
    size = wide.size ?? size
    compressed = wide.compressed ?? compressed
    localOffset = wide.offset ?? localOffset
    at += 46 + nameLength + extraLength + commentLength
    if (name.endsWith('/')) continue

    const unreadable =
      (flags & 0x1) !== 0
        ? 'it is encrypted'
        : method !== 0 && method !== 8
          ? `it uses a compression method this cannot read (${method})`
          : null
    // The data starts after the LOCAL header, whose name and extra lengths can differ from the
    // directory's copy, so it is read once, when the entry is first needed.
    let dataStart: number | null = null
    const start = async () => {
      if (dataStart !== null) return dataStart
      const local = await read(zip, localOffset, 30)
      if (u32(local, 0) !== LOCAL) throw new ZipError(`${name}: the zip entry is damaged`)
      dataStart = localOffset + 30 + u16(local, 26) + u16(local, 28)
      return dataStart
    }
    entries.push({
      path: name,
      size,
      unreadable,
      async bytes() {
        if (unreadable !== null) throw new ZipError(`${name}: ${unreadable}`)
        const from = await start()
        const raw = new Uint8Array((await read(zip, from, compressed)).buffer)
        if (method === 0) return raw
        let out: Uint8Array
        try {
          out = inflateSync(raw, { out: new Uint8Array(size) })
        } catch {
          throw new ZipError(`${name}: the zip entry is damaged`)
        }
        if (out.byteLength !== size) throw new ZipError(`${name}: the zip entry is damaged`)
        return out
      },
      async head(n: number) {
        if (unreadable !== null) throw new ZipError(`${name}: ${unreadable}`)
        const from = await start()
        if (method === 0) return new Uint8Array((await read(zip, from, Math.min(n, size))).buffer)
        try {
          return await inflateHead(zip, from, compressed, n)
        } catch {
          throw new ZipError(`${name}: the zip entry is damaged`)
        }
      },
    })
  }
  return entries
}
