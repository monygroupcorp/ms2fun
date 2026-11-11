/**
 * Talking to a holder's own IPFS node: kubo, or IPFS Desktop (which runs kubo), over its RPC API.
 *
 * Nothing here runs on its own. Every call is the consequence of a click in the panel, and the
 * endpoint is whatever the holder typed, checked to be a plain http(s) URL first.
 *
 * Every RPC call is a POST: kubo refuses GET on its API, as a defence against cross-site requests.
 * For the same reason it refuses a request from a web page whose origin it was not told to allow,
 * which is the one-time setup `setupCommands` spells out.
 */

/** IPFS Desktop's and kubo's default RPC address. */
export const DEFAULT_NODE_API = 'http://127.0.0.1:5001'

/**
 * A node endpoint the holder typed, normalised to `scheme://host[:port][/path]` with no trailing
 * slash and no `/api/v0`, or null when it is not a plain http(s) URL.
 *
 * Credentials, a query or a fragment in the URL are refused rather than stripped: none belongs in a
 * node address, and silently sending a URL other than the one typed is worse than saying no.
 */
export function normaliseEndpoint(input: string): string | null {
  const raw = input.trim()
  if (raw === '') return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    return null
  }
  const path = url.pathname.replace(/\/+$/, '').replace(/\/api\/v0$/, '')
  return `${url.origin}${path}`
}

export interface NodeIdentity {
  id: string
  agentVersion: string
}

/**
 * What detecting the node found.
 *
 *   ready        the node answered; pinning can go ahead
 *   blocked      something is listening but would not answer this page: the node does not allow
 *                this origin yet (kubo answers 403, or the browser hides the answer for want of
 *                CORS headers), or the browser held the request back for local-network permission
 *   unreachable  nothing answered at all: no node running at that address, or the browser refused
 *                to reach it before a request went out
 */
export type Detection =
  | { kind: 'ready'; node: NodeIdentity }
  | { kind: 'blocked' }
  | { kind: 'unreachable' }

function rpc(endpoint: string, command: string, args: Record<string, string> = {}): string {
  const query = new URLSearchParams(args).toString()
  return `${endpoint}/api/v0/${command}${query === '' ? '' : `?${query}`}`
}

/** `POST /api/v0/id`, then, if the page cannot read the answer, whether anything is there at all. */
export async function detectNode(
  endpoint: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = 8_000,
): Promise<Detection> {
  try {
    const res = await fetcher(rpc(endpoint, 'id'), {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (res.status === 403) return { kind: 'blocked' }
    if (!res.ok) return { kind: 'unreachable' }
    const body = (await res.json()) as { ID?: unknown; AgentVersion?: unknown }
    if (typeof body.ID !== 'string') return { kind: 'unreachable' }
    return {
      kind: 'ready',
      node: {
        id: body.ID,
        agentVersion: typeof body.AgentVersion === 'string' ? body.AgentVersion : 'kubo',
      },
    }
  } catch {
    // A CORS refusal and a closed port look the same from here. An opaque request tells them
    // apart: it does not need the node's permission to complete, only something listening.
    try {
      await fetcher(rpc(endpoint, 'version'), {
        method: 'POST',
        mode: 'no-cors',
        signal: AbortSignal.timeout(timeoutMs),
      })
      return { kind: 'blocked' }
    } catch {
      return { kind: 'unreachable' }
    }
  }
}

/**
 * Where the app is published (`app/scripts/ipfs-dist/RUNBOOK.md`): the web build and the IPFS
 * build. The setup names both, so one setup covers a holder who uses either.
 */
export const PUBLISHED_ORIGINS = ['https://ms2.fun', 'https://noesis.gwei.domains'] as const

/** The origins a holder's node should allow: this page's, and the app's published ones. */
export function originsToAllow(current: string, published: readonly string[]): string[] {
  const out: string[] = []
  for (const origin of [current, ...published]) {
    if (origin === '' || origin === 'null' || out.includes(origin)) continue
    out.push(origin)
  }
  return out
}

/**
 * The commands that let this page talk to the holder's node, for the origins given.
 *
 * The node's own web UI origins are kept in the list: setting it replaces whatever was there, and
 * a list without them would lock the holder out of the node's own web UI.
 */
export function setupCommands(endpoint: string, origins: readonly string[]): string[] {
  let nodeOrigin = DEFAULT_NODE_API
  try {
    nodeOrigin = new URL(endpoint).origin
  } catch {
    // keep the default
  }
  const allow = [...origins, nodeOrigin, 'https://webui.ipfs.io']
  const unique = allow.filter((origin, i) => allow.indexOf(origin) === i)
  return [
    `ipfs config --json API.HTTPHeaders.Access-Control-Allow-Origin '${JSON.stringify(unique)}'`,
    `ipfs config --json API.HTTPHeaders.Access-Control-Allow-Methods '["POST"]'`,
  ]
}

export interface ImportResult {
  /** Roots the node imported, each with the pin error it reported ('' when pinned). */
  roots: { cid: string; pinError: string }[]
}

/** Uploads a body with progress. `fetch` cannot report upload progress; the default uses XHR. */
export type Upload = (
  url: string,
  body: FormData,
  onProgress: (sent: number, total: number) => void,
) => Promise<{ status: number; text: string }>

export const xhrUpload: Upload = (url, body, onProgress) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total)
    }
    xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText })
    xhr.onerror = () => reject(new Error('the node did not answer'))
    xhr.onabort = () => reject(new Error('the upload was cancelled'))
    xhr.send(body)
  })

