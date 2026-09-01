/**
 * Per-target rollup for the vaults index (`/vaults`).
 *
 * The page already shows ETH twice — one global endowment total in the header, and a figure per
 * vault row — but neither answers "how much is bound to THIS alignment target?". This module rolls
 * the per-vault figures up by target so the card carrying a target's name can carry its number too,
 * and so a visitor can add the vault rows themselves and land on the same total.
 *
 * Pure: no RPC, no hooks. The vault→target attribution itself is not reimplemented here — the
 * probed ids are zipped into records by `attributeVaults` (`../tithe/aggregate`), the same grouping
 * primitive the tithe report uses, so there is one attribution path rather than two that can drift.
 *
 * Two accounting rules are load-bearing and mirror the page's existing header note:
 *   1. Endowment principal and LP accumulated fees are reported SEPARATELY and never summed. LP
 *      positions are not valued anywhere in this app; folding fees into a principal figure would
 *      manufacture a TVL number that no read backs.
 *   2. Anything that cannot be attributed to a target the page actually renders — a failed target
 *      read, an id of 0, or an id that is not among the active targets — lands in the
 *      `unattributed` group and is reported on its own line. Attributed groups plus `unattributed`
 *      therefore always sum to the global endowment total; a figure that quietly omitted what it
 *      could not place would not survive a visitor checking it.
 */
import { formatEther } from 'viem'
import { attributeVaults } from '../tithe/aggregate'

/** Trim an ETH string to 4 fraction digits for a compact figure. */
export function ethCompact(value: bigint): string {
  const s = formatEther(value)
  const [whole, frac] = s.split('.')
  return frac ? `${whole}.${frac.slice(0, 4).replace(/0+$/, '') || '0'}` : (whole ?? s)
}

/** The per-vault inputs this rollup needs — a structural subset of `VaultRow` + `VaultSummary`. */
export interface RollupVaultInput {
  address: `0x${string}`
  /** How many collections align to this vault. */
  collectionCount: number
  /** `'AaveEndowment'` for the endowment family; undefined while the type read is unresolved. */
  vaultType: string | undefined
  /** Endowment principal; undefined for LP vaults (they revert the read). */
  totalPrincipal: bigint | undefined
  /** ETH the LP vault placed into its position, at cost; undefined for endowment vaults. */
  ethLocked: bigint | undefined
  /** ETH the LP vault holds, tithed but not yet converted into liquidity. */
  pendingEth: bigint | undefined
  /** Accrued fees, both families. */
  accumulatedFees: bigint | undefined
  /** Probed target id, or `null` when neither family's target getter resolved. */
  targetId: bigint | null
}

/** One target's rollup. `targetId: null` is the unattributed group. */
export interface TargetRollup {
  targetId: bigint | null
  /** Sum of `totalPrincipal` across this target's endowment vaults. */
  endowmentPrincipal: bigint
  /** Sum of `accumulatedFees` across this target's LP vaults. Never added to the principal. */
  lpFees: bigint
  /**
   * Sum of ETH this target's LP vaults have placed into their positions, at cost.
   *
   * Kept BESIDE the endowment principal rather than merged into it: a principal is held and
   * redeemable, an LP placement is a cost basis whose present worth moves with the pool. Adding them
   * would produce one number that means neither thing.
   */
  lpEthPlaced: bigint
  /**
   * Sum of ETH this target's LP vaults hold awaiting conversion.
   *
   * Counted, because it is the vault's ETH and it is bound to this community — it simply has not
   * been put to work yet. Named separately, because "working as liquidity" and "waiting to be" are
   * different states and one of them is an action somebody can still take.
   */
  lpPendingEth: bigint
  vaultCount: number
  collectionCount: number
}

const ENDOWMENT = 'AaveEndowment'

function emptyRollup(targetId: bigint | null): TargetRollup {
  return {
    targetId,
    endowmentPrincipal: 0n,
    lpFees: 0n,
    lpEthPlaced: 0n,
    lpPendingEth: 0n,
    vaultCount: 0,
    collectionCount: 0,
  }
}

/**
 * Roll vaults up by alignment target.
 *
 * `knownTargetIds` is the set of targets the page renders a card for. A vault whose target is not
 * in that set has nowhere to be displayed, so it is folded into the unattributed group rather than
 * into a group nothing shows — that is what keeps the rendered figures summing to the global total.
 *
 * Returns one entry per known target (in the order given, including targets with no vaults, which
 * roll up to zero and are a real answer rather than a blank), followed by the unattributed group
 * when any vault landed there.
 */
