/**
 * Gateway latency harness — measures every entry in `IPFS_GATEWAYS` against art we actually pin,
 * and fails when the shipped order contradicts what it measured.
 *
 * `uri.ts` states that the roster is "ordered by observed retrieval reliability". Nothing held that
 * claim to anything, and on 2026-09-24 it was false: the first entry answered in 4.4-5.5 s and the
 * second in 0.06-0.29 s, so every cold load paid the slow one first. A sentence in a docstring is
 * not an ordering, it is a memory of one, and this file is what turns it back into a measurement.
 *
 * Deliberately NOT wired into `pnpm build` or the app gate. It spends real requests on public
 * endpoints, so its verdict moves with network weather and with whatever those operators are doing
 * this afternoon; a build that fails because a stranger's CDN is having an afternoon teaches
 * nobody anything. It is run on purpose — when the roster is edited, and when the order is
 * re-argued.
 *
 * Usage:
 *
 *   pnpm ipfs:latency                          # the shipped roster
 *   pnpm ipfs:latency --gateway https://x/ipfs/   # ...and one more, e.g. a dedicated gateway
 *
 * `--gateway` exists so a gateway whose hostname is an ACCOUNT IDENTIFIER can be measured without
 * that hostname entering this repository (app/scripts/ipfs-dist/RUNBOOK.md section 2). It is
 * measured and reported beside the roster, and it is never held to the ordering rule — it is not
 * shipped, so there is no shipped order for it to contradict.
 */
import { IPFS_GATEWAYS, gatewayUrl, type IpfsGateway } from '../src/lib/metadata/uri'

/**
 * What every gateway is asked for: one piece of the Sepolia showcase art, pinned in the account
 * that pins everything this app shows. 1,179 bytes, so what is timed is the gateway's time to find
 * and answer rather than its bandwidth.
 *
 * It must be OUR pin. A gateway scoped to one account's pins — which is what a dedicated gateway is
 * — serves our art and 404s everything else, and measuring it against some universally-pinned
 * object would rank it unreachable precisely because it is the one worth having.
 */
const PROBE_PATH =
  process.env.IPFS_PROBE_PATH ?? 'bafybeigd7557iwardhnwg5kbmg2s7tmuxqkstjeoixu7wunooiywbb3jqq/1'

/** Matches `GATEWAY_TIMEOUT_MS` in uri.ts: a gateway is measured against the budget it gets live. */
const TIMEOUT_MS = 12_000

/** Runs per gateway. Three is enough for a median to survive one slow draw without being a study. */
const RUNS = 3

/**
 * How much faster a later entry must be before the shipped order is called wrong: BOTH 1.5x and
 * 250 ms. Two gateways within a quarter-second of each other are not really in an order, and
 * failing on that would make this harness a coin toss that edits the roster for no gain.
 */
const RATIO_TOLERANCE = 1.5
const ABSOLUTE_TOLERANCE_MS = 250

interface Measurement {
  label: string
  url: string | null
  /** Median wall time in ms; `Infinity` when the gateway never answered with our art. */
  median: number
  runs: (number | null)[]
  note: string
}

async function timeOnce(url: string): Promise<number | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  const started = performance.now()
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    // Read the body: a gateway that answers headers fast and then trickles the bytes is slow in
    // the only way a viewer experiences, and time-to-headers would score it as quick.
    await res.arrayBuffer()
    if (!res.ok) return null
    return performance.now() - started
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function median(values: number[]): number {
  if (values.length === 0) return Infinity
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

async function measure(label: string, gateway: IpfsGateway): Promise<Measurement> {
  const url = gatewayUrl(gateway, PROBE_PATH)
  if (url === null) {
    return { label, url, median: Infinity, runs: [], note: 'cannot address this CID' }
  }
  const runs: (number | null)[] = []
  for (let i = 0; i < RUNS; i++) runs.push(await timeOnce(url))
  const good = runs.filter((r): r is number => r !== null)
  const note =
    good.length === 0
      ? `no answer in ${TIMEOUT_MS / 1000}s`
      : good.length < RUNS
        ? `${RUNS - good.length} of ${RUNS} failed`
        : ''
  return { label, url, median: median(good), runs, note }
}

function format(ms: number): string {
  return Number.isFinite(ms) ? `${(ms / 1000).toFixed(2)}s` : '—'
}

const extraFlag = process.argv.indexOf('--gateway')
const extraBase = extraFlag === -1 ? process.env.IPFS_GATEWAY_EXTRA : process.argv[extraFlag + 1]

const shipped: Measurement[] = []
for (const [index, gateway] of IPFS_GATEWAYS.entries()) {
  shipped.push(await measure(`${index + 1}. ${gateway.operator}`, gateway))
}

let extra: Measurement | null = null
if (extraBase) {
  const base = extraBase.endsWith('/') ? extraBase : `${extraBase}/`
  extra = await measure('+  (--gateway)', { operator: 'extra', form: 'path', base })
}

console.log(`probe: ${PROBE_PATH}`)
console.log(`${RUNS} runs each, ${TIMEOUT_MS / 1000}s timeout, median reported\n`)
for (const m of [...shipped, ...(extra ? [extra] : [])]) {
  const runs = m.runs.map((r) => (r === null ? 'fail' : format(r))).join(' ')
  console.log(
    `  ${m.label.padEnd(18)} ${format(m.median).padStart(7)}   ${runs}${m.note ? `   (${m.note})` : ''}`,
  )
}

const failures: string[] = []

// Nothing answered: the roster may be perfectly ordered and we have no standing to say so.
if (shipped.every((m) => !Number.isFinite(m.median))) {
  failures.push(
    'no gateway in the shipped roster answered, so the order was not measured — this is not a pass',
  )
}

// The shipped order must not be contradicted: no later entry meaningfully faster than an earlier.
for (let i = 0; i < shipped.length; i++) {
  for (let j = i + 1; j < shipped.length; j++) {
    const earlier = shipped[i]!
    const later = shipped[j]!
    if (!Number.isFinite(later.median)) continue
    const fasterBy = earlier.median - later.median
    if (!Number.isFinite(earlier.median)) {
      failures.push(
        `${later.label} answers in ${format(later.median)} and is shipped BEHIND ${earlier.label}, which never answered`,
      )
      continue
    }
    if (fasterBy > ABSOLUTE_TOLERANCE_MS && earlier.median / later.median > RATIO_TOLERANCE) {
      failures.push(
        `${later.label} (${format(later.median)}) is shipped behind ${earlier.label} (${format(earlier.median)}) — ${(earlier.median / later.median).toFixed(1)}x slower is tried first`,
      )
    }
  }
}

if (extra && Number.isFinite(extra.median)) {
  const best = Math.min(...shipped.map((m) => m.median))
  const verdict =
    extra.median < best
      ? 'FASTER than every shipped entry'
      : 'not faster than the best shipped entry'
  console.log(`\n--gateway is ${verdict} (best shipped: ${format(best)}).`)
}

if (failures.length > 0) {
  console.error('\ngateway order contradicts measurement:')
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}

console.log('\nshipped order is consistent with measured latency.')
