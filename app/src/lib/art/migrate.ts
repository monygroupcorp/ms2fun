/**
 * The browser's half of moving hosted art to IPFS: the regenerated metadata root, the CAR a creator
 * pins, and the check that a public gateway can actually serve the result.
 *
 *   regenerate          imgCid + image names → the migrated metadata DAG (see `ipfsMigration.ts`)
 *   buildMigrationCar   the hosted images + that DAG, under one root, ready for any pinning service
 *   checkRetrievable    a sample of both roots fetched from the public roster, never from our host
 *
 * Nothing here talks to a pinning service or holds a credential. The creator takes the CAR to the
 * service of their choice; the platform does not pin into an account of its own.
 */
import { CarReader } from '@ipld/car'
import * as dagPb from '@ipld/dag-pb'
import { CID } from 'multiformats/cid'
import { sha256 } from 'multiformats/hashes/sha2'

import { IPFS_GATEWAYS, gatewayUrl, type IpfsGateway } from '../metadata/gateways'
import { migratedPieceJson, migrationFiles, pieceOfImageName, samplePieces } from './ipfsMigration'
import { importFiles, writeCarChunks, type ImportedDag } from './unixfs'

/** The migrated metadata DAG for a hosted upload. */
export async function regenerate(
  imgCid: string,
  imageNames: readonly string[],
): Promise<ImportedDag & { metaCid: string }> {
  const dag = await importFiles(migrationFiles(imgCid, imageNames))
  return { ...dag, metaCid: dag.root.toString() }
}

/** Just the migrated metadata root — what the "verified on IPFS" check compares the chain with. */
export async function migratedMetaCidOf(
  imgCid: string,
  imageNames: readonly string[],
): Promise<string> {
  return (await regenerate(imgCid, imageNames)).metaCid
}

/** UnixFS `Data` for a plain directory: `{ Type: Directory }`, protobuf-encoded. */
const UNIXFS_DIRECTORY = new Uint8Array([0x08, 0x01])

/** Every block reachable from `root` in `blocks`, each once. */
function reachable(root: CID, blocks: ReadonlyMap<string, Uint8Array>): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>()
  const visit = (cid: CID) => {
    const key = cid.toString()
    if (out.has(key)) return
    const bytes = blocks.get(key)
    if (bytes === undefined) throw new Error(`the hosted CAR is missing block ${key}`)
    out.set(key, bytes)
    if (cid.code === dagPb.code) for (const link of dagPb.decode(bytes).Links) visit(link.Hash)
  }
  visit(root)
  return out
}

const sizeOf = (blocks: ReadonlyMap<string, Uint8Array>) =>
  [...blocks.values()].reduce((n, b) => n + b.byteLength, 0)

export interface MigrationCar {
  /** The one root the CAR carries: a directory holding `images` and `metadata`. Pin this. */
  rootCid: string
  imgCid: string
  /** The migrated metadata root. The collection's new base is `ipfs://<metaCid>/`. */
  metaCid: string
  car: Blob
}

export type MigrationStage = 'downloading' | 'verifying' | 'regenerating' | 'packing'

/**
 * Build the CAR a creator pins: the hosted images, byte for byte, and the regenerated metadata.
 *
 * The images come from the art host's copy of the upload (`/car/<imgCid>`), and every block is
 * hashed against its CID here before it goes in, so a host that served the wrong bytes produces an
 * error rather than a CAR whose images root is not the one on chain.
 *
 * ONE ROOT, a directory with two entries (`images`, `metadata`). Some pinning services pin only a
 * CAR's first root; under one root, pinning it pins both, and each is still fetchable by its own
 * CID on any gateway.
 */
