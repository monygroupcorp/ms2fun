// Precache coverage: the assertion the landing-payload audit named and could not make.
//
// Workbox has an undeclared 2 MiB `maximumFileSizeToCacheInBytes` default. A build asset that
// matches `globPatterns` but exceeds it is dropped from the precache manifest silently — the only
// signal is a build warning, and `app-ci` does not read build warnings. The failure is invisible in
// both directions: an asset we meant to precache stops being precached, or an asset we never meant
// to ship at install time is swept in by the glob. Both are first-visit cost, which is what a
// shared collection link buys the person who clicks it.
//
// This module is pure: it takes the glob configuration as an argument rather than owning a second
// copy of it. `vite.config.ts` exports the real `precacheGlobs`, and `scripts/check-precache.ts`
// passes those exact values in, so the guard cannot drift from what configured the build.

/**
 * Workbox's own emitted runtime. These match the glob patterns but are generated after the glob
 * runs and never precache themselves, so their absence from the manifest is correct, not drift.
 */
export const SERVICE_WORKER_OUTPUTS = ['sw.js', 'workbox-*.js'] as const

/** Workbox's undeclared default. An entry at or above this is dropped from the manifest. */
export const WORKBOX_MAX_FILE_BYTES = 2 * 1024 * 1024

/**
 * Minimal glob matcher covering the shapes we actually use: a leading `**` / `**\/`, `*` inside a
 * single segment, and a `{a,b,c}` alternation. Deliberately not a general glob engine — a partial
 * implementation that silently mismatches would make this guard lie.
 */
export function matchesGlob(path: string, pattern: string): boolean {
  let re = ''
  let i = 0
  while (i < pattern.length) {
    if (pattern.startsWith('**/', i)) {
      re += '(?:.*/)?'
      i += 3
    } else if (pattern.startsWith('**', i)) {
      re += '.*'
      i += 2
    } else if (pattern[i] === '*') {
      re += '[^/]*'
      i += 1
    } else if (pattern[i] === '{') {
      const close = pattern.indexOf('}', i)
      if (close === -1) throw new Error(`unterminated { in glob: ${pattern}`)
      const alts = pattern.slice(i + 1, close).split(',')
      re += `(?:${alts.map(escapeRegExp).join('|')})`
      i = close + 1
    } else {
      re += escapeRegExp(pattern.slice(i, i + 1))
      i += 1
    }
  }
  return new RegExp(`^${re}$`).test(path)
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export interface BuiltFile {
  /** Path relative to the build output directory, forward slashes, no leading slash. */
  path: string
  bytes: number
}

export interface CoverageFinding {
  path: string
  bytes: number
  reason: 'over-workbox-size-cap' | 'missing-from-manifest'
}

/**
 * Every built file that the glob configuration says should be precached, but which the emitted
 * manifest does not carry. `over-workbox-size-cap` is the silent-drop tripwire; anything else is
 * reported as `missing-from-manifest` rather than guessed at.
 */
export function findUncoveredFiles(
  built: readonly BuiltFile[],
  manifestPaths: readonly string[],
  options: {
    patterns: readonly string[]
    ignores?: readonly string[]
    maxFileBytes?: number
  },
): CoverageFinding[] {
  const { patterns, ignores = [], maxFileBytes = WORKBOX_MAX_FILE_BYTES } = options
  const inManifest = new Set(manifestPaths.map((p) => p.replace(/^\//, '')))

  return built
    .filter((file) => patterns.some((p) => matchesGlob(file.path, p)))
    .filter((file) => !ignores.some((p) => matchesGlob(file.path, p)))
    .filter((file) => !SERVICE_WORKER_OUTPUTS.some((p) => matchesGlob(file.path, p)))
    .filter((file) => !inManifest.has(file.path))
    .map((file) => ({
      path: file.path,
      bytes: file.bytes,
      reason:
        file.bytes >= maxFileBytes
          ? ('over-workbox-size-cap' as const)
          : ('missing-from-manifest' as const),
    }))
}

/**
 * Built files that are in the precache manifest but that the glob configuration excludes — the
 * other direction of the same drift. Workbox also injects entries of its own (the registration
 * shim, the generated manifest webmanifest), so callers pass those as `allowExtra`.
 */
export function findUnexpectedEntries(
  manifestPaths: readonly string[],
  options: { ignores?: readonly string[]; allowExtra?: readonly string[] } = {},
): string[] {
  const { ignores = [], allowExtra = [] } = options
  const allowed = new Set(allowExtra)
  return manifestPaths
    .map((p) => p.replace(/^\//, ''))
    .filter((p) => !allowed.has(p))
    .filter((p) => ignores.some((g) => matchesGlob(p, g)))
}

/** Pull the precached URLs out of an emitted `sw.js`. Returns [] if the file carries no manifest. */
export function parsePrecacheManifest(swSource: string): string[] {
  return [...swSource.matchAll(/url:\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1] ?? '')
}
