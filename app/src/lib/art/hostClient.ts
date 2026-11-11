/**
 * The app's side of art hosting: where the host is, and the requests that talk to it.
 *
 * The host is read from `VITE_ART_HOST` and from nowhere else. `app/.env.production` sets the
 * project's default, so a production build offers uploads; a dev build, a test run, or a fork that
 * clears the variable has no host, and the wizard then shows only the paste-a-link field — exactly
 * as it did before hosting existed.
 */
import { createSiweMessage } from 'viem/siwe'

import { normaliseArtServiceBase } from '../metadata/artServiceBase'
import { parseGatewayShapedUri, type HostingState } from './hostingLimits'

/** The art host's origin, or null when this build has none. */
export function artHostBase(): string | null {
  return normaliseArtServiceBase(import.meta.env.VITE_ART_HOST)
}

/** Whether a per-token base is one this build's art host serves (and so may need binding). */
export function isHostedArtUri(uri: string, host: string | null = artHostBase()): boolean {
  if (host === null) return false
  const shaped = parseGatewayShapedUri(uri)
  return shaped !== null && uri.trim().startsWith(`${host}/ipfs/`)
}

/** A refusal from the host, carrying the reason it gave so the creator sees it. */
export class ArtHostError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function reasonOf(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown }
    if (typeof body.error === 'string') return body.error
  } catch {
    // Not JSON — fall through to the status.
  }
  return `the art host answered ${res.status}`
}

