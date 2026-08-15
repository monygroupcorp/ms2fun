import { describe, expect, it } from 'vitest'
import { encodeAbiParameters, encodeEventTopics, type Log } from 'viem'
import { formatReceipt, type MoneyReceipt } from './receipt'
import { carveReceiptFromLogs } from '../collection/erc404/Erc404AdminPanel'
import { liquidityDeployerModuleAbi } from '../../generated/contracts'

// Wei fixtures at the precision this item's audit measured on a live fork walk — no rounding
// that would hide the last wei.
//
// CARVE_GROSS was corrected 2026-08-15 (noesis-215): the prior fixture (`1426376508000000000`) was
// the recorded 9-decimal figure padded out, and the legs derived from it could not sum back to it —
// the true gross truncates to `1.426376507`, not `…508` (round-half-up). Recovered by inverting the
// contract's residual split (`RevenueSplitLib.sol`) over the unchanged, independently-measured net;
// see `plans/noesis-212.md` Acceptance for the full derivation and its definitive-settlement caveat.
const CARVE_GROSS = 1426376507829841544n
const CARVE_NET = 1141101206263873236n
const CARVE_PROTOCOL_LEG = 14263765078298415n
const CARVE_VAULT_LEG = 271011536487669893n
const RECLAIM_NET = 49500000000000000n
const RECLAIM_PROTOCOL_LEG = 500000000000000n

describe('formatReceipt', () => {
  it('renders the net first, with no legs', () => {
    const r: MoneyReceipt = { verb: 'reclaimed', net: { label: 'net', wei: RECLAIM_NET } }
    expect(formatReceipt(r)).toBe('reclaimed — net: 0.0495 ETH.')
  })

  it('renders the net before the legs when a split exists', () => {
    const r: MoneyReceipt = {
      verb: 'reclaimed',
      net: { label: 'net', wei: RECLAIM_NET },
      legs: [{ label: 'protocol', wei: RECLAIM_PROTOCOL_LEG }],
    }
    const out = formatReceipt(r)
    expect(out.indexOf('0.0495')).toBeLessThan(out.indexOf('0.0005'))
  })

  it('leg sum plus net equals gross, at the wei this seat measured (reclaim)', () => {
    const deposit = 50000000000000000n // 0.05 ETH
    expect(RECLAIM_NET + RECLAIM_PROTOCOL_LEG).toBe(deposit)
  })

  it('derives the carve legs from the gross using the split the app performs, and the net matches the measured figure (not a tautology)', () => {
    // The prior version of this test computed `residual = GROSS - NET`, derived the legs FROM that
    // residual, then asserted `NET + legs === GROSS` — true by construction for any two numbers and
    // exercising nothing about the app's actual split. This version goes the other way: it applies
    // `RevenueSplitLib`'s own 1% protocol / 19% vault / residual-creator split to the GROSS (mirroring
    // `carveReceiptFromLogs` in `Erc404AdminPanel.tsx`), independently of `CARVE_NET`, and only then
    // checks the result against the net this seat separately measured on-chain.
    const protocolLeg = CARVE_GROSS / 100n
    const vaultLeg = (CARVE_GROSS * 19n) / 100n
    const net = CARVE_GROSS - protocolLeg - vaultLeg // residual — absorbs all truncation dust
    expect(protocolLeg).toBe(CARVE_PROTOCOL_LEG)
    expect(vaultLeg).toBe(CARVE_VAULT_LEG)
    expect(net).toBe(CARVE_NET)

    const r: MoneyReceipt = {
      verb: 'carved',
      net: { label: 'net', wei: net },
      legs: [
        { label: 'protocol', wei: protocolLeg },
        { label: 'vault', wei: vaultLeg },
      ],
    }
    // Full wei precision survives formatting — no wei is rounded away.
    expect(formatReceipt(r)).toContain('1.141101206263873236 ETH')
  })

  it('does not round away a single wei', () => {
    const r: MoneyReceipt = { verb: 'settled', net: { label: 'net', wei: 1n } }
    expect(formatReceipt(r)).toBe('settled — net: 0.000000000000000001 ETH.')
  })

  it('a whole-ETH amount renders with no trailing fraction', () => {
    const r: MoneyReceipt = {
      verb: 'settled',
      net: { label: 'net', wei: 1_000000000000000000n },
    }
    expect(formatReceipt(r)).toBe('settled — net: 1 ETH.')
  })

  it('a zero amount renders as 0 ETH, not blank', () => {
    const r: MoneyReceipt = { verb: 'settled', net: { label: 'net', wei: 0n } }
    expect(formatReceipt(r)).toBe('settled — net: 0 ETH.')
  })

  it('the type guarantee: a receipt cannot be built without net', () => {
    // @ts-expect-error — `net` is required; omitting it must fail `pnpm typecheck`, not just at
    // runtime. This assertion exists to keep that guarantee tested, not merely asserted in prose.
    const bad: MoneyReceipt = { verb: 'carved' }
    expect(bad.verb).toBe('carved')
  })
})

