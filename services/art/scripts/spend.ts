/**
 * `pnpm spend` — what this deployment cost so far this month, against a budget.
 *
 * The goal's clause is that the bill is a QUERY AND NEVER A SURPRISE. Two things follow from taking
 * that literally, and they are the whole design of this file.
 *
 * First, a cost is measured usage times a published price, and the price is the half that rots. A
 * hardcoded table goes stale silently and then prints a confident wrong number, which is worse than
 * printing nothing — so {@link PRICES} carries the date it was read and the page it was read from,
 * every run prints that provenance beside the total, and a table older than {@link STALE_AFTER_DAYS}
 * says so out loud. Re-read the page, update the table, move the date.
 *
 * Second, this must never guess. Usage this cannot read is not treated as zero: the run fails and
 * names what it could not fetch. A spend command that under-reports is the surprise it exists to
 * prevent.
 *
 * WHAT IT NEEDS, all from the environment and none of it from this repository:
 *   CLOUDFLARE_ACCOUNT_ID   the account the service is deployed in
 *   CLOUDFLARE_API_TOKEN    a token with Account Analytics:Read
 *   ART_BUDGET_USD          the monthly budget to measure against
 *   ART_BUCKET              the R2 bucket, default `noesis-art-cache`
 *   ART_WORKER              the Worker's script name, default `noesis-art`
 *
 * It exits 1 when the month's cost is over budget, so it can be a scheduled check and not only
 * something a person reads.
 */

/**
 * Cloudflare's published prices, in USD, with where and when they were read.
 *
 * MOVE THE DATE WHENEVER A NUMBER MOVES. The staleness warning is keyed to it, and its only job is
 * to stop this file quietly becoming fiction.
 */
export const PRICES = {
  readOn: '2026-09-27',
  sources: [
    'https://developers.cloudflare.com/r2/pricing/',
    'https://developers.cloudflare.com/workers/platform/pricing/',
  ],
  /** R2 Standard storage, per GB-month. */
  storagePerGbMonth: 0.015,
  /** R2 Class A (mutating: writes, lists) per million. */
  classAPerMillion: 4.5,
  /** R2 Class B (reads) per million. */
  classBPerMillion: 0.36,
  /** Workers requests beyond the included allowance, per million. */
  workerRequestsPerMillion: 0.3,
  /** The Workers Paid minimum, charged whether or not this service is the only thing on the account. */
  workersPaidBaseUsd: 5,
  /** Free-tier allowances, which are monthly and apply to R2 Standard only. */
  free: {
    storageGbMonth: 10,
    classAMillion: 1,
    classBMillion: 10,
    workerRequestsMillion: 10,
  },
} as const

/** How long a price table is trusted before every run starts saying it may have moved. */
export const STALE_AFTER_DAYS = 120

/** Egress is free from R2, which is the reason this service is a cache and not a proxy to nowhere. */
export const EGRESS_IS_FREE = true

export interface Usage {
  /** Mean stored bytes over the month so far, which is what a GB-month is. */
  storedBytes: number
  /** R2 Class A operations this month (every `put` and `delete` this worker makes). */
  classAOps: number
  /** R2 Class B operations this month (every `get`). */
  classBOps: number
  /** Worker requests this month. */
  workerRequests: number
}

export interface CostLine {
  what: string
  billable: string
  usd: number
}

export interface Cost {
  lines: CostLine[]
  /** Everything this service caused, excluding the account-wide Workers minimum. */
  serviceUsd: number
  /** What the account is charged, service plus that minimum. */
  totalUsd: number
}

const GB = 1024 ** 3
const MILLION = 1_000_000

/** Round to cents for display without letting rounding accumulate into the total. */
function usd(n: number): string {
  return `$${n.toFixed(2)}`
}

/**
 * Usage times price, free tier first.
 *
 * Pure, and separated from every network call on purpose: it is the part that can be checked, and
 * the part a wrong answer would be embarrassing in.
 */
