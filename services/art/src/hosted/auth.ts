/**
 * Who is uploading: Sign-In with Ethereum, then a short-lived session token.
 *
 * Caps are per wallet, so an upload has to be tied to one. The creator signs an EIP-4361 message
 * naming a nonce this service issued; the signature is checked, and the answer is a session token —
 * an HMAC over the address and an expiry — that the upload carries. No account, no cookie, nothing
 * stored per session: the token verifies itself and lapses on its own.
 *
 * SMART WALLETS. A contract wallet signs through ERC-1271 (or ERC-6492 before it is deployed), which
 * only the chain can check. An ordinary signature is recovered locally first, which costs nothing
 * and covers most creators; only when that does not match is the RPC asked, through viem's
 * `verifyHash`, which handles both standards.
 */
import { createPublicClient, hashMessage, http, isAddressEqual, recoverMessageAddress } from 'viem'
import { verifyHash } from 'viem/actions'
import { parseSiweMessage, validateSiweMessage } from 'viem/siwe'

/** How far a message's `issuedAt` may sit from our clock. */
const ISSUED_SKEW_MS = 10 * 60 * 1000

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

/** A token for `address`, valid until `expiresAt`. */
export async function issueSession(
  secret: string,
  address: string,
  expiresAt: number,
): Promise<string> {
  const payload = base64url(
    new TextEncoder().encode(JSON.stringify({ a: address.toLowerCase(), e: expiresAt })),
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret),
    new TextEncoder().encode(payload),
  )
  return `${payload}.${base64url(new Uint8Array(signature))}`
}

/** The wallet a token was issued to, or null if it is forged, malformed or expired. */
export async function readSession(
  secret: string,
  token: string,
  now: number,
): Promise<string | null> {
  const [payload, signature, extra] = token.split('.')
  if (!payload || !signature || extra !== undefined) return null
  let valid = false
  try {
    valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      fromBase64url(signature),
      new TextEncoder().encode(payload),
    )
  } catch {
    return null
  }
  if (!valid) return null
  try {
    const { a, e } = JSON.parse(new TextDecoder().decode(fromBase64url(payload))) as {
      a?: unknown
      e?: unknown
    }
    if (typeof a !== 'string' || typeof e !== 'number' || e <= now) return null
    return a
  } catch {
    return null
  }
}

/** The bearer token on a request, or null. */
export function bearerOf(request: Request): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')
  return match === null ? null : match[1]!
}

export interface SignInRules {
  domains: readonly string[]
  chainId: number | null
  rpcUrl: string | null
  now: number
  /** Spend the message's nonce. True only for a nonce this service issued and has not seen used. */
  consumeNonce: (nonce: string) => Promise<boolean>
}

export type SignInResult = { ok: true; address: string } | { ok: false; reason: string }

/** Check a signed EIP-4361 message against the rules above. */
export async function verifySignIn(
  message: string,
  signature: `0x${string}`,
  rules: SignInRules,
): Promise<SignInResult> {
  let parsed: ReturnType<typeof parseSiweMessage>
  try {
    parsed = parseSiweMessage(message)
  } catch {
    return { ok: false, reason: 'the sign-in message is malformed' }
  }
  const { address, domain, nonce, chainId, issuedAt } = parsed
  if (!address || !domain || !nonce)
    return { ok: false, reason: 'the sign-in message is incomplete' }
  if (!rules.domains.includes(domain.toLowerCase())) {
    return { ok: false, reason: 'uploads are not accepted from this site' }
  }
  if (rules.chainId !== null && chainId !== rules.chainId) {
    return { ok: false, reason: 'the sign-in message names a different chain' }
  }
  if (issuedAt === undefined || Math.abs(issuedAt.getTime() - rules.now) > ISSUED_SKEW_MS) {
    return { ok: false, reason: 'the sign-in message is stale; sign in again' }
  }
  // Domain, nonce and the time window (expiration, not-before) in one place, viem's.
  if (!validateSiweMessage({ message: parsed, domain, nonce, time: new Date(rules.now) })) {
    return { ok: false, reason: 'the sign-in message is not valid now' }
  }
  if (!(await rules.consumeNonce(nonce))) {
    return { ok: false, reason: 'the sign-in nonce is unknown or already used; sign in again' }
  }

  try {
    const recovered = await recoverMessageAddress({ message, signature })
    if (isAddressEqual(recovered, address)) return { ok: true, address }
  } catch {
    // Not a plain ECDSA signature — a smart wallet's, perhaps. The chain decides below.
  }
  if (rules.rpcUrl === null) return { ok: false, reason: 'the signature does not match the wallet' }
  try {
    const client = createPublicClient({ transport: http(rules.rpcUrl) })
    const valid = await verifyHash(client, { address, hash: hashMessage(message), signature })
    return valid
      ? { ok: true, address }
      : { ok: false, reason: 'the signature does not match the wallet' }
  } catch {
    return { ok: false, reason: 'the wallet signature could not be checked; try again' }
  }
}
