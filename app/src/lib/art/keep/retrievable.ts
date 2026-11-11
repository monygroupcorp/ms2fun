/**
 * Is a root retrievable from public IPFS right now — from somebody other than us?
 *
 * The question behind the status readout, and the gate on pinning by CID: a pinning service fetches
 * what it is asked to pin from the network, so it can only succeed if the network can serve it.
 *
 * Asked cheaply. A sampled file is asked for with HEAD (no body), falling back to a one-byte ranged
 * GET for a gateway that refuses HEAD; with no file to sample, the root block alone is asked for
 * with `?format=raw`, which is one block whatever the size of the collection. Gateways are tried in
 * roster order, one at a time, and the first that answers settles it, so a healthy root costs one
 * request on the viewer's metered public-gateway budget.
 *
 * NEVER COUNTS OUR OWN HOST. The roster is public gateways only, and any entry on the art host's or
 * the art service's origin is dropped as well, so a ✓ here means the art lives somewhere we do not
 * control.
 */
import { IPFS_GATEWAYS, gatewayUrl, type IpfsGateway } from '../../metadata/gateways'
import type { KeepRoot } from './plan'

export interface RootCheck {
  cid: string
  role: KeepRoot['role']
  ok: boolean
  /** The gateway operator that served it, when one did. */
  operator: string | null
}

function originOf(url: string | null | undefined): string | null {
  if (typeof url !== 'string' || url === '') return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/** The public roster minus anything served from the origins given (our host, our art service). */
export function independentGateways(
  ours: readonly (string | null | undefined)[],
  gateways: readonly IpfsGateway[] = IPFS_GATEWAYS,
): IpfsGateway[] {
  const excluded = new Set(ours.map(originOf).filter((o): o is string => o !== null))
  return gateways.filter((gateway) => {
    const url = gatewayUrl(gateway, 'bafkqaaa')
    const origin = originOf(url)
    return origin !== null && !excluded.has(origin)
  })
}

/** `url` with a query appended, or null for no url. */
export function withQuery(url: string | null, query: string): string | null {
  if (url === null) return null
  return `${url}${url.includes('?') ? '&' : '?'}${query}`
}

async function answers(url: string, fetcher: typeof fetch, timeoutMs: number): Promise<boolean> {
  try {
    const head = await fetcher(url, { method: 'HEAD', signal: AbortSignal.timeout(timeoutMs) })
    if (head.ok) return true
    if (head.status !== 405 && head.status !== 501) return false
  } catch {
    return false
  }
  // HEAD refused: ask for one byte, and stop the body either way.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetcher(url, { headers: { Range: 'bytes=0-0' }, signal: controller.signal })
    return res.ok
  } catch {
    return false
  } finally {
    controller.abort()
    clearTimeout(timer)
  }
}

/** Whether one root answers on any independent gateway. */
export async function checkRoot(
  root: KeepRoot,
  options: { gateways: readonly IpfsGateway[]; fetcher?: typeof fetch; timeoutMs?: number },
): Promise<RootCheck> {
  const fetcher = options.fetcher ?? fetch
  const timeoutMs = options.timeoutMs ?? 12_000
  for (const gateway of options.gateways) {
    const url =
      root.sample === undefined
        ? withQuery(gatewayUrl(gateway, root.cid), 'format=raw')
        : gatewayUrl(gateway, `${root.cid}/${root.sample}`)
    if (url === null) continue
    if (await answers(url, fetcher, timeoutMs)) {
      return { cid: root.cid, role: root.role, ok: true, operator: gateway.operator }
    }
  }
  return { cid: root.cid, role: root.role, ok: false, operator: null }
}

/** Every root, one after another (never in parallel: the budget is the viewer's). */
export async function checkRoots(
  roots: readonly KeepRoot[],
  options: { gateways: readonly IpfsGateway[]; fetcher?: typeof fetch; timeoutMs?: number },
): Promise<RootCheck[]> {
  const out: RootCheck[] = []
  for (const root of roots) out.push(await checkRoot(root, options))
  return out
}
