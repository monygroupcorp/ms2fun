/**
 * Encodes the metadata-resolution stack (ADR-0006/0007) into the on-chain `MetadataConfig` tuple
 * threaded through the ERC404 `createInstance` 7-arg overload — so the resolver pointer, router
 * children, and the (immutable) Token Tiers ladder are all wired in the SAME create tx.
 *
 * The wizard exposes three optional module slots: `resolver` (a MetadataResolverRouter), `overlay`
 * (MetadataOverlayModule) and `tier` (TokenTierBandResolver). This module maps those selections +
 * the `metadata-tier`/`metadata-overlay` config forms (see configTypes.ts) onto the contract struct:
 *
 *   - resolver (router) selected  → it is the instance's METADATA_RESOLVER target; the selected
 *     children [overlay, tier] become its precedence-ordered list.
 *   - no router, exactly one child → the instance points DIRECTLY at that single module (childResolvers
 *     empty) — the contract supports a single-module resolver without a router.
 *   - no router, two children      → invalid: stacking needs a router (validation flags it).
 *
 * Token Tiers: a tier NFT is a coin DENOMINATION, and its art is STATIC — an id in band N shows
 * band N's art, unconditionally. There is no holdings threshold and no locked/teaser art.
 *
 * THE CREATOR SUPPLIES A LADDER, NOT ID RANGES. Each rung is `{weight, count, baseURI}`; the factory
 * derives every id range from it — packed contiguously above the mintable supply (`nftCount`), where
 * DN404's auto-mint can never emit them. That derivation seals BOTH the instance's economic ladder
 * and the resolver's art table from the same ranges, so the two cannot describe different ids. The
 * app must therefore never compute id ranges for submission: `tierSupplySummary` mirrors the
 * derivation for DISPLAY only.
 *
 * The ladder has no list-of-group renderer, so — exactly like password-tier-gating — it is captured
 * as PARALLEL lists (`tierWeights.N`, `tierCounts.N`, `tierBaseURIs.N`) and zipped by row index here.
 *
 * Pure TS (no React/wagmi) so it's unit-testable and shared by the wizard + NOEMA. Mirrors the
 * `gatingConfig.ts` pattern.
 */

// Local copy (NOT imported from ./submit) — submit.ts imports this module, so importing back would
// create a cycle that leaves the const undefined during init. Same literal as submit's ZERO_ADDRESS.
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const

/** The lowest denomination a tier may carry. The escrow arithmetic is `(weight - 1) * unit`, so a
 *  weight of 1 would be an ordinary id with extra steps and the seal rejects it. */
export const MIN_TIER_WEIGHT = 2

// ── On-chain shapes (viem-inferred) ───────────────────────────────────────────

/** One `ERC404Factory.TierSpec` row: uint32 weight, uint32 count, one string URI. */
export interface TierSpec {
  /** Denomination: this tier's NFT is worth `weight` coin units. >= 2, strictly increasing. */
  weight: number
  /** Ids in this tier. 0 => the maximum (`nftCount / weight`); above it the contract clamps. */
  count: number
  /** Band art prefix; resolves to `baseURI + id`. '' => fall through to the collection base. */
  baseURI: string
}

/** The `MetadataConfig` struct the factory's 7-arg `createInstance` overload takes. */
export interface MetadataConfigValue {
  resolver: `0x${string}`
  childResolvers: `0x${string}`[]
  overlay: `0x${string}`
  tier: `0x${string}`
  tiers: TierSpec[]
  autoLatest: boolean
  /** uint8 Payout enum: 0 = ARTIST, 1 = SPLIT. */
  defaultPayout: number
}

export const EMPTY_METADATA_CONFIG: MetadataConfigValue = {
  resolver: ZERO_ADDRESS,
  childResolvers: [],
  overlay: ZERO_ADDRESS,
  tier: ZERO_ADDRESS,
  tiers: [],
  autoLatest: false,
  defaultPayout: 0,
}

/** The selected metadata-stack module addresses (undefined / zero → not selected). */
export interface MetadataModuleSelection {
  resolver?: `0x${string}`
  overlay?: `0x${string}`
  tier?: `0x${string}`
}

const PAYOUT_SPLIT = 1
const PAYOUT_ARTIST = 0

// ── list helpers (shared shape with gatingConfig.ts) ──────────────────────────

/** Read a SchemaForm `list` field (`${key}.N` flat keys) into a dense, in-order string array. */
function readList(values: Record<string, string>, key: string): string[] {
  const prefix = `${key}.`
  return Object.keys(values)
    .filter((k) => k.startsWith(prefix) && /^\d+$/.test(k.slice(prefix.length)))
    .sort((a, b) => Number(a.slice(prefix.length)) - Number(b.slice(prefix.length)))
    .map((k) => values[k] ?? '')
}

