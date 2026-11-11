/**
 * The downloadable examples on the "Preparing your files" page, generated rather than drawn by hand
 * so they always match what the uploader accepts:
 *
 *   example-collection.zip   four tiny images with one JSON per piece, HashLips-style
 *   metadata-template.csv    the spreadsheet layout: file, name, description, one column per trait
 *
 * Deterministic (fixed timestamps, fixed pixels), so the committed copies in `public/art-examples/`
 * can be checked against a fresh build by a test.
 */
import { zipSync, zlibSync } from 'fflate'

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.byteLength)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.byteLength)
  out.set(new TextEncoder().encode(type), 4)
  out.set(data, 8)
  view.setUint32(8 + data.byteLength, crc32(out.subarray(4, 8 + data.byteLength)))
  return out
}

/** A `size`×`size` PNG: a background colour with a square of a second colour in the middle. */
export function tinyPng(size: number, background: number[], square: number[]): Uint8Array {
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, size)
  view.setUint32(4, size)
  header.set([8, 2, 0, 0, 0], 8) // 8-bit RGB
  const rows = new Uint8Array(size * (1 + size * 3))
  for (let y = 0; y < size; y++) {
    rows[y * (1 + size * 3)] = 0
    for (let x = 0; x < size; x++) {
      const inner = x >= size / 4 && x < (size * 3) / 4 && y >= size / 4 && y < (size * 3) / 4
      rows.set(inner ? square : background, y * (1 + size * 3) + 1 + x * 3)
    }
  }
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlibSync(rows, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.byteLength
  }
  return out
}

const BACKGROUNDS: Record<string, number[]> = { Red: [220, 40, 40], Blue: [40, 80, 220] }
const SQUARES: Record<string, number[]> = { Black: [0, 0, 0], White: [255, 255, 255] }
const PIECES = [
  { background: 'Red', square: 'Black' },
  { background: 'Blue', square: 'Black' },
  { background: 'Red', square: 'White' },
  { background: 'Blue', square: 'White' },
]

const MTIME = new Date('2026-01-01T00:00:00Z')

/** The example collection: `images/<n>.png` and `json/<n>.json`, numbered from 1. */
export function exampleCollectionZip(): Uint8Array {
  const encoder = new TextEncoder()
  const files: Record<string, Uint8Array> = {}
  PIECES.forEach((piece, i) => {
    const n = i + 1
    files[`example-collection/images/${n}.png`] = tinyPng(
      32,
      BACKGROUNDS[piece.background]!,
      SQUARES[piece.square]!,
    )
    const json = {
      name: `Square #${n}`,
      description: 'An example piece. Replace this with your own description.',
      image: `${n}.png`,
      external_url: 'https://example.org/squares',
      attributes: [
        { trait_type: 'Background', value: piece.background },
        { trait_type: 'Square', value: piece.square },
      ],
    }
    files[`example-collection/json/${n}.json`] = encoder.encode(
      `${JSON.stringify(json, null, 2)}\n`,
    )
  })
  return zipSync(
    Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, [bytes, {}]])),
    { mtime: MTIME, level: 6 },
  )
}

/** The CSV template: one row per piece, the file column naming each image. */
export function metadataTemplateCsv(): string {
  const rows = [
    ['file', 'name', 'description', 'external_url', 'Background', 'Square'],
    ...PIECES.map((piece, i) => [
      `${i + 1}.png`,
      `Square #${i + 1}`,
      i === 0 ? '"An example piece, with a comma in its description."' : 'An example piece.',
      'https://example.org/squares',
      piece.background,
      piece.square,
    ]),
  ]
  return `${rows.map((row) => row.join(',')).join('\n')}\n`
}
