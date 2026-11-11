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
import { buildUpload, carBlob, type Naming } from '../../src/lib/art/buildUpload'
import { migratedPieceJson } from '../../src/lib/art/ipfsMigration'
import { planArt } from '../../src/lib/art/layout'
import { migratedMetaCidOf } from '../../src/lib/art/migrate'
import { collect } from '../../src/lib/art/sources'
import { importFiles, writeCarChunks } from '../../src/lib/art/unixfs'

const HOST = 'https://art.example'
const NAMING: Naming = { pattern: '', description: '' }

function png(seed: number, size = 64): Uint8Array {
  const bytes = new Uint8Array(size)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  for (let i = 8; i < size; i++) bytes[i] = (seed * 31 + i * 7) & 0xff
  return bytes
}

async function plan(files: Record<string, Uint8Array>, supply: number | null = null) {
  return planArt(
    await collect(
      Object.entries(files).map(([path, bytes]) => ({
        path,
        file: new File([bytes as BlobPart], path),
      })),
    ),
    { supply },
  )
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

describe('buildUpload', () => {
  const images = {
    'b.png': png(2),
    'a.png': png(1),
    'c.png': png(3, 400_000), // past one 256 KiB chunk
  }

  it('builds the same CIDs the release packer builds from the same files on disk', async () => {
    const built = await buildUpload(await plan(images), HOST, NAMING)

    const imagesDir = tempDir()
    writeFileSync(join(imagesDir, '1.png'), png(1))
    writeFileSync(join(imagesDir, '2.png'), png(2))
    writeFileSync(join(imagesDir, '3.png'), png(3, 400_000))
    expect((await packDirectory(imagesDir)).root.toString()).toBe(built.imgCid)

    // With no metadata and no pattern, each piece gets exactly the JSON uploads always had.
    const metaDir = tempDir()
    for (const n of [1, 2, 3]) {
      writeFileSync(
        join(metaDir, String(n)),
        JSON.stringify({ name: `#${n}`, image: `${HOST}/ipfs/${built.imgCid}/${n}.png` }),
      )
    }
    expect((await packDirectory(metaDir)).root.toString()).toBe(built.metaCid)
    expect(built.baseUri).toBe(`${HOST}/ipfs/${built.metaCid}/`)
  })

  it("hosts the creator's own JSON with only the image link rewritten", async () => {
    const creator = (n: number) =>
      `{\n  "name": "Sprite #${n}",\n  "image": "ipfs://NewUriToReplace/${n}.png",\n  "edition": ${n},\n  "attributes": [{"trait_type": "Eyes", "value": "Laser"}]\n}`
    const built = await buildUpload(
      await plan({
        '1.png': png(1),
        '2.png': png(2),
        '1.json': new TextEncoder().encode(creator(1)),
        '2.json': new TextEncoder().encode(creator(2)),
      }),
      HOST,
      NAMING,
    )
    const metaDir = tempDir()
    for (const n of [1, 2]) {
      writeFileSync(
        join(metaDir, String(n)),
        `{"name":"Sprite #${n}","image":"${HOST}/ipfs/${built.imgCid}/${n}.png","edition":${n},"attributes":[{"trait_type":"Eyes","value":"Laser"}]}`,
      )
    }
    expect((await packDirectory(metaDir)).root.toString()).toBe(built.metaCid)
  })

  it('writes the CAR an in-memory build writes, byte for byte, without holding it', async () => {
    const built = await buildUpload(await plan(images), HOST, NAMING)
    const car = await bytesOf(await carBlob(built, 100_003))
    expect(car.byteLength).toBe(built.size)

    const imageDag = await importFiles([
      { path: '1.png', content: png(1) },
      { path: '2.png', content: png(2) },
      { path: '3.png', content: png(3, 400_000) },
    ])
    const encoder = new TextEncoder()
    const metaDag = await importFiles(
      [1, 2, 3].map((n) => ({
        path: String(n),
        content: encoder.encode(
          JSON.stringify({ name: `#${n}`, image: `${HOST}/ipfs/${built.imgCid}/${n}.png` }),
        ),
      })),
    )
    const parts: Uint8Array[] = []
    await writeCarChunks(
      [imageDag.root, metaDag.root],
      new Map([...imageDag.blocks, ...metaDag.blocks]),
      (chunk) => void parts.push(chunk),
      'dag',
    )
    expect(car).toEqual(await bytesOf(new Blob(parts as BlobPart[])))
    // Any range reads the same as the whole.
    expect(await built.read(1000, 300_000)).toEqual(car.subarray(1000, 300_000))
  })

  it('is deterministic, down to the CAR bytes', async () => {
    const a = await buildUpload(await plan(images), HOST, NAMING)
    const reversed = Object.fromEntries(Object.entries(images).reverse())
    const b = await buildUpload(await plan(reversed), HOST, NAMING)
    expect(b.metaCid).toBe(a.metaCid)
    expect(await bytesOf(await carBlob(b))).toEqual(await bytesOf(await carBlob(a)))
  })

  it('writes one CAR rooted at the images then the metadata, carrying every block once', async () => {
    const built = await buildUpload(await plan(images), HOST, NAMING)
    const iterator = await CarBlockIterator.fromBytes(await bytesOf(await carBlob(built)))
    expect((await iterator.getRoots()).map(String)).toEqual([built.imgCid, built.metaCid])
    const seen = new Set<string>()
    for await (const block of iterator) {
      expect(seen.has(block.cid.toString())).toBe(false)
      seen.add(block.cid.toString())
    }
    // 3 image leaves + 1 more for the chunked one + its file node + 2 directories + 3 JSON leaves.
    expect(seen.size).toBe(10)
  })

  it('writes the name pattern and description for pieces that came without metadata', async () => {
    const built = await buildUpload(await plan({ '1.png': png(1) }), HOST, {
      pattern: 'Sprite #{n}',
      description: 'A sprite.',
    })
    const metaDir = tempDir()
    writeFileSync(
      join(metaDir, '1'),
      JSON.stringify({
        name: 'Sprite #1',
        description: 'A sprite.',
        image: `${HOST}/ipfs/${built.imgCid}/1.png`,
      }),
    )
    expect((await packDirectory(metaDir)).root.toString()).toBe(built.metaCid)
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
    const hosted = [1, 2, 10].map((n) => ({
      name: String(n),
      json: `{"name":"Sprite #${n}","attributes":[{"trait_type":"Eyes","value":"Laser"}],"image":"${HOST}/ipfs/${imgCid}/${n}.png","animation_url":"https://elsewhere.example/${n}.mp4"}`,
    }))
    const dir = tempDir()
    for (const piece of hosted) {
      writeFileSync(join(dir, piece.name), migratedPieceJson(piece.json, imgCid))
    }
    expect(await migratedMetaCidOf(imgCid, hosted)).toBe((await packDirectory(dir)).root.toString())
  })
})
