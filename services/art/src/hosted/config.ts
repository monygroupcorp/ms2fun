/**
 * Hosting's configuration: the bindings and vars a deployment sets, read into numbers once.
 *
 * Every var is optional and every one has a default from `hostingLimits.ts`, the file the app reads
 * too, so a deployment that sets nothing enforces exactly what the upload form tells creators. What
 * a deployment MUST set to accept uploads at all is listed in {@link uploadsConfigured}; without
 * those, the upload routes answer 503 and every read route behaves as it did before hosting existed.
 */
import { HOSTING_LIMITS } from '../../../../app/src/lib/art/hostingLimits'

/** The bindings and vars hosting reads. All optional: see {@link uploadsUnavailable}. */
export interface HostingEnv {
  /** Hosted originals. NO lifecycle rule: hosting ends by ledger expiry, never by eviction. */
  ART_HOSTED?: R2Bucket
  /** The ledger Durable Object (`HostingLedger`). */
  HOSTING_LEDGER?: DurableObjectNamespace
  /** Optional: resizes hosted images into the width rungs. Without it originals are served. */
  IMAGES?: ImagesBinding
  /** Secret. Signs upload session tokens. Set with `wrangler secret put`. */
  UPLOAD_SESSION_SECRET?: string
  /** Hosts a sign-in message may name as its `domain`, comma-separated (`example.org,localhost:5173`). */
  UPLOAD_SIWE_DOMAINS?: string
  /** The chain a sign-in must name, and the chain bind reads. */
  UPLOAD_CHAIN_ID?: string
  /** RPC for that chain: smart-wallet signature checks and the bind-step reads. */
  UPLOAD_RPC_URL?: string
  /** The protocol's master registry on that chain; bind only accepts instances it knows. */
  UPLOAD_REGISTRY?: string
  /** `1` refuses every new upload. Reads, downloads and binds carry on. */
  UPLOADS_PAUSED?: string
  /** Bytes the deployment may hold in total, across every draft. The kill switch for the bill. */
  HOSTED_MAX_TOTAL_BYTES?: string
  /** Largest single upload. Raise only on a plan whose request-body ceiling is above 100 MB. */
  UPLOAD_MAX_CAR_BYTES?: string
  /** Minutes between on-chain checks of each launched collection. Informational only. */
  HOSTED_CHECK_MINUTES?: string
}

/** Bytes hosting may hold when a deployment sets no ceiling of its own: 50 GiB. */
const DEFAULT_TOTAL_BYTES = 50 * 1024 * 1024 * 1024

/** How long a session token lasts. Long enough for one upload over a slow connection. */
export const SESSION_TTL_MS = 60 * 60 * 1000

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw?.trim() ?? '', 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

/** How often the watcher reads each launched collection's state from the chain, in ms. */
export function checkIntervalMs(env: HostingEnv): number {
  const minutes = Number.parseFloat(env.HOSTED_CHECK_MINUTES?.trim() ?? '')
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : 60) * 60 * 1000
}

export function hostingConfig(env: HostingEnv) {
  const domains = (env.UPLOAD_SIWE_DOMAINS ?? '')
    .split(/[\s,]+/)
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d.length > 0)
  const chainId = Number.parseInt(env.UPLOAD_CHAIN_ID?.trim() ?? '', 10)
  return {
    domains,
    chainId: Number.isSafeInteger(chainId) && chainId > 0 ? chainId : null,
    rpcUrl: env.UPLOAD_RPC_URL?.trim() || null,
    registry: /^0x[0-9a-fA-F]{40}$/.test(env.UPLOAD_REGISTRY?.trim() ?? '')
      ? (env.UPLOAD_REGISTRY!.trim() as `0x${string}`)
      : null,
    paused: env.UPLOADS_PAUSED?.trim() === '1',
    totalBytes: positiveInt(env.HOSTED_MAX_TOTAL_BYTES, DEFAULT_TOTAL_BYTES),
    maxCarBytes: positiveInt(env.UPLOAD_MAX_CAR_BYTES, HOSTING_LIMITS.maxUploadBytes),
    draftBytesPerWallet: HOSTING_LIMITS.draftBytesPerWallet,
    draftsPerWallet: HOSTING_LIMITS.draftsPerWallet,
    draftTtlMs: HOSTING_LIMITS.draftTtlDays * 24 * 60 * 60 * 1000,
    reserveTtlMs: 30 * 60 * 1000,
  }
}

/**
 * Why this deployment cannot accept uploads, or null when it can.
 *
 * The bucket, the ledger, a session secret and at least one sign-in domain. RPC and registry are not
 * on this list: without them EOA sign-in still works and bind answers 503 on its own, so a missing
 * RPC narrows what works rather than turning hosting off.
 */
export function uploadsUnavailable(env: HostingEnv): string | null {
  if (env.ART_HOSTED === undefined) return 'hosting storage is not configured'
  if (env.HOSTING_LEDGER === undefined) return 'the hosting ledger is not configured'
  if (!env.UPLOAD_SESSION_SECRET) return 'upload sign-in is not configured'
  if (hostingConfig(env).domains.length === 0) return 'upload sign-in is not configured'
  return null
}
