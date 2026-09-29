/**
 * How `VITE_ART_SERVICE` becomes a base URL.
 *
 * Alone in a file because two very different callers need the SAME answer: the app at runtime
 * (`uri.ts`) and the publish preflight (`scripts/assert-publishable.ts`) before a release is
 * pinned. The preflight exists to refuse a bundle that would ship with art delivery silently off,
 * and it can only do that if it decides "off" exactly the way the app decides it. A second copy of
 * this rule, drifted by one character, would bless a value the app then ignores — which is the
 * failure being guarded against, wearing the clothes of a guard.
 *
 * It lives here rather than in `uri.ts` so a node script can import it without pulling in the
 * gateway roster, the health store and the custom-gateway storage that module needs.
 */

/**
 * The base URL a service is addressed at, or null when the value names none.
 *
 * Null is what switches the art service off: every URL builder in `uri.ts` returns null from it and
 * the public gateway roster carries the request instead. That is a supported state and the one
 * every test and local build runs in — see `services/art/README.md`.
 *
 * Trailing slashes are stripped so `${base}/art/…` can never double one.
 */
export function normaliseArtServiceBase(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim().replace(/\/+$/, '')
  return /^https:\/\/|^http:\/\//.test(trimmed) ? trimmed : null
}
