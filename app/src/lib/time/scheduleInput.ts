/**
 * The creator's side of a schedule: turning what a person can actually state — a moment on a
 * calendar, a span of hours or days — into the unix seconds the contracts take, and back again so a
 * form opens showing what is already set rather than two empty boxes.
 *
 * The chain's unit does not move and must not. `addEdition`, `setEditionSchedule` and the ERC-404
 * bonding setters all take unix seconds and `0` still means "no time set"; every form here keeps
 * that integer as its own state. What changes is that nobody types one.
 *
 * Pure functions over strings, so a test drives them without a DOM and both the hand-written
 * collection forms and the schema-driven wizard answer a creator the same way.
 */

/** The shape an `<input type="datetime-local">` emits and accepts: local wall clock, no zone. */
const LOCAL_INPUT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/

/**
 * Unix seconds for a `datetime-local` value, or null when it is blank or not that shape.
 *
 * The shape test is not belt-and-braces: `Date.parse` reads a DATE-ONLY string as UTC and a
 * date-and-time string as LOCAL time, so a pasted `2026-09-22` would silently mean midnight in a
 * timezone the creator is not in. Refusing it is the honest answer — the picker never emits one.
 */
export function epochFromLocalInput(value: string): number | null {
  const raw = value.trim()
  if (!LOCAL_INPUT_RE.test(raw)) return null
  const ms = Date.parse(raw)
  if (Number.isNaN(ms)) return null
  return Math.floor(ms / 1000)
}

/**
 * A `datetime-local` value for unix seconds, in the viewer's own timezone — `''` for 0, which is
 * "no time set" on every one of these fields and must render as an empty picker rather than as
 * 1970.
 *
 * MINUTE GRANULARITY, deliberately: the picker's own default step is a minute, and a drop window
 * stated to the second is precision nobody asked for. A stored value carrying seconds keeps them
 * until the creator edits that field — the form holds the integer, not this string — and snaps to
 * the minute only when they do.
 */
export function localInputFromEpoch(epoch: number | bigint): string {
  const secs = typeof epoch === 'bigint' ? Number(epoch) : epoch
  if (!Number.isFinite(secs) || secs <= 0) return ''
  const d = new Date(secs * 1000)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  )
}

/**
 * The spans a duration is stated in, finest first. Seconds stay on the list because an anti-snipe
 * buffer genuinely is a handful of them — a duration in seconds is a span a person can picture,
 * which is the thing an epoch timestamp never was.
 */
export const DURATION_UNITS = [
  { key: 'seconds', seconds: 1 },
  { key: 'minutes', seconds: 60 },
  { key: 'hours', seconds: 3_600 },
  { key: 'days', seconds: 86_400 },
] as const

export type DurationUnit = (typeof DURATION_UNITS)[number]['key']

/** Hours reads as the middle of the range these fields live in (an auction, a drop window). */
export const DEFAULT_DURATION_UNIT: DurationUnit = 'hours'

function unitSeconds(unit: DurationUnit): number {
  return DURATION_UNITS.find((u) => u.key === unit)?.seconds ?? 1
}

/**
 * Seconds for `amount` of `unit`, or null when the amount is blank or not a whole number ≥ 0.
 * Fractions are refused rather than rounded: "1.5 days" is expressible as "36 hours", and silently
 * truncating a creator's number into a drop window is worse than asking for it again.
 */
export function secondsFromDuration(amount: string, unit: DurationUnit): number | null {
  const raw = amount.trim()
  if (!/^\d+$/.test(raw)) return null
  return Number(raw) * unitSeconds(unit)
}

/**
 * Split seconds back into the coarsest span that divides it exactly, so a stored 86400 opens the
 * control as "1 days" and not "1440 minutes", and 90 opens as "90 seconds" rather than lose the
 * half-minute. Non-positive input is the empty state — these fields are durations, and zero is not
 * one.
 */
export function durationFromSeconds(seconds: number | bigint): {
  amount: string
  unit: DurationUnit
} {
  const secs = typeof seconds === 'bigint' ? Number(seconds) : seconds
  if (!Number.isFinite(secs) || secs <= 0) return { amount: '', unit: DEFAULT_DURATION_UNIT }
  for (let i = DURATION_UNITS.length - 1; i >= 0; i--) {
    const u = DURATION_UNITS[i]!
    if (secs % u.seconds === 0) return { amount: String(secs / u.seconds), unit: u.key }
  }
  // Unreachable: the finest unit is 1 second and every positive integer divides by it.
  return { amount: String(secs), unit: 'seconds' }
}
