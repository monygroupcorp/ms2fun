/**
 * Shared gas model for on-chain data embedded at deploy (ADR-0004 metadataURI blob). One source of
 * truth for both the wizard's per-image readout (ImageSourceInput) and the Review-step deploy
 * breakdown (deployGasBreakdown) — a second copy would drift.
 *
 * Model: N ASCII bytes written on-chain cost one cold SSTORE per new 32-byte word (~22,100) plus the
 * bytes riding in calldata (~16/byte; a base64/URL-encoded blob is virtually all non-zero). N is the
 * MARGINAL size a field adds to the serialized metadataURI, not the bare value — URL-encoding inflates
 * a WebP data URI ~1.14x, so charging the bare length under-reports (measured on a real deploy).
 */

export const SSTORE_PER_WORD = 22_100
export const CALLDATA_PER_BYTE = 16
/** Reference gas price for the ETH readout. Not a promise — just a "what this'd cost" anchor. */
export const REF_GWEI = 15

/** UTF-8 byte length — what actually lands on-chain, not `String.length` (which counts UTF-16 units). */
export const byteLen = (s: string): number => new TextEncoder().encode(s).length

export function estimateEmbedGas(bytes: number): number {
  if (bytes <= 0) return 0
  return Math.ceil(bytes / 32) * SSTORE_PER_WORD + bytes * CALLDATA_PER_BYTE
}

export const humanBytes = (n: number): string =>
  n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`

export const humanGas = (g: number): string =>
  g >= 1_000_000 ? `${(g / 1_000_000).toFixed(1)}M gas` : `${Math.round(g / 1000)}k gas`

export function humanEth(gas: number): string {
  const eth = (gas * REF_GWEI) / 1e9
  return eth >= 0.001 ? `~${eth.toFixed(3)} ETH` : '<0.001 ETH'
}
