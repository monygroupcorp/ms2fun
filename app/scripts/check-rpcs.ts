/**
 * Proves every endpoint in `src/lib/rpc.ts` is one a BROWSER on the published origin can actually
 * use, and fails when one is not.
 *
 * This exists because the list shipped on 2026-09-29 with three of its four Sepolia entries dead,
 * and nothing in the repository could have said so: the URLs are inlined into a pinned bundle, the
 * app has no server to notice, and a dead entry costs more than nothing — viem's `rank: true`
 * re-probes every endpoint on a timer, so each call burns its retries on the corpses and the one
 * live endpoint gets rate-limited for the sins of the others.
 *
 * THREE CHECKS, because each of the three real failures passed the other two:
 *
 *   preflight  `rpc.sepolia.org` answered requests but sent no `access-control-allow-origin`, so a
 *              browser could not read a single response. A terminal check never sees this: curl
 *              does not enforce CORS.
 *   batch      the app sends `batch: true`, so it POSTs an ARRAY. An endpoint that answers a single
 *              call and rejects a batch is dead for this app and alive for a naive check.
 *   body       `1rpc.io/sepolia` returned HTTP 200 whose body was a JSON-RPC "usage limit" error.
 *              That is the worst shape there is: a health ranker scores it as the healthiest member
 *              of the pool and sends it everything.
 *
 * A FOURTH, for history: every log scan in the app walks `eth_getLogs` in windows of
 * `logWindowForChain` blocks, and a public endpoint can serve every call above and still refuse a
 * window that wide. Each entry gets one address-filtered `eth_getLogs` ending at its head at the
 * app's window (a refusal fails the run, unless the entry is in `rpc.ts`'s `NARROW_LOG_RANGE`,
 * which keeps it off log scans) and one at 50,000 blocks, which is printed as measured and never
 * fails the run: it says how much room each provider leaves, not whether the app works.
 *
 * The lists are READ from `src/lib/rpc.ts` rather than repeated here, so this cannot pass while
 * checking endpoints the app does not use.
 *
 * Run: `pnpm rpc:check` (every chain) or `pnpm rpc:check --chain 1` (one). Exits 0 when every
 * entry passes all four; 1 naming each that does not.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { logWindowForChain } from '../src/lib/logWindow'

/** The origin a published bundle asks from; CORS answers differ by origin, so it is not invented. */
const ORIGIN = 'https://noesis.gwei.domains'

const TIMEOUT_MS = 15_000

/** What the app actually puts on the wire with `batch: true`: an array, not an object. */
const BATCH = [
  { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] },
  { jsonrpc: '2.0', id: 2, method: 'eth_blockNumber', params: [] },
]

