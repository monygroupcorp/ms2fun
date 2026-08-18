/**
 * G5c — share-card emission guard. Runs as the last step of `pnpm build`, so `app-ci`'s existing
 * build gate covers it with no new CI step, exactly as the precache guard beside it does.
 *
 * Four merged items built the share card — the tags (`noesis-221`), the SPA fallback
 * (`noesis-229`), the payload (`noesis-244`) — and nothing asserted a line of it. Each of these
 * is a silently green CI run and a card nobody can render: the icon renamed, a plugin reordered so
 * `404.html` stops matching `index.html`, `_redirects` deleted, a tag dropped, or the pending
 * origin substitution landing on two of its three sites.
 *
 * It reads the *emitted* `dist/`, never the source, and it knows no origin, title or description —
 * structure and resolvability only, so the origin ruling never has to edit this file.
 */
import { readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  REQUIRED_CARD_TAGS,
  distPathOf,
  extractMetaTags,
  findCardTagFaults,
  findOriginSplit,
  isAbsoluteUrl,
  readPngDimensions,
} from '../src/lib/share/card'

const distDir = resolve(import.meta.dirname, '..', 'dist')
const failures: string[] = []

function read(path: string): string | null {
  try {
    return readFileSync(join(distDir, path), 'utf8')
  } catch {
    return null
  }
}

const indexHtml = read('index.html')
if (indexHtml === null) {
  console.error(`share-card guard: no index.html at ${distDir} — did the build emit one?`)
  process.exit(1)
}

const tags = extractMetaTags(indexHtml)

// A1 — every card tag present by name, and none present-but-empty.
for (const fault of findCardTagFaults(tags)) {
  failures.push(`${fault.tag} is ${fault.reason}`)
}

const ogImage = tags.get('og:image') ?? ''
const twitterImage = tags.get('twitter:image') ?? ''

// A5 — an og:image a scraper can fetch has to be absolute.
for (const [tag, value] of [
  ['og:image', ogImage],
  ['twitter:image', twitterImage],
] as const) {
  if (value !== '' && !isAbsoluteUrl(value)) {
    failures.push(`${tag} is not an absolute http(s) url: ${value}`)
  }
}

// A4 — og:url, og:image and twitter:image must share one origin.
const split = findOriginSplit(tags)
if (split !== null) {
  failures.push(
    `og:url / og:image / twitter:image are on different origins: ${split.join(' | ')} — ` +
      'a card with a working title and a picture nobody can fetch',
  )
}

// A2 — the image tags resolve to a file that exists in dist/.
let resolvedImage: string | null = null
for (const [tag, value] of [
  ['og:image', ogImage],
  ['twitter:image', twitterImage],
] as const) {
  const path = distPathOf(value)
  if (path === null) continue
  try {
    statSync(join(distDir, path))
    if (tag === 'og:image') resolvedImage = path
  } catch {
    failures.push(`${tag} points at ${path}, which the build did not emit`)
  }
}

// A3 — declared dimensions match the actual PNG.
let dimensions: { width: number; height: number } | null = null
if (resolvedImage !== null) {
  dimensions = readPngDimensions(new Uint8Array(readFileSync(join(distDir, resolvedImage))))
  if (dimensions !== null) {
    const declared = {
      width: Number(tags.get('og:image:width')),
      height: Number(tags.get('og:image:height')),
    }
    if (declared.width !== dimensions.width || declared.height !== dimensions.height) {
      failures.push(
        `og:image:width/height declare ${declared.width}x${declared.height} but ${resolvedImage} ` +
          `is ${dimensions.width}x${dimensions.height}`,
      )
    }
  }
}

// A6 — the SPA fallback shipped, and it is the same document a scraper would read.
const fallback = read('404.html')
if (fallback === null) {
  failures.push('404.html was not emitted — deep links card the host’s own 404 page')
} else if (fallback !== indexHtml) {
  failures.push(
    '404.html is not byte-identical to index.html, so a deep link cards a different document',
  )
}
const redirects = read('_redirects')
if (redirects === null) {
  failures.push('_redirects was not emitted')
} else if (redirects.trim() === '') {
  failures.push('_redirects is empty')
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`share-card guard: ${failure}`)
  console.error(
    'share-card guard: FAILED — the emitted build does not carry a card a scraper can render.',
  )
  process.exit(1)
}

const shape =
  dimensions === null
    ? 'dimensions not checked (not a PNG)'
    : `${dimensions.width}x${dimensions.height}`
console.log(
  `share-card guard: OK — ${REQUIRED_CARD_TAGS.length} card tags, image ${resolvedImage} (${shape}), ` +
    'one origin, 404.html identical to index.html, _redirects present',
)
