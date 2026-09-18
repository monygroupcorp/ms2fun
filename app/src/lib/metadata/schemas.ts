/**
 * Metadata content schemas (ADR-0004) — the JSON shapes behind each on-chain pointer. These ARE the
 * NOEMA API surface (build once, serve frontend + agents). Parsers are LENIENT: untrusted,
 * user/agent-authored JSON from IPFS is coerced to a safe typed shape with defaults, never thrown
 * on. Each shape carries a `schemaVersion` so content can evolve without on-chain changes.
 *
 * Coercion is also where the URI scheme allowlist is applied (`untrusted.ts`): image pointers are
 * author-chosen strings, so a disallowed scheme is blanked here, once, rather than at each of the
 * render sites that consume the parsed shape.
 */

import { sanitizeImageUri } from './untrusted'

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

/**
 * Collection metadata behind `MasterRegistry.instanceInfo[instance].metadataURI`.
 *
 * NOTE: the on-chain JSON uses ERC-7572 key names (`banner_image`, `external_link`) so marketplaces
 * can read it; these in-memory names are ours. The mapping lives in `encode.ts` / `parseCollection`.
 */
export interface CollectionMetadata {
  schemaVersion: number
  name: string
  description: string
  image: string
  /** Serialized as `banner_image`. */
  banner: string
  category: string
  links: ProfileLink[]
  /**
   * Merkle-allowlist listURIs (noesis-080), one row per gated (editionId, tierIndex) — today always a
   * single `{editionId:0, tierIndex:0}` row (single list, no per-edition/tier authoring UI yet). The
   * `listURI` points at the off-chain `{address,maxQty}[]` entries the mint page fetches to build a
   * proof; the ROOT itself lives on-chain in `MerkleGatingModule`, not here. Optional/omitted when no
   * allowlist has been configured.
   */
  allowlists?: AllowlistRow[]
  /**
   * Which authored art pointers the allowlist REFUSED (`sanitizeImageUri` blanked a non-empty
   * string). Without it `image: ''` is ambiguous — a collection that authored no art and one whose
   * art the app will never render read identically, and only the second is worth telling the
   * creator about. Omitted when nothing was refused. Never serialized: `buildCollectionJson`
   * writes an explicit key list, so this stays in-memory.
   */
  refusedPointers?: readonly ('image' | 'banner')[]
}

/** One row of `CollectionMetadata.allowlists` — see that field's doc for the (editionId,tierIndex) model. */
export interface AllowlistRow {
  editionId: number
  tierIndex: number
  listURI: string
}

/**
 * One pick in a curation: a collection, or a single piece inside one.
 *
 * `instance` is the collection's deployed address, lowercased so two spellings of the same pick
 * compare equal. `tokenId` empty means the pick IS the collection; a non-empty decimal string
 * narrows it to one edition (ERC-1155) or token (ERC-721 / ERC-404) within that collection.
 */
export interface CurationItem {
  instance: `0x${string}`
  tokenId: string
  /** The curator's own line about this pick. Optional, and usually the reason the set exists. */
  note: string
}

/**
 * Curation metadata behind `CurationRegistry.getCuration(id).uri`.
 *
 * The chain holds the curator, the timestamps and this pointer; everything a reader sees is here,
 * so a curation of two pieces and a curation of two hundred cost the same to publish. Wire keys
 * are ERC-7572-shaped where an equivalent exists (`name`, `description`, `image`) so an indexer
 * that knows nothing about curations still reads a title and a cover; `items` is ours.
 */
export interface CurationMetadata {
  schemaVersion: number
  name: string
  description: string
  /** Cover image URI. A curation with no cover draws a mono glyph of its initial instead. */
  image: string
  items: CurationItem[]
}

/**
 * Ceiling on the items one curation renders.
 *
 * The JSON is authored by anyone and fetched from a gateway that can answer anything, so an
 * unbounded `items` array is a render-time denial of service on whoever opens the page — the
 * detail view issues a batched on-chain read per window of picks. 200 is far above any set a
 * person assembles by hand and far below a list that hangs a browser. Picks past it are dropped at
 * parse, where every other untrusted-shape rule already lives.
 */
export const CURATION_MAX_ITEMS = 200

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
    avatar: sanitizeImageUri(str(o.avatar) || str(o.image)),
    banner: sanitizeImageUri(str(o.banner)),
    links: links(o.links),
    socials: record(o.socials),
  }
}

