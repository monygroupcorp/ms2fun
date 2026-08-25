/**
 * The CID is the release identity: the runbook's whole check is "build twice from one commit, get
 * one CID". These tests assert the packing half of that — the DAG parameters and the traversal
 * order are pinned, not inherited.
 *
 * The recorded-vector case is the one that would fail loudly if `UNIXFS_OPTIONS` were changed or
 * defaulted (a v0 CID, dag-pb leaves, no wrapping directory all produce a different root), which a
 * two-runs-agree check alone would happily pass.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { listFiles, packDirectory, writeCar } from './pack'

let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ipfs-dist-'))
  // A shape that exercises what the real build has: a root document, a nested asset directory, and
  // one file past the 256 KiB chunk boundary so the DAG is more than a flat list of leaves.
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>fixture</title>\n')
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'assets', 'app.css'), 'body{margin:0}\n')
  writeFileSync(join(dir, 'assets', 'big.bin'), Buffer.alloc(300_000, 7))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

test('lists files as sorted directory-relative paths', () => {
  expect(listFiles(dir)).toEqual(['assets/app.css', 'assets/big.bin', 'index.html'])
})

test('the same directory packs to the same root CID and the same block set', async () => {
  const first = await packDirectory(dir)
  const second = await packDirectory(dir)

  expect(second.root.toString()).toBe(first.root.toString())
  expect([...second.blocks.keys()].sort()).toEqual([...first.blocks.keys()].sort())
  expect(second.files).toEqual(first.files)
})

test('the root CID is the recorded UnixFS vector for this fixture', async () => {
  const { root } = await packDirectory(dir)
  // CIDv1, raw leaves, wrapped in a directory — `ipfs add -r --cid-version=1` parameters. A change
  // to UNIXFS_OPTIONS moves this value, which is the point: it is not free to change silently.
  expect(root.toString()).toBe('bafybeicfv4d4vw2cvjpdn3scshkchjauqayenajhwqc64tgno6fryfwfum')
  expect(root.version).toBe(1)
})

test('the CAR is byte-reproducible', async () => {
  // Written outside the packed directory — a CAR dropped next to the source would become part of
  // the next import and the comparison would be against a different DAG.
  const out = mkdtempSync(join(tmpdir(), 'ipfs-dist-car-'))
  try {
    const a = join(out, 'out-a.car')
    const b = join(out, 'out-b.car')

    await writeCar(await packDirectory(dir), a)
    await writeCar(await packDirectory(dir), b)

    expect(readFileSync(b).equals(readFileSync(a))).toBe(true)
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})
