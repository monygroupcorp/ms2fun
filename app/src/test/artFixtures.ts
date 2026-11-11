/**
 * Collections the way creators bring them: HashLips folders, aggregate metadata, spreadsheets,
 * loose images, zips with the operating system's clutter in them. Shared by the art upload tests.
 */
import { zipSync, type Zippable } from 'fflate'

import { collect, type Collected, type Dropped } from '../lib/art/sources'

/** Bytes that sniff as a PNG, distinct per `seed`, `size` long. */
export function png(seed: number, size = 64): Uint8Array {
  const bytes = new Uint8Array(size)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  for (let i = 8; i < size; i++) bytes[i] = (seed * 31 + i * 7) & 0xff
  return bytes
}

export const text = (value: string) => new TextEncoder().encode(value)

/** A dropped file at `path`. */
export function dropped(path: string, bytes: Uint8Array): Dropped {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return { path, file: new File([bytes as BlobPart], name) }
}

export function zipOf(files: Record<string, Uint8Array>, level: 0 | 6 = 6): Uint8Array {
  const tree: Zippable = {}
  for (const [path, bytes] of Object.entries(files)) tree[path] = [bytes, { level }]
  return zipSync(tree, { mtime: new Date('2026-01-01T00:00:00Z') })
}

export async function collectFiles(files: Record<string, Uint8Array>): Promise<Collected> {
  return collect(Object.entries(files).map(([path, bytes]) => dropped(path, bytes)))
}

export async function collectZip(files: Record<string, Uint8Array>, level: 0 | 6 = 6) {
  return collect([dropped('collection.zip', zipOf(files, level))])
}

/** HashLips' output: `images/<n>.png`, `json/<n>.json`, and `json/_metadata.json`. */
export function hashLips(count: number, options: { from?: number; placeholder?: boolean } = {}) {
  const from = options.from ?? 1
  const files: Record<string, Uint8Array> = {}
  const all: unknown[] = []
  for (let n = from; n < from + count; n++) {
    const meta = {
      name: `Sprite #${n}`,
      description: 'A sprite.',
      image:
        options.placeholder === false
          ? `https://elsewhere.example/${n}.png`
          : `ipfs://NewUriToReplace/${n}.png`,
      dna: `dna${n}`,
      edition: n,
      date: 1700000000000,
      attributes: [
        { trait_type: 'Background', value: n % 2 === 0 ? 'Blue' : 'Red' },
        { trait_type: 'Eyes', value: 'Laser' },
      ],
      compiler: 'HashLips Art Engine',
    }
    all.push(meta)
    files[`images/${n}.png`] = png(n)
    files[`json/${n}.json`] = text(JSON.stringify(meta, null, 2))
  }
  files['json/_metadata.json'] = text(JSON.stringify(all, null, 2))
  return files
}
