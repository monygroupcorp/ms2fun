/**
 * parseAmount (Phase 0) — pure parse of a decimal string to base units (wei/token units). Returns
 * undefined on empty/invalid/negative input so call sites can disable submit. Kept separate from the
 * AmountField component so the component file exports only a component (react-refresh).
 */
import { parseUnits } from 'viem'

export function parseAmount(raw: string, decimals = 18): bigint | undefined {
  const trimmed = raw.trim()
  if (trimmed === '') return undefined
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === '.') return undefined
  try {
    const value = parseUnits(trimmed, decimals)
    return value < 0n ? undefined : value
  } catch {
    return undefined
  }
}
