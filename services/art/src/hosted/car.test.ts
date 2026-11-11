/**
 * The verifier is the whole trust model of hosting: bytes are served under a CID only because they
 * were checked against it. So every way an upload can lie is tried here, and every one must be
 * refused — and an honest upload must come back out byte for byte.
 */
import { describe, expect, it } from 'vitest'

import { CarRejected, CarVerifier, indexCar, readVarint, verifyingStream } from './car'
import { readHostedFile, spansOf } from './store'
import { buildUpload, chunked, memoryBucket, png, writeCar, dagOrder } from './testing'

async function verify(car: Uint8Array, chunkSize = 4096) {
  const verifier = new CarVerifier()
  const reader = chunked(car, chunkSize).getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    await verifier.push(value)
  }
  return verifier.finish()
}

async function rejection(work: () => Promise<unknown>): Promise<string> {
  try {
    await work()
  } catch (error) {
    expect(error).toBeInstanceOf(CarRejected)
    return (error as Error).message
  }
  throw new Error('expected a refusal')
}

const PIECES = [
  { name: '1.png', bytes: png(1) },
  { name: '2.png', bytes: png(2) },
  { name: '3.png', bytes: png(3, 600_000) }, // past the 256 KiB chunk size: a multi-leaf file
]

describe('an honest upload', () => {
  it('verifies, indexes both roots, and reads every file back byte for byte', async () => {
    const upload = await buildUpload(PIECES)
    // Tiny chunks, so headers, CIDs and blocks all straddle chunk boundaries.
    const car = await verify(upload.car, 7)
    const { images, metadata } = indexCar(car)

    expect(images.root).toBe(upload.imgCid)
    expect(metadata.root).toBe(upload.metaCid)
    expect(Object.keys(images.files).sort()).toEqual(['1.png', '2.png', '3.png'])
    expect(Object.keys(metadata.files).sort()).toEqual(['1', '2', '3'])
    expect(images.files['3.png']!.ranges.length).toBeGreaterThan(1)
    expect(images.files['1.png']!.type).toBe('image/png')
    expect(metadata.files['1']!.type).toMatch(/^application\/json/)

    const bucket = memoryBucket()
    await bucket.put('car', upload.car)
    for (const piece of PIECES) {
      const index = { ...images, car: 'car' }
      const bytes = await readHostedFile(bucket as never, index, images.files[piece.name]!)
      expect(bytes).toEqual(piece.bytes)
    }
    const json = await readHostedFile(
      bucket as never,
      { ...metadata, car: 'car' },
      metadata.files['1']!,
    )
    expect(JSON.parse(new TextDecoder().decode(json!))).toEqual({
      name: '#1',
      image: `https://art.example/ipfs/${upload.imgCid}/1.png`,
    })
  })

  it('reads a chunked file in ONE ranged read when the CAR is in DAG order', async () => {
    const upload = await buildUpload(PIECES)
    const { images } = indexCar(await verify(upload.car))
    expect(spansOf(images.files['3.png']!.ranges)).toHaveLength(1)
  })

  it('still reads correctly when the CAR is in CID order, one read per chunk', async () => {
    const upload = await buildUpload(PIECES, { order: 'cid' })
    const { images } = indexCar(await verify(upload.car))
    const bucket = memoryBucket()
    await bucket.put('car', upload.car)
    const bytes = await readHostedFile(
      bucket as never,
      { ...images, car: 'car' },
      images.files['3.png']!,
    )
    expect(bytes).toEqual(PIECES[2]!.bytes)
  })

  it('walks a sharded (HAMT) directory, the shape a large collection imports as', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ name: `${i + 1}.png`, bytes: png(i) }))
    const upload = await buildUpload(many, { shardSplitThresholdBytes: 256 })
    const { images, metadata } = indexCar(await verify(upload.car))
    expect(Object.keys(images.files)).toHaveLength(40)
    expect(Object.keys(metadata.files)).toHaveLength(40)
  })

  it('passes the bytes through untouched as a stream', async () => {
    const upload = await buildUpload(PIECES)
    const { stream, result } = verifyingStream()
    const out = await new Response(chunked(upload.car, 1000).pipeThrough(stream)).arrayBuffer()
    expect(new Uint8Array(out)).toEqual(upload.car)
    expect((await result).roots.map(String)).toEqual([upload.imgCid, upload.metaCid])
  })
})

