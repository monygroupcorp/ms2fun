/**
 * What "keeping a collection alive" pins, worked out from the collection's on-chain base.
 *
 * The chain is the trust anchor. The per-token base a collection writes on chain names its metadata
 * root, either as `ipfs://<cid>/` or gateway-shaped (`https://<any host>/ipfs/<cid>/`); everything
 * else — the images root, the art host's record — is a lead that the CAR builder checks against
 * content-addressed bytes before anything is pinned. So a plan is cheap and synchronous, and holds
 * no claim the browser has not, or will not, verify.
 *
 *   hosted     the base is this build's art host and the host has a record of the collection. The
 *              CAR comes from the host (`/car/<imgCid>`, the upload as it arrived), and the metadata
 *              a later move to IPFS will point at is added to it, so a holder who keeps a copy today
 *              already holds what the creator's move will name.
 *   migrated   the base is `ipfs://<root>/` and that root is the move the art host worked out for
 *              this collection: images plus the regenerated metadata, the version that is on chain.
 *              Built from the host's copy while it has one, else from the public gateway roster.
 *   ipfs       any other content-addressed base. Built from the public gateway roster.
 *
 * Dependency-light on purpose: the panel imports this eagerly, and the CAR code loads on a click.
 */
import type { HostingStatus } from '../hostClient'
import { parseGatewayShapedUri } from '../hostingLimits'

export type KeepKind = 'hosted' | 'migrated' | 'ipfs'

/** A root a holder keeps, and what it is. */
export interface KeepRoot {
  role: 'images' | 'metadata' | 'next-metadata'
  cid: string
  /** A file under the root that a gateway can be asked about cheaply, when one is known. */
  sample?: string
}

export interface KeepPlan {
  kind: KeepKind
  /** The metadata root the chain names. The one fact every plan starts from. */
  metaCid: string
  /**
   * The images root, when it is known before any CAR is read: the host's record, or the root the
   * first piece's `image` names. A lead, not a fact — the CAR builder derives it from the verified
   * metadata and refuses a CAR whose images root differs.
   */
  imgCid: string | null
  /** The art host, for `hosted` and `migrated` plans whose host still has the upload. */
  host: string | null
  /** The hosted metadata root, for a migrated plan: what the regenerated root is rebuilt from. */
  hostedMetaCid: string | null
  /** The metadata a later move will point at, for a hosted plan, when the host has worked it out. */
  nextMetaCid: string | null
  /** A sample image file under `imgCid`, for the retrievability check. */
  imageSample: string | null
  /** A sample metadata file under `metaCid`. ERC-404 pieces are numbered from 1. */
  metaSample: string
}

/** The root CID a per-token base names, or null when the base is not content-addressed. */
export function baseRootCid(base: string | null | undefined): string | null {
  if (typeof base !== 'string') return null
  const trimmed = base.trim()
  const ipfs = /^ipfs:\/\/(?:ipfs\/)?([A-Za-z0-9]{46,})(?:\/.*)?$/.exec(trimmed)
  if (ipfs !== null) return ipfs[1]!
  const shaped = parseGatewayShapedUri(trimmed)
  return shaped === null ? null : shaped.cid
}

function onHost(base: string, host: string | null): boolean {
  return host !== null && base.trim().startsWith(`${host}/ipfs/`)
}

function firstPieceNumber(imageNames: readonly string[]): string {
  const numbers = imageNames
    .map((name) => Number.parseInt(name, 10))
    .filter((n) => Number.isSafeInteger(n) && n > 0)
    .sort((a, b) => a - b)
  return numbers.length === 0 ? '1' : String(numbers[0])
}

/**
 * The plan for a collection, or null when its base is not content-addressed (nothing to keep).
 *
 * `status` is the art host's record (null when it has none, undefined while it loads); a plan made
 * before it loads treats the collection as plain IPFS, which is correct for every collection that
 * was not uploaded for hosting and is replaced once the record arrives.
 */
export function keepPlan(
  base: string | null | undefined,
  status: HostingStatus | null | undefined,
  host: string | null,
): KeepPlan | null {
  const metaCid = baseRootCid(base)
  if (metaCid === null || typeof base !== 'string') return null
  const record = status ?? null
  const imageSample = record?.pieces[0] ?? null
  const metaSample = record === null ? '1' : firstPieceNumber(record.pieces)

  if (record !== null && onHost(base, host) && record.metaCid === metaCid) {
    return {
      kind: 'hosted',
      metaCid,
      imgCid: record.imgCid,
      host,
      hostedMetaCid: null,
      nextMetaCid: record.migrationCid,
      imageSample,
      metaSample,
    }
  }
  if (record !== null && base.trim().startsWith('ipfs://') && record.migrationCid === metaCid) {
    return {
      kind: 'migrated',
      metaCid,
      imgCid: record.imgCid,
      host,
      hostedMetaCid: record.metaCid,
      nextMetaCid: null,
      imageSample,
      metaSample,
    }
  }
  return {
    kind: 'ipfs',
    metaCid,
    imgCid: null,
    host: null,
    hostedMetaCid: null,
    nextMetaCid: null,
    imageSample: null,
    metaSample: '1',
  }
}

/** The roots on chain right now: what a holder keeps, and what the status readout checks. */
export function onChainRoots(plan: KeepPlan): KeepRoot[] {
  const roots: KeepRoot[] = []
  if (plan.imgCid !== null) {
    roots.push({
      role: 'images',
      cid: plan.imgCid,
      ...(plan.imageSample === null ? {} : { sample: plan.imageSample }),
    })
  }
  roots.push({ role: 'metadata', cid: plan.metaCid, sample: plan.metaSample })
  return roots
}

/**
 * The images root a piece's `image` names, or null when it names no single root: `ipfs://<cid>/<f>`
 * or `https://<host>/ipfs/<cid>/<f>`, and `<f>` beneath it.
 */
export function imageRootOf(image: unknown): { cid: string; file: string } | null {
  if (typeof image !== 'string') return null
  const trimmed = image.trim()
  const ipfs = /^ipfs:\/\/(?:ipfs\/)?([A-Za-z0-9]{46,})\/(.+)$/.exec(trimmed)
  if (ipfs !== null) return { cid: ipfs[1]!, file: ipfs[2]! }
  const shaped = parseGatewayShapedUri(trimmed)
  if (shaped === null) return null
  const file = shaped.path.replace(/^\//, '')
  return file === '' ? null : { cid: shaped.cid, file }
}

/** Short role names for people, used in the readout and as pin names. */
export const ROLE_LABEL: Record<KeepRoot['role'], string> = {
  images: 'images',
  metadata: 'metadata',
  'next-metadata': 'IPFS metadata, ready for the move',
}
