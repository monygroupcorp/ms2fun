/**
 * The rules on an ERC-404 collection's bonding open and maturity times, worked out BEFORE the
 * creator picks so the picker can state them and refuse an invalid value, rather than explain a
 * rule only after a pick has failed.
 *
 * The contract (`setBondingOpenTime` / `setBondingMaturityTime`) enforces:
 *   - open time later than `block.timestamp`;
 *   - maturity later than `block.timestamp`, set only once an open time exists, later than the open
 *     time, and at most `MAX_BONDING_DURATION` after it — checked from both setters, so moving the
 *     open time must keep an already-set maturity inside the window too.
 *
 * Every check runs against the CHAIN's clock, which is not the creator's: a dev fork's clock runs
 * hours ahead of the wall clock, and a public chain's drifts. The bounds here are computed from
 * chain time and then shown in the creator's own time zone, so "pick 6:15 PM today or later" is
 * true on the chain and readable on the creator's screen.
 *
 * The instance forwards both setters through a delegatecall that discards the reason, so a revert
 * reaches the app only as `SetBondingOpenTimeFailed` / `SetBondingMaturityTimeFailed`. That is why
 * the picker has to be right before the send: after it, nothing says which rule failed.
 *
 * Pure functions over numbers (unix seconds), so tests drive them without a DOM or a chain.
 */

const MINUTE = 60
const HOUR = 3_600
const DAY = 86_400

/** Mirrors `MAX_BONDING_DURATION` in ERC404BondingStorage.sol (210 days). */
export const MAX_BONDING_DURATION_SEC = 210 * DAY

/**
 * Headroom between "now" and the earliest pick the form allows. A pick one minute ahead passes the
 * form and can still revert: the chain's clock keeps moving while the creator reads the wallet
 * prompt and the block lands. Five minutes covers a slow confirmation without being a rule a
 * creator would notice.
 */
export const SEND_MARGIN_SEC = 5 * MINUTE

/** The clock gap past which the form says out loud that the chain's clock is not the creator's. */
export const CLOCK_SKEW_NOTE_SEC = 2 * MINUTE

export function ceilToMinute(sec: number): number {
  return Math.ceil(sec / MINUTE) * MINUTE
}

export function floorToMinute(sec: number): number {
  return Math.floor(sec / MINUTE) * MINUTE
}

/**
 * What a field may hold right now. `earliest`/`latest` are whole minutes (the picker's step), so a
 * bound shown as a minute is a minute the picker can land on. `blocked` is set when no value is
 * valid, and says what to do first.
 */
export interface TimeWindow {
  earliest: number
  latest: number | null
  blocked?: string
}

export interface ScheduleClock {
  /** The chain's current time, unix seconds. */
  chainNow: number
  /** The creator's wall clock, unix seconds — used only to say "today" / "tomorrow" in their terms. */
  wallNow: number
  /** IANA zone to state times in; undefined is the viewer's own zone. Tests pin it. */
  timeZone?: string
}

/** The window for the open time, given the maturity already stored (0 = none). */
export function openWindow(chainNow: number, maturity: number): TimeWindow {
  let earliest = ceilToMinute(chainNow + SEND_MARGIN_SEC)
  if (maturity <= 0) return { earliest, latest: null }
  // Maturity is set, so the open time has to stay before it and within the cap of it.
  earliest = Math.max(earliest, ceilToMinute(maturity - MAX_BONDING_DURATION_SEC))
  const latest = floorToMinute(maturity - 1)
  if (earliest > latest) {
    return {
      earliest,
      latest,
      blocked:
        'The maturity time already set is too soon for any open time to come before it. Move the ' +
        'maturity time later first, then set the open time.',
    }
  }
  return { earliest, latest }
}

/** The window for the maturity time, given the open time already stored (0 = none). */
export function maturityWindow(chainNow: number, open: number): TimeWindow {
  const earliestNow = ceilToMinute(chainNow + SEND_MARGIN_SEC)
  if (open <= 0) {
    return { earliest: earliestNow, latest: null, blocked: 'Set the open time first.' }
  }
  const earliest = Math.max(earliestNow, ceilToMinute(open + 1))
  const latest = floorToMinute(open + MAX_BONDING_DURATION_SEC)
  if (earliest > latest) {
    return {
      earliest,
      latest,
      blocked:
        'Maturity must fall within 210 days of the open time, and that span has already passed. ' +
        'Set a new open time first.',
    }
  }
  return { earliest, latest }
}

function dayKey(sec: number, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(sec * 1000))
}

/**
 * A moment as a creator says it, in their zone: "3:40 PM today", "9:00 AM tomorrow",
 * "Sat, Nov 21 at 3:40 PM", with the year only when it is not this one. "Today" is the creator's
 * today (wall clock), not the chain's, because it is their calendar they are reading.
 */
