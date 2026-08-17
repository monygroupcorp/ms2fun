import { describe, expect, it } from 'vitest'
import { aggregateContributions, attributeVaults, formatReport } from './aggregate'
import type { ContributionLog, HazardLog } from './aggregate'

const ETH = 1_000_000_000_000_000_000n

const UNI_VAULT = '0x0000000000000000000000000000000000a001' as const
const ENDOWMENT_VAULT = '0x0000000000000000000000000000000000a002' as const
const UNATTRIBUTED_VAULT = '0x0000000000000000000000000000000000a003' as const

const COLLECTION_A = '0x0000000000000000000000000000000000b001' as const
const COLLECTION_B = '0x0000000000000000000000000000000000b002' as const

describe('attributeVaults', () => {
  it('both target-id field names resolve, and share a target when they match', () => {
    // UNI_VAULT probed via alignmentTargetId(), ENDOWMENT_VAULT via targetId() — the script resolves
    // the field name; attributeVaults just zips vault + resolved id.
    const records = attributeVaults([UNI_VAULT, ENDOWMENT_VAULT], [1n, 1n])
    expect(records).toEqual([
      { vault: UNI_VAULT, targetId: 1n },
      { vault: ENDOWMENT_VAULT, targetId: 1n },
    ])

    const report = aggregateContributions(
      records,
      [
        { vault: UNI_VAULT, benefactor: COLLECTION_A, amount: ETH },
        { vault: ENDOWMENT_VAULT, benefactor: COLLECTION_B, amount: 2n * ETH },
      ],
      [],
      [],
    )

    expect(report.targets).toHaveLength(1)
    expect(report.targets[0]!.targetId).toBe(1n)
    expect(report.targets[0]!.delivered).toBe(3n * ETH)
  })

  it('throws on mismatched array lengths', () => {
    expect(() => attributeVaults([UNI_VAULT], [])).toThrow()
  })
})

describe('aggregateContributions', () => {
  it('groups two collections tithing to one target under that target, reported per collection', () => {
    const vaults = attributeVaults([UNI_VAULT], [7n])
    const contributions: ContributionLog[] = [
      { vault: UNI_VAULT, benefactor: COLLECTION_A, amount: ETH },
      { vault: UNI_VAULT, benefactor: COLLECTION_B, amount: 2n * ETH },
    ]

    const report = aggregateContributions(vaults, contributions, [], [])

    expect(report.targets).toHaveLength(1)
    const group = report.targets[0]!
    expect(group.targetId).toBe(7n)
    expect(group.delivered).toBe(3n * ETH)
    expect(group.benefactors).toHaveLength(2)
    const a = group.benefactors.find((b) => b.benefactor === COLLECTION_A)
    const b = group.benefactors.find((b) => b.benefactor === COLLECTION_B)
    expect(a?.delivered).toBe(ETH)
    expect(b?.delivered).toBe(2n * ETH)
  })

  it('a redirected cut appears on the redirected line and is not in delivered', () => {
    const vaults = attributeVaults([UNI_VAULT], [3n])
    const redirect: HazardLog[] = [{ vault: UNI_VAULT, benefactor: COLLECTION_A, amount: ETH }]

    const report = aggregateContributions(vaults, [], redirect, [])

    const group = report.targets[0]!
    expect(group.redirected).toBe(ETH)
    expect(group.delivered).toBe(0n)
    expect(report.totals.delivered).toBe(0n)
    expect(report.totals.redirected).toBe(ETH)
  })

  it('a failed/queued cut appears on the pending line and is not in delivered', () => {
    const vaults = attributeVaults([UNI_VAULT], [3n])
    const failed: HazardLog[] = [{ vault: UNI_VAULT, benefactor: COLLECTION_A, amount: ETH }]

    const report = aggregateContributions(vaults, [], [], failed)

    const group = report.targets[0]!
    expect(group.pending).toBe(ETH)
    expect(group.delivered).toBe(0n)
    expect(report.totals.pending).toBe(ETH)
  })

  it('does not accept a GraduationExcessTithed-shaped input as a contribution source at all', () => {
    // The aggregator's signature has no parameter for it — a graduation's delivered total can only
    // ever equal the ContributionReceived amount, never that plus a gross excess-diverted figure.
    const vaults = attributeVaults([UNI_VAULT], [9n])
    const graduationContribution: ContributionLog[] = [
      { vault: UNI_VAULT, benefactor: COLLECTION_A, amount: ETH },
    ]

    const report = aggregateContributions(vaults, graduationContribution, [], [])

    expect(report.targets[0]!.delivered).toBe(ETH)
    expect(report.totals.delivered).toBe(ETH)
  })

  it('a vault whose target read failed is reported as unattributed rather than dropped', () => {
    const vaults = attributeVaults([UNATTRIBUTED_VAULT], [null])
    const contributions: ContributionLog[] = [
      { vault: UNATTRIBUTED_VAULT, benefactor: COLLECTION_A, amount: ETH },
    ]

    const report = aggregateContributions(vaults, contributions, [], [])

    expect(report.targets).toHaveLength(1)
    expect(report.targets[0]!.targetId).toBeNull()
    expect(report.targets[0]!.delivered).toBe(ETH)
  })

  it('a benefactor that is a known vault throws', () => {
    const vaults = attributeVaults([UNI_VAULT, ENDOWMENT_VAULT], [1n, 2n])
    const metaVaultContribution: ContributionLog[] = [
      { vault: UNI_VAULT, benefactor: ENDOWMENT_VAULT, amount: ETH },
    ]

    expect(() => aggregateContributions(vaults, metaVaultContribution, [], [])).toThrow()
  })

  it('throws on a log referencing a vault outside the known set', () => {
    const vaults = attributeVaults([UNI_VAULT], [1n])
    const contributions: ContributionLog[] = [
      { vault: '0x0000000000000000000000000000000000dead', benefactor: COLLECTION_A, amount: ETH },
    ]

    expect(() => aggregateContributions(vaults, contributions, [], [])).toThrow()
  })

  it('reports a null-benefactor hazard log (module-routed redirect with no instance field) as unattributed', () => {
    const vaults = attributeVaults([UNI_VAULT], [4n])
    const redirect: HazardLog[] = [{ vault: UNI_VAULT, benefactor: null, amount: ETH }]

    const report = aggregateContributions(vaults, [], redirect, [])

    const group = report.targets[0]!
    expect(group.redirected).toBe(ETH)
    expect(group.benefactors).toHaveLength(1)
    expect(group.benefactors[0]!.benefactor).toBeNull()
  })
})

describe('formatReport', () => {
  it('includes the contribution-is-not-a-payout caveat', () => {
    const vaults = attributeVaults([UNI_VAULT], [1n])
    const report = aggregateContributions(
      vaults,
      [{ vault: UNI_VAULT, benefactor: COLLECTION_A, amount: ETH }],
      [],
      [],
    )

    const text = formatReport(report, new Map([['1', 'Sample Target']]))

    expect(text).toContain('not a payout')
    expect(text).toContain('Sample Target')
  })
})
