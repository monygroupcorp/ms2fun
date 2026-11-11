/**
 * Pinning a collection with a service the holder has an account with, through the IPFS Pinning
 * Service API (https://ipfs.github.io/pinning-services-api-spec/): `POST /pins {cid, name}`, then
 * `GET /pins/<requestid>` until the service says `pinned` or `failed`.
 *
 * The service fetches the content BY CID FROM THE NETWORK. Nothing is uploaded, so this only works
 * for content public IPFS can already serve, and the panel offers it only then.
 *
 * THE TOKEN. It is the holder's credential with their own service. It goes from this page straight
 * to the endpoint they chose, in an `Authorization` header and nowhere else: never to the art host
 * or art service (an endpoint on either origin is refused), never into a URL, a log or an error
 * message. It is kept in this tab's session storage so a reload does not lose it, and goes when the
 * tab closes.
 */

export interface PsaPreset {
  id: string
  label: string
  endpoint: string
  /** Where the holder makes a token. */
  tokenHelp: string
}

/**
 * Services whose Pinning Service API endpoints are documented and standard.
 *
 *   Pinata    https://api.pinata.cloud/psa — "Pinning Services API" in Pinata's API reference,
 *             https://docs.pinata.cloud/api-reference/pinning-service-api ; the token is the JWT
 *             shown when an API key is created.
 *   Filebase  https://api.filebase.io/v1/ipfs — "IPFS Pinning Service API",
 *             https://filebase.com/docs/ipfs/pinning-service-api ; the token is a per-bucket access
 *             token from the Access Keys page. Pins land in that bucket.
 *
 * Both answered a CORS preflight for POST with `authorization, content-type` when this was written,
 * which is what lets a web page use them directly.
 */
export const PSA_PRESETS: readonly PsaPreset[] = [
  {
    id: 'pinata',
    label: 'Pinata',
    endpoint: 'https://api.pinata.cloud/psa',
    tokenHelp: 'the JWT shown when you create an API key in Pinata',
  },
  {
    id: 'filebase',
    label: 'Filebase',
    endpoint: 'https://api.filebase.io/v1/ipfs',
    tokenHelp: "a bucket's access token, from Filebase's Access Keys page",
  },
]

/**
 * A service endpoint as typed, normalised to its root (no trailing slash, no trailing `/pins`), or
 * null when it is not a plain http(s) URL or is on one of `refused` origins (ours).
 */
export function normaliseServiceEndpoint(
  input: string,
  refused: readonly (string | null | undefined)[] = [],
): string | null {
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
  for (const ours of refused) {
    if (typeof ours !== 'string' || ours === '') continue
    try {
      if (new URL(ours).origin === url.origin) return null
    } catch {
      // not a URL; nothing to compare
    }
  }
  const path = url.pathname.replace(/\/+$/, '').replace(/\/pins$/, '')
  return `${url.origin}${path}`
}

export type PinState = 'queued' | 'pinning' | 'pinned' | 'failed'

export interface PinStatus {
  requestid: string
  status: PinState
}

/** A refusal from the service, with the token scrubbed from anything it echoed. */
export class PsaError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message)
  }
}

function scrub(text: string, token: string): string {
  return token.length < 4 ? text : text.split(token).join('…')
}

async function failure(res: Response, token: string): Promise<PsaError> {
  let reason = ''
  try {
    const body = (await res.json()) as { error?: { reason?: unknown; details?: unknown } }
    const parts = [body.error?.reason, body.error?.details].filter(
      (p): p is string => typeof p === 'string' && p !== '',
    )
    reason = parts.join(': ')
  } catch {
    // not JSON
  }
  const what =
    res.status === 401 || res.status === 403
      ? 'the service did not accept the token'
      : `the service answered ${res.status}`
  return new PsaError(scrub(reason === '' ? what : `${what} (${reason})`, token), res.status)
}

function asStatus(body: unknown): PinStatus {
  const { requestid, status } = (body ?? {}) as { requestid?: unknown; status?: unknown }
  if (
    typeof requestid !== 'string' ||
    (status !== 'queued' && status !== 'pinning' && status !== 'pinned' && status !== 'failed')
  ) {
    throw new PsaError('the service answered with something that is not a pin status', null)
  }
  return { requestid, status }
}

async function call(
  url: string,
  token: string,
  init: RequestInit,
  fetcher: typeof fetch,
): Promise<unknown> {
  let res: Response
  try {
    res = await fetcher(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
      // A credential of the holder's: never cached, never sent with cookies.
      cache: 'no-store',
      credentials: 'omit',
    })
  } catch {
    throw new PsaError(
      `could not reach ${new URL(url).host} — the address may be wrong, or the service does not accept requests from web pages`,
      null,
    )
  }
  if (!res.ok) throw await failure(res, token)
  return res.json()
}

/** `POST /pins`: ask the service to pin a CID. */
export async function requestPin(
  endpoint: string,
  token: string,
  pin: { cid: string; name: string },
  fetcher: typeof fetch = fetch,
): Promise<PinStatus> {
  return asStatus(
    await call(
      `${endpoint}/pins`,
      token,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cid: pin.cid, name: pin.name.slice(0, 255) }),
      },
      fetcher,
    ),
  )
}

/** `GET /pins/<requestid>`: where a pin request stands. */
export async function pinStatus(
  endpoint: string,
  token: string,
  requestid: string,
  fetcher: typeof fetch = fetch,
): Promise<PinStatus> {
  return asStatus(
    await call(`${endpoint}/pins/${encodeURIComponent(requestid)}`, token, {}, fetcher),
  )
}

/** Where the endpoint and token wait while the tab is open. Session storage only, by design. */
const SESSION_KEY = 'ms2fun:session:pinningService'

export interface SavedService {
  endpoint: string
  token: string
}

export function loadService(): SavedService | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (raw === null) return null
    const parsed = JSON.parse(raw) as Partial<SavedService>
    if (typeof parsed.endpoint !== 'string' || typeof parsed.token !== 'string') return null
    return { endpoint: parsed.endpoint, token: parsed.token }
  } catch {
    return null
  }
}

export function saveService(service: SavedService | null): void {
  try {
    if (service === null) sessionStorage.removeItem(SESSION_KEY)
    else sessionStorage.setItem(SESSION_KEY, JSON.stringify(service))
  } catch {
    // Storage refused (private mode, quota): the token simply is not remembered.
  }
}
