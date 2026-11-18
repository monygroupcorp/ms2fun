/**
 * `pnpm release:verify <cid>`: proves a Sepolia release is what both names now serve.
 *
 * Run after the names were pointed at `<cid>`, from the tree `release:sepolia` built (so
 * `dist/ipfs/` is that release's bundle). It:
 *
 *   1. polls each name until its gateway's `x-ipfs-cid` header equals `<cid>` — a record write is
 *      read by the gateway on its own cadence, so the first look after the transaction may be stale;
 *   2. fails unless each name's served `index.html` is byte-identical to the local build's;
 *   3. fails unless the JavaScript that `index.html` loads bakes `VITE_CHAIN_ID` 11155111 and the
 *      Sepolia master registry address — the two values whose absence once shipped a site that
 *      talked to the wrong chain;
 *   4. fails unless an independent IPFS gateway, not either name's own, retrieves `<cid>` and
 *      serves the same `index.html`.
 *
 * Every failure is printed; the exit code is 1 if there was any.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { RELEASE_CHAIN_ID } from './release'

/** The names a Sepolia release is pointed at, as their gateways serve them. */
export const RELEASE_ORIGINS = ['https://noesis.gwei.domains/', 'https://noesis.wei.domains/']

/** A gateway that reads neither name's record: retrieving the CID here proves it is on IPFS. */
export const INDEPENDENT_GATEWAY = 'https://ipfs.io/ipfs/'

type Fetch = typeof fetch

/** The `./assets/*.js` files `index.html` loads: its entry script and its modulepreloads. */
export function scriptRefs(html: string): string[] {
  const refs = new Set<string>()
  for (const match of html.matchAll(/(?:src|href)="(\.?\/?assets\/[^"]+\.js)"/g)) {
    refs.add(match[1].replace(/^\.?\//, ''))
  }
  return [...refs]
}

/** Why `bundle` is not a Sepolia build; empty when it bakes both the chain id and the registry. */
export function bundleReasons(bundle: string, registry: string): string[] {
  const reasons: string[] = []
  if (!new RegExp(`VITE_CHAIN_ID:\\s*["'\`]${RELEASE_CHAIN_ID}["'\`]`).test(bundle)) {
    reasons.push(`the bundle does not bake VITE_CHAIN_ID ${RELEASE_CHAIN_ID}`)
  }
  if (!bundle.toLowerCase().includes(registry.toLowerCase())) {
    reasons.push(`the bundle does not carry the Sepolia master registry ${registry}`)
  }
  return reasons
}

export interface PollOptions {
  fetchImpl?: Fetch
  sleep?: (ms: number) => Promise<void>
  intervalMs?: number
  timeoutMs?: number
  now?: () => number
}

/**
 * Poll `origin` until its `x-ipfs-cid` is `cid`. Resolves with the last CID seen; the caller
 * compares, so a timeout reports what the name was still serving.
 */
export async function pollForCid(origin: string, cid: string, options: PollOptions = {}) {
  const {
    fetchImpl = fetch,
    sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
    intervalMs = 30_000,
    timeoutMs = 30 * 60_000,
    now = Date.now,
  } = options
  const deadline = now() + timeoutMs
  let seen: string | null = null
  for (;;) {
    try {
      const response = await fetchImpl(origin, { method: 'HEAD', cache: 'no-store' })
      seen = response.headers.get('x-ipfs-cid')
    } catch {
      seen = null
    }
    if (seen === cid || now() >= deadline) return seen
    await sleep(intervalMs)
  }
}

async function getText(url: string, fetchImpl: Fetch): Promise<string> {
  const response = await fetchImpl(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return response.text()
}

export interface VerifyInput {
  cid: string
  localIndex: string
  registry: string
  origins?: string[]
  gateway?: string
  poll?: PollOptions
  fetchImpl?: Fetch
  log?: (line: string) => void
}

/** Every reason the release is not verified; empty when it is. */
export async function verifyRelease(input: VerifyInput): Promise<string[]> {
  const {
    cid,
    localIndex,
    registry,
    origins = RELEASE_ORIGINS,
    gateway = INDEPENDENT_GATEWAY,
    fetchImpl = fetch,
    log = () => {},
  } = input
  const reasons: string[] = []

  for (const origin of origins) {
    const seen = await pollForCid(origin, cid, { fetchImpl, ...input.poll })
    if (seen !== cid) {
      reasons.push(`${origin} still serves ${seen ?? '(no x-ipfs-cid)'}, not ${cid}`)
      continue
    }
    log(`${origin} serves ${cid}`)
    try {
      const index = await getText(origin, fetchImpl)
      if (index !== localIndex) {
        reasons.push(`${origin} serves an index.html that differs from the local build`)
        continue
      }
      const scripts = scriptRefs(index)
      if (scripts.length === 0) {
        reasons.push(`${origin} index.html loads no ./assets/*.js`)
        continue
      }
      const bundle = (
        await Promise.all(scripts.map((path) => getText(new URL(path, origin).href, fetchImpl)))
      ).join('\n')
      const bundleProblems = bundleReasons(bundle, registry)
      reasons.push(...bundleProblems.map((reason) => `${origin}: ${reason}`))
      if (bundleProblems.length === 0) {
        log(
          `${origin} index.html matches the local build; bundle is Sepolia (${scripts.length} scripts)`,
        )
      }
    } catch (error) {
      reasons.push(`${origin}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const independent = `${gateway}${cid}/`
  try {
    const index = await getText(independent, fetchImpl)
    if (index !== localIndex) {
      reasons.push(`${independent} serves an index.html that differs from the local build`)
    } else {
      log(`${independent} retrieves the release`)
    }
  } catch (error) {
    reasons.push(`${independent}: ${error instanceof Error ? error.message : String(error)}`)
  }

  return reasons
}

const APP_DIR = resolve(import.meta.dirname, '..', '..')

async function main(): Promise<void> {
  const cid = process.argv[2]
  if (!cid || !/^baf[a-z2-7]+$/.test(cid)) {
    console.error('usage: pnpm release:verify <cid>   (a CIDv1, as release:sepolia printed it)')
    process.exit(1)
  }
  const localIndex = readFileSync(resolve(APP_DIR, 'dist', 'ipfs', 'index.html'), 'utf8')
  const deployment = JSON.parse(
    readFileSync(resolve(APP_DIR, 'src', 'config', 'sepolia-deployment.json'), 'utf8'),
  ) as { contracts: { MasterRegistryV1: string } }

  const reasons = await verifyRelease({
    cid,
    localIndex,
    registry: deployment.contracts.MasterRegistryV1,
    log: (line) => console.log(`verify: ${line}`),
  })
  if (reasons.length > 0) {
    console.error('verify: FAILED')
    for (const reason of reasons) console.error(`  - ${reason}`)
    process.exit(1)
  }
  console.log(`verify: ok — both names serve ${cid}`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch((error: unknown) => {
    console.error('verify: FAILED —', error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