async function call<T>(host: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${host}${path}`, init)
  if (!res.ok) throw new ArtHostError(await reasonOf(res), res.status)
  return (await res.json()) as T
}

/** The text a creator signs to sign in. Plain EIP-4361, naming this site and the host's nonce. */
export function signInMessage(args: {
  address: `0x${string}`
  chainId: number
  nonce: string
  location?: Pick<Location, 'host' | 'origin'>
}): string {
  const where = args.location ?? window.location
  return createSiweMessage({
    address: args.address,
    chainId: args.chainId,
    domain: where.host,
    uri: where.origin,
    nonce: args.nonce,
    version: '1',
    statement: 'Sign in to upload art for temporary hosting. This costs nothing and sends nothing.',
    issuedAt: new Date(),
  })
}

/**
 * Sign in and return a session token. `sign` is the connected wallet's personal-sign; a smart
 * wallet's signature is checked by the host on-chain, so either kind works.
 */
export async function signIn(
  host: string,
  address: `0x${string}`,
  chainId: number,
  sign: (message: string) => Promise<`0x${string}`>,
): Promise<string> {
  const { nonce } = await call<{ nonce: string }>(host, '/upload/nonce')
  const message = signInMessage({ address, chainId, nonce })
  const signature = await sign(message)
  const { token } = await call<{ token: string }>(host, '/upload/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, signature }),
  })
  return token
}

export interface HostedDraft {
  id: string
  state: 'reserved' | 'open' | 'bound'
  imgCid: string | null
  metaCid: string | null
  bytes: number
  files: number
  expiresAt: number | null
}

/** A resumable upload the host has started: which parts it holds so far. */
export interface PartsUpload {
  id: string
  bytes: number
  partSize: number
  /** Part numbers (from 1) the host already holds. */
  parts: number[]
  imgCid: string
  metaCid: string
  expiresAt: number | null
}

/** What the uploader reports as it goes. Bytes, not fractions, so a resume can be shown as such. */
export interface UploadProgress {
  stage: 'uploading' | 'verifying'
  /** Bytes the host holds, counting parts sent before a resume. */
  sent: number
  total: number
  /** Bytes the host already held when this run started; 0 for a fresh upload. */
  resumedFrom: number
  /** Set while a part is being retried after a dropped connection. */
  retrying: string | null
}

/** The CAR, as the uploader needs it: its size and any byte range of it. */
export interface UploadSource {
  imgCid: string
  metaCid: string
  size: number
  read(start: number, end: number): Promise<Uint8Array>
}

/** A session token. `fresh` asks for a new one, after the host refused the last as expired. */
export type TokenSource = (fresh: boolean) => Promise<string>

const PARALLEL_PARTS = 3
const MAX_TRIES = 6

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** One PUT of one part, reporting bytes sent as it goes. */
function putPart(
  url: string,
  token: string,
  body: Uint8Array,
  onSent: (bytes: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('authorization', `Bearer ${token}`)
    xhr.upload.onprogress = (event) => onSent(event.loaded)
    xhr.onerror = () => reject(new ArtHostError('the connection to the art host dropped', 0))
    xhr.ontimeout = xhr.onerror
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve()
      let reason = `the art host answered ${xhr.status}`
      try {
        const parsed = JSON.parse(xhr.responseText) as { error?: unknown }
        if (typeof parsed.error === 'string') reason = parsed.error
      } catch {
        // Not JSON.
      }
      reject(new ArtHostError(reason, xhr.status))
    }
    xhr.send(body as unknown as XMLHttpRequestBodyInit)
  })
}

/** Whether a failure is worth trying again: the network, or the host having a bad moment. */
const transient = (error: unknown) =>
  !(error instanceof ArtHostError) ||
  error.status === 0 ||
  error.status >= 500 ||
  error.status === 408

/**
 * Upload a CAR in parts, resuming wherever the host left off.
 *
 * The host is asked to start an upload for these roots and this size; if this wallet already
 * started one — before a dropped connection or a page reload — the host answers with it and the
 * parts it holds, and only the rest are sent. A part that fails on the network is retried with
 * backoff; a session that expires mid-upload is renewed through `token(true)`. Once every part is
 * there the host checks the whole CAR, block by block, before anything is served.
 *
 * Returns the draft, or throws; the parts already sent stay with the host, so calling this again
 * with the same files carries on.
 */
export async function uploadResumable(
  host: string,
  token: TokenSource,
  source: UploadSource,
  onProgress?: (progress: UploadProgress) => void,
  options: { retryDelayMs?: number } = {},
): Promise<{ draft: HostedDraft; duplicate: boolean }> {
  const delay = (attempt: number) =>
    pause(Math.min((options.retryDelayMs ?? 1000) * 2 ** (attempt - 1), 16_000))
  let current = await token(false)
  const authed = async <T>(run: (token: string) => Promise<T>): Promise<T> => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await run(current)
      } catch (error) {
        if (error instanceof ArtHostError && error.status === 401 && attempt === 1) {
          current = await token(true)
          continue
        }
        if (!transient(error) || attempt >= MAX_TRIES) throw error
        await delay(attempt)
      }
    }
  }
  const json = (method: string, body?: unknown) => (tok: string) =>
    ({
      method,
      headers: {
        authorization: `Bearer ${tok}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }) as RequestInit

  const started = await authed((tok) =>
    call<{ upload?: PartsUpload; draft?: HostedDraft; duplicate?: boolean }>(
      host,
      '/upload/parts',
      json('POST', { bytes: source.size, imgCid: source.imgCid, metaCid: source.metaCid })(tok),
    ),
  )
  if (started.draft !== undefined) return { draft: started.draft, duplicate: true }
  const upload = started.upload!
  const count = Math.max(1, Math.ceil(source.size / upload.partSize))
  const sizeOf = (n: number) => Math.min(upload.partSize, source.size - (n - 1) * upload.partSize)
  const held = new Set(upload.parts)
  const resumedFrom = [...held].reduce((total, n) => total + sizeOf(n), 0)
  let done = resumedFrom
  const inFlight = new Map<number, number>()
  let retrying: string | null = null
  const report = () =>
    onProgress?.({
      stage: 'uploading',
      sent: done + [...inFlight.values()].reduce((a, b) => a + b, 0),
      total: source.size,
      resumedFrom,
      retrying,
    })
  report()

  const queue = Array.from({ length: count }, (_, i) => i + 1).filter((n) => !held.has(n))
  const sendPart = async (n: number) => {
    const start = (n - 1) * upload.partSize
    const body = await source.read(start, start + sizeOf(n))
    for (let attempt = 1; ; attempt++) {
      try {
        inFlight.set(n, 0)
        await putPart(`${host}/upload/parts/${upload.id}/${n}`, current, body, (sent) => {
          inFlight.set(n, sent)
          report()
        })
        inFlight.delete(n)
        done += body.byteLength
        retrying = null
        report()
        return
      } catch (error) {
        inFlight.delete(n)
        if (error instanceof ArtHostError && error.status === 401) {
          current = await token(true)
          continue
        }
        if (!transient(error) || attempt >= MAX_TRIES) throw error
        retrying = `connection lost; retrying part ${n} of ${count}`
        report()
        await delay(attempt)
      }
    }
  }
  let failure: unknown = null
  await Promise.all(
    Array.from({ length: Math.min(PARALLEL_PARTS, queue.length) }, async () => {
      while (queue.length > 0 && failure === null) {
        const n = queue.shift()!
        try {
          await sendPart(n)
        } catch (error) {
          failure = error
        }
      }
    }),
  )
  if (failure !== null) throw failure

  onProgress?.({
    stage: 'verifying',
    sent: source.size,
    total: source.size,
    resumedFrom,
    retrying: null,
  })
  const finished = await authed((tok) =>
    call<{ draft: HostedDraft; duplicate: boolean }>(
      host,
      `/upload/parts/${upload.id}/complete`,
      json('POST')(tok),
    ),
  )
  return finished
}

