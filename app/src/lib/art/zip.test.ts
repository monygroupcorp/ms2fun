// @vitest-environment node
/**
 * The zip reader against archives written by fflate (as a browser zip tool would), and against
 * hand-built ones for the shapes fflate does not write: ZIP64, encrypted entries, other methods.
 */
import { describe, expect, it } from 'vitest'

import { png, zipOf } from '../../test/artFixtures'
import { readZip } from './zip'

const blob = (bytes: Uint8Array) => new Blob([bytes as BlobPart])

/** A stored-only zip, optionally in ZIP64 form, with per-entry general-purpose flags and methods. */
function handZip(
  entries: Array<{ name: string; data: Uint8Array; flags?: number; method?: number }>,
  zip64 = false,
): Uint8Array {
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  const enc = new TextEncoder()
  for (const entry of entries) {
    const name = enc.encode(entry.name)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(6, entry.flags ?? 0, true)
    local.setUint16(8, entry.method ?? 0, true)
    local.setUint32(18, entry.data.byteLength, true)
    local.setUint32(22, entry.data.byteLength, true)
    local.setUint16(26, name.byteLength, true)
    parts.push(new Uint8Array(local.buffer), name, entry.data)

    const extra = new DataView(new ArrayBuffer(zip64 ? 4 + 24 : 0))
    if (zip64) {
      extra.setUint16(0, 0x0001, true)
      extra.setUint16(2, 24, true)
      extra.setBigUint64(4, BigInt(entry.data.byteLength), true)
      extra.setBigUint64(12, BigInt(entry.data.byteLength), true)
      extra.setBigUint64(20, BigInt(offset), true)
    }
    const head = new DataView(new ArrayBuffer(46))
    head.setUint32(0, 0x02014b50, true)
    head.setUint16(8, entry.flags ?? 0, true)
    head.setUint16(10, entry.method ?? 0, true)
    head.setUint32(20, zip64 ? 0xffffffff : entry.data.byteLength, true)
    head.setUint32(24, zip64 ? 0xffffffff : entry.data.byteLength, true)
    head.setUint16(28, name.byteLength, true)
    head.setUint16(30, extra.byteLength, true)
    head.setUint32(42, zip64 ? 0xffffffff : offset, true)
    central.push(new Uint8Array(head.buffer), name, new Uint8Array(extra.buffer))
    offset += 30 + name.byteLength + entry.data.byteLength
  }
  const cdSize = central.reduce((n, c) => n + c.byteLength, 0)
  const cdOffset = offset
  parts.push(...central)
  if (zip64) {
    const record = new DataView(new ArrayBuffer(56))
    record.setUint32(0, 0x06064b50, true)
    record.setBigUint64(4, 44n, true)
    record.setBigUint64(24, BigInt(entries.length), true)
    record.setBigUint64(32, BigInt(entries.length), true)
    record.setBigUint64(40, BigInt(cdSize), true)
    record.setBigUint64(48, BigInt(cdOffset), true)
    const locator = new DataView(new ArrayBuffer(20))
    locator.setUint32(0, 0x07064b50, true)
    locator.setBigUint64(8, BigInt(cdOffset + cdSize), true)
    locator.setUint32(16, 1, true)
    parts.push(new Uint8Array(record.buffer), new Uint8Array(locator.buffer))
  }
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, zip64 ? 0xffff : entries.length, true)
  end.setUint16(10, zip64 ? 0xffff : entries.length, true)
  end.setUint32(12, zip64 ? 0xffffffff : cdSize, true)
  end.setUint32(16, zip64 ? 0xffffffff : cdOffset, true)
  parts.push(new Uint8Array(end.buffer))
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.byteLength
  }
  return out
}

describe('readZip', () => {
  it('reads deflated and stored entries, leaving folders out', async () => {
    for (const level of [0, 6] as const) {
      const image = png(1, 300_000)
      const entries = await readZip(
        blob(zipOf({ 'art/1.png': image, 'art/1.json': png(2) }, level)),
      )
      expect(entries.map((e) => e.path).sort()).toEqual(['art/1.json', 'art/1.png'])
      const entry = entries.find((e) => e.path === 'art/1.png')!
      expect(entry.size).toBe(300_000)
      expect(await entry.bytes()).toEqual(image)
      expect(await entry.head(16)).toEqual(image.slice(0, 16))
    }
  })

  it('reads a ZIP64 archive', async () => {
    const data = png(3)
    const entries = await readZip(blob(handZip([{ name: 'a/1.png', data }], true)))
    expect(entries.map((e) => [e.path, e.size])).toEqual([['a/1.png', data.byteLength]])
    expect(await entries[0]!.bytes()).toEqual(data)
  })

  it('names encrypted entries and unknown methods as unreadable rather than guessing', async () => {
    const entries = await readZip(
      blob(
        handZip([
          { name: 'secret.png', data: png(1), flags: 1 },
          { name: 'bzip.png', data: png(2), method: 12 },
          { name: 'fine.png', data: png(3) },
        ]),
      ),
    )
    expect(entries.map((e) => e.unreadable)).toEqual([
      'it is encrypted',
      'it uses a compression method this cannot read (12)',
      null,
    ])
    await expect(entries[0]!.bytes()).rejects.toThrow(/encrypted/)
  })

  it('refuses something that is not a zip', async () => {
    await expect(readZip(blob(new TextEncoder().encode('hello')))).rejects.toThrow(/not a zip/)
  })

  it('reads entry bytes only when asked, one at a time', async () => {
    const zip = zipOf({ '1.png': png(1, 200_000), '2.png': png(2, 200_000) }, 0)
    let read = 0
    const source = blob(zip)
    const counting = {
      size: source.size,
      slice: (start?: number, end?: number) => {
        read += (end ?? source.size) - (start ?? 0)
        return source.slice(start, end)
      },
    } as unknown as Blob
    const entries = await readZip(counting)
    // The directory alone: far less than either image.
    expect(read).toBeLessThan(70_000)
    await entries[0]!.head(16)
    expect(read).toBeLessThan(70_100)
  })
})
