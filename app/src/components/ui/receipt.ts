/**
 * receipt.ts — the money confirmation that cannot be built without a number. Every terminal
 * money action (a tx that moves ETH to or from the acting wallet) constructs a `MoneyReceipt`
 * instead of hand-writing a `successLabel` string; `net` is a REQUIRED field on the type, so a
 * money surface cannot compile a receipt while omitting the figure that matters to the person
 * reading it.
 *
 * `net` is the acting user's own result — what they actually received (an auction settle) or
 * paid (a mint) — and is always rendered first. `legs`, when present, is the split underneath it
 * (protocol / vault / other), rendered after and clearly subordinate: the net is the user's, the
 * legs are context.
 */

export interface MoneyLeg {
  /** Human label for this portion of the split, e.g. "protocol", "vault". */
  label: string
  /** Amount in wei (18-decimal ETH). */
  wei: bigint
}

export interface MoneyReceipt {
  /** Past-tense verb describing what happened, e.g. "carved", "settled", "reclaimed", "minted". */
  verb: string
  /** What the acting user actually received or paid. REQUIRED — a receipt with no net cannot compile. */
  net: MoneyLeg
  /** The split underneath the net, when one exists (protocol cut, vault cut, …). */
  legs?: MoneyLeg[]
}

/** Render wei as an ETH decimal string with no precision loss — never rounds away a wei. */
function weiToEthString(wei: bigint): string {
  const negative = wei < 0n
  const abs = negative ? -wei : wei
  const whole = abs / 1_000000000000000000n
  const frac = abs % 1_000000000000000000n
  const fracStr = frac.toString().padStart(18, '0').replace(/0+$/, '')
  const body = fracStr.length > 0 ? `${whole}.${fracStr}` : whole.toString()
  return negative ? `-${body}` : body
}

/**
 * Render a MoneyReceipt as a confirmation string. The net leads (it's the user's own result);
 * the split, if any, follows in parentheses. `formatReceipt` is the ONLY sanctioned way to turn a
 * `MoneyReceipt` into UI text — a money surface that hand-writes its own string instead defeats
 * the guarantee `net` being required was meant to provide.
 */
export function formatReceipt(r: MoneyReceipt): string {
  const netStr = `${r.net.label}: ${weiToEthString(r.net.wei)} ETH`
  const head = `${r.verb} — ${netStr}`
  if (r.legs === undefined || r.legs.length === 0) return `${head}.`
  const legsStr = r.legs.map((leg) => `${leg.label} ${weiToEthString(leg.wei)} ETH`).join(', ')
  return `${head} (${legsStr}).`
}
