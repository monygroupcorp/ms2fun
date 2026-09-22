/**
 * Encoding helpers for the backend-free metadata model (ADR-0004): build canonical JSON strings
 * from ProfileMetadata / CollectionMetadata / CurationMetadata and wrap them in inline `data:`
 * URIs that can be written on-chain as pointers. Pure TS (no React/wagmi) so NOEMA can reuse it.
 *
 * Key contract: empty-string / empty-array / empty-object fields are omitted to minimise on-chain
 * payload size; `schemaVersion` is always kept.
 */

import type { CollectionMetadata, CurationMetadata, ProfileLink, ProfileMetadata } from './schemas'

// ── key-order helpers ─────────────────────────────────────────────────────────

/** Returns a new object with only the truthy / non-empty fields (schemaVersion always kept). */
function omitEmpty(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'schemaVersion') {
      out[k] = v
      continue
    }
    if (v === '' || v === null || v === undefined) continue
    if (Array.isArray(v) && v.length === 0) continue
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0)
      continue
    out[k] = v
  }
  return out
}

function serializeLinks(links: ProfileLink[]): ProfileLink[] {
  return links.filter((l) => l.url !== '')
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Canonical JSON string for a ProfileMetadata value.
 * Key order: schemaVersion, name, handle, bio, avatar, banner, links, socials.
 * Empty-string / empty-array / empty-object fields are omitted; schemaVersion is always present.
 */
export function buildProfileJson(p: ProfileMetadata): string {
  const raw: Record<string, unknown> = {
    schemaVersion: p.schemaVersion,
    name: p.name,
    handle: p.handle,
    bio: p.bio,
    avatar: p.avatar,
    banner: p.banner,
    links: serializeLinks(p.links),
    socials: p.socials,
  }
  return JSON.stringify(omitEmpty(raw))
}

/**
 * Canonical JSON string for a CollectionMetadata value — the document served by `contractURI()`.
 *
 * Wire keys follow **ERC-7572** so marketplaces and indexers (OpenSea, Rarible, Zora…) can read a
 * collection without knowing about MasterRegistry: `name`, `description`, `image`, `banner_image`,
 * `external_link`. Our in-memory field names stay `banner` / `links` — the mapping lives here and
 * nowhere else.
 *
 * `links` has no ERC-7572 equivalent (it's a labelled list, `external_link` is one URL), so we keep
 * it as an extension AND derive `external_link` from the first link. Consumers ignore unknown keys.
 *
 * Key order: schemaVersion, name, description, image, banner_image, category, external_link, links,
 * allowlists. Empty-string / empty-array fields are omitted; schemaVersion is always present.
 */
export function buildCollectionJson(c: CollectionMetadata): string {
  const serialized = serializeLinks(c.links)
  const raw: Record<string, unknown> = {
    schemaVersion: c.schemaVersion,
    name: c.name,
    description: c.description,
    image: c.image,
    banner_image: c.banner,
    category: c.category,
    external_link: serialized[0]?.url ?? '',
    links: serialized,
    allowlists: c.allowlists ?? [],
  }
  return JSON.stringify(omitEmpty(raw))
}

/**
 * Wrap a JSON string in a `data:application/json,` URI (URL-encoded UTF-8).
 * URL-encoded (not base64) so it round-trips through `fetchJson` / `resolveUri` unchanged.
 */
export function toJsonDataUri(json: string): string {
  return `data:application/json,${encodeURIComponent(json)}`
}

/** Build a `data:` URI for a profile — the value that goes on-chain as `profileURI`. */
export function profileToDataUri(p: ProfileMetadata): string {
  return toJsonDataUri(buildProfileJson(p))
}

/** Build a `data:` URI for a collection — the value that goes on-chain as `metadataURI`. */
export function collectionToDataUri(c: CollectionMetadata): string {
  return toJsonDataUri(buildCollectionJson(c))
}

/**
 * Canonical JSON string for a CurationMetadata value — the document behind `curationURI`.
 *
 * Key order: schemaVersion, name, description, image, items. Empty fields are omitted, so a
 * curation with no cover and no notes writes four keys and the picks. Each pick is written with
 * only the keys it uses: `tokenId` and `note` are dropped when empty, which is the common case
 * (a set of collections, unannotated) and is where most of the payload would otherwise go.
 *
 * `items` is NOT omitted when empty: a curation with no picks is a real, publishable state — the
 * curator named the set before filling it — and `{"items":[]}` says that where a missing key would
 * read as "this JSON predates items".
 */
export function buildCurationJson(c: CurationMetadata): string {
  const raw: Record<string, unknown> = {
    schemaVersion: c.schemaVersion,
    name: c.name,
    description: c.description,
    image: c.image,
    items: c.items.map((i) => ({
      instance: i.instance.toLowerCase(),
      ...(i.tokenId !== '' ? { tokenId: i.tokenId } : {}),
      ...(i.note !== '' ? { note: i.note } : {}),
    })),
  }
  const out = omitEmpty(raw)
  out.items = raw.items
  return JSON.stringify(out)
}

/** Build a `data:` URI for a curation — the value that goes on-chain as the curation pointer. */
export function curationToDataUri(c: CurationMetadata): string {
  return toJsonDataUri(buildCurationJson(c))
}
