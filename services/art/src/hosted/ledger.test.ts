/**
 * The ledger's caps are what bound the bill, so each one is driven to its edge on a real SQLite —
 * the engine a Durable Object runs — rather than inferred from the SQL.
 */
import { beforeEach, describe, expect, it } from 'vitest'

import { Ledger, type LedgerLimits } from './ledger'
import { sqliteSql } from './testing'

const MiB = 1024 * 1024
const LIMITS: LedgerLimits = {
  draftBytesPerWallet: 200 * MiB,
  draftsPerWallet: 3,
  draftTtlMs: 7 * 24 * 3600_000,
  reserveTtlMs: 30 * 60_000,
  totalBytes: 1024 * MiB,
}
const ALICE = '0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa'
const BOB = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const T0 = 1_800_000_000_000

let ledger: Ledger

beforeEach(() => {
  ledger = new Ledger(sqliteSql(), LIMITS)
})

function openDraft(wallet: string, bytes: number, n: number, now = T0) {
  const reserved = ledger.reserve(wallet, bytes, now)
  if (!reserved.ok) throw new Error(reserved.reason)
  const committed = ledger.commit(
    reserved.id,
    { imgCid: `img${n}`, metaCid: `meta${n}`, files: 2 },
    now,
  )
  if (committed.status !== 'open') throw new Error(committed.status)
  return committed.draft
}

describe('nonces', () => {
  it('are good exactly once, and only before they expire', () => {
    const { nonce, expiresAt } = ledger.issueNonce(T0)
    expect(nonce).toMatch(/^[a-z0-9]{20}$/)
    expect(ledger.consumeNonce(nonce, T0 + 1)).toBe(true)
    expect(ledger.consumeNonce(nonce, T0 + 2)).toBe(false)

    const late = ledger.issueNonce(T0)
    expect(ledger.consumeNonce(late.nonce, expiresAt + 1)).toBe(false)
    expect(ledger.consumeNonce('never-issued', T0)).toBe(false)
  })
})

describe('per-wallet caps on unlaunched art', () => {
  it('allows three open drafts and refuses a fourth', () => {
    openDraft(ALICE, MiB, 1)
    openDraft(ALICE, MiB, 2)
    openDraft(ALICE, MiB, 3)
    const fourth = ledger.reserve(ALICE, MiB, T0)
    expect(fourth).toMatchObject({ ok: false, status: 409 })
    // Another wallet is counted apart.
    expect(ledger.reserve(BOB, MiB, T0).ok).toBe(true)
  })

  it('refuses bytes past 200 MiB per wallet, counting uploads still in flight', () => {
    expect(ledger.reserve(ALICE, 150 * MiB, T0).ok).toBe(true)
    expect(ledger.reserve(ALICE, 51 * MiB, T0)).toMatchObject({ ok: false, status: 413 })
    expect(ledger.reserve(ALICE, 50 * MiB, T0).ok).toBe(true)
  })

  it('counts a wallet the same whatever case its address arrives in', () => {
    openDraft(ALICE, MiB, 1)
    expect(ledger.drafts(ALICE.toLowerCase())).toHaveLength(1)
  })

  it('stops counting a draft once a collection is bound to it', () => {
    openDraft(ALICE, 100 * MiB, 1)
    openDraft(ALICE, 100 * MiB, 2)
    expect(ledger.reserve(ALICE, MiB, T0).ok).toBe(false)
    expect(ledger.bind('meta1', '0x1111111111111111111111111111111111111111', T0)?.state).toBe(
      'bound',
    )
    expect(ledger.reserve(ALICE, MiB, T0).ok).toBe(true)
  })
})

