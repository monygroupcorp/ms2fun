/**
 * Alignment COMMUNITIES — one row per asset, however many targets the registry holds for it.
 *
 * The registry curates ONE venue per (target, asset), so an asset offered on two venues is two
 * targets: `MS2` on Uniswap and `MS2-ZAMM` on ZAMM are the same community, and a Cypher vault
 * refuses to convert unless the route it reads names ALGEBRA — which is why the second target has
 * to exist on chain. That is a registry constraint, not something a visitor should have to know:
 * on the wall it reads as the same community listed twice.
 *
 * So the grouping happens HERE, once, and every surface that shows communities uses it. The seed
 * says the same thing from the other side: "presenting two targets over one asset as ONE row with
 * a venue choice is the picker's job, not the registry's."
 */
import type { AlignmentTargetRow } from './useAlignmentTargets'

export interface AlignmentCommunity {
  /** The asset every target in this group curates. Lowercased; the grouping key. */
  key: string
  /** The asset token, when the targets register one. */
  token: `0x${string}` | undefined
  /**
   * The canonical target: the lowest id over this asset. Registration order is what makes this the
   * right choice rather than an arbitrary one — the plain row is registered first and the
   * venue-variant rows after it, so the lowest id carries the community's own name ("MS2") rather
   * than a venue-qualified one ("MS2-ZAMM").
   */
  primary: AlignmentTargetRow
  /** Every target over this asset, primary first — one per curated venue. */
  targets: AlignmentTargetRow[]
}

/**
 * Group targets into communities, preserving first-appearance order.
 *
 * A target with no registered asset cannot be grouped — two of them are not known to be the same
 * community — so each becomes its own single-target community rather than being merged into a
 * catch-all that would claim a relationship the chain never stated.
 */
export function groupTargetsByCommunity(
  targets: readonly AlignmentTargetRow[],
): AlignmentCommunity[] {
  const byKey = new Map<string, AlignmentCommunity>()

  for (const target of targets) {
    const key = target.token ? target.token.toLowerCase() : `untokened:${target.id.toString()}`
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, { key, token: target.token, primary: target, targets: [target] })
      continue
    }
    existing.targets.push(target)
    if (target.id < existing.primary.id) existing.primary = target
  }

  for (const community of byKey.values()) {
    community.targets.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }
  return [...byKey.values()]
}

/** The community holding `targetId`, or undefined when no target matches. */
export function findCommunityByTargetId(
  communities: readonly AlignmentCommunity[],
  targetId: bigint,
): AlignmentCommunity | undefined {
  return communities.find((c) => c.targets.some((t) => t.id === targetId))
}
