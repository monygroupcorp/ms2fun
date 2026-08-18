/**
 * Share-card assertions, as pure functions over emitted build output.
 *
 * The runner (`scripts/check-share-card.ts`) does the filesystem reads; everything that decides
 * pass or fail lives here so it is covered by vitest rather than only by a build that happened to
 * be run. Nothing here knows an origin string, a title or a description — the guard asserts
 * structure and resolvability, never content, so the pending origin ruling never has to edit it.
 */

/** The card tags a scraper reads. Declared by name so a missing one is named, not counted. */
export const REQUIRED_CARD_TAGS = [
  'og:type',
  'og:site_name',
  'og:title',
  'og:description',
  'og:url',
  'og:image',
  'og:image:width',
  'og:image:height',
  'og:image:alt',
  'twitter:card',
  'twitter:title',
  'twitter:description',
  'twitter:image',
] as const

export type CardTag = (typeof REQUIRED_CARD_TAGS)[number]

/**
 * Extract `<meta property="…">` / `<meta name="…">` content by key from emitted HTML.
 *
 * Deliberately attribute-order agnostic: the build's HTML minifier is free to reorder them, and a
 * guard that only matches one order goes red for a formatting change.
 */
export function extractMetaTags(html: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = /\b(?:property|name)\s*=\s*"([^"]*)"/i.exec(tag)?.[1]
    if (key === undefined) continue
    const content = /\bcontent\s*=\s*"([^"]*)"/i.exec(tag)?.[1]
    found.set(key, content ?? '')
  }
  return found
}

export type CardFinding = { tag: string; reason: 'missing' | 'empty' }

/** A1 — every declared tag present, and none of them present-but-empty. */
export function findCardTagFaults(tags: Map<string, string>): CardFinding[] {
  return REQUIRED_CARD_TAGS.flatMap((tag): CardFinding[] => {
    const content = tags.get(tag)
    if (content === undefined) return [{ tag, reason: 'missing' }]
    if (content.trim() === '') return [{ tag, reason: 'empty' }]
    return []
  })
}

/** A5 — an `og:image` a scraper can fetch has to be absolute. */
export function isAbsoluteUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** A4 — scheme + host + port, the thing that must agree across the three URL tags. */
export function originOf(value: string): string | null {
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

/**
 * A4 — `og:url`, `og:image` and `twitter:image` must share one origin.
 *
 * This is what makes `noesis-230`'s three-site origin substitution safe: a substitution that
 * misses one site leaves a working title beside a picture nobody can fetch.
 */
export function findOriginSplit(tags: Map<string, string>): string[] | null {
  const keys = ['og:url', 'og:image', 'twitter:image'] as const
  const origins = keys.map((key) => originOf(tags.get(key) ?? ''))
  if (origins.some((origin) => origin === null))
    return origins.map((origin) => origin ?? 'unparseable')
  return new Set(origins).size === 1 ? null : (origins as string[])
}

/** The path an emitted-file lookup should use for an absolute asset URL. Leading slash stripped. */
export function distPathOf(value: string): string | null {
  try {
    return decodeURIComponent(new URL(value).pathname).replace(/^\/+/, '')
  } catch {
    return null
  }
}

/**
 * A3 — read width/height out of a PNG's IHDR chunk.
 *
 * Returns null for anything that is not a PNG, so a future SVG or WebP card image degrades to
 * "dimensions not checked" rather than to a false red.
 */
export function readPngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 24) return null
  if (signature.some((byte, index) => bytes[index] !== byte)) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // IHDR is required to be the first chunk: 8-byte signature, 4-byte length, 4-byte type, then data.
  if (String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') return null
  return { width: view.getUint32(16), height: view.getUint32(20) }
}
