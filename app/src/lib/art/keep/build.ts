/**
 * The CAR a holder keeps: built in this browser, every block checked against its CID, and every
 * root it names checked against the chain before anything is handed to a node or a download.
 *
 * WHY THE BROWSER RE-CHECKS EVERYTHING. A pin is a promise somebody makes with their own disk, about
 * the content a collection names on chain. Neither the art host nor a public gateway is trusted for
 * that: a block whose bytes do not hash to its CID is refused, a root the chain does not name is
 * refused, and a DAG with a block missing is refused, so a tampered or partial CAR never reaches a
 * holder's node. The art host is used only because it is fast and has the bytes; the chain and the
 * hashes decide what the bytes are.
 *
 * WHICH ROOTS (see `plan.ts`):
 *   hosted     images + the hosted metadata on chain now, + the metadata a move to IPFS will name
 *              (regenerated here from the hosted metadata — a few kilobytes per piece), so a copy
 *              kept today already serves the collection after its creator moves it
 *   migrated   images + the regenerated metadata on chain: the IPFS version, not the hosted one
 *   ipfs       the metadata on chain + the one images root its pieces name, when there is one
 *
 * Every root is a root of the CAR's header, so `dag import --pin-roots` pins each by its own CID and
 * `pin ls` can confirm exactly the CIDs the collection names.
 *
 * STREAMED, like `buildMigrationCar`: image blocks pass through verification into Blobs the browser
 * may keep on disk, and only directory nodes and metadata are held in memory.
 */
import { CarBlockIterator } from '@ipld/car'
import * as dagPb from '@ipld/dag-pb'
import { CID } from 'multiformats/cid'

import { IPFS_GATEWAYS, gatewayUrl, type IpfsGateway } from '../../metadata/gateways'
import {
  bodyChunks,
  fileBytes,
  hostedPieces,
  listDirectory,
  regenerate,
  verified,
  type Regenerated,
} from '../migrate'
import { carHeader, carSection, dagOrder } from '../unixfs'
import { imageRootOf, type KeepPlan, type KeepRoot } from './plan'
import { independentGateways, withQuery } from './retrievable'

const RAW = 0x55
/** Bytes gathered before they are handed to a Blob, which the browser may keep out of memory. */
const FLUSH_BYTES = 32 * 1024 * 1024
/** A collection's metadata is held in memory to be read; more than this is not a collection's. */
const MAX_METADATA_BYTES = 256 * 1024 * 1024

export type KeepStage = 'metadata' | 'images' | 'packing'

export interface KeepProgress {
  stage: KeepStage
  /** Bytes received so far in this stage. */
  bytes: number
  /** Where the bytes are coming from: the art host's hostname or a gateway operator. */
  source: string
}

export interface KeepCar {
  car: Blob
  /** The CAR's header roots, in order: every one is pinned. */
  roots: KeepRoot[]
  /** Where the bytes came from. */
  source: string
}

/** A refusal worth showing as is: the CAR did not prove what it had to. */
export class KeepCarError extends Error {}

/** Collects CAR sections into Blobs, flushing as it goes. */
class Sections {
  readonly parts: BlobPart[] = []
  private pending: Uint8Array[] = []
  private pendingBytes = 0
  readonly written = new Set<string>()

  add(cid: CID, bytes: Uint8Array): void {
    const key = cid.toString()
    if (this.written.has(key)) return
    this.written.add(key)
    for (const chunk of carSection(cid, bytes)) {
      this.pending.push(chunk)
      this.pendingBytes += chunk.byteLength
    }
    if (this.pendingBytes >= FLUSH_BYTES) this.flush()
  }

  flush(): void {
    if (this.pending.length === 0) return
    this.parts.push(new Blob(this.pending as BlobPart[]))
    this.pending = []
    this.pendingBytes = 0
  }

  async car(roots: readonly CID[]): Promise<Blob> {
    this.flush()
    return new Blob([(await carHeader(roots)) as BlobPart, ...this.parts], {
      type: 'application/vnd.ipld.car',
    })
  }
}

/** What a verified stream of blocks proved: each block's links, and the bytes of the ones kept. */
interface Received {
  links: Map<string, CID[]>
  kept: Map<string, Uint8Array>
}

/**
 * Read a CAR stream, verify every block, and write the ones not in `skip` to `out`.
 *
 * Codecs are limited to UnixFS (dag-pb and raw) and hashes to sha-256, which is every collection
 * this app can render; anything else is refused rather than passed through unread. `keep` names
 * blocks whose bytes are also returned (the metadata, which has to be read).
 */