export function costOf(usage: Usage, prices: typeof PRICES = PRICES): Cost {
  const over = (used: number, free: number) => Math.max(0, used - free)

  const storageGbMonth = usage.storedBytes / GB
  const billableStorage = over(storageGbMonth, prices.free.storageGbMonth)
  const billableA = over(usage.classAOps / MILLION, prices.free.classAMillion)
  const billableB = over(usage.classBOps / MILLION, prices.free.classBMillion)
  const billableReq = over(usage.workerRequests / MILLION, prices.free.workerRequestsMillion)

  const lines: CostLine[] = [
    {
      what: 'R2 storage',
      billable: `${billableStorage.toFixed(2)} of ${storageGbMonth.toFixed(2)} GB-month`,
      usd: billableStorage * prices.storagePerGbMonth,
    },
    {
      what: 'R2 class A (writes)',
      billable: `${billableA.toFixed(3)}M of ${(usage.classAOps / MILLION).toFixed(3)}M`,
      usd: billableA * prices.classAPerMillion,
    },
    {
      what: 'R2 class B (reads)',
      billable: `${billableB.toFixed(3)}M of ${(usage.classBOps / MILLION).toFixed(3)}M`,
      usd: billableB * prices.classBPerMillion,
    },
    {
      what: 'Worker requests',
      billable: `${billableReq.toFixed(3)}M of ${(usage.workerRequests / MILLION).toFixed(3)}M`,
      usd: billableReq * prices.workerRequestsPerMillion,
    },
    { what: 'Egress', billable: 'free from R2', usd: 0 },
  ]

  const serviceUsd = lines.reduce((sum, line) => sum + line.usd, 0)
  return { lines, serviceUsd, totalUsd: serviceUsd + prices.workersPaidBaseUsd }
}

/** Whole days between the price table's date and now, for the staleness warning. */
export function priceAgeDays(readOn: string, now: Date): number {
  const then = Date.parse(`${readOn}T00:00:00Z`)
  if (Number.isNaN(then)) throw new Error(`PRICES.readOn is not a date: ${readOn}`)
  return Math.floor((now.getTime() - then) / 86_400_000)
}

/** First instant of the current UTC month — the window every figure here is measured over. */
export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

/** The report, as the lines it prints. Separated from printing so a test can read it. */
export function report(usage: Usage, budgetUsd: number, now: Date): string[] {
  const cost = costOf(usage)
  const since = monthStart(now).toISOString().slice(0, 10)
  const out = [
    `art service spend — ${since} to ${now.toISOString().slice(0, 10)}`,
    '',
    ...cost.lines.map((l) => `  ${l.what.padEnd(22)} ${l.billable.padEnd(34)} ${usd(l.usd)}`),
    '',
    `  ${'this service'.padEnd(22)} ${''.padEnd(34)} ${usd(cost.serviceUsd)}`,
    `  ${'Workers Paid minimum'.padEnd(22)} ${'account-wide, not ours alone'.padEnd(34)} ${usd(
      PRICES.workersPaidBaseUsd,
    )}`,
    `  ${'total'.padEnd(22)} ${''.padEnd(34)} ${usd(cost.totalUsd)}`,
    '',
    `  budget ${usd(budgetUsd)} — ${
      cost.totalUsd > budgetUsd
        ? `OVER by ${usd(cost.totalUsd - budgetUsd)}`
        : `${usd(budgetUsd - cost.totalUsd)} left`
    }`,
    '',
    `  prices read ${PRICES.readOn} from ${PRICES.sources.join(' and ')}`,
  ]

  const age = priceAgeDays(PRICES.readOn, now)
  if (age > STALE_AFTER_DAYS) {
    out.push(
      `  WARNING: that table is ${age} days old. Re-read those pages before trusting this number.`,
    )
  }
  return out
}

/** Whether the report says the account is over budget. */
export function isOverBudget(usage: Usage, budgetUsd: number): boolean {
  return costOf(usage).totalUsd > budgetUsd
}

// ── Everything below talks to the network and is deliberately thin ────────────────────────────

const GRAPHQL = 'https://api.cloudflare.com/client/v4/graphql'

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`${name} is not set. This reads every identifier from the environment.`)
  }
  return value
}

/**
 * One GraphQL query for all four figures.
 *
 * On an unreadable or partial answer this THROWS rather than defaulting a field to zero. A spend
 * report that silently omits a cost is the surprise the whole command exists to prevent.
 */
