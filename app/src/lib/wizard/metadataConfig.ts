/**
 * Encodes the metadata-resolution stack (ADR-0006/0007) into the on-chain `MetadataConfig` tuple
 * threaded through the ERC404 `createInstance` 7-arg overload — so the resolver pointer, router
 * children, and the (immutable) tier table are all wired in the SAME create tx.
 *
 * The wizard exposes three optional module slots: `resolver` (a MetadataResolverRouter), `overlay`
 * (MetadataOverlayModule) and `tier` (TierRevealModule). This module maps those selections + the
 * `metadata-tier`/`metadata-overlay` config forms (see configTypes.ts) onto the contract struct:
 *
 *   - resolver (router) selected  → it is the instance's METADATA_RESOLVER target; the selected
 *     children [overlay, tier] become its precedence-ordered list.
 *   - no router, exactly one child → the instance points DIRECTLY at that single module (childResolvers
 *     empty) — the contract supports a single-module resolver without a router.
 *   - no router, two children      → invalid: stacking needs a router (validation flags it).
 *
 * The tier table has no list-of-group renderer, so — exactly like password-tier-gating — it is
 * captured as PARALLEL lists (`tierIdStarts.N`, `tierIdEnds.N`, …) and zipped by row index here.
 *
 * Pure TS (no React/wagmi) so it's unit-testable and shared by the wizard + NOEMA. Mirrors the
 * `gatingConfig.ts` pattern.
 */

import { parseUnits } from 'viem'

// Local copy (NOT imported from ./submit) — submit.ts imports this module, so importing back would
// create a cycle that leaves the const undefined during init. Same literal as submit's ZERO_ADDRESS.
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const

/** Whole-token count decimals for these ERC-404/1155/721 amounts (all 18-decimal). */
const TOKEN_DECIMALS = 18

// ── On-chain shapes (viem-inferred) ───────────────────────────────────────────

/** One TierRevealModule.Tier row (idStart/idEnd uint256, minBalance uint256, two string URIs). */
export interface MetadataTier {
  idStart: bigint
  idEnd: bigint
  minBalance: bigint
  baseURI: string
  lockedURI: string
}

