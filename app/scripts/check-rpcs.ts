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
 * The list is READ from `src/lib/rpc.ts` rather than repeated here, so this cannot pass while
 * checking endpoints the app does not use.
 *
 * Run: `pnpm rpc:check`. Exits 0 when every entry passes all three; 1 naming each that does not.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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

async function main() {
  const here = dirname(fileURLToPath(import.meta.url))
  const source = readFileSync(resolve(here, '../src/lib/rpc.ts'), 'utf-8')
  const pools = readPools(source)

  let failed = 0
  for (const [chainId, urls] of pools) {
    console.log(`chain ${chainId}`)
    const results = await Promise.all(
      urls.map(async (u) => [u, await checkEndpoint(u, chainId)] as const),
    )
    for (const [url, reasons] of results) {
      if (reasons.length === 0) {
        console.log(`  ok      ${url}`)
      } else {
        failed += 1
        console.log(`  FAILED  ${url}`)
        for (const reason of reasons) console.log(`            - ${reason}`)
      }
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
