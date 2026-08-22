/**
 * Authoring-time validation for creator-supplied ART POINTERS (the wizard's cover, banner and
 * piece-art fields).
 *
 * The app applies a scheme allowlist when it READS a collection's metadata back
 * (`sanitizeImageUri`, `app/src/lib/metadata/untrusted.ts`): a pointer outside the allowlist is
 * coerced to `''` and the art renders as absent. Without the same check at authoring time a
 * creator can enter such a pointer, deploy it, and have the art resolve to nothing for every
 * viewer — and the pointer is on-chain, where correcting it costs another transaction.
 *
 * So the wizard asks the SAME function the renderer asks, and refuses what it blanks. The rules
 * live in one place: `ALLOW_REMOTE_HTTP_URIS` is a product ruling that can flip, and a second copy
 * of the scheme list here is exactly how the authoring form and the renderer come to disagree.
 */
import { ALLOW_REMOTE_HTTP_URIS, sanitizeImageUri } from '../metadata'

/**
 * The accepted schemes, in prose, derived from the same constant the allowlist reads — so the
 * message cannot claim a scheme the renderer would drop (or omit one it would keep) if the ruling
 * flips.
 */
export function acceptedArtSchemes(): string {
  const remote = ALLOW_REMOTE_HTTP_URIS ? 'a https:// link, ' : ''
  return `${remote}an ipfs:// or ar:// pointer, or an inline image data: URI`
}

/**
 * Why this art pointer would not render, or `null` when it is fine.
 *
 * Blank is fine: art is optional throughout the wizard (a collection may launch with no cover, and
 * a blank piece-art base means pieces render as a bare id). This refuses a pointer that was
 * ENTERED and would still resolve to nothing — never the absence of one.
 */
export function artPointerError(uri: string | undefined | null): string | null {
  const trimmed = (uri ?? '').trim()
  if (trimmed === '') return null
  if (sanitizeImageUri(trimmed) !== '') return null
  return `this link can’t be displayed — use ${acceptedArtSchemes()}.`
}