/** Parse a whole-number form field. Blank / malformed / negative all read as 0. */
function numOrZero(v: string | undefined): number {
  const t = (v ?? '').trim()
  if (t === '' || !/^\d+$/.test(t)) return 0
  const n = Number(t)
  return Number.isSafeInteger(n) && n >= 0 ? n : 0
}

const nonZero = (a: `0x${string}` | undefined): a is `0x${string}` =>
  a !== undefined && a !== ZERO_ADDRESS

// ── ladder ────────────────────────────────────────────────────────────────────

/**
 * Zip the parallel ladder lists into TierSpec rows. A row is DROPPED when its weight is blank (so a
 * half-filled trailing row never reaches the contract), keeping the ladder dense + ordered.
 */
export function encodeTiers(values: Record<string, string>): TierSpec[] {
  const weights = readList(values, 'tierWeights')
  const counts = readList(values, 'tierCounts')
  const bases = readList(values, 'tierBaseURIs')

  const tiers: TierSpec[] = []
  weights.forEach((w, i) => {
    if (w.trim() === '') return // drop empty rows (and their paired entries)
    tiers.push({
      weight: numOrZero(w),
      count: numOrZero(counts[i]),
      baseURI: (bases[i] ?? '').trim(),
    })
  })
  return tiers
}

// ── derived read-out (what the contract will compute) ────────────────────────

/** One tier as the contract will derive it, for display beside the ladder form. */
export interface DerivedTier {
  /** 1-based tier number, matching `tierBands[n - 1]` on the instance. */
  tierNumber: number
  weight: number
  /** First id in the derived range (0 when the supply is unknown or the row is unusable). */
  idStart: bigint
  /** Last id in the derived range, inclusive. */
  idEnd: bigint
  /** Ids this tier actually gets — `min(count || max, max)`. */
  count: bigint
  /** The most ids the coin supply could back for this weight: `floor(nftCount / weight)`. */
  maxCount: bigint
  /** The tier is capped below `maxCount`, so it can sell out while coin remains. */
  scarce: boolean
}

/** The running supply → derived-range math the wizard shows beside the ladder form. */
export interface TierSupplySummary {
  /** The ERC404 core supply the creator entered (0 when not yet set). */
  nftCount: bigint
  /** Whether the supply is known (> 0) — ranges cannot be derived without it. */
  supplyKnown: boolean
  /** At least one ladder row is present. */
  hasTiers: boolean
  /** Per-tier derivation, in ladder order. Empty when the supply is unknown. */
  tiers: DerivedTier[]
  /** Total ids the derived bands reserve. All of them sit ABOVE `nftCount`. */
  bandIdCount: bigint
}

/**
 * Reproduce the factory's derivation for DISPLAY. Bands pack contiguously ascending from
 * `nftCount + 1`; each tier's size is `min(count || max, max)` with `max = floor(nftCount / weight)`.
 * Pure (no React) so it's unit-testable and shared by the helper component.
 *
 * A row the contract would REJECT (weight below 2, or a weight so large the band derives to zero
 * ids) contributes no range and stops the packing — `validateMetadataConfig` surfaces the error; this
 * summary just avoids inventing a range the contract would never seal.
 */
export function tierSupplySummary(
  values: Record<string, string>,
  nftCount: bigint,
): TierSupplySummary {
  const specs = encodeTiers(values)
  const supplyKnown = nftCount > 0n
  const tiers: DerivedTier[] = []
  let bandIdCount = 0n

  if (supplyKnown) {
    let prevEnd = nftCount
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i]!
      const weight = BigInt(spec.weight)
      const maxCount = weight >= BigInt(MIN_TIER_WEIGHT) ? nftCount / weight : 0n
      if (maxCount === 0n) break // unusable row — the contract reverts rather than deriving a range
      const asked = BigInt(spec.count)
      const count = asked === 0n || asked > maxCount ? maxCount : asked
      const idStart = prevEnd + 1n
      const idEnd = idStart + count - 1n
      tiers.push({
        tierNumber: i + 1,
        weight: spec.weight,
        idStart,
        idEnd,
        count,
        maxCount,
        scarce: count < maxCount,
      })
      bandIdCount += count
      prevEnd = idEnd
    }
  }

  return {
    nftCount,
    supplyKnown,
    hasTiers: specs.length > 0,
    tiers,
    bandIdCount,
  }
}

// ── encode ────────────────────────────────────────────────────────────────────

/**
 * Build the on-chain `MetadataConfig` from the selected modules + form values. Returns a config with
 * `resolver === ZERO_ADDRESS` (feature off) when there is nothing to wire — the caller then uses a
 * non-metadata create overload. Validate with `validateMetadataConfig` BEFORE calling this.
 */
