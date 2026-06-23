/**
 * Encoding helpers for the backend-free metadata model (ADR-0004): build canonical JSON strings
 * from ProfileMetadata / CollectionMetadata and wrap them in inline `data:` URIs that can be
 * written on-chain as pointers. Pure TS (no React/wagmi) so NOEMA can reuse it.
 *
 * Key contract: empty-string / empty-array / empty-object fields are omitted to minimise on-chain
 * payload size; `schemaVersion` is always kept.
 */

import type { CollectionMetadata, ProfileLink, ProfileMetadata } from './schemas'

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
 * Canonical JSON string for a CollectionMetadata value.
 * Key order: schemaVersion, name, description, image, banner, category, links.
 * Empty-string / empty-array fields are omitted; schemaVersion is always present.
 */
export function buildCollectionJson(c: CollectionMetadata): string {
  const raw: Record<string, unknown> = {
    schemaVersion: c.schemaVersion,
    name: c.name,
    description: c.description,
    image: c.image,
    banner: c.banner,
    category: c.category,
    links: serializeLinks(c.links),
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
