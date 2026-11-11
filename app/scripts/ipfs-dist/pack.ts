/**
 * UnixFS packaging for the IPFS distribution build (noesis-409).
 *
 * Turns the emitted `dist/ipfs/` directory into (a) a root CID and (b) a CAR file carrying every
 * block under it, so the release can be handed to a pinning node in one request and the CID can be
 * written to the noesis.gwei.domains `contenthash` record. See `RUNBOOK.md` beside this file.
 *
 * No daemon is required to produce either: the DAG is built in-process by the shared UnixFS core in
 * `src/lib/art/unixfs.ts`, the same code the wizard uses to pack a creator's art in the browser, so
 * the two can never disagree about import parameters.
 *
 * Determinism is the property that matters here — the CID is the release identity, so the same
 * commit must produce the same CID or the runbook cannot be checked by re-running it. Three things
 * secure that: the file list is sorted before import, the UnixFS parameters are pinned explicitly
 * rather than inherited from a library default, and the CAR blocks are emitted in CID order.
 * Everything upstream of that is vite's own output, which is a pure function of the source plus the
 * `__BUILD_COMMIT__` define.
 */
import { createWriteStream, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import type { CID } from 'multiformats/cid'
import { importFiles, writeCarChunks } from '../../src/lib/art/unixfs'

export { UNIXFS_OPTIONS } from '../../src/lib/art/unixfs'

export interface PackedDirectory {
  /** Root CID of the wrapping directory — the value the contenthash record carries. */
  root: CID
  /** Every block in the DAG, keyed by CID string. */
  blocks: Map<string, Uint8Array>
  /** Directory-relative file paths, sorted, as imported. */
  files: string[]
  /** Total bytes of the imported files (not of the CAR). */
  bytes: number
}

/** Every file under `dir`, as directory-relative POSIX paths, sorted. Sorted because import order
 * is an input to the DAG shape, and `readdir` order is a filesystem property, not a repo one. */
export function listFiles(dir: string): string[] {
  const walk = (current: string): string[] =>
    readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
      const full = join(current, entry.name)
      if (entry.isDirectory()) return walk(full)
      if (!entry.isFile()) return []
      return [relative(dir, full).split('\\').join('/')]
    })
  return walk(dir).sort()
}

/** Build the UnixFS DAG for a directory and return its root CID plus every block. */
export async function packDirectory(dir: string): Promise<PackedDirectory> {
  const files = listFiles(dir)
  if (files.length === 0) throw new Error(`nothing to pack: ${dir} is empty or missing`)

  // `new Uint8Array(...)` rather than the `Buffer` node hands back: the importer validates chunks
  // with `instanceof Uint8Array`, and under a jsdom test realm a node `Buffer` fails that check.
  const source = files.map((path) => ({
    path,
    content: new Uint8Array(readFileSync(join(dir, path))),
  }))
  const bytes = source.reduce((total, entry) => total + entry.content.byteLength, 0)
  const { root, blocks } = await importFiles(source)

  return { root, blocks, files, bytes }
}

/** Write a CAR file carrying the whole DAG, rooted at `packed.root`. Blocks go in CID order so the
 * CAR itself is byte-reproducible, not merely CID-reproducible. */
export async function writeCar(packed: PackedDirectory, carPath: string): Promise<number> {
  mkdirSync(dirname(carPath), { recursive: true })
  const sink = createWriteStream(carPath)

  await writeCarChunks([packed.root], packed.blocks, async (chunk) => {
    if (!sink.write(chunk)) {
      await new Promise((done) => sink.once('drain', done))
    }
  })
  await new Promise<void>((done, fail) => {
    sink.once('error', fail)
    sink.end(done)
  })

  return statSync(carPath).size
}

const DIST_DIR = resolve(import.meta.dirname, '..', '..', 'dist', 'ipfs')
const CAR_PATH = resolve(import.meta.dirname, '..', '..', 'dist', 'ipfs.car')

async function main(): Promise<void> {
  const packed = await packDirectory(DIST_DIR)
  const carBytes = await writeCar(packed, CAR_PATH)

  console.log(
    `ipfs-dist: packed ${packed.files.length} files (${packed.bytes} bytes) from ${DIST_DIR}`,
  )
  console.log(`ipfs-dist: car    ${CAR_PATH} (${carBytes} bytes, ${packed.blocks.size} blocks)`)
  console.log(`ipfs-dist: root   ${packed.root.toString()}`)
  console.log(
    'ipfs-dist: next   see scripts/ipfs-dist/RUNBOOK.md — pin the CAR, then set the contenthash',
  )
}

// Only run the publish flow when invoked directly; the module is also imported by its test.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch((error: unknown) => {
    console.error('ipfs-dist: FAILED —', error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