/** The signed-in wallet's drafts, unfinished uploads included. */
export async function listDrafts(host: string, token: string): Promise<HostedDraft[]> {
  const { drafts } = await call<{ drafts: HostedDraft[] }>(host, '/upload/drafts', {
    headers: { authorization: `Bearer ${token}` },
  })
  return drafts
}

/** Delete one of the signed-in wallet's unlaunched drafts. */
export async function deleteDraft(host: string, token: string, id: string): Promise<void> {
  await call(host, `/upload/drafts/${id}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  })
}

/**
 * Upload a CAR in one request, reporting progress as a fraction from 0 to 1. Kept for uploads made
 * by hand against `PUT /upload/car`; the wizard uses {@link uploadResumable}.
 */
export function uploadCar(
  host: string,
  token: string,
  car: Blob,
  onProgress?: (fraction: number) => void,
): Promise<HostedDraft> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', `${host}/upload/car`)
    xhr.setRequestHeader('authorization', `Bearer ${token}`)
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total)
    }
    xhr.onerror = () => reject(new ArtHostError('the upload did not reach the art host', 0))
    xhr.onload = () => {
      let body: { draft?: HostedDraft; error?: string } = {}
      try {
        body = JSON.parse(xhr.responseText) as typeof body
      } catch {
        // Fall through with no body.
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.draft !== undefined) {
        resolve(body.draft)
      } else {
        reject(new ArtHostError(body.error ?? `the art host answered ${xhr.status}`, xhr.status))
      }
    }
    xhr.send(car)
  })
}

/**
 * Tell the host a deployed collection uses its hosted art, which stops the unlaunched-upload clock.
 *
 * The host reads the instance's on-chain base itself and checks the registry knows it, so this
 * needs no sign-in and anyone may call it; it is idempotent.
 */
export async function bindHostedArt(host: string, instance: `0x${string}`): Promise<void> {
  await call(host, '/upload/bind', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ instance }),
  })
}

/**
 * What the art host knows about one launched collection's hosted art. Read by anyone: it is a public
 * fact about a public collection. Informational only — there is no deadline in it, because hosting
 * has none. Dates are epoch milliseconds.
 */
export interface HostingStatus {
  instance: string
  state: HostingState
  imgCid: string
  /** The hosted metadata root the collection launched with. */
  metaCid: string
  /** The metadata root a migrated collection should point at, once the host has worked it out. */
  migrationCid: string | null
  /** The image file names under `imgCid`, which is all the regenerated metadata depends on. */
  pieces: string[]
  migrated: boolean
  boundAt: number
  graduatedAt: number | null
  migratedAt: number | null
}

/** The host's record for a collection, or null when it hosts nothing for it. */
export async function fetchHostingStatus(
  host: string,
  instance: `0x${string}`,
  fetcher: typeof fetch = fetch,
): Promise<HostingStatus | null> {
  const res = await fetcher(`${host}/hosting/${instance.toLowerCase()}`)
  if (res.status === 404) return null
  if (!res.ok) throw new ArtHostError(await reasonOf(res), res.status)
  return (await res.json()) as HostingStatus
}
