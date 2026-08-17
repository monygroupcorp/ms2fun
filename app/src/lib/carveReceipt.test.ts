/**
 * The graduation carve settlement, read from logs. Two call sites depend on this arithmetic being in
 * one place — the creator's in-session receipt and the public post-graduation disclosure — so the
 * union rule (`CreatorCarvePaid.paid + GraduationExcessTithed.amount`) is asserted here rather than
 * at either surface.
 *
 * The union is the substance: the deployer module caps `CreatorCarvePaid.paid` to the requested leg
 * alone, and reports any LP-share ETH the parity clamp could not place at pool price on a separate
 * `GraduationExcessTithed`. Because the carve request defaults to 0, the excess-only case is the
 * COMMON one — ETH reaches the creator's wallet with no `CreatorCarvePaid` emitted at all.
 */
import { describe, expect, it } from 'vitest'
import { encodeAbiParameters, encodeEventTopics, type Log } from 'viem'
import { liquidityDeployerModuleAbi } from '../generated/contracts'
import { carveCreatorNet } from './carve'
import { carveSettlementFromLogs } from './carveReceipt'

const INSTANCE = '0x1111111111111111111111111111111111111111' as const
const CREATOR = '0x2222222222222222222222222222222222222222' as const

// viem does not export a one-call `encodeEventLog`, so the two halves are built separately:
// `encodeEventTopics` for the indexed args, `encodeAbiParameters` for the non-indexed ones that land
// in `data` (both events index only `instance`/`creator`; the wei amounts are non-indexed).
function carvePaidLog(paid: bigint, requested = paid): Log {
  const topics = encodeEventTopics({
    abi: liquidityDeployerModuleAbi,
    eventName: 'CreatorCarvePaid',
    args: { instance: INSTANCE, creator: CREATOR },
  })
  const data = encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [requested, paid])
  return { data, topics } as unknown as Log
}

function excessTithedLog(amount: bigint): Log {
  const topics = encodeEventTopics({
    abi: liquidityDeployerModuleAbi,
    eventName: 'GraduationExcessTithed',
    args: { instance: INSTANCE },
  })
  const data = encodeAbiParameters([{ type: 'uint256' }], [amount])
  return { data, topics } as unknown as Log
}

/** A log this ABI cannot decode — another contract's event sharing the same window. */
function foreignLog(): Log {
  return {
    data: '0x',
    topics: ['0x1234567890123456789012345678901234567890123456789012345678901234'],
  } as unknown as Log
}

describe('carveSettlementFromLogs', () => {
  it('sums the requested leg and the tithed excess into one gross', () => {
    const s = carveSettlementFromLogs([carvePaidLog(1000n), excessTithedLog(500n)])
    expect(s.gross).toBe(1500n)
  })

  it('an excess-only graduation still reports a gross — the defaulted-to-zero request case', () => {
    const s = carveSettlementFromLogs([excessTithedLog(500n)])
    expect(s.gross).toBe(500n)
    expect(s.creatorNet).toBeGreaterThan(0n)
  })

  it('a requested-carve-only graduation reports the paid figure', () => {
    expect(carveSettlementFromLogs([carvePaidLog(1000n)]).gross).toBe(1000n)
  })

  it('no carve events at all is a gross of zero, not a failure', () => {
    const s = carveSettlementFromLogs([])
    expect(s).toEqual({ gross: 0n, protocol: 0n, vault: 0n, creatorNet: 0n })
  })

  it('logs this ABI cannot decode are skipped, not fatal', () => {
    const s = carveSettlementFromLogs([foreignLog(), carvePaidLog(1000n), foreignLog()])
    expect(s.gross).toBe(1000n)
  })

  it('splits 1 / 19 / 80 with the creator taking the residual, and the parts sum to the gross', () => {
    const gross = 1_141_101_206_263_873_236n + 14_263_765_078_298_415n + 271_011_536_487_669_893n
    const s = carveSettlementFromLogs([carvePaidLog(gross)])
    expect(s.protocol).toBe(gross / 100n)
    expect(s.vault).toBe((gross * 19n) / 100n)
    expect(s.creatorNet).toBe(carveCreatorNet(gross))
    expect(s.protocol + s.vault + s.creatorNet).toBe(gross)
  })
})

// noesis-220 acceptance leg 6: the union must have exactly ONE implementation. Reading
// `CreatorCarvePaid.paid` alone understates the settlement whenever the parity clamp leaves excess,
// and reports nothing at all in the common defaulted-to-zero-request case — a second hand-rolled
// decode anywhere in the tree is how that comes back. This walks the source rather than trusting a
// convention, so a future copy fails here instead of shipping.
describe('the union arithmetic is not duplicated', () => {
  // Every source file in `src`, as raw text. `import.meta.glob` resolves at transform time, so this
  // sees the tree as it is on disk rather than as this test imagines it.
  const sources = import.meta.glob('../**/*.{ts,tsx}', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>

  const nonTestSources = Object.entries(sources).filter(([path]) => !/\.test\.tsx?$/.test(path))

  it('exactly one source file decodes GraduationExcessTithed, and it is this module', () => {
    const decoders = nonTestSources
      .filter(([, text]) => text.includes("eventName === 'GraduationExcessTithed'"))
      .map(([path]) => path)
    expect(decoders).toEqual(['./carveReceipt.ts'])
  })

  it('exactly one source file declares carveReceiptFromLogs — the receipt adapter over it', () => {
    const declarers = nonTestSources.filter(([, text]) =>
      /function carveReceiptFromLogs\b/.test(text),
    )
    expect(declarers).toHaveLength(1)
  })
})
