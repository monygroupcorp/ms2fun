/**
 * Pure preset builders for the swap quick-fill row (S4). Kept out of the component file so the
 * component module only exports a component (react-refresh).
 *
 * Buys pick an ETH amount to SPEND; sells pick a % of the held balance.
 */
import { formatUnits } from 'viem'

export interface QuickPreset {
  label: string
  /** The string to write into the amount input, or undefined to disable (e.g. zero balance). */
  value: string | undefined
}

/** The fixed ETH-to-spend presets for a buy. */
export const BUY_ETH_PRESETS = ['0.005', '0.01', '0.05', '0.1'] as const

/** Build the ETH buy presets (value is the ETH literal; label carries the unit). */
export function buyEthPresets(): QuickPreset[] {
  return BUY_ETH_PRESETS.map((v) => ({ label: `${v} ETH`, value: v }))
}

/** The fixed percentages for a sell. */
export const SELL_PCTS = [25, 50, 75, 100] as const

/**
 * Build sell presets as a % of `balance` (base units), formatted to `decimals`. A 100% preset uses
 * the exact balance so it never leaves dust from rounding; the others floor toward zero.
 */
export function sellPctPresets(balance: bigint | undefined, decimals: number): QuickPreset[] {
  return SELL_PCTS.map((pct) => {
    if (balance === undefined || balance === 0n) return { label: `${pct}%`, value: undefined }
    const amount = pct === 100 ? balance : (balance * BigInt(pct)) / 100n
    return { label: `${pct}%`, value: formatUnits(amount, decimals) }
  })
}
