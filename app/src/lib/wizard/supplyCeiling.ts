/**
 * ERC-404 supply ceiling — the bound a launch preset puts on `nftCount`.
 *
 * An ERC404 instance is initialized with `maxSupply = nftCount * unitPerNFT * 1e18` coin units
 * (`ERC404Factory._deployAndInitialize`), and DN404 stores the total supply in a `uint96`:
 * `_totalSupplyOverflows` reverts `TotalSupplyOverflow()` (selector `0xe5cfe957`) the moment that
 * product passes `type(uint96).max`. The preset therefore fixes a HARD maximum NFT supply, and it is
 * not a small number in the "nobody will hit it" sense — with the deployed presets:
 *
 *   NICHE     unitPerNFT 1e9 →         79 NFTs
 *   STANDARD  unitPerNFT 1e6 →     79,228 NFTs
 *   HYPE      unitPerNFT 1e3 → 79,228,162 NFTs
 *
 * Nothing surfaced this: the wizard accepted any supply, priced a gas estimate for a call that could
 * not succeed, and the create reverted as "transaction failed — try again". A creator picking the
 * default preset and a round supply of 1,000 — the obvious first thing to type — could not launch.
 *
 * `unitPerNFT` is read LIVE from `LaunchManager.getPreset` (see `usePresetSupplyCeiling`), never
 * hardcoded here: presets are DAO-settable via `setPreset`, and a hardcoded mirror would silently
 * desync from the chain the first time one is retuned.
 *
 * Pure TS (no React/wagmi) so it is unit-testable and shared with NOEMA, matching the rest of
 * `lib/wizard`.
 */

/** `type(uint96).max` — DN404's total-supply field width. */
export const DN404_MAX_TOTAL_SUPPLY = (1n << 96n) - 1n

/** Coin decimals; `unit = unitPerNFT * 1e18` in `ERC404Factory._deployAndInitialize`. */
const WAD = 10n ** 18n

/**
 * The largest `nftCount` that can be created under a preset, i.e. the largest N with
 * `N * unitPerNFT * 1e18 <= type(uint96).max`. Returns 0n for a non-positive `unitPerNFT` (a preset
 * that could not have been set — `setPreset` rejects 0 — so there is no supply it would admit).
 */
export function maxNftSupplyForUnit(unitPerNFT: bigint): bigint {
  if (unitPerNFT <= 0n) return 0n
  return DN404_MAX_TOTAL_SUPPLY / (unitPerNFT * WAD)
}

/**
 * Validate a typed supply against a preset's ceiling. Returns an actionable message, or null when the
 * supply fits (or when there is nothing to check yet: blank input, unparsable input, or a ceiling not
 * yet loaded from chain — those are other validators' business, and a pending read must never
 * manufacture a blocker).
 */
export function supplyCeilingError(
  nftCountRaw: string | undefined,
  ceiling: bigint | undefined,
  presetLabel: string,
): string | null {
  if (ceiling === undefined) return null
  const t = (nftCountRaw ?? '').trim()
  if (t === '' || !/^\d+$/.test(t)) return null
  let n: bigint
  try {
    n = BigInt(t)
  } catch {
    return null
  }
  if (n <= ceiling) return null
  return (
    `NFT supply ${formatCount(n)} is above what the ${presetLabel} preset allows ` +
    `(max ${formatCount(ceiling)}). Lower the supply, or pick a preset with a smaller unit size.`
  )
}

/** Group digits so a ceiling like 79228162 is readable at a glance in a blocker line. */
export function formatCount(n: bigint): string {
  return n.toLocaleString('en-US')
}