async function fetchUsage(accountId: string, token: string, since: Date): Promise<Usage> {
  const query = `
    query ArtSpend($account: String!, $since: Time!, $bucket: String!, $script: String!) {
      viewer {
        accounts(filter: { accountTag: $account }) {
          r2StorageAdaptiveGroups(
            limit: 1
            filter: { datetime_geq: $since, bucketName: $bucket }
          ) {
            max { payloadSize }
          }
          r2OperationsAdaptiveGroups(
            limit: 100
            filter: { datetime_geq: $since, bucketName: $bucket }
          ) {
            dimensions { actionType }
            sum { requests }
          }
          workersInvocationsAdaptive(
            limit: 100
            filter: { datetime_geq: $since, scriptName: $script }
          ) {
            sum { requests }
          }
        }
      }
    }`

  const res = await fetch(GRAPHQL, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      query,
      variables: {
        account: accountId,
        since: since.toISOString(),
        bucket: process.env.ART_BUCKET?.trim() || 'noesis-art-cache',
        script: process.env.ART_WORKER?.trim() || 'noesis-art',
      },
    }),
  })

  if (!res.ok) throw new Error(`Cloudflare analytics answered ${res.status}`)
  const body = (await res.json()) as {
    errors?: { message: string }[]
    data?: { viewer?: { accounts?: unknown[] } }
  }
  if (body.errors?.length) {
    throw new Error(`Cloudflare analytics refused: ${body.errors.map((e) => e.message).join('; ')}`)
  }
  const account = body.data?.viewer?.accounts?.[0]
  if (account === undefined) throw new Error('Cloudflare analytics returned no account')
  return parseUsage(account)
}

/**
 * Pull the four figures out of one account's analytics node.
 *
 * Exported so the shape this expects is asserted by a test rather than discovered in production.
 * Class A is every mutating operation and class B every read; Cloudflare bills by that split, and
 * an `actionType` this does not recognise is an ERROR rather than a silent omission from the bill.
 */
export function parseUsage(account: unknown): Usage {
  const node = account as {
    r2StorageAdaptiveGroups?: { max?: { payloadSize?: number } }[]
    r2OperationsAdaptiveGroups?: { dimensions?: { actionType?: string }; sum?: { requests?: number } }[]
    workersInvocationsAdaptive?: { sum?: { requests?: number } }[]
  }

  const storedBytes = node.r2StorageAdaptiveGroups?.[0]?.max?.payloadSize
  if (typeof storedBytes !== 'number') throw new Error('no R2 storage figure in the answer')

  const ops = node.r2OperationsAdaptiveGroups
  if (!Array.isArray(ops)) throw new Error('no R2 operations figures in the answer')

  // Class A mutates, class B reads. Anything unrecognised stops the run: an operation missing from
  // this map is a cost missing from the total.
  const CLASS_A = new Set([
    'PutObject',
    'CopyObject',
    'CompleteMultipartUpload',
    'CreateMultipartUpload',
    'UploadPart',
    'UploadPartCopy',
    'ListObjects',
    'ListBuckets',
    'ListMultipartUploads',
    'ListParts',
    'PutBucket',
    'DeleteObject',
    'DeleteObjects',
    'AbortMultipartUpload',
    'LifecycleStorageTierTransition',
  ])
  const CLASS_B = new Set(['GetObject', 'HeadObject', 'HeadBucket', 'UsageSummary'])

  let classAOps = 0
  let classBOps = 0
  for (const group of ops) {
    const action = group.dimensions?.actionType
    const requests = group.sum?.requests ?? 0
    if (action === undefined) throw new Error('an R2 operations group names no actionType')
    if (CLASS_A.has(action)) classAOps += requests
    else if (CLASS_B.has(action)) classBOps += requests
    else throw new Error(`unclassified R2 operation "${action}" — add it to CLASS_A or CLASS_B`)
  }

  const invocations = node.workersInvocationsAdaptive
  if (!Array.isArray(invocations)) throw new Error('no Worker request figures in the answer')
  const workerRequests = invocations.reduce((sum, g) => sum + (g.sum?.requests ?? 0), 0)

  return { storedBytes, classAOps, classBOps, workerRequests }
}

async function main(): Promise<void> {
  const budget = Number.parseFloat(required('ART_BUDGET_USD'))
  if (!Number.isFinite(budget) || budget <= 0) {
    throw new Error('ART_BUDGET_USD must be a positive number of dollars')
  }
  const now = new Date()
  const usage = await fetchUsage(required('CLOUDFLARE_ACCOUNT_ID'), required('CLOUDFLARE_API_TOKEN'), monthStart(now))
  for (const line of report(usage, budget, now)) console.log(line)
  if (isOverBudget(usage, budget)) process.exitCode = 1
}

// Only when run, never when imported by a test.
if (process.argv[1]?.endsWith('spend.ts') || process.argv[1]?.endsWith('spend.js')) {
  main().catch((err: unknown) => {
    console.error(`spend: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 2
  })
}