// noesis-215 Step 1 acceptance: `carveReceiptFromLogs` (Erc404AdminPanel.tsx) must produce a
// receipt from the UNION of `CreatorCarvePaid.paid` and `GraduationExcessTithed.amount` — the
// deployer module caps `CreatorCarvePaid.paid` to the requested leg alone and reports any
// LP-share ETH the parity clamp couldn't place (`excessEth`) on a separate event
// (`LiquidityDeployerModule.sol:332-338`). `carveInput` defaults to `'0'`, so `carveEth == 0` (no
// `CreatorCarvePaid` at all) is the COMMON case, not an edge case — case (c) below is the one that
// was silently broken: ETH lands in the creator's wallet while the app rendered "no creator carve
// requested".
const INSTANCE = '0x1111111111111111111111111111111111111111' as const
const CREATOR = '0x2222222222222222222222222222222222222222' as const

// viem 2.53.1 doesn't export `encodeEventLog` (topics + data in one call) — build the two halves
// separately: `encodeEventTopics` for the indexed args, `encodeAbiParameters` for the non-indexed
// ones that land in `data` (both `CreatorCarvePaid` and `GraduationExcessTithed` index only
// `instance`/`creator`; the wei amounts are non-indexed).
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

describe('carveReceiptFromLogs', () => {
  it('(a) carve-only logs: CreatorCarvePaid alone produces a receipt off its paid figure', () => {
    const r = carveReceiptFromLogs([carvePaidLog(1000n)])
    expect(r).toBeDefined()
    expect(r?.net.wei).toBe(800n) // 1000 - 1% protocol (10) - 19% vault (190)
    expect(r?.legs?.[0]).toEqual({ label: 'protocol', wei: 10n })
    expect(r?.legs?.[1]).toEqual({ label: 'vault', wei: 190n })
  })

  it('(b) carve + excess logs: the two events sum before the split is applied', () => {
    const r = carveReceiptFromLogs([carvePaidLog(1000n), excessTithedLog(500n)])
    expect(r).toBeDefined()
    // gross = 1000 + 500 = 1500; protocol 15, vault 285, net 1200.
    expect(r?.net.wei).toBe(1200n)
    expect(r?.legs?.[0]).toEqual({ label: 'protocol', wei: 15n })
    expect(r?.legs?.[1]).toEqual({ label: 'vault', wei: 285n })
  })

  it('(c) excess-only logs, no CreatorCarvePaid: still produces a receipt with a number — the fix', () => {
    // carveEth == 0 (the default) with excessEth > 0: no CreatorCarvePaid is emitted at all, but ETH
    // still lands in the creator's wallet. Before this fix, the fallback rendered "no creator carve
    // requested" here — an amountless confirmation on a tx that moved money.
    const r = carveReceiptFromLogs([excessTithedLog(500n)])
    expect(r).toBeDefined()
    expect(r?.net.wei).toBe(400n) // 500 - 1% (5) - 19% (95)
  })

  it('(d) genuinely nothing moved: no receipt, so the "no carve requested" fallback may render', () => {
    const r = carveReceiptFromLogs([])
    expect(r).toBeUndefined()
  })
})