async function receive(
  chunks: AsyncIterable<Uint8Array>,
  out: Sections,
  options: {
    skip?: ReadonlySet<string> | undefined
    keepAll?: boolean
    onBytes?: (bytes: number) => void
  } = {},
): Promise<Received> {
  const links = new Map<string, CID[]>()
  const kept = new Map<string, Uint8Array>()
  let bytes = 0
  let keptBytes = 0
  const iterator = await CarBlockIterator.fromIterable(chunks)
  for await (const block of iterator) {
    const key = block.cid.toString()
    if (options.skip?.has(key) || links.has(key)) continue
    if (block.cid.code !== dagPb.code && block.cid.code !== RAW) {
      throw new KeepCarError(`block ${key} is not UnixFS`)
    }
    try {
      await verified(block.cid, block.bytes)
    } catch (error) {
      throw new KeepCarError(error instanceof Error ? error.message : `block ${key} is not valid`)
    }
    links.set(
      key,
      block.cid.code === dagPb.code ? dagPb.decode(block.bytes).Links.map((l) => l.Hash) : [],
    )
    if (options.keepAll) {
      keptBytes += block.bytes.byteLength
      if (keptBytes > MAX_METADATA_BYTES) throw new KeepCarError('the metadata is too large')
      kept.set(key, block.bytes)
    }
    out.add(block.cid, block.bytes)
    bytes += block.bytes.byteLength
    options.onBytes?.(bytes)
  }
  return { links, kept }
}

/** Every block reachable from `root` must have arrived. Returns the set reached. */
function complete(root: CID, links: ReadonlyMap<string, CID[]>): Set<string> {
  const reached = new Set<string>()
  const stack = [root]
  while (stack.length > 0) {
    const cid = stack.pop()!
    const key = cid.toString()
    if (reached.has(key)) continue
    const children = links.get(key)
    if (children === undefined) {
      throw new KeepCarError(`the CAR is missing block ${key} of ${root.toString()}`)
    }
    reached.add(key)
    stack.push(...children)
  }
  return reached
}

function hostName(host: string): string {
  try {
    return new URL(host).host
  } catch {
    return host
  }
}

async function hostCar(host: string, cid: string, fetcher: typeof fetch): Promise<Response> {
  const res = await fetcher(`${host}/car/${cid}`)
  if (!res.ok) throw new KeepCarError(`the art host answered ${res.status} for ${cid}`)
  return res
}

/**
 * A root's CAR from the public roster: `?format=car`, the trustless-gateway response, tried on one
 * gateway after another until one streams a CAR that verifies in full.
 */
async function rosterCar(
  root: CID,
  gateways: readonly IpfsGateway[],
  fetcher: typeof fetch,
  read: (res: Response, source: string) => Promise<void>,
): Promise<string> {
  const problems: string[] = []
  for (const gateway of gateways) {
    const url = withQuery(gatewayUrl(gateway, root.toString()), 'format=car&dag-scope=all')
    if (url === null) continue
    try {
      const res = await fetcher(url, { headers: { Accept: 'application/vnd.ipld.car' } })
      if (!res.ok) {
        problems.push(`${gateway.operator} answered ${res.status}`)
        continue
      }
      await read(res, gateway.operator)
      return gateway.operator
    } catch (error) {
      if (error instanceof KeepCarError) problems.push(`${gateway.operator}: ${error.message}`)
      else problems.push(`${gateway.operator} did not answer`)
    }
  }
  throw new KeepCarError(
    `no public gateway served ${root.toString()} in full${problems.length > 0 ? ` (${problems.join('; ')})` : ''}`,
  )
}

/** The pieces' JSON under a verified metadata root, by name. */
function readPieces(
  metaCid: CID,
  blocks: ReadonlyMap<string, Uint8Array>,
): { name: string; json: string }[] {
  const decoder = new TextDecoder()
  let entries: Map<string, CID>
  try {
    entries = listDirectory(metaCid, blocks)
  } catch (error) {
    throw new KeepCarError(error instanceof Error ? error.message : 'the metadata is not a folder')
  }
  return [...entries].map(([name, cid]) => ({
    name,
    json: decoder.decode(fileBytes(cid, blocks)),
  }))
}

/**
 * The one images root every piece's `image` names, or null when they name none or several (images
 * pinned one CID each, or hosted somewhere that is not IPFS): then only the metadata is kept.
 */
