/**
 * Client-side mirror of the registries' on-chain metadata-URI allowlist
 * (`MetadataUtils.isValidURI`, contracts/src/shared/libraries/MetadataUtils.sol). Every registry
 * writer that stores a `metadataURI` — `registerAlignmentTarget`, `updateAlignmentTarget`, the
 * master registry's equivalents — reverts `InvalidMetadataURI` on a pointer outside this set.
 *
 * Kept here as a pure predicate so a form can refuse a bad pointer before it costs a reverted
 * transaction, rather than after. It is a MIRROR, not the authority: the chain decides, and this
 * must be kept in step with the library if the allowlist ever moves.
 *
 * `data:text/html` and bare `data:` are excluded on purpose — the on-chain rule admits `data:` only
 * for image and JSON media types, which is what closes the stored-XSS surface for anything that
 * renders a stored pointer.
 */

/** The accepted prefixes, in the order the Solidity library tests them. */
export const REGISTRY_URI_SCHEMES = [
  'https://',
  'ipfs://',
  'ar://',
  'data:image/',
  'data:application/json',
] as const

/**
 * True for a URI the registries will store. Empty is FALSE here, matching the library
 * (`uriBytes.length == 0` returns false) — the callers that accept a blank as "clear the pointer"
 * skip the check entirely rather than asking this to lie about it.
 */
export function isRegistryMetadataURI(uri: string): boolean {
  return REGISTRY_URI_SCHEMES.some((scheme) => uri.startsWith(scheme))
}

/**
 * True for a value an `updateAlignmentTarget`-shaped writer will accept: a valid pointer, or empty
 * to clear the stored one (the contract admits an empty string and skips the allowlist check).
 * Untrimmed input is the caller's problem — pass what you will send.
 */
export function isStorableMetadataURI(uri: string): boolean {
  return uri === '' || isRegistryMetadataURI(uri)
}