/** Kubo's error body, `{"Message": "..."}`, or the status when there is none. */
function rpcError(status: number, text: string): string {
  try {
    const body = JSON.parse(text) as { Message?: unknown }
    if (typeof body.Message === 'string') return body.Message
  } catch {
    // not JSON
  }
  return `the node answered ${status}`
}

/**
 * `POST /api/v0/dag/import?pin-roots=true`: the node stores every block and pins each root the CAR
 * header names. The answer is one JSON object per line: a `Root` for each root, and `Stats`.
 */
export async function importCar(
  endpoint: string,
  car: Blob,
  filename: string,
  onProgress: (sent: number, total: number) => void,
  upload: Upload = xhrUpload,
): Promise<ImportResult> {
  const body = new FormData()
  body.append('file', car, filename)
  const { status, text } = await upload(
    rpc(endpoint, 'dag/import', { 'pin-roots': 'true', stats: 'true' }),
    body,
    onProgress,
  )
  if (status < 200 || status >= 300) throw new Error(rpcError(status, text))
  const roots: ImportResult['roots'] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    let entry: { Root?: { Cid?: { '/'?: unknown }; PinErrorMsg?: unknown } }
    try {
      entry = JSON.parse(line) as typeof entry
    } catch {
      continue
    }
    const cid = entry.Root?.Cid?.['/']
    if (typeof cid === 'string') {
      const pinError = entry.Root?.PinErrorMsg
      roots.push({ cid, pinError: typeof pinError === 'string' ? pinError : '' })
    }
  }
  return { roots }
}

/**
 * `POST /api/v0/pin/ls?arg=<cid>`: how the node holds a CID — `recursive`, `indirect` (inside a
 * pinned root), `direct` — or null when it is not pinned.
 */
export async function pinType(
  endpoint: string,
  cid: string,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  const res = await fetcher(rpc(endpoint, 'pin/ls', { arg: cid }), { method: 'POST' })
  const text = await res.text()
  if (!res.ok) {
    if (/not pinned/i.test(text)) return null
    throw new Error(rpcError(res.status, text))
  }
  const body = JSON.parse(text) as { Keys?: Record<string, { Type?: unknown }> }
  // One key, for the one CID asked about (kubo may spell it in another base).
  const entry = Object.values(body.Keys ?? {})[0]
  if (entry !== undefined && typeof entry.Type === 'string') return entry.Type
  return null
}