export function encodeMetadataConfig(
  sel: MetadataModuleSelection,
  values: Record<string, string>,
): MetadataConfigValue {
  const overlay = nonZero(sel.overlay) ? sel.overlay : ZERO_ADDRESS
  const tier = nonZero(sel.tier) ? sel.tier : ZERO_ADDRESS

  // Precedence-ordered children (ADR default: overlay above band art).
  const children: `0x${string}`[] = []
  if (overlay !== ZERO_ADDRESS) children.push(overlay)
  if (tier !== ZERO_ADDRESS) children.push(tier)

  let resolver: `0x${string}` = ZERO_ADDRESS
  let childResolvers: `0x${string}`[] = []
  if (nonZero(sel.resolver)) {
    // Router selected → it is the pointer; children are its ordered list.
    resolver = sel.resolver
    childResolvers = children
  } else if (children.length === 1) {
    // No router but one child → point the instance directly at that module (no router needed).
    resolver = children[0]!
    childResolvers = []
  }
  // else: no router + 0 or ≥2 children → feature off (≥2 is a validation error, surfaced separately).

  const autoLatest = values['overlayAutoLatest'] === 'true'
  const defaultPayout = values['overlayDefaultPayout'] === '1' ? PAYOUT_SPLIT : PAYOUT_ARTIST

  return {
    resolver,
    childResolvers,
    overlay,
    tier,
    tiers: tier !== ZERO_ADDRESS ? encodeTiers(values) : [],
    autoLatest,
    defaultPayout,
  }
}

/** True when the encoded config actually wires something (the create must use the 7-arg overload). */
export function hasMetadataConfig(cfg: MetadataConfigValue): boolean {
  return cfg.resolver !== ZERO_ADDRESS
}

// ── validate ──────────────────────────────────────────────────────────────────

/**
 * Validate the metadata-stack selection + ladder before submit. Returns field.key → error (only
 * failures). Mirrors the create-time reverts so the user gets a message instead of a reverted tx:
 * the factory refuses a tier module with no ladder and a weight that derives a zero-width band, and
 * the instance's seal refuses a weight below 2 or a non-increasing ladder.
 *
 * `nftCount` is the ERC404 core supply (whole-id count) and therefore the instance's id ceiling. When
 * > 0 each weight is additionally checked against it: a weight above the supply derives `floor(supply
 * / weight) == 0` ids, which reverts at create. When 0/empty (supply not yet entered) that check is
 * skipped so the ladder doesn't false-error before the creator has typed a supply.
 *
 * Id ranges are NOT validated here and are not app input at all — the contract derives them, which is
 * what makes an overlapping or below-supply band unrepresentable rather than merely rejected.
 */
export function validateMetadataConfig(
  sel: MetadataModuleSelection,
  values: Record<string, string>,
  nftCount: bigint = 0n,
): Record<string, string> {
  const errors: Record<string, string> = {}
  const overlaySel = nonZero(sel.overlay)
  const tierSel = nonZero(sel.tier)
  const resolverSel = nonZero(sel.resolver)

  // Stacking two modules requires a router; a single module can be pointed at directly.
  const childCount = (overlaySel ? 1 : 0) + (tierSel ? 1 : 0)
  if (!resolverSel && childCount >= 2) {
    errors['resolver'] = 'Select a metadata resolver (router) to stack overlay + tier'
  }
  // A router with no children resolves to nothing — likely a mis-selection.
  if (resolverSel && childCount === 0) {
    errors['resolver'] = 'Resolver selected but no overlay or tier module to stack'
  }

  if (tierSel) {
    const tiers = encodeTiers(values)
    if (tiers.length === 0) {
      // A tier module wired with no ladder reverts at create — the instance's tier ops would
      // otherwise be permanent no-ops and the seal is create-only.
      errors['tierWeights'] = 'Tier module selected — add at least one tier row'
    }
    let prevWeight = 0
    tiers.forEach((t, i) => {
      if (t.weight < MIN_TIER_WEIGHT) {
        errors[`tierWeights.${i}`] =
          `tier ${i + 1}: weight must be ≥ ${MIN_TIER_WEIGHT} — a weight of 1 is an ordinary id`
      } else if (t.weight <= prevWeight) {
        errors[`tierWeights.${i}`] =
          `tier ${i + 1}: weight must be greater than tier ${i}'s (${prevWeight}) — the ladder climbs`
      } else if (nftCount > 0n && BigInt(t.weight) > nftCount) {
        errors[`tierWeights.${i}`] =
          `tier ${i + 1}: weight ${t.weight} is above the ${nftCount} NFT supply, so the tier would have no ids`
      }
      // `count` is intentionally unconstrained: 0 means "as many as the supply can back", and a
      // value above that maximum is CLAMPED by the contract rather than rejected.
      // Band URIs are intentionally NOT required — the main collection URI is optional (art-optional),
      // so blocking deploy on a per-band URI is inconsistent. A blank URI encodes as an empty string.
      prevWeight = t.weight
    })
  }

  return errors
}