/** Coerce arbitrary JSON into a safe CollectionMetadata. Never throws. */
export function parseCollection(json: unknown): CollectionMetadata {
  const o = (json ?? {}) as Record<string, unknown>
  const allowlists = allowlistRows(o.allowlists)
  const rawImage = str(o.image)
  // ERC-7572 spells it `banner_image`; `banner` is our pre-7572 key, still read so collections
  // written before the rename (and any third-party JSON) keep rendering.
  const rawBanner = str(o.banner_image) || str(o.banner)
  const image = sanitizeImageUri(rawImage)
  const banner = sanitizeImageUri(rawBanner)
  // A pointer that was authored and then blanked is a refusal, not an absence — recorded here, the
  // one place the allowlist is applied to collection JSON, so no caller re-implements the rules.
  const refusedPointers: ('image' | 'banner')[] = []
  if (rawImage.trim() !== '' && image === '') refusedPointers.push('image')
  if (rawBanner.trim() !== '' && banner === '') refusedPointers.push('banner')
  return {
    schemaVersion: num(o.schemaVersion, 1),
    name: str(o.name),
    description: str(o.description),
    image,
    banner,
    category: str(o.category),
    // `external_link` is derived from links[0] on write, so it needs no read-back — but a
    // third-party collection may carry only `external_link`. Surface it as the sole link.
    links: links(o.links).length > 0 ? links(o.links) : externalLink(o.external_link),
    // `exactOptionalPropertyTypes` forbids assigning `undefined` to an optional field — only include
    // the key when there's an actual row set.
    ...(allowlists !== undefined ? { allowlists } : {}),
    ...(refusedPointers.length > 0 ? { refusedPointers } : {}),
  }
}

/** Coerce arbitrary JSON into a list of allowlist rows, dropping any malformed entry. */
function allowlistRows(v: unknown): AllowlistRow[] | undefined {
  if (!Array.isArray(v)) return undefined
  const rows: AllowlistRow[] = []
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as { editionId?: unknown; tierIndex?: unknown; listURI?: unknown }
    const listURI = str(r.listURI)
    if (listURI === '') continue
    rows.push({ editionId: num(r.editionId, 0), tierIndex: num(r.tierIndex, 0), listURI })
  }
  return rows.length > 0 ? rows : undefined
}

/** An ERC-7572 `external_link` promoted to our labelled-link shape. */
function externalLink(v: unknown): ProfileLink[] {
  const url = str(v)
  return HTTP_URL_RE.test(url) ? [{ label: 'Website', url }] : []
}

/** `0x` + 40 hex, the only shape an instance pointer may take. */
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
/** A token id as authored: decimal digits only, so it round-trips through `BigInt` and a route. */
const TOKEN_ID_RE = /^[0-9]{1,78}$/

/**
 * Coerce arbitrary JSON into a safe CurationMetadata. Never throws.
 *
 * A malformed pick is DROPPED rather than repaired: a row whose `instance` is not an address names
 * no collection, and there is nothing to render it as. Duplicates are dropped too — the same pick
 * twice is one pick — keeping the first occurrence, so the curator's ordering survives.
 */
export function parseCuration(json: unknown): CurationMetadata {
  const o = (json ?? {}) as Record<string, unknown>
  return {
    schemaVersion: num(o.schemaVersion, 1),
    name: str(o.name),
    description: str(o.description),
    image: sanitizeImageUri(str(o.image)),
    items: curationItems(o.items),
  }
}

function curationItems(v: unknown): CurationItem[] {
  if (!Array.isArray(v)) return []
  const out: CurationItem[] = []
  const seen = new Set<string>()
  for (const raw of v) {
    if (out.length >= CURATION_MAX_ITEMS) break
    if (!raw || typeof raw !== 'object') continue
    const r = raw as { instance?: unknown; tokenId?: unknown; note?: unknown }
    const instance = str(r.instance).toLowerCase()
    // The regex IS the proof of the `0x${string}` shape; asserting it here, once, is what keeps
    // every consumer of a parsed pick free of address casts.
    if (!ADDRESS_RE.test(instance)) continue
    // A tokenId that is not a plain decimal cannot address a piece, but the collection behind it is
    // still a real pick — so the row is kept and widened to the collection rather than dropped.
    const rawTokenId = str(r.tokenId)
    const tokenId = TOKEN_ID_RE.test(rawTokenId) ? rawTokenId : ''
    const key = `${instance}#${tokenId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ instance: instance as `0x${string}`, tokenId, note: str(r.note) })
  }
  return out
}

/** The pick's identity, and the key every dedupe/compare in the app uses. */
export function curationItemKey(item: CurationItem): string {
  return `${item.instance.toLowerCase()}#${item.tokenId}`
}
