/**
 * Pure aggregation for the tithe report. No RPC, no viem client, no `process`, no I/O — this module
 * only groups already-fetched log data. `../../../scripts/tithe-report.ts` is the thin runner that
 * fetches logs and hands them here.
 *
 * The recipe (enumeration via `InstanceRegistered` + `getInstanceVaults`, target attribution via
 * `alignmentTargetId()` / `targetId()`, the five accounting hazards) is derived in full elsewhere;
 * this file implements it. See the module doc on `aggregateContributions` for the hazard handling.
 */

type Address = `0x${string}`

/** One vault, attributed to a target (or not — a failed read is retained, never dropped). */
export interface VaultRecord {
  vault: Address
  /** `null` = the target read failed for this vault (neither `alignmentTargetId()` nor `targetId()`
   *  resolved). Reported as its own "unattributed" group rather than dropped. */
  targetId: bigint | null
}

/** A decoded `ContributionReceived(benefactor, amount)` log, tagged with the vault it came from. */
export interface ContributionLog {
  vault: Address
  benefactor: Address
  amount: bigint
}

/**
 * A decoded `VaultCutRedirected` / `VaultContributionFailed` log, tagged with the vault it concerns.
 * `benefactor` is `null` when the emitting event shape carries no benefactor/instance field — this is
 * a real gap for `VaultCutRedirected` emitted by the three liquidity deployer modules or
 * `MetadataOverlayModule` (module-routed redirects carry no `instance` field at all), and must be
 * reported as its own "unattributed" line, never guessed or dropped.
 */
export interface HazardLog {
  vault: Address
  benefactor: Address | null
  amount: bigint
}

/** Per-collection totals within one target group. `benefactor: null` = unattributed (see `HazardLog`). */
export interface BenefactorTotals {
  benefactor: Address | null
  delivered: bigint
  redirected: bigint
  pending: bigint
}

/** One target's totals, broken down by contributing collection. */
export interface TargetGroup {
  /** `null` = vaults whose target could not be read (see `VaultRecord.targetId`). */
  targetId: bigint | null
  benefactors: BenefactorTotals[]
  delivered: bigint
  redirected: bigint
  pending: bigint
}

export interface TitheReport {
  targets: TargetGroup[]
  totals: { delivered: bigint; redirected: bigint; pending: bigint }
}

const UNATTRIBUTED_TARGET = 'unattributed-target'
const UNATTRIBUTED_BENEFACTOR = 'unattributed-benefactor'

function targetKey(targetId: bigint | null): string {
  return targetId === null ? UNATTRIBUTED_TARGET : targetId.toString()
}

function benefactorKey(benefactor: Address | null): string {
  return benefactor === null ? UNATTRIBUTED_BENEFACTOR : benefactor.toLowerCase()
}

/**
 * Pair vault addresses with their probed target ids. `targetIds[i]` is the resolved target for
 * `vaults[i]` (or `null` on a failed probe) — the caller (the script) does the `eth_call` probing;
 * this function only zips the results into records.
 */
export function attributeVaults(
  vaults: readonly Address[],
  targetIds: readonly (bigint | null)[],
): VaultRecord[] {
  if (vaults.length !== targetIds.length) {
    throw new Error('attributeVaults: vaults and targetIds must be the same length')
  }
  return vaults.map((vault, i) => ({ vault, targetId: targetIds[i] ?? null }))
}

/**
 * Group `delivered` (`ContributionReceived`), `redirected` (`VaultCutRedirected`) and `pending`
 * (`VaultContributionFailed`) into `TargetGroup`s, each broken down by contributing collection.
 *
 * The three totals are kept strictly separate and are never netted against each other (hazards 1
 * and 2): a redirected cut is real revenue that never reached the community, and a pending cut is
 * money still sitting in a contract, not yet delivered. `GraduationExcessTithed` is not accepted as
 * an input at all — hazard 5 — so it cannot be summed in by construction.
 *
 * Guard (per the source audit's meta-vault note): a `benefactor` that is itself one of the known
 * vaults means a meta-vault is routing through another vault, which breaks the no-double-count
 * guarantee this aggregation relies on. That case throws rather than silently summing.
 */