/** The `MetadataConfig` struct the factory's 7-arg `createInstance` overload takes. */
export interface MetadataConfigValue {
  resolver: `0x${string}`
  childResolvers: `0x${string}`[]
  overlay: `0x${string}`
  tier: `0x${string}`
  tiers: MetadataTier[]
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

function bigOrZero(v: string | undefined): bigint {
  const t = (v ?? '').trim()
  if (t === '') return 0n
  try {
    return BigInt(t)
  } catch {
    return 0n
  }
}

/**
 * Human whole-token count → exact on-chain wei bigint (× 10**18). The creator enters "1000" tokens;
 * the tier threshold is stored as the 18-decimal token amount. Empty/garbage/negative → 0n (no throw).
 */
function tokensToWei(v: string | undefined): bigint {
  const t = (v ?? '').trim()
  if (t === '' || !/^\d*\.?\d*$/.test(t) || t === '.') return 0n
  try {
    const wei = parseUnits(t, TOKEN_DECIMALS)
    return wei < 0n ? 0n : wei
  } catch {
    return 0n
  }
}

const nonZero = (a: `0x${string}` | undefined): a is `0x${string}` =>
  a !== undefined && a !== ZERO_ADDRESS

// ── tier table ────────────────────────────────────────────────────────────────

/**
 * Zip the parallel tier lists into Tier rows. A row is DROPPED when its start id is blank (so a
 * half-filled trailing row never reaches the contract), keeping the table dense + ordered.
 */
export function encodeTiers(values: Record<string, string>): MetadataTier[] {
  const starts = readList(values, 'tierIdStarts')
  const ends = readList(values, 'tierIdEnds')
  const mins = readList(values, 'tierMinBalances')
  const bases = readList(values, 'tierBaseURIs')
  const lockeds = readList(values, 'tierLockedURIs')

  const tiers: MetadataTier[] = []
  starts.forEach((s, i) => {
    if (s.trim() === '') return // drop empty rows (and their paired entries)
    tiers.push({
      idStart: bigOrZero(s),
      idEnd: bigOrZero(ends[i]),
      minBalance: tokensToWei(mins[i]), // creator enters whole tokens; scaled to 18-decimal wei here
      baseURI: (bases[i] ?? '').trim(),
      lockedURI: (lockeds[i] ?? '').trim(),
    })
  })
  return tiers
}

// ── supply summary (live "total IDs" helper math) ─────────────────────────────

/** The running base + tiers → total-ids math the wizard shows beside the tier table. */
export interface TierSupplySummary {
  /** The ERC404 core supply the creator entered (0 when not yet set). */
  nftCount: bigint
  /** Whether the supply is known (> 0) — gates the ⊆-supply verdict. */
  supplyKnown: boolean
  /** At least one tier row is present. */
  hasTiers: boolean
  /** Lowest tier start id (0 when no tiers). */
  minId: bigint
  /** Highest tier end id (0 when no tiers). */
  maxId: bigint
  /** Total ids the tier ranges cover — Σ (idEnd − idStart + 1) over well-formed rows. */
  tierIdCount: bigint
  /** Untiered base ids — `nftCount − tierIdCount`, clamped ≥ 0. Meaningful only when within supply. */
  untieredCount: bigint
  /** Every tier range fits within `[1, nftCount]`. True (vacuously) when supply unknown or no tiers. */
  withinSupply: boolean
}

/**
 * Compute the base + tiers → total-ids breakdown from the current tier form + core supply. Pure (no
 * React) so it's unit-testable and shared by the helper component. Malformed rows (idEnd < idStart)
 * contribute 0 to the covered count rather than a negative — the validator surfaces the error
 * separately; this summary just avoids lying about coverage.
 */
export function tierSupplySummary(
  values: Record<string, string>,
  nftCount: bigint,
): TierSupplySummary {
  const tiers = encodeTiers(values)
  const supplyKnown = nftCount > 0n
  if (tiers.length === 0) {
    return {
      nftCount,
      supplyKnown,
      hasTiers: false,
      minId: 0n,
      maxId: 0n,
      tierIdCount: 0n,
      untieredCount: nftCount,
      withinSupply: true,
    }
  }
  let minId = tiers[0]!.idStart
  let maxId = tiers[0]!.idEnd
  let tierIdCount = 0n
  for (const t of tiers) {
    if (t.idStart < minId) minId = t.idStart
    if (t.idEnd > maxId) maxId = t.idEnd
    if (t.idEnd >= t.idStart) tierIdCount += t.idEnd - t.idStart + 1n
  }
  const withinSupply = supplyKnown ? minId >= 1n && maxId <= nftCount : true
  const untieredCount = nftCount > tierIdCount ? nftCount - tierIdCount : 0n
  return {
    nftCount,
    supplyKnown,
    hasTiers: true,
    minId,
    maxId,
    tierIdCount,
    untieredCount,
    withinSupply,
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

  // Precedence-ordered children (ADR default: overlay above tier).
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
 * Validate the metadata-stack selection + tier table before submit. Returns field.key → error (only
 * failures). Mirrors the on-chain reverts (`InvalidRange`, `RangesNotAscending`) and the wiring
 * invariants so the user gets a message instead of a reverted tx.
 *
 * `nftCount` is the ERC404 core supply (whole-id count). When > 0 each tier range is additionally
 * asserted ⊆ `[1, nftCount]` — a tier ending past the supply mints DEAD ids (never reachable), a
 * silently broken collection the ascending/non-overlap checks alone don't catch. When 0/empty
 * (supply not yet entered) the ⊆-supply check is skipped so the table doesn't false-error before the
 * creator has typed a supply; the start/end sanity checks still run.
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
      errors['tierIdStarts'] = 'Tier module selected — add at least one tier row'
    }
    let prevEnd = 0n
    tiers.forEach((t, i) => {
      // Start id must be a real token id (1-based). Catches an explicit 0/blank-coerced start.
      if (t.idStart < 1n) {
        errors[`tierIdStarts.${i}`] = `tier ${i + 1}: start id must be ≥ 1`
      } else if (t.idStart <= prevEnd) {
        errors[`tierIdStarts.${i}`] = `tier ${i + 1}: ranges must be ascending + non-overlapping`
      }
      if (t.idEnd < t.idStart) {
        errors[`tierIdEnds.${i}`] = `tier ${i + 1}: end id must be ≥ start id`
      } else if (nftCount > 0n && t.idEnd > nftCount) {
        // Range extends past the minted set → those ids never exist (dead tier). Only checked once a
        // supply is known; the specific number lets the creator raise supply or lower the range.
        errors[`tierIdEnds.${i}`] =
          `tier ${i + 1}: end id ${t.idEnd} exceeds NFT supply ${nftCount} — raise supply or lower the range`
      }
      // Tier URIs are intentionally NOT required — the main collection URI is optional (art-optional),
      // so blocking deploy on a per-tier URI is inconsistent. A blank URI encodes as an empty string.
      prevEnd = t.idEnd
    })
  }

  return errors
}
