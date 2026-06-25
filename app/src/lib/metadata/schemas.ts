/**
 * Metadata content schemas (ADR-0004) — the JSON shapes behind each on-chain pointer. These ARE the
 * NOEMA API surface (build once, serve frontend + agents). Parsers are LENIENT: untrusted,
 * user/agent-authored JSON from IPFS is coerced to a safe typed shape with defaults, never thrown
 * on. Each shape carries a `schemaVersion` so content can evolve without on-chain changes.
 */

export interface ProfileLink {
  label: string
  url: string
}

/** Account / profile metadata — the feature-rich identity behind `ProfileRegistry.profileURI`. */
export interface ProfileMetadata {
  schemaVersion: number
  name: string
  handle: string
  bio: string
  avatar: string // image URI (ipfs/ar/http/data)
  banner: string // wide image URI
  links: ProfileLink[]
  socials: Record<string, string> // e.g. { x: "...", farcaster: "..." }
}

/** Collection metadata behind `MasterRegistry.instanceInfo[instance].metadataURI`. */
export interface CollectionMetadata {
  schemaVersion: number
  name: string
  description: string
  image: string
  banner: string
  category: string
  links: ProfileLink[]
}

// ── lenient coercion helpers ────────────────────────────────────────────────
function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}
function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}
// Links render into `<a href>`, so only http(s) URLs survive — this drops `data:`/`javascript:` and
// other schemes that could execute when a viewer clicks an untrusted on-chain profile/collection link.
const HTTP_URL_RE = /^https?:\/\//i
function links(v: unknown): ProfileLink[] {
  if (!Array.isArray(v)) return []
  return v
    .map((l) => ({ label: str((l as ProfileLink)?.label), url: str((l as ProfileLink)?.url) }))
    .filter((l) => HTTP_URL_RE.test(l.url))
}
function record(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'string') out[k] = val
  }
  return out
}

/** Coerce arbitrary JSON into a safe ProfileMetadata. Never throws. */
export function parseProfile(json: unknown): ProfileMetadata {
  const o = (json ?? {}) as Record<string, unknown>
  return {
    schemaVersion: num(o.schemaVersion, 1),
    name: str(o.name),
    handle: str(o.handle),
    bio: str(o.bio),
    avatar: str(o.avatar) || str(o.image),
    banner: str(o.banner),
    links: links(o.links),
    socials: record(o.socials),
  }
}

/** Coerce arbitrary JSON into a safe CollectionMetadata. Never throws. */
export function parseCollection(json: unknown): CollectionMetadata {
  const o = (json ?? {}) as Record<string, unknown>
  return {
    schemaVersion: num(o.schemaVersion, 1),
    name: str(o.name),
    description: str(o.description),
    image: str(o.image),
    banner: str(o.banner),
    category: str(o.category),
    links: links(o.links),
  }
}
