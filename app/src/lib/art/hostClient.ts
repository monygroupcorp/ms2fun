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
  imgCid: string
  metaCid: string
  bytes: number
  files: number
  expiresAt: number | null
}

/**
 * Upload a CAR, reporting progress as a fraction from 0 to 1.
 *
 * XMLHttpRequest rather than fetch because only it reports UPLOAD progress, and a creator watching
 * a large collection go up for a minute needs to see it moving.
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