export function sharedImageRoot(pieces: readonly { json: string }[]): string | null {
  const roots = new Set<string>()
  for (const { json } of pieces) {
    let image: unknown
    try {
      image = (JSON.parse(json) as { image?: unknown }).image
    } catch {
      return null
    }
    const root = imageRootOf(image)
    if (root === null) return null
    roots.add(root.cid)
    if (roots.size > 1) return null
  }
  return roots.size === 1 ? [...roots][0]! : null
}

function addDag(out: Sections, dag: Regenerated): void {
  for (const key of dagOrder([dag.root], dag.blocks)) out.add(CID.parse(key), dag.blocks.get(key)!)
}

export interface BuildOptions {
  fetcher?: typeof fetch
  /** Public gateways to rebuild from. Defaults to the roster, minus our own origins. */
  gateways?: readonly IpfsGateway[]
  onProgress?: (progress: KeepProgress) => void
}

/** From the art host: a hosted collection, or a migrated one whose upload the host still holds. */
async function fromHost(plan: KeepPlan, host: string, options: BuildOptions): Promise<KeepCar> {
  const fetcher = options.fetcher ?? fetch
  const source = hostName(host)
  const report = (stage: KeepStage, bytes: number) => options.onProgress?.({ stage, bytes, source })

  // The hosted metadata, verified under its root. For a hosted collection that root is the one on
  // chain; for a migrated one it is the host's record, and the regenerated root must then equal
  // the one on chain, which is the check that makes the record irrelevant to trust.
  const hostedRoot = plan.kind === 'hosted' ? plan.metaCid : plan.hostedMetaCid
  if (hostedRoot === null) throw new KeepCarError('the art host has no record of this collection')
  report('metadata', 0)
  let hosted: Awaited<ReturnType<typeof hostedPieces>>
  try {
    hosted = await hostedPieces(host, hostedRoot, fetcher)
  } catch (error) {
    throw new KeepCarError(
      error instanceof Error ? error.message : 'the hosted metadata is invalid',
    )
  }
  const imgCid = sharedImageRoot(hosted.pieces)
  if (imgCid === null) throw new KeepCarError('the hosted metadata does not name one images root')
  let next: Regenerated
  try {
    next = await regenerate(imgCid, hosted.pieces)
  } catch (error) {
    throw new KeepCarError(error instanceof Error ? error.message : 'the metadata did not rebuild')
  }
  if (plan.kind === 'migrated' && next.metaCid !== plan.metaCid) {
    throw new KeepCarError(
      `the hosted metadata rebuilds to ${next.metaCid}, not ${plan.metaCid} — the root on chain`,
    )
  }

  // The upload as it arrived: images and hosted metadata. For a migrated collection the hosted
  // metadata is left out — it is not what the chain names any more.
  const out = new Sections()
  report('images', 0)
  const res = await hostCar(host, imgCid, fetcher)
  const { links } = await receive(bodyChunks(res), out, {
    skip: plan.kind === 'migrated' ? hosted.cids : undefined,
    onBytes: (bytes) => report('images', bytes),
  })
  const images = CID.parse(imgCid)
  const reached = complete(images, links)
  if (plan.kind === 'hosted') {
    for (const key of complete(CID.parse(plan.metaCid), links)) reached.add(key)
  }
  if (reached.size !== links.size) {
    throw new KeepCarError('the CAR carries blocks that are not part of this collection')
  }

  report('packing', 0)
  addDag(out, next)
  const roots: KeepRoot[] =
    plan.kind === 'hosted'
      ? [
          { role: 'images', cid: imgCid },
          { role: 'metadata', cid: plan.metaCid },
          { role: 'next-metadata', cid: next.metaCid },
        ]
      : [
          { role: 'images', cid: imgCid },
          { role: 'metadata', cid: plan.metaCid },
        ]
  return { car: await out.car(roots.map((r) => CID.parse(r.cid))), roots, source }
}

