/**
 * Client mirror of the on-chain collection-name rules. The registry is the authority — this only
 * exists so the wizard fails at the Name field instead of reverting on the final `createInstance`.
 *
 * `MetadataUtils.isValidName` (contracts/src/shared/libraries/MetadataUtils.sol:61) accepts ONLY
 * `[0-9A-Za-z_-]`, length 1–64. No spaces, no punctuation, no unicode. `toNameHash` (line 89)
 * ASCII-lowercases before hashing, so names are case-insensitively unique — `Milady` and `milady`
 * are the same claim. That makes the name a slug already; `toSlug` is just `.toLowerCase()`.
 */

export const NAME_MAX = 64
const NAME_RE = /^[0-9A-Za-z_-]+$/

/** The URL segment a name resolves to. Lowercase, because that's what `toNameHash` hashes. */
export function toSlug(name: string): string {
  return name.trim().toLowerCase()
}

/** A human-readable reason the name is unusable, or null when it satisfies `isValidName`. */
export function validateCollectionName(name: string): string | null {
  const v = name.trim()
  if (v.length === 0) return 'Required.'
  if (v.length > NAME_MAX) return `Too long — ${NAME_MAX} characters max.`
  if (v.includes(' ')) return 'No spaces. Use hyphens or underscores.'
  if (!NAME_RE.test(v)) return 'Letters, numbers, hyphens, and underscores only.'
  return null
}