export async function buildMigrationCar(
  host: string,
  imgCid: string,
  imageNames: readonly string[],
  onStage?: (stage: MigrationStage) => void,
  fetcher: typeof fetch = fetch,
): Promise<MigrationCar> {
  onStage?.('downloading')
  const res = await fetcher(`${host}/car/${imgCid}`)
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? 'the art host no longer has this upload — use the CAR you downloaded at upload time'
        : `the art host answered ${res.status}`,
    )
  }
  const reader = await CarReader.fromBytes(new Uint8Array(await res.arrayBuffer()))

  onStage?.('verifying')
  const hosted = new Map<string, Uint8Array>()
  for await (const block of reader.blocks()) {
    if (block.cid.multihash.code !== sha256.code) {
      throw new Error(`block ${block.cid.toString()} is not hashed with sha-256`)
    }
    const digest = await sha256.digest(block.bytes)
    if (!equalBytes(digest.digest, block.cid.multihash.digest)) {
      throw new Error(`block ${block.cid.toString()} does not match its CID`)
    }
    hosted.set(block.cid.toString(), block.bytes)
  }
  const images = CID.parse(imgCid)
  const imageBlocks = reachable(images, hosted)

  onStage?.('regenerating')
  const meta = await regenerate(imgCid, imageNames)

  onStage?.('packing')
  const wrapper = dagPb.encode(
    dagPb.prepare({
      Data: UNIXFS_DIRECTORY,
      Links: [
        { Name: 'images', Hash: images, Tsize: sizeOf(imageBlocks) },
        { Name: 'metadata', Hash: meta.root, Tsize: sizeOf(meta.blocks) },
      ],
    }),
  )
  const root = CID.createV1(dagPb.code, await sha256.digest(wrapper))
  const blocks = new Map([...imageBlocks, ...meta.blocks, [root.toString(), wrapper]])
  const parts: Uint8Array[] = []
  await writeCarChunks([root], blocks, (chunk) => void parts.push(chunk), 'dag')
  return {
    rootCid: root.toString(),
    imgCid,
    metaCid: meta.metaCid,
    car: new Blob(parts as BlobPart[], { type: 'application/vnd.ipld.car' }),
  }
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.byteLength === b.byteLength && a.every((byte, i) => byte === b[i])
}

export interface RetrievalResult {
  ok: boolean
  /** The gateway operator that served every sample, when one did. */
  operator: string | null
  /** One line per gateway that did not, saying which file failed and how. */
  problems: string[]
}

/**
 * Ask public gateways — the app's own roster, never the art host — for a sample of the migrated
 * art: each sampled piece's regenerated JSON, compared byte for byte, and its image, of which only
 * the response headers are read.
 *
 * Passing means somebody other than us is serving both roots right now, which is the one fact that
 * makes pointing the collection at them safe. One gateway answering every sample is enough; they
 * are tried in roster order, one at a time, for the same metering reason as everywhere else.
 */
export async function checkRetrievable(
  imgCid: string,
  metaCid: string,
  imageNames: readonly string[],
  options: {
    gateways?: readonly IpfsGateway[]
    fetcher?: typeof fetch
    timeoutMs?: number
  } = {},
): Promise<RetrievalResult> {
  const gateways = options.gateways ?? IPFS_GATEWAYS
  const fetcher = options.fetcher ?? fetch
  const timeoutMs = options.timeoutMs ?? 20_000
  const pieces = samplePieces(
    imageNames
      .map((name) => ({ name, piece: pieceOfImageName(name) }))
      .filter((p): p is { name: string; piece: number } => p.piece !== null)
      .sort((a, b) => a.piece - b.piece),
  )
  const problems: string[] = []
  for (const gateway of gateways) {
    const problem = await firstFailure(gateway, imgCid, metaCid, pieces, fetcher, timeoutMs)
    if (problem === null) return { ok: true, operator: gateway.operator, problems }
    problems.push(`${gateway.operator}: ${problem}`)
  }
  return { ok: false, operator: null, problems }
}

async function firstFailure(
  gateway: IpfsGateway,
  imgCid: string,
  metaCid: string,
  pieces: ReadonlyArray<{ name: string; piece: number }>,
  fetcher: typeof fetch,
  timeoutMs: number,
): Promise<string | null> {
  for (const { name, piece } of pieces) {
    const jsonUrl = gatewayUrl(gateway, `${metaCid}/${piece}`)
    const imageUrl = gatewayUrl(gateway, `${imgCid}/${name}`)
    if (jsonUrl === null || imageUrl === null) return 'cannot address these CIDs'
    try {
      const json = await fetcher(jsonUrl, { signal: AbortSignal.timeout(timeoutMs) })
      if (!json.ok) return `metadata #${piece} answered ${json.status}`
      const text = await json.text()
      if (text !== migratedPieceJson(piece, imgCid, name)) {
        return `metadata #${piece} is not the regenerated JSON`
      }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const image = await fetcher(imageUrl, { signal: controller.signal })
        if (!image.ok) return `image ${name} answered ${image.status}`
      } finally {
        // Only the status was wanted; stop the image body rather than download it.
        controller.abort()
        clearTimeout(timer)
      }
    } catch {
      return `no answer for piece #${piece}`
    }
  }
  return null
}