/** From the public roster: any content-addressed collection that is retrievable on IPFS. */
async function fromRoster(plan: KeepPlan, options: BuildOptions): Promise<KeepCar> {
  const fetcher = options.fetcher ?? fetch
  const gateways = options.gateways ?? independentGateways([plan.host], IPFS_GATEWAYS)
  const out = new Sections()
  const meta = CID.parse(plan.metaCid)

  let metaBlocks: Map<string, Uint8Array> = new Map()
  const metaSource = await rosterCar(meta, gateways, fetcher, async (res, source) => {
    const attempt = new Sections()
    const { links, kept } = await receive(bodyChunks(res), attempt, {
      keepAll: true,
      onBytes: (bytes) => options.onProgress?.({ stage: 'metadata', bytes, source }),
    })
    complete(meta, links)
    metaBlocks = kept
    for (const [key, bytes] of kept) out.add(CID.parse(key), bytes)
  })
  const pieces = readPieces(meta, metaBlocks)
  const imgCid = sharedImageRoot(pieces)

  if (imgCid === null) {
    // Images that are not under one IPFS root: the metadata is what can be kept.
    options.onProgress?.({ stage: 'packing', bytes: 0, source: metaSource })
    return {
      car: await out.car([meta]),
      roots: [{ role: 'metadata', cid: plan.metaCid }],
      source: metaSource,
    }
  }

  // Image blocks stream straight through, after the metadata; an attempt that fails partway is
  // discarded whole and the next gateway starts again.
  const images = CID.parse(imgCid)
  const metaKeys = new Set(out.written)
  let imageParts: BlobPart[] = []
  const source = await rosterCar(images, gateways, fetcher, async (res, from) => {
    const attempt = new Sections()
    const { links } = await receive(bodyChunks(res), attempt, {
      skip: metaKeys,
      onBytes: (bytes) => options.onProgress?.({ stage: 'images', bytes, source: from }),
    })
    // A block shared with the metadata (an identical file) was skipped here but is carried.
    for (const key of metaKeys) if (!links.has(key)) links.set(key, linksOf(key, metaBlocks))
    complete(images, links)
    attempt.flush()
    imageParts = attempt.parts
  })
  options.onProgress?.({ stage: 'packing', bytes: 0, source })
  const roots: KeepRoot[] = [
    { role: 'images', cid: imgCid },
    { role: 'metadata', cid: plan.metaCid },
  ]
  out.flush()
  const header = await carHeader(roots.map((r) => CID.parse(r.cid)))
  return {
    car: new Blob([header as BlobPart, ...out.parts, ...imageParts], {
      type: 'application/vnd.ipld.car',
    }),
    roots,
    source,
  }
}

function linksOf(key: string, blocks: ReadonlyMap<string, Uint8Array>): CID[] {
  const cid = CID.parse(key)
  const bytes = blocks.get(key)
  if (bytes === undefined || cid.code !== dagPb.code) return []
  return dagPb.decode(bytes).Links.map((l) => l.Hash)
}

/**
 * Build the CAR for a plan. The art host first, for a plan that has one; the public roster when it
 * has none, no longer has the upload, or served something that did not verify.
 */
export async function buildKeepCar(plan: KeepPlan, options: BuildOptions = {}): Promise<KeepCar> {
  if (plan.host !== null && plan.kind !== 'ipfs') {
    try {
      return await fromHost(plan, plan.host, options)
    } catch (error) {
      // A hosted collection is on IPFS only if somebody pinned it; try the roster, and if that
      // fails too, say what the host said, which is the more useful of the two.
      try {
        return await fromRoster(plan, options)
      } catch {
        throw error
      }
    }
  }
  return fromRoster(plan, options)
}

/**
 * A CAR's verified roots, re-read from the Blob that will be sent: the header must name exactly
 * the roots the builder proved. The last check before a holder's node or disk sees anything.
 */
export async function carRoots(car: Blob): Promise<string[]> {
  const head = new Uint8Array(await car.slice(0, 4096).arrayBuffer())
  const reader = await CarBlockIterator.fromIterable(
    (async function* () {
      yield head
    })(),
  )
  return (await reader.getRoots()).map((root) => root.toString())
}

/**
 * The last check before a CAR leaves the builder: its header names exactly the roots the builder
 * proved, in order, and those include the metadata root the chain names. Re-read from the Blob
 * itself, so what is checked is what will be sent.
 */
export async function checkKeepCar(keep: KeepCar, plan: KeepPlan): Promise<void> {
  const header = await carRoots(keep.car)
  const proved = keep.roots.map((root) => root.cid)
  if (header.length !== proved.length || header.some((cid, i) => cid !== proved[i])) {
    throw new KeepCarError('the CAR header does not name the roots that were checked')
  }
  if (!keep.roots.some((root) => root.role === 'metadata' && root.cid === plan.metaCid)) {
    throw new KeepCarError('the CAR does not carry the metadata root on chain')
  }
}