describe('the global ceiling', () => {
  it('refuses any upload that would take the deployment past it, bound art included', () => {
    openDraft(ALICE, 200 * MiB, 1)
    ledger.bind('meta1', '0x1111111111111111111111111111111111111111', T0)
    for (const n of [2, 3, 4]) openDraft(`0x${String(n).repeat(40)}`, 200 * MiB, n)
    expect(ledger.totalBytes()).toBe(800 * MiB)
    expect(ledger.reserve(BOB, 200 * MiB, T0).ok).toBe(true) // 1000 of 1024 MiB
    const carol = `0x${'c'.repeat(40)}`
    expect(ledger.reserve(carol, 25 * MiB, T0)).toMatchObject({ ok: false, status: 503 })
    expect(ledger.reserve(carol, 24 * MiB, T0).ok).toBe(true)
  })
})

describe('commit', () => {
  it('returns the existing draft for a metadata root already hosted', () => {
    const first = openDraft(ALICE, MiB, 1)
    const again = ledger.reserve(BOB, MiB, T0)
    if (!again.ok) throw new Error()
    const result = ledger.commit(again.id, { imgCid: 'img1', metaCid: 'meta1', files: 2 }, T0)
    expect(result).toMatchObject({ status: 'duplicate', draft: { id: first.id } })
    // The duplicate's reservation is gone, so it holds none of Bob's quota.
    expect(ledger.drafts(BOB)).toHaveLength(0)
  })

  it('refuses the same images under different metadata', () => {
    openDraft(ALICE, MiB, 1)
    const again = ledger.reserve(ALICE, MiB, T0)
    if (!again.ok) throw new Error()
    expect(ledger.commit(again.id, { imgCid: 'img1', metaCid: 'other', files: 2 }, T0)).toEqual({
      status: 'conflict',
    })
  })

  it('reports a reservation that lapsed before the upload finished', () => {
    const reserved = ledger.reserve(ALICE, MiB, T0)
    if (!reserved.ok) throw new Error()
    ledger.sweep(T0 + LIMITS.reserveTtlMs + 1)
    expect(ledger.commit(reserved.id, { imgCid: 'a', metaCid: 'b', files: 1 }, T0)).toEqual({
      status: 'missing',
    })
  })
})

describe('expiry', () => {
  it('deletes an unbound draft after seven days and names what storage should drop', () => {
    const draft = openDraft(ALICE, MiB, 1)
    expect(ledger.sweep(T0 + LIMITS.draftTtlMs - 1)).toEqual([])
    expect(ledger.nextExpiry()).toBe(T0 + LIMITS.draftTtlMs)
    expect(ledger.sweep(T0 + LIMITS.draftTtlMs)).toEqual([
      { draftId: draft.id, cids: ['img1', 'meta1'] },
    ])
    expect(ledger.drafts(ALICE)).toEqual([])
  })

  it('never expires a bound draft', () => {
    openDraft(ALICE, MiB, 1)
    ledger.bind('meta1', '0x1111111111111111111111111111111111111111', T0)
    expect(ledger.sweep(T0 + 10 * LIMITS.draftTtlMs)).toEqual([])
    expect(ledger.drafts(ALICE)[0]).toMatchObject({ state: 'bound', expiresAt: null })
  })
})

describe('bind and remove', () => {
  it('binds idempotently and refuses a metadata root nobody uploaded', () => {
    openDraft(ALICE, MiB, 1)
    const instance = '0x1111111111111111111111111111111111111111'
    expect(ledger.bind('meta1', instance, T0)).toMatchObject({ state: 'bound', instance })
    expect(ledger.bind('meta1', instance, T0 + 5)).toMatchObject({ state: 'bound' })
    expect(ledger.bind('nobody', instance, T0)).toBeNull()
  })

  it('lets a wallet delete its own unbound draft and nobody else’s', () => {
    const draft = openDraft(ALICE, MiB, 1)
    expect(ledger.remove(BOB, draft.id)).toBeNull()
    expect(ledger.remove(ALICE, draft.id)).toEqual({ draftId: draft.id, cids: ['img1', 'meta1'] })
  })

  it('does not let the uploader delete art a launched collection uses', () => {
    const draft = openDraft(ALICE, MiB, 1)
    ledger.bind('meta1', '0x1111111111111111111111111111111111111111', T0)
    expect(ledger.remove(ALICE, draft.id)).toBeNull()
  })
})