export function formatMoment(sec: number, clock: Pick<ScheduleClock, 'wallNow' | 'timeZone'>) {
  const { wallNow, timeZone } = clock
  const d = new Date(sec * 1000)
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
  const key = dayKey(sec, timeZone)
  if (key === dayKey(wallNow, timeZone)) return `${time} today`
  if (key === dayKey(wallNow + DAY, timeZone)) return `${time} tomorrow`
  const sameYear = key.slice(0, 4) === dayKey(wallNow, timeZone).slice(0, 4)
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(d)
  return `${date} at ${time}`
}

/** The short name of the zone times are stated in, e.g. "EST" or "GMT+2". */
export function zoneName(timeZone?: string, at: number = Date.now() / 1000): string {
  const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
    .formatToParts(new Date(at * 1000))
    .find((p) => p.type === 'timeZoneName')
  return part?.value ?? ''
}

function span(sec: number): string {
  const abs = Math.abs(sec)
  const days = Math.floor(abs / DAY)
  const hours = Math.floor((abs % DAY) / HOUR)
  const minutes = Math.round((abs % HOUR) / MINUTE)
  const parts: string[] = []
  if (days) parts.push(`${days} day${days === 1 ? '' : 's'}`)
  if (hours) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`)
  if (minutes && !days) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`)
  return parts.join(' ') || 'under a minute'
}

/**
 * A sentence telling the creator the chain's clock differs from theirs, or undefined when the two
 * agree closely enough not to matter. Without it, "pick 6:15 PM or later" at 4:10 PM on the
 * creator's watch reads as a bug.
 */
export function clockSkewNote(clock: ScheduleClock): string | undefined {
  const skew = clock.chainNow - clock.wallNow
  if (Math.abs(skew) < CLOCK_SKEW_NOTE_SEC) return undefined
  return (
    `This network's clock reads ${formatMoment(clock.chainNow, clock)}, ` +
    `${span(skew)} ${skew > 0 ? 'ahead of' : 'behind'} your clock. ` +
    'The network decides when bonding opens, so the times allowed here follow its clock.'
  )
}

/**
 * Why `picked` cannot be sent, phrased as what to pick instead; undefined when it can be. The
 * picker's own min/max already keep most values out, but a typed or pasted value, or one that was
 * valid when picked and has since gone stale as the clock moved, still lands here.
 */
export function pickProblem(
  picked: number,
  window: TimeWindow,
  clock: Pick<ScheduleClock, 'wallNow' | 'timeZone'>,
): string | undefined {
  if (window.blocked) return window.blocked
  if (picked < window.earliest) return `Pick ${formatMoment(window.earliest, clock)} or later.`
  if (window.latest !== null && picked > window.latest)
    return `Pick ${formatMoment(window.latest, clock)} or earlier.`
  return undefined
}

export interface QuickPick {
  /** The full wording, read out as the button's name. */
  label: string
  /** The words on the button itself, under a caption that carries the rest of `label`. */
  short: string
  at: number
  /** False when the choice would fall outside the window; shown, but not pressable. */
  allowed: boolean
}

function inWindow(at: number, w: TimeWindow): boolean {
  return !w.blocked && at >= w.earliest && (w.latest === null || at <= w.latest)
}

/** One-press choices for the open time, counted from the chain's clock. */
export function openQuickPicks(chainNow: number, window: TimeWindow): QuickPick[] {
  return [
    { label: 'in 1 hour', short: '1 hour', offset: HOUR },
    { label: 'in 1 day', short: '1 day', offset: DAY },
    { label: 'in 1 week', short: '1 week', offset: 7 * DAY },
  ].map(({ label, short, offset }) => {
    const at = ceilToMinute(chainNow + offset)
    return { label, short, at, allowed: inWindow(at, window) }
  })
}

/** One-press choices for the maturity time, counted from the open time already set. */
export function maturityQuickPicks(open: number, window: TimeWindow): QuickPick[] {
  if (open <= 0) return []
  return [
    { label: '7 days after open', short: '7 days', offset: 7 * DAY },
    { label: '30 days after open', short: '30 days', offset: 30 * DAY },
    { label: '90 days after open', short: '90 days', offset: 90 * DAY },
    { label: 'longest allowed (210 days)', short: '210 days', offset: MAX_BONDING_DURATION_SEC },
  ].map(({ label, short, offset }) => {
    const at = floorToMinute(open + offset)
    return { label, short, at, allowed: inWindow(at, window) }
  })
}

/**
 * The words for a refused send. The instance's delegatecall drops Ops's specific reason, so a
 * refusal is almost always the chain's clock having passed the pick between choosing it and the
 * block landing, or another write having moved the other field. Either way the fix is to pick again
 * from the bounds now shown.
 */
export function refusedSendCopy(kind: 'open' | 'maturity'): string {
  return (
    `The network refused this ${kind === 'open' ? 'open' : 'maturity'} time. Its clock may have ` +
    'moved past your pick while you confirmed. Pick again from the times shown and resend.'
  )
}