export function aggregateContributions(
  vaults: readonly VaultRecord[],
  contributionLogs: readonly ContributionLog[],
  redirectLogs: readonly HazardLog[],
  failedLogs: readonly HazardLog[],
): TitheReport {
  const vaultSet = new Set(vaults.map((v) => v.vault.toLowerCase()))
  const targetIdByVault = new Map(vaults.map((v) => [v.vault.toLowerCase(), v.targetId]))

  const groups = new Map<string, TargetGroup>()
  const benefactorRows = new Map<string, Map<string, BenefactorTotals>>()

  const resolveTargetId = (vault: Address, kind: string): bigint | null => {
    const key = vault.toLowerCase()
    if (!targetIdByVault.has(key)) {
      throw new Error(`aggregateContributions: ${kind} log references unknown vault ${vault}`)
    }
    return targetIdByVault.get(key) ?? null
  }

  const guardBenefactor = (benefactor: Address | null): void => {
    if (benefactor !== null && vaultSet.has(benefactor.toLowerCase())) {
      throw new Error(
        `aggregateContributions: benefactor ${benefactor} is itself a registered vault — meta-vault ` +
          'routing would double-count and is not supported',
      )
    }
  }

  const add = (
    targetId: bigint | null,
    benefactor: Address | null,
    field: 'delivered' | 'redirected' | 'pending',
    amount: bigint,
  ): void => {
    const tKey = targetKey(targetId)
    let group = groups.get(tKey)
    if (!group) {
      group = { targetId, benefactors: [], delivered: 0n, redirected: 0n, pending: 0n }
      groups.set(tKey, group)
      benefactorRows.set(tKey, new Map())
    }
    group[field] += amount

    const bKey = benefactorKey(benefactor)
    const rows = benefactorRows.get(tKey)!
    let row = rows.get(bKey)
    if (!row) {
      row = { benefactor, delivered: 0n, redirected: 0n, pending: 0n }
      rows.set(bKey, row)
      group.benefactors.push(row)
    }
    row[field] += amount
  }

  for (const log of contributionLogs) {
    guardBenefactor(log.benefactor)
    const targetId = resolveTargetId(log.vault, 'ContributionReceived')
    add(targetId, log.benefactor, 'delivered', log.amount)
  }

  for (const log of redirectLogs) {
    guardBenefactor(log.benefactor)
    const targetId = resolveTargetId(log.vault, 'VaultCutRedirected')
    add(targetId, log.benefactor, 'redirected', log.amount)
  }

  for (const log of failedLogs) {
    guardBenefactor(log.benefactor)
    const targetId = resolveTargetId(log.vault, 'VaultContributionFailed')
    add(targetId, log.benefactor, 'pending', log.amount)
  }

  const targets = [...groups.values()]
  const totals = targets.reduce(
    (acc, g) => ({
      delivered: acc.delivered + g.delivered,
      redirected: acc.redirected + g.redirected,
      pending: acc.pending + g.pending,
    }),
    { delivered: 0n, redirected: 0n, pending: 0n },
  )

  return { targets, totals }
}

const WEI_PER_ETH = 1_000_000_000_000_000_000n

/** Format `wei` as an ETH string with up to 6 decimal places (trailing zeros trimmed). */
function formatEth(wei: bigint): string {
  const negative = wei < 0n
  const abs = negative ? -wei : wei
  const whole = abs / WEI_PER_ETH
  const frac = abs % WEI_PER_ETH
  const fracStr = (frac * 1_000_000n) / WEI_PER_ETH
  const fracPadded = fracStr.toString().padStart(6, '0').replace(/0+$/, '')
  const sign = negative ? '-' : ''
  return fracPadded.length > 0 ? `${sign}${whole}.${fracPadded} ETH` : `${sign}${whole} ETH`
}

function targetLabel(targetId: bigint | null, targetTitles: ReadonlyMap<string, string>): string {
  if (targetId === null) return 'Unattributed vaults (target read failed)'
  const title = targetTitles.get(targetId.toString())
  return title ? `${title} (target #${targetId})` : `Target #${targetId}`
}

function benefactorLabel(benefactor: Address | null): string {
  return benefactor ?? 'unknown collection (event carried no benefactor)'
}

/**
 * Render a `TitheReport` as printable text. `targetTitles` maps `targetId.toString()` →
 * `AlignmentTarget.title` (from `IAlignmentRegistry.getAlignmentTarget`). Every target block carries
 * the standing caveat for hazards 3 and 4 — this is not optional and not the operator's to remember.
 */
export function formatReport(
  report: TitheReport,
  targetTitles: ReadonlyMap<string, string>,
): string {
  const lines: string[] = []
  lines.push('Tithe report — ETH tithed on chain, by target')
  lines.push('='.repeat(60))
  lines.push('')

  for (const group of report.targets) {
    lines.push(targetLabel(group.targetId, targetTitles))
    lines.push(`  delivered: ${formatEth(group.delivered)}`)
    lines.push(
      `  redirected (target revoked, sent to protocol treasury): ${formatEth(group.redirected)}`,
    )
    lines.push(`  pending (collected, not yet delivered): ${formatEth(group.pending)}`)
    lines.push('  by collection:')
    for (const row of group.benefactors) {
      lines.push(
        `    ${benefactorLabel(row.benefactor)} — delivered ${formatEth(row.delivered)}, ` +
          `redirected ${formatEth(row.redirected)}, pending ${formatEth(row.pending)}`,
      )
    }
    lines.push(
      "  Note: these figures are ETH tithed INTO this target's vault(s), not a payout to the " +
        "target's community treasury — the liquidity-family vaults buy and LP the target token " +
        'rather than forwarding ETH, and any token amount is a swap outcome not read here.',
    )
    lines.push('')
  }

  lines.push('TOTAL')
  lines.push(`  delivered: ${formatEth(report.totals.delivered)}`)
  lines.push(`  redirected: ${formatEth(report.totals.redirected)}`)
  lines.push(`  pending: ${formatEth(report.totals.pending)}`)

  return lines.join('\n')
}