/** Endpoint -> the chain id it is listed under, read out of the module the app imports. */
export function readPools(source: string): Map<number, string[]> {
  const pools = new Map<number, string[]>()
  const block = source.match(/const PUBLIC_RPCS[^{]*\{([\s\S]*?)\n\}/)
  if (block === null) throw new Error('rpc.ts: could not find PUBLIC_RPCS')
  for (const entry of block[1]!.matchAll(/(\d+):\s*\[([\s\S]*?)\]/g)) {
    const urls = [...entry[2]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!)
    pools.set(Number(entry[1]), urls)
  }
  return pools
}

/** The `NARROW_LOG_RANGE` entries in rpc.ts: in the pool, but kept off `eth_getLogs`. */
export function readNarrowLogRange(source: string): string[] {
  const block = source.match(/const NARROW_LOG_RANGE[^=]*=\s*\[([\s\S]*?)\]/)
  if (block === null) throw new Error('rpc.ts: could not find NARROW_LOG_RANGE')
  return [...block[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!)
}

/**
 * The pool entries a log scan on this chain can use and that served the app's window: every entry
 * outside `NARROW_LOG_RANGE` whose measurement came back ok. Empty means no scan on the chain can
 * load its history, even when every entry passes on its own (all of them kept off log scans).
 */
export function logScanPaths(
  results: ReadonlyArray<{ url: string; logs: { app: string }; skipped: boolean }>,
): string[] {
  return results.filter((r) => !r.skipped && r.logs.app.startsWith('ok')).map((r) => r.url)
}

/** The width every pool entry's range cap is also measured at, as a report. */
const WIDE_LOG_WINDOW = 50_000n

/**
 * The contract probed on a chain with no deployment file: the ENS registry, at the same address on
 * every chain. A probe needs an address filter (the app always sends one). Its volume is moderate
 * (about 1,250 logs per 10,000 mainnet blocks), well under the result caps public endpoints set, so
 * a refusal here is about the range asked for.
 */
const QUIET_CONTRACT = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e'

/** Chain id -> the protocol's MasterRegistryV1, from each deployment file in `src/config/`. */
export function readRegistries(configDir: string): Map<number, string> {
  const registries = new Map<number, string>()
  for (const name of readdirSync(configDir)) {
    if (!name.endsWith('-deployment.json') || name.startsWith('local')) continue
    const config = JSON.parse(readFileSync(resolve(configDir, name), 'utf-8')) as {
      chainId?: number
      contracts?: { MasterRegistryV1?: string }
    }
    const registry = config.contracts?.MasterRegistryV1
    if (config.chainId !== undefined && registry !== undefined) {
      registries.set(config.chainId, registry)
    }
  }
  return registries
}

async function withTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** Every reason this endpoint cannot serve a browser on ORIGIN. Empty means it can. */
export async function checkEndpoint(url: string, chainId: number): Promise<string[]> {
  const reasons: string[] = []

  try {
    const pre = await withTimeout(url, {
      method: 'OPTIONS',
      headers: {
        origin: ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    })
    if (!pre.headers.has('access-control-allow-origin')) {
      reasons.push(`preflight sends no access-control-allow-origin (a browser cannot read it)`)
    }
  } catch (error) {
    reasons.push(`preflight failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  try {
    const res = await withTimeout(url, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify(BATCH),
    })
    if (!res.ok) {
      reasons.push(`batched POST answered ${res.status}`)
    } else {
      const body: unknown = await res.json()
      const rows = Array.isArray(body) ? body : [body]
      const errored = rows.find((r) => r !== null && typeof r === 'object' && 'error' in r)
      if (errored !== undefined) {
        const message = (errored as { error?: { message?: string } }).error?.message ?? 'unknown'
        reasons.push(`answered 200 carrying a JSON-RPC error: ${message}`)
      } else {
        const chain = rows.find(
          (r) => r !== null && typeof r === 'object' && (r as { id?: number }).id === 1,
        ) as { result?: string } | undefined
        const got = chain?.result === undefined ? undefined : Number(chain.result)
        if (got !== chainId) {
          reasons.push(`eth_chainId returned ${String(chain?.result)}, not chain ${chainId}`)
        }
      }
    }
  } catch (error) {
    reasons.push(`batched POST failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  return reasons
}

async function rpc(url: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await withTimeout(url, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify([{ jsonrpc: '2.0', id: 1, method, params }]),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 120).trim()}`)
  const body: unknown = JSON.parse(text)
  const row = (Array.isArray(body) ? body[0] : body) as {
    result?: unknown
    error?: { code?: number; message?: string }
  }
  if (row.error !== undefined) throw new Error(`${row.error.code} ${row.error.message}`)
  return row.result
}

/** One address-filtered `eth_getLogs` over the `width` blocks ending at `head`. */
export async function probeLogs(
  url: string,
  address: string,
  head: bigint,
  width: bigint,
): Promise<string> {
  const toHex = (n: bigint) => `0x${n.toString(16)}`
  try {
    const logs = await rpc(url, 'eth_getLogs', [
      { address, fromBlock: toHex(head - width + 1n), toBlock: toHex(head) },
    ])
    return Array.isArray(logs) ? `ok (${logs.length} logs)` : 'answered without a log list'
  } catch (error) {
    return `refused: ${error instanceof Error ? error.message : String(error)}`
  }
}

/** The app-window and 50,000-block `eth_getLogs` results for one entry. */
async function checkLogRange(
  url: string,
  address: string,
  window: bigint,
): Promise<{ app: string; wide: string }> {
  let head: bigint
  try {
    head = BigInt((await rpc(url, 'eth_blockNumber', [])) as string)
  } catch (error) {
    const reason = `no head: ${error instanceof Error ? error.message : String(error)}`
    return { app: reason, wide: reason }
  }
  const app = await probeLogs(url, address, head, window)
  const wide =
    window === WIDE_LOG_WINDOW ? app : await probeLogs(url, address, head, WIDE_LOG_WINDOW)
  return { app, wide }
}

async function main() {
  const here = dirname(fileURLToPath(import.meta.url))
  const source = readFileSync(resolve(here, '../src/lib/rpc.ts'), 'utf-8')
  const pools = readPools(source)
  const only = process.argv.indexOf('--chain')
  if (only !== -1) {
    const chainId = Number(process.argv[only + 1])
    if (!pools.has(chainId)) throw new Error(`--chain ${process.argv[only + 1]}: no pool in rpc.ts`)
    for (const id of [...pools.keys()]) if (id !== chainId) pools.delete(id)
  }
  const narrow = readNarrowLogRange(source)
  const registries = readRegistries(resolve(here, '../src/config'))

  let failed = 0
  for (const [chainId, urls] of pools) {
    const window = logWindowForChain(chainId)
    const address = registries.get(chainId) ?? QUIET_CONTRACT
    console.log(`chain ${chainId} (eth_getLogs on ${address}, app window ${window} blocks)`)
    const results = await Promise.all(
      urls.map(async (u) => {
        const reasons = await checkEndpoint(u, chainId)
        const logs = await checkLogRange(u, address, window)
        const skipped = narrow.includes(u)
        if (!skipped && !logs.app.startsWith('ok')) {
          reasons.push(`eth_getLogs at the app window (${window} blocks) ${logs.app}`)
        }
        return { url: u, reasons, logs, skipped }
      }),
    )
    for (const { url, reasons, logs, skipped } of results) {
      if (reasons.length === 0) {
        console.log(`  ok      ${url}`)
      } else {
        failed += 1
        console.log(`  FAILED  ${url}`)
        for (const reason of reasons) console.log(`            - ${reason}`)
      }
      const app = skipped ? `${logs.app} (kept off log scans: NARROW_LOG_RANGE)` : logs.app
      console.log(`            getLogs ${window} blocks: ${app}`)
      if (window !== WIDE_LOG_WINDOW) {
        console.log(`            getLogs ${WIDE_LOG_WINDOW} blocks: ${logs.wide}`)
      }
    }
    if (logScanPaths(results).length === 0) {
      failed += 1
      console.log(
        `  FAILED  no pool entry outside NARROW_LOG_RANGE serves eth_getLogs at ${window} blocks on chain ${chainId}`,
      )
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} endpoint(s) in src/lib/rpc.ts cannot serve a browser on ${ORIGIN}.`)
    process.exit(1)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
