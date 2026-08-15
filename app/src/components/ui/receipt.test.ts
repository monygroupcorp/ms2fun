import { describe, expect, it } from 'vitest'
import { formatReceipt, type MoneyReceipt } from './receipt'

// Wei fixtures at the precision this item's audit measured on a live fork walk — no rounding
// that would hide the last wei.
const CARVE_GROSS = 1426376508000000000n
const CARVE_NET = 1141101206263873236n
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

  it('leg sum plus net equals gross, at the wei this seat measured (carve)', () => {
    const residual = CARVE_GROSS - CARVE_NET
    const protocolLeg = residual / 20n // 1 part of a 1:19 protocol:vault split of the residual
    const vaultLeg = residual - protocolLeg // exact — never a rounding gap
    const r: MoneyReceipt = {
      verb: 'carved',
      net: { label: 'net', wei: CARVE_NET },
      legs: [
        { label: 'protocol', wei: protocolLeg },
        { label: 'vault', wei: vaultLeg },
      ],
    }
    expect(CARVE_NET + protocolLeg + vaultLeg).toBe(CARVE_GROSS)
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