export function rollUpByTarget(
  vaults: readonly RollupVaultInput[],
  knownTargetIds: readonly bigint[],
): TargetRollup[] {
  const known = new Set(knownTargetIds.map((id) => id.toString()))
  const records = attributeVaults(
    vaults.map((v) => v.address),
    vaults.map((v) => v.targetId),
  )

  const byKey = new Map<string, TargetRollup>()
  for (const id of knownTargetIds) byKey.set(id.toString(), emptyRollup(id))
  const unattributed = emptyRollup(null)

  records.forEach((record, i) => {
    const vault = vaults[i]!
    const id = record.targetId
    // Target id 0 is never a valid target: `registerAlignmentTarget` pre-increments, so ids start
    // at 1. A zero read is therefore as unplaceable as a failed one.
    const key = id !== null && id !== 0n ? id.toString() : null
    const group = key !== null && known.has(key) ? byKey.get(key)! : unattributed

    group.vaultCount += 1
    group.collectionCount += vault.collectionCount
    if (vault.vaultType === ENDOWMENT) {
      group.endowmentPrincipal += vault.totalPrincipal ?? 0n
    } else if (vault.vaultType !== undefined) {
      group.lpFees += vault.accumulatedFees ?? 0n
      group.lpEthPlaced += vault.ethLocked ?? 0n
      group.lpPendingEth += vault.pendingEth ?? 0n
    }
  })

  const out = [...byKey.values()]
  if (unattributed.vaultCount > 0) out.push(unattributed)
  return out
}

/** Total endowment principal across every group — the rollup's own view of the header figure. */
export function totalEndowmentPrincipal(rollups: readonly TargetRollup[]): bigint {
  return rollups.reduce((sum, r) => sum + r.endowmentPrincipal, 0n)
}

/**
 * Index a rollup list by target id for card lookup. The unattributed group is keyed `'unattributed'`
 * so it is addressable rather than lost.
 */
export function rollupsByTargetKey(rollups: readonly TargetRollup[]): Map<string, TargetRollup> {
  return new Map(
    rollups.map((r) => [r.targetId === null ? 'unattributed' : r.targetId.toString(), r]),
  )
}

/**
 * The label a vault row carries so the row's ETH is visibly counted under a target. `undefined` is
 * the still-reading state; anything that does not resolve to an active target reads `unattributed`,
 * matching the group its ETH is actually rolled into.
 */
export function vaultTargetLabel(
  targetId: bigint | null | undefined,
  titles: ReadonlyMap<string, string>,
): string {
  if (targetId === undefined) return '…'
  if (targetId === null || targetId === 0n) return 'unattributed'
  return titles.get(targetId.toString()) ?? 'unattributed'
}

/**
 * The headline figure for one target card. Pending reads render the header's `…` rather than a
 * confident `0 ETH` — an unread total and an empty one are different statements. Zero itself is a
 * legitimate answer and renders as `0 ETH`.
 */
export function targetFigureLabel(rollup: TargetRollup | undefined, pending: boolean): string {
  if (pending) return '…'
  const bound =
    (rollup?.endowmentPrincipal ?? 0n) + (rollup?.lpEthPlaced ?? 0n) + (rollup?.lpPendingEth ?? 0n)
  return `${ethCompact(bound)} ETH`
}

/**
 * The scope line under the figure, in the header's voice: what the number counts, and what it
 * deliberately does not. LP fees are named separately and never folded into the figure above.
 */
export function targetFigureNote(rollup: TargetRollup | undefined, pending: boolean): string {
  if (pending) return 'reading vaults…'
  const vaults = rollup?.vaultCount ?? 0
  const collections = rollup?.collectionCount ?? 0
  const principal = rollup?.endowmentPrincipal ?? 0n
  const placed = rollup?.lpEthPlaced ?? 0n

  // The figure is a sum of two unlike things, so the note always says what went into it. An LP
  // placement is stated AT COST, because the position's present worth moves with the pool and this
  // page has no business implying otherwise.
  const parts: string[] = []
  if (principal > 0n) parts.push(`${ethCompact(principal)} ETH endowment principal`)
  if (placed > 0n) parts.push(`${ethCompact(placed)} ETH placed as liquidity, at cost`)
  const awaiting = rollup?.lpPendingEth ?? 0n
  if (awaiting > 0n) parts.push(`${ethCompact(awaiting)} ETH awaiting conversion`)
  const made = parts.length > 0 ? parts.join(' + ') : 'nothing bound yet'

  const scope =
    `${made} · ${vaults} ${vaults === 1 ? 'vault' : 'vaults'}` +
    ` · ${collections} ${collections === 1 ? 'collection' : 'collections'}`
  const fees = rollup?.lpFees ?? 0n
  return fees > 0n ? `${scope} · plus ${ethCompact(fees)} ETH LP fees` : scope
}

/**
 * Sum several targets' rollups into one.
 *
 * A COMMUNITY's figure, not a target's: an asset curated on two venues is two targets, and a
 * visitor reading one card expects the number on it to cover everything bound to that community
 * rather than to whichever venue happened to be registered first.
 */
export function sumRollups(rollups: readonly (TargetRollup | undefined)[]): TargetRollup {
  const out: TargetRollup = {
    targetId: null,
    endowmentPrincipal: 0n,
    lpFees: 0n,
    lpEthPlaced: 0n,
    lpPendingEth: 0n,
    vaultCount: 0,
    collectionCount: 0,
  }
  for (const r of rollups) {
    if (!r) continue
    out.endowmentPrincipal += r.endowmentPrincipal
    out.lpFees += r.lpFees
    out.lpEthPlaced += r.lpEthPlaced
    out.lpPendingEth += r.lpPendingEth
    out.vaultCount += r.vaultCount
    out.collectionCount += r.collectionCount
  }
  return out
}
