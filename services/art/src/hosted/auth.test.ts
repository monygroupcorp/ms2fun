/**
 * Sign-in is what ties an upload to a wallet, and the caps are per wallet. These sign real EIP-4361
 * messages with a real key and check that every field the service relies on is enforced.
 */
import { privateKeyToAccount } from 'viem/accounts'
import { createSiweMessage } from 'viem/siwe'
import { describe, expect, it } from 'vitest'

import { issueSession, readSession, verifySignIn, type SignInRules } from './auth'

// A well-known development key (anvil account 0). Never holds anything.
const account = privateKeyToAccount(
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
)
const NOW = Date.UTC(2026, 10, 10, 12, 0, 0)

function message(over: Partial<Parameters<typeof createSiweMessage>[0]> = {}) {
  return createSiweMessage({
    address: account.address,
    chainId: 1,
    domain: 'launch.example',
    nonce: 'abcdefgh12345678',
    uri: 'https://launch.example',
    version: '1',
    issuedAt: new Date(NOW),
    ...over,
  })
}

function rules(over: Partial<SignInRules> = {}): SignInRules {
  const used = new Set<string>()
  return {
    domains: ['launch.example'],
    chainId: 1,
    rpcUrl: null,
    now: NOW,
    consumeNonce: async (nonce) => (used.has(nonce) ? false : (used.add(nonce), true)),
    ...over,
  }
}

describe('sign-in', () => {
  it('accepts a correctly signed message and names the wallet', async () => {
    const text = message()
    const result = await verifySignIn(text, await account.signMessage({ message: text }), rules())
    expect(result).toEqual({ ok: true, address: account.address })
  })

  it('refuses a message signed by a different key', async () => {
    const text = message()
    const other = privateKeyToAccount(
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    )
    const result = await verifySignIn(text, await other.signMessage({ message: text }), rules())
    expect(result.ok).toBe(false)
  })

  it('refuses a message written for another site', async () => {
    const text = message({ domain: 'phish.example' })
    const result = await verifySignIn(text, await account.signMessage({ message: text }), rules())
    expect(result).toMatchObject({ ok: false, reason: expect.stringMatching(/this site/) })
  })

  it('refuses another chain, a stale message, and a reused nonce', async () => {
    const chain = message({ chainId: 5 })
    expect(
      (await verifySignIn(chain, await account.signMessage({ message: chain }), rules())).ok,
    ).toBe(false)

    const stale = message({ issuedAt: new Date(NOW - 60 * 60 * 1000) })
    expect(
      (await verifySignIn(stale, await account.signMessage({ message: stale }), rules())).ok,
    ).toBe(false)

    const shared = rules()
    const text = message()
    const signature = await account.signMessage({ message: text })
    expect((await verifySignIn(text, signature, shared)).ok).toBe(true)
    expect(await verifySignIn(text, signature, shared)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/nonce/),
    })
  })

  it('refuses an expired message', async () => {
    const text = message({ expirationTime: new Date(NOW - 1000) })
    const result = await verifySignIn(text, await account.signMessage({ message: text }), rules())
    expect(result.ok).toBe(false)
  })
})

describe('session tokens', () => {
  it('round-trip, and refuse tampering, the wrong secret and expiry', async () => {
    const token = await issueSession('secret', account.address, NOW + 1000)
    expect(await readSession('secret', token, NOW)).toBe(account.address.toLowerCase())
    expect(await readSession('other', token, NOW)).toBeNull()
    expect(await readSession('secret', token, NOW + 1000)).toBeNull()

    const [payload, signature] = token.split('.')
    const forged = btoa(JSON.stringify({ a: '0xdead', e: NOW + 1e9 }))
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
    expect(await readSession('secret', `${forged}.${signature}`, NOW)).toBeNull()
    expect(await readSession('secret', `${payload}.`, NOW)).toBeNull()
    expect(await readSession('secret', 'garbage', NOW)).toBeNull()
  })
})
