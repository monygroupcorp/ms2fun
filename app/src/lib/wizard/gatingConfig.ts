/**
 * Encodes the `password-tier-gating` config form (CONFIG_SCHEMAS) into the on-chain `TierConfig`
 * tuple threaded through `createInstance` — so tier setup happens in the SAME create tx (no second
 * transaction). Also reused by the post-create creator-admin row (which calls `configureFor` with
 * the same shape).
 *
 * The form takes PLAINTEXT passwords (one per tier, in order); they are hashed with keccak256 here.
 * Volume caps / unlock times are paired with passwords positionally. Empty password rows are
 * dropped, and their paired cap/time is dropped too, so the array lengths stay matched (the module
 * reverts with TierConfigMismatch otherwise).
 *
 * Pure TS (no React/wagmi) so it's unit-testable and shared by the wizard + admin + NOEMA.
 */
import { keccak256, toHex } from 'viem'

/** On-chain `TierConfig` shape (viem-inferred): tierType uint8, the rest dynamic arrays. */
export interface TierConfigValue {
  tierType: number
  passwordHashes: `0x${string}`[]
  volumeCaps: bigint[]
  tierUnlockTimes: bigint[]
}

export const EMPTY_TIER_CONFIG: TierConfigValue = {
  tierType: 0,
  passwordHashes: [],
  volumeCaps: [],
  tierUnlockTimes: [],
}

const VOLUME_CAP = 0
const TIME_BASED = 1

/** Read a SchemaForm `list` field (`${key}.N` flat keys) into a dense, in-order string array. */
function readList(values: Record<string, string>, key: string): string[] {
  const prefix = `${key}.`
  return Object.keys(values)
    .filter((k) => k.startsWith(prefix) && /^\d+$/.test(k.slice(prefix.length)))
    .sort((a, b) => Number(a.slice(prefix.length)) - Number(b.slice(prefix.length)))
    .map((k) => values[k] ?? '')
}

function bigOrZero(v: string): bigint {
  const t = v.trim()
  if (t === '') return 0n
  try {
    return BigInt(t)
  } catch {
    return 0n
  }
}

/** True when the form holds at least one non-empty password (i.e. an actual tier to configure). */
export function hasTierConfig(values: Record<string, string>): boolean {
  return readList(values, 'passwords').some((p) => p.trim() !== '')
}

/**
 * Build the on-chain `TierConfig` from the form values. Passwords are hashed; caps/times are paired
 * by the SAME index as their password, so dropping an empty password drops its paired entry too.
 */
export function encodeTierConfig(values: Record<string, string>): TierConfigValue {
  const tierType = values['tierType'] === '1' ? TIME_BASED : VOLUME_CAP
  const passwords = readList(values, 'passwords')
  const caps = readList(values, 'volumeCaps')
  const times = readList(values, 'tierUnlockTimes')

  const passwordHashes: `0x${string}`[] = []
  const volumeCaps: bigint[] = []
  const tierUnlockTimes: bigint[] = []

  passwords.forEach((pw, i) => {
    if (pw.trim() === '') return // drop empty rows (and their paired cap/time) to keep lengths matched
    passwordHashes.push(keccak256(toHex(pw.trim())))
    if (tierType === VOLUME_CAP) volumeCaps.push(bigOrZero(caps[i] ?? ''))
    else tierUnlockTimes.push(bigOrZero(times[i] ?? ''))
  })

  return { tierType, passwordHashes, volumeCaps, tierUnlockTimes }
}

/**
 * Validate the form before submit. Returns field.key → error (only failures). Mirrors the module's
 * own reverts: every tier needs its paired cap (VOLUME_CAP) or unlock time (TIME_BASED).
 */
export function validateTierConfig(values: Record<string, string>): Record<string, string> {
  const errors: Record<string, string> = {}
  const tierType = values['tierType'] === '1' ? TIME_BASED : VOLUME_CAP
  const passwords = readList(values, 'passwords')
  const caps = readList(values, 'volumeCaps')
  const times = readList(values, 'tierUnlockTimes')

  passwords.forEach((pw, i) => {
    if (pw.trim() === '') return
    if (tierType === VOLUME_CAP && (caps[i] ?? '').trim() === '') {
      errors[`volumeCaps.${i}`] = `tier ${i + 1} needs a volume cap`
    }
    if (tierType === TIME_BASED && (times[i] ?? '').trim() === '') {
      errors[`tierUnlockTimes.${i}`] = `tier ${i + 1} needs an unlock time`
    }
  })
  return errors
}
