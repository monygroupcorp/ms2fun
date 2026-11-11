/**
 * The browser builder must produce the CIDs an IPFS node would, or "move it to IPFS later" moves it
 * to a different address. So it is checked against the release packer (`scripts/ipfs-dist/pack.ts`),
 * which writes real files to disk and imports them — the same content must give the same roots.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CarBlockIterator } from '@ipld/car'
import { afterEach, describe, expect, it } from 'vitest'

import { packDirectory, writeCar } from './pack'
import { buildUpload, pieceJson, planUpload, type PieceSource } from '../../src/lib/art/buildUpload'
import { migratedPieceJson } from '../../src/lib/art/ipfsMigration'
import { migratedMetaCidOf } from '../../src/lib/art/migrate'
import { importFiles, writeCarChunks } from '../../src/lib/art/unixfs'

const HOST = 'https://art.example'

function png(seed: number, size = 64): Uint8Array {
  const bytes = new Uint8Array(size)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  for (let i = 8; i < size; i++) bytes[i] = (seed * 31 + i * 7) & 0xff
  return bytes
}

function source(name: string, bytes: Uint8Array): PieceSource {
  return {
    name,
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.slice().buffer,
  }
}

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

const dirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'art-upload-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('planUpload', () => {
  it('numbers pieces in the order a person reads the file names', () => {
    const plan = planUpload([
      source('art-10.png', png(10)),
      source('art-2.PNG', png(2)),
      source('art-1.jpg', new Uint8Array([0xff, 0xd8, 0xff, 0])),
    ])
    expect(plan.problems).toEqual([])
    expect(plan.pieces.map((p) => [p.source.name, p.name])).toEqual([
      ['art-1.jpg', '1.jpg'],
      ['art-2.PNG', '2.png'],
      ['art-10.png', '3.png'],
    ])
  })

  it('names every file it cannot host, and why', () => {
    const big = {
      name: 'huge.png',
      size: 11 * 1024 * 1024,
      arrayBuffer: async () => new ArrayBuffer(0),
    }
    const plan = planUpload([source('a.svg', png(1)), big, source('ok.webp', png(2))])
    expect(plan.problems).toHaveLength(2)
    expect(plan.problems[0]).toMatch(/a\.svg/)
    expect(plan.problems[1]).toMatch(/huge\.png.*10 MiB/)
  })
})

describe('buildUpload', () => {
  const files = [
    source('b.png', png(2)),
    source('a.png', png(1)),
    source('c.png', png(3, 400_000)), // past one 256 KiB chunk
  ]

  it('builds the same CIDs the release packer builds from the same files on disk', async () => {
    const built = await buildUpload(planUpload(files), HOST)

    const imagesDir = tempDir()
    writeFileSync(join(imagesDir, '1.png'), png(1))
    writeFileSync(join(imagesDir, '2.png'), png(2))
    writeFileSync(join(imagesDir, '3.png'), png(3, 400_000))
    expect((await packDirectory(imagesDir)).root.toString()).toBe(built.imgCid)

    const metaDir = tempDir()
    for (const n of [1, 2, 3]) {
      writeFileSync(join(metaDir, String(n)), pieceJson(n, `${HOST}/ipfs/${built.imgCid}/${n}.png`))
    }
    expect((await packDirectory(metaDir)).root.toString()).toBe(built.metaCid)
    expect(built.baseUri).toBe(`${HOST}/ipfs/${built.metaCid}/`)
  })

  it('is deterministic, down to the CAR bytes', async () => {
    const a = await buildUpload(planUpload(files), HOST)
    const b = await buildUpload(planUpload([...files].reverse()), HOST)
    expect(b.metaCid).toBe(a.metaCid)
    expect(await bytesOf(b.car)).toEqual(await bytesOf(a.car))
  })

  it('writes one CAR rooted at the images then the metadata, carrying every block once', async () => {
    const built = await buildUpload(planUpload(files), HOST)
    const iterator = await CarBlockIterator.fromBytes(await bytesOf(built.car))
    expect((await iterator.getRoots()).map(String)).toEqual([built.imgCid, built.metaCid])
    const seen = new Set<string>()
    for await (const block of iterator) {
      expect(seen.has(block.cid.toString())).toBe(false)
      seen.add(block.cid.toString())
    }
    // 3 image leaves + 2 more for the chunked one + its file node + 2 directories + 3 JSON leaves.
    expect(seen.size).toBe(10)
  })

  it('refuses a file whose bytes are not the format its name claims', async () => {
    const plan = planUpload([source('1.png', new TextEncoder().encode('<html></html>'))])
    await expect(buildUpload(plan, HOST)).rejects.toThrow(/not really a PNG/)
  })
})

describe('the shared UnixFS core', () => {
  it('writes the same CAR the release packer writes, block for block, in CID order', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'index.html'), '<!doctype html>\n')
    writeFileSync(join(dir, 'big.bin'), new Uint8Array(300_000).fill(7))
    const packed = await packDirectory(dir)
    const out = join(tempDir(), 'out.car')
    await writeCar(packed, out)

    const { root, blocks } = await importFiles([
      { path: 'index.html', content: new TextEncoder().encode('<!doctype html>\n') },
      { path: 'big.bin', content: new Uint8Array(300_000).fill(7) },
    ])
    expect(root.toString()).toBe(packed.root.toString())
    const parts: Uint8Array[] = []
    await writeCarChunks([root], blocks, (chunk) => void parts.push(chunk))
    const { readFileSync } = await import('node:fs')
    expect(await bytesOf(new Blob(parts as BlobPart[]))).toEqual(new Uint8Array(readFileSync(out)))
  })
})

describe('the migrated metadata', () => {
  it('has the root the release packer gives the same files on disk', async () => {
    const imgCid = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
    const names = ['1.png', '2.jpg', '3.webp', '10.gif']
    const dir = tempDir()
    for (const name of names) {
      const n = Number.parseInt(name, 10)
      writeFileSync(join(dir, String(n)), migratedPieceJson(n, imgCid, name))
    }
    expect(await migratedMetaCidOf(imgCid, names)).toBe((await packDirectory(dir)).root.toString())
  })
})
