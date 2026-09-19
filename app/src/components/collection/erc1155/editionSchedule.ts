/**
 * An edition's schedule, as the two questions a collector actually asks: can I still mint this, and
 * how long have I got. Pure functions over the values the aggregator returns, so the mint panel and
 * the edition card answer both the same way and a test can drive them without a chain.
 *
 * Both values are 0 when unset, and 0 is also what an instance deployed before the schedule existed
 * reads as (the aggregator guards those reads) — so "no close time" and "old instance" are the same
 * case here on purpose: the edition runs open-ended, which is what it did.
 */

/** Milliseconds in the units the parts below are expressed in. */
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export interface EditionSchedule {
  /** Unix seconds; 0 = never closes. */
  closeTime: bigint
  /** 0 = no ceiling. */
  maxPerWallet: bigint
}

/** The moment minting stops, or null for an edition that runs open-ended. */
export function closesAt(schedule: EditionSchedule): Date | null {
  return schedule.closeTime > 0n ? new Date(Number(schedule.closeTime) * 1000) : null
}

/**
 * Is this edition over at `now`?
 *
 * The contract reverts `EditionClosed()` AT the close time, not after it, so the comparison here is
 * `>=` — a countdown that still reads "1 second left" on a mint that reverts is worse than no
 * countdown at all.
 */
export function isClosed(schedule: EditionSchedule, now: number = Date.now()): boolean {
  const at = closesAt(schedule)
  return at !== null && now >= at.getTime()
}

/**
 * How long is left, as one coarse phrase a collector reads at a glance: "3 days left", "5 hours
 * left", "12 minutes left", "under a minute left". Null when the edition never closes or is over —
 * both of those are a different sentence, not a shorter one.
 *
 * Deliberately coarse. A per-second countdown on a drop that runs for a week is noise, and it forces
 * a re-render every second on a page that renders one of these per edition.
 */
export function timeRemaining(schedule: EditionSchedule, now: number = Date.now()): string | null {
  const at = closesAt(schedule)
  if (at === null) return null
  const left = at.getTime() - now
  if (left <= 0) return null
  if (left >= DAY) {
    const days = Math.floor(left / DAY)
    return `${days} ${days === 1 ? 'day' : 'days'} left`
  }
  if (left >= HOUR) {
    const hours = Math.floor(left / HOUR)
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} left`
  }
  if (left >= MINUTE) {
    const minutes = Math.floor(left / MINUTE)
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} left`
  }
  return 'under a minute left'
}

/**
 * What this wallet may still mint, or null when the edition sets no ceiling.
 *
 * `minted` is what the wallet has MINTED of this edition, paid and free together — never its
 * balance, which falls when it transfers a token away and would overstate the allowance.
 * Clamped at zero: the ceiling can be lowered below what a wallet already took.
 */
export function remainingForWallet(
  schedule: EditionSchedule,
  minted: bigint | undefined,
): bigint | null {
  if (schedule.maxPerWallet === 0n) return null
  const taken = minted ?? 0n
  return taken >= schedule.maxPerWallet ? 0n : schedule.maxPerWallet - taken
}
