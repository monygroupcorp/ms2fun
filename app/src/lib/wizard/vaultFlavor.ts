/**
 * Vault taxonomy — derives the family/venue "flavor" of an alignment vault from its on-chain
 * `vaultType()` string, and groups a set of enriched vaults into the family → venue shape the
 * alignment picker renders. Pure + dependency-free so it's unit-testable without a chain.
 *
 * vaultType() is one of exactly: "AaveEndowment", "UniswapV4LP", "ZAMMLP", "CypherLP".
 *  - family: an "…LP" suffix ⇒ 'lp' (Liquidity); everything else ⇒ 'yield' (Yield).
 *  - venue:  for LP, the type with "LP" stripped ("UniswapV4" | "ZAMM" | "Cypher");
 *            for yield, the vaultType itself ("AaveEndowment").
 */
export type VaultFamily = 'yield' | 'lp'

export interface VaultFlavor {
  family: VaultFamily
  /** Machine venue id — "UniswapV4" | "ZAMM" | "Cypher" | "AaveEndowment" (or an unknown passthrough). */
  venue: string
}

/** Human labels for the known venues (Uniswap V4 / ZAMM / Cypher / Aave). Unknown ⇒ the id itself. */
const VENUE_LABELS: Record<string, string> = {
  UniswapV4: 'Uniswap V4',
  ZAMM: 'ZAMM',
  Cypher: 'Cypher',
  AaveEndowment: 'Aave',
}

/**
 * Venue display order (D4): Uni is the workhorse — order LP venues Uni first, then ZAMM, then
 * Cypher. Yield's single Aave venue sorts first within its own family. Unknown venues sort last.
 */
const VENUE_ORDER: Record<string, number> = {
  AaveEndowment: 0,
  UniswapV4: 0,
  ZAMM: 1,
  Cypher: 2,
}

export function venueLabel(venue: string): string {
  return VENUE_LABELS[venue] ?? venue
}

export function deriveVaultFlavor(vaultType: string): VaultFlavor {
  if (vaultType.endsWith('LP')) {
    return { family: 'lp', venue: vaultType.slice(0, -'LP'.length) }
  }
  return { family: 'yield', venue: vaultType }
}

/** The minimal enriched-vault shape the grouping needs (RegisteredVault is a superset). */
export interface VaultLike {
  family: VaultFamily
  venue: string
  ready: boolean
}

/** One venue choice within a family: the resolved vault plus its O2 gating state. */
export interface VenueOption<V> {
  venue: string
  venueLabel: string
  /** The vault this venue resolves to (there's normally one per target per venue). */
  vault: V
  ready: boolean
  /** O2: an LP venue that isn't liquidity-ready can't be selected (its graduation would fail). */
  disabled: boolean
}

export interface FamilyGroup<V> {
  family: VaultFamily
  venues: VenueOption<V>[]
}

/** Families render Yield first, then Liquidity. */
const FAMILY_ORDER: VaultFamily[] = ['yield', 'lp']

/**
 * Group enriched vaults into families → venues for the picker. Within a venue we collapse to one
 * vault (normally there's a single vault per venue); a ready vault wins over an unready one so a
 * selectable option is preferred. An LP venue with no ready vault is surfaced DISABLED (O2) rather
 * than dropped, so the creator can see it exists but can't pick something whose graduation fails.
 * Yield/Aave is always ready.
 */
export function groupVaultsByFamily<V extends VaultLike>(vaults: readonly V[]): FamilyGroup<V>[] {
  const byFamily = new Map<VaultFamily, Map<string, V>>()
  for (const v of vaults) {
    let venues = byFamily.get(v.family)
    if (!venues) {
      venues = new Map()
      byFamily.set(v.family, venues)
    }
    const existing = venues.get(v.venue)
    // Prefer a ready vault; otherwise keep the first seen for the venue.
    if (!existing || (!existing.ready && v.ready)) venues.set(v.venue, v)
  }

  const groups: FamilyGroup<V>[] = []
  for (const family of FAMILY_ORDER) {
    const venues = byFamily.get(family)
    if (!venues) continue
    const options: VenueOption<V>[] = [...venues.values()]
      .map((vault) => ({
        venue: vault.venue,
        venueLabel: venueLabel(vault.venue),
        vault,
        ready: vault.ready,
        // Yield is always ready; only an unready LP venue is gated off.
        disabled: family === 'lp' && !vault.ready,
      }))
      .sort(
        (a, b) =>
          (VENUE_ORDER[a.venue] ?? 99) - (VENUE_ORDER[b.venue] ?? 99) ||
          a.venue.localeCompare(b.venue),
      )
    groups.push({ family, venues: options })
  }
  return groups
}
