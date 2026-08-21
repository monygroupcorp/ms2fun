import { describe, expect, it } from 'vitest'
import {
  rollUpByTarget,
  rollupsByTargetKey,
  targetFigureLabel,
  targetFigureNote,
  totalEndowmentPrincipal,
  vaultTargetLabel,
  type RollupVaultInput,
} from './targetRollup'

const A = '0xAAaAAaAAaAAAAaAaaAaAAaAAAaaAaAaAaAAAAAAa' as const
const B = '0xBbBBBBBbBbBbbbbBBbBbbbBBbBBbbbbBbBBbBbBb' as const
const C = '0xCcCCcCCCcCCCCcCCcccCCcCcCcCcCCcCCCcCcCcC' as const
const D = '0xdDdDDDdDdDDddddDdDDDDddDDdDDDddDDDdddddD' as const

const ONE_ETH = 1_000_000_000_000_000_000n

function endowment(
  address: `0x${string}`,
  principal: bigint,
  targetId: bigint | null,
  collectionCount = 1,
): RollupVaultInput {
  return {
    address,
    collectionCount,
    vaultType: 'AaveEndowment',
    totalPrincipal: principal,
    accumulatedFees: 0n,
    targetId,
  }
}

function lp(
  address: `0x${string}`,
  fees: bigint,
  targetId: bigint | null,
  collectionCount = 1,
): RollupVaultInput {
  return {
    address,
    collectionCount,
    vaultType: 'UniV4',
    totalPrincipal: undefined,
    accumulatedFees: fees,
    targetId,
  }
}

describe('rollUpByTarget', () => {
  it('sums the principals of a target with two endowment vaults', () => {
    const rollups = rollUpByTarget(
      [endowment(A, 2n * ONE_ETH, 1n), endowment(B, 3n * ONE_ETH, 1n, 4)],
      [1n],
    )
    expect(rollups).toHaveLength(1)
    expect(rollups[0]!.endowmentPrincipal).toBe(5n * ONE_ETH)
    expect(rollups[0]!.vaultCount).toBe(2)
    expect(rollups[0]!.collectionCount).toBe(5)
  })

  it('reports LP fees separately and never adds them into the principal', () => {
    const rollups = rollUpByTarget([endowment(A, ONE_ETH, 1n), lp(B, 7n * ONE_ETH, 1n)], [1n])
    expect(rollups[0]!.endowmentPrincipal).toBe(ONE_ETH)
    expect(rollups[0]!.lpFees).toBe(7n * ONE_ETH)
    expect(targetFigureLabel(rollups[0], false)).toBe('1 ETH')
    expect(targetFigureNote(rollups[0], false)).toContain('7 ETH LP fees')
  })

  it('puts a vault whose target read failed into the rendered unattributed group', () => {
    const rollups = rollUpByTarget(
      [endowment(A, ONE_ETH, 1n), endowment(B, 2n * ONE_ETH, null)],
      [1n],
    )
    const byKey = rollupsByTargetKey(rollups)
    expect(byKey.get('unattributed')?.endowmentPrincipal).toBe(2n * ONE_ETH)
    expect(byKey.get('1')?.endowmentPrincipal).toBe(ONE_ETH)
  })

  it('treats target id 0 and an id with no active target as unattributed', () => {
    const rollups = rollUpByTarget(
      [endowment(A, ONE_ETH, 0n), endowment(B, 2n * ONE_ETH, 99n), endowment(C, 4n * ONE_ETH, 1n)],
      [1n],
    )
    const byKey = rollupsByTargetKey(rollups)
    expect(byKey.get('unattributed')?.endowmentPrincipal).toBe(3n * ONE_ETH)
    expect(byKey.get('unattributed')?.vaultCount).toBe(2)
    expect(byKey.get('1')?.endowmentPrincipal).toBe(4n * ONE_ETH)
  })

  it('renders a target with no vaults as zero rather than dropping it', () => {
    const rollups = rollUpByTarget([endowment(A, ONE_ETH, 1n)], [1n, 2n])
    const byKey = rollupsByTargetKey(rollups)
    expect(byKey.get('2')?.endowmentPrincipal).toBe(0n)
    expect(targetFigureLabel(byKey.get('2'), false)).toBe('0 ETH')
  })

  it('omits the unattributed group entirely when every vault is attributed', () => {
    const rollups = rollUpByTarget([endowment(A, ONE_ETH, 1n)], [1n])
    expect(rollupsByTargetKey(rollups).has('unattributed')).toBe(false)
  })

  it('sums to the global endowment total, unattributed vaults included', () => {
    const vaults = [
      endowment(A, ONE_ETH, 1n),
      endowment(B, 2n * ONE_ETH, 2n),
      endowment(C, 4n * ONE_ETH, null),
      lp(D, 9n * ONE_ETH, 1n),
    ]
    // The same rule the header's `endowmentTvl` applies: endowment principals only.
    const globalEndowmentTvl = vaults.reduce(
      (sum, v) => sum + (v.vaultType === 'AaveEndowment' ? (v.totalPrincipal ?? 0n) : 0n),
      0n,
    )
    const rollups = rollUpByTarget(vaults, [1n, 2n])
    expect(totalEndowmentPrincipal(rollups)).toBe(globalEndowmentTvl)
  })
})

describe('targetFigureLabel / targetFigureNote', () => {
  it('renders the pending state rather than a confident zero', () => {
    expect(targetFigureLabel(undefined, true)).toBe('…')
    expect(
      targetFigureLabel(
        { targetId: 1n, endowmentPrincipal: 0n, lpFees: 0n, vaultCount: 0, collectionCount: 0 },
        true,
      ),
    ).toBe('…')
    expect(targetFigureNote(undefined, true)).toBe('reading vaults…')
  })

  it('states the figure scope in the header voice', () => {
    const note = targetFigureNote(
      { targetId: 1n, endowmentPrincipal: ONE_ETH, lpFees: 0n, vaultCount: 1, collectionCount: 2 },
      false,
    )
    expect(note).toContain('principal locked in endowment vaults')
    expect(note).toContain('1 vault')
    expect(note).toContain('2 collections')
  })
})

describe('vaultTargetLabel', () => {
  const titles = new Map([['1', 'Some Community']])

  it('names the target a row is counted under', () => {
    expect(vaultTargetLabel(1n, titles)).toBe('Some Community')
  })

  it('reads unattributed for a failed, zero, or inactive target', () => {
    expect(vaultTargetLabel(null, titles)).toBe('unattributed')
    expect(vaultTargetLabel(0n, titles)).toBe('unattributed')
    expect(vaultTargetLabel(42n, titles)).toBe('unattributed')
  })

  it('reads as pending while the target read is unresolved', () => {
    expect(vaultTargetLabel(undefined, titles)).toBe('…')
  })
})