describe('a dishonest upload', () => {
  it('is refused when one byte of one block differs from its CID', async () => {
    const upload = await buildUpload(PIECES)
    const tampered = upload.car.slice()
    tampered[tampered.byteLength - 3]! ^= 0xff
    expect(await rejection(() => verify(tampered))).toMatch(/does not match its bytes/)
  })

  it('errors the stream, so the storage write it feeds fails', async () => {
    const upload = await buildUpload(PIECES)
    const tampered = upload.car.slice()
    tampered[tampered.byteLength - 3]! ^= 0xff
    const { stream, refusal } = verifyingStream()
    await expect(
      new Response(chunked(tampered, 1000).pipeThrough(stream)).arrayBuffer(),
    ).rejects.toBeTruthy()
    expect(refusal()?.message).toMatch(/does not match/)
  })

  it('is refused when a root names a block the CAR does not carry', async () => {
    const upload = await buildUpload(PIECES)
    const roots = [upload.images.root, upload.metadata.root]
    const blocks = new Map([...upload.images.blocks, ...upload.metadata.blocks])
    const keys = dagOrder(roots, blocks).filter((_, i) => i !== 0)
    const car = await writeCar(
      roots,
      keys.map((k) => [k, blocks.get(k)!]),
    )
    expect(await rejection(async () => indexCar(await verify(car)))).toMatch(/not carried/)
  })

  it('is refused when it carries a block neither root names', async () => {
    const upload = await buildUpload(PIECES)
    const stray = await buildUpload([{ name: '9.png', bytes: png(99) }])
    const roots = [upload.images.root, upload.metadata.root]
    const blocks = new Map([
      ...upload.images.blocks,
      ...upload.metadata.blocks,
      ...stray.images.blocks,
    ])
    const car = await writeCar(roots, [...blocks.entries()])
    expect(await rejection(async () => indexCar(await verify(car)))).toMatch(
      /not part of either root/,
    )
  })

  it('is refused when an image is not the format its name says', async () => {
    const html = new TextEncoder().encode('<!doctype html><script>alert(1)</script>')
    const upload = await buildUpload([{ name: '1.png', bytes: html }])
    expect(await rejection(async () => indexCar(await verify(upload.car)))).toMatch(
      /not the image format/,
    )
  })

  it('is refused for a format hosting does not accept, SVG included', async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')
    const upload = await buildUpload([{ name: '1.svg', bytes: svg }])
    expect(await rejection(async () => indexCar(await verify(upload.car)))).toMatch(
      /not an accepted image name/,
    )
  })

  it('is refused with any number of roots but two', async () => {
    const upload = await buildUpload(PIECES)
    const blocks = [...upload.images.blocks.entries()]
    const car = await writeCar([upload.images.root], blocks)
    expect(await rejection(async () => indexCar(await verify(car)))).toMatch(/exactly two roots/)
  })

  it('is refused when it ends partway through a block', async () => {
    const upload = await buildUpload(PIECES)
    expect(
      await rejection(() => verify(upload.car.subarray(0, upload.car.byteLength - 5))),
    ).toMatch(/ends partway/)
  })

  it('is refused when a length prefix claims an absurd section', async () => {
    expect(await rejection(() => verify(new Uint8Array([0xff, 0xff, 0xff, 0x7f, 0, 0])))).toMatch(
      /out of bounds/,
    )
  })

  it('can be refused by its roots before the rest is read', async () => {
    const upload = await buildUpload(PIECES)
    const verifier = new CarVerifier((roots) => {
      if (roots[0]!.toString() === upload.imgCid) throw new CarRejected('denied')
    })
    expect(await rejection(() => verifier.push(upload.car.subarray(0, 120)))).toBe('denied')
  })
})

describe('varints', () => {
  it('reads multi-byte lengths and waits for incomplete ones', () => {
    expect(readVarint(new Uint8Array([0xac, 0x02]))).toEqual([300, 2])
    expect(readVarint(new Uint8Array([0xac]))).toBeNull()
  })
})
