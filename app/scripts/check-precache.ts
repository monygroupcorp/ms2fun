/**
 * G5b — precache coverage guard. Runs as the last step of `pnpm build`, so it is covered by the
 * existing `app-ci` build gate with no new CI step.
 *
 * What it asserts against the *emitted* `dist/sw.js`, not against the config that was meant to
 * produce it:
 *   1. every built file the glob configuration says to precache is actually in the manifest, and
 *   2. no file the ignore list excludes has crept back into it.
 *
 * Why it exists: workbox's undeclared 2 MiB `maximumFileSizeToCacheInBytes` default drops an
 * oversize asset from the manifest with only a build warning, and `app-ci` reads build output for
 * an exit code, not for warnings. The flagship card art currently sits 32 KB under that cap, so any
 * redraw that grows it silently changes what a first visit fetches.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import {
  findUncoveredFiles,
  findUnexpectedEntries,
  parsePrecacheManifest,
  type BuiltFile,
} from '../src/lib/pwa/precache'
import { precacheGlobs } from '../precache.globs'

const distDir = resolve(import.meta.dirname, '..', 'dist')

function walk(dir: string): BuiltFile[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    if (!entry.isFile()) return []
    return [{ path: relative(distDir, full).split('\\').join('/'), bytes: statSync(full).size }]
  })
}

const swPath = join(distDir, 'sw.js')
let swSource: string
try {
  swSource = readFileSync(swPath, 'utf8')
} catch {
  console.error(`precache guard: no service worker at ${swPath} — did the build emit one?`)
  process.exit(1)
}

const manifest = parsePrecacheManifest(swSource)
if (manifest.length === 0) {
  console.error('precache guard: sw.js carries no precache manifest')
  process.exit(1)
}

const built = walk(distDir)
const uncovered = findUncoveredFiles(built, manifest, {
  patterns: precacheGlobs.globPatterns,
  ignores: precacheGlobs.globIgnores,
})
const unexpected = findUnexpectedEntries(manifest, { ignores: precacheGlobs.globIgnores })

const precachedBytes = manifest
  .map((url) => built.find((f) => f.path === url.replace(/^\//, '')))
  .reduce((total, file) => total + (file?.bytes ?? 0), 0)

if (uncovered.length === 0 && unexpected.length === 0) {
  console.log(
    `precache guard: OK — ${manifest.length} entries, ${(precachedBytes / 1024).toFixed(2)} KiB, ` +
      `${precacheGlobs.globIgnores.length} deliberate exclusion(s)`,
  )
  process.exit(0)
}

for (const finding of uncovered) {
  const detail =
    finding.reason === 'over-workbox-size-cap'
      ? `${finding.bytes} bytes is at or over workbox's 2 MiB cap, so it was dropped from the precache`
      : 'matches globPatterns but is not in the manifest'
  console.error(`precache guard: ${finding.path} — ${detail}`)
}
for (const url of unexpected) {
  console.error(`precache guard: ${url} — is in globIgnores but was precached anyway`)
}
console.error(
  'precache guard: FAILED — the emitted precache set does not match the configured one. ' +
    'If the change is intended, say so in `precacheGlobs` in precache.globs.ts.',
)
process.exit(1)
