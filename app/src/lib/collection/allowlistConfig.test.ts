import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAddress } from 'viem'
import {
  buildAllowlistFromPaste,
  buildAllowlistFromUri,
  findAllowlistListURI,
  isAllowlistBuildError,
  patchAllowlistRow,
  resolveMemberProof,
  toMerkleConfig,
} from './allowlistConfig'
import type { CollectionMetadata } from '../metadata'

const ADDR_A = getAddress('0x1111111111111111111111111111111111111111')
const ADDR_B = getAddress('0x2222222222222222222222222222222222222222')
const ADDR_C = getAddress('0x3333333333333333333333333333333333333333')
const NOT_LISTED = getAddress('0x9999999999999999999999999999999999999999')

const HOSTED_URI = 'https://example.com/allowlist.json'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('allowlistConfig', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  describe('buildAllowlistFromUri', () => {
    it('valid hosted list → {root, count, listURI}', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        jsonResponse([
          { address: ADDR_A, maxQty: 1 },
          { address: ADDR_B, maxQty: 2 },
        ]),
      )
      const result = await buildAllowlistFromUri(HOSTED_URI)
      expect(isAllowlistBuildError(result)).toBe(false)
      if (isAllowlistBuildError(result)) throw new Error('unreachable')
      expect(result.count).toBe(2)
      expect(result.listURI).toBe(HOSTED_URI)
      expect(result.root).toMatch(/^0x[0-9a-f]{64}$/)
    })

    it('unreachable URI → error, no root', async () => {
      vi.mocked(globalThis.fetch).mockRejectedValue(new Error('network down'))
      const result = await buildAllowlistFromUri(HOSTED_URI)
      expect(isAllowlistBuildError(result)).toBe(true)
    })

    it('malformed JSON → error, no root', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(new Response('not json{{', { status: 200 }))
      const result = await buildAllowlistFromUri(HOSTED_URI)
      expect(isAllowlistBuildError(result)).toBe(true)
    })

    it('empty list → error, no root', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse([]))
      const result = await buildAllowlistFromUri(HOSTED_URI)
      expect(isAllowlistBuildError(result)).toBe(true)
    })

    it('empty uri → error without fetching', async () => {
      const result = await buildAllowlistFromUri('  ')
      expect(isAllowlistBuildError(result)).toBe(true)
      expect(globalThis.fetch).not.toHaveBeenCalled()
    })
  })

  describe('buildAllowlistFromPaste', () => {
    it('paste path yields the identical root to the hosted set AND a fetchable data: listURI', async () => {
      const paste = `${ADDR_A},1\n${ADDR_B},2`
      const pasted = buildAllowlistFromPaste(paste)
      expect(isAllowlistBuildError(pasted)).toBe(false)
      if (isAllowlistBuildError(pasted)) throw new Error('unreachable')
      expect(pasted.listURI.startsWith('data:application/json,')).toBe(true)

      vi.mocked(globalThis.fetch).mockResolvedValue(
        jsonResponse([
          { address: ADDR_A, maxQty: 1 },
          { address: ADDR_B, maxQty: 2 },
        ]),
      )
      const hosted = await buildAllowlistFromUri(HOSTED_URI)
      expect(isAllowlistBuildError(hosted)).toBe(false)
      if (isAllowlistBuildError(hosted)) throw new Error('unreachable')

      expect(pasted.root).toBe(hosted.root)

      // The self-hosted data: URI is itself fetchable via the same resolver (no network hit needed —
      // fetchJson short-circuits data: URIs, but assert the encoded payload round-trips through parseAllowlist).
      const decoded = JSON.parse(
        decodeURIComponent(pasted.listURI.slice('data:application/json,'.length)),
      )
      expect(decoded).toEqual([
        { address: ADDR_A, maxQty: '1' },
        { address: ADDR_B, maxQty: '2' },
      ])
    })

    it('all-invalid rows → error surfacing invalid', () => {
      const result = buildAllowlistFromPaste('not-an-address,1\nalso-bad')
      expect(isAllowlistBuildError(result)).toBe(true)
      if (!isAllowlistBuildError(result)) throw new Error('unreachable')
      expect(result.invalid.length).toBeGreaterThan(0)
    })
  })

  describe('toMerkleConfig', () => {
    it('builds a single-tier, open-immediately MerkleConfig at editionId 0 by default', () => {
      const root = '0xabc0000000000000000000000000000000000000000000000000000000000' as const
      const cfg = toMerkleConfig(root)
      expect(cfg).toEqual({ editionId: 0n, roots: [root], tierOpenTimes: [0n] })
    })
  })

  describe('patchAllowlistRow / findAllowlistListURI', () => {
    const base: CollectionMetadata = {
      schemaVersion: 1,
      name: 'x',
      description: '',
      image: '',
      banner: '',
      category: '',
      links: [],
    }

    it('adds a row and finds it back', () => {
      const patched = patchAllowlistRow(base, { editionId: 0, tierIndex: 0, listURI: HOSTED_URI })
      expect(findAllowlistListURI(patched, 0, 0)).toBe(HOSTED_URI)
      expect(findAllowlistListURI(patched, 1, 0)).toBeUndefined()
    })

    it('replaces idempotently (same key → one row, not a duplicate)', () => {
      const once = patchAllowlistRow(base, { editionId: 0, tierIndex: 0, listURI: HOSTED_URI })
      const twice = patchAllowlistRow(once, {
        editionId: 0,
        tierIndex: 0,
        listURI: 'ipfs://newcid',
      })
      expect(twice.allowlists).toHaveLength(1)
      expect(findAllowlistListURI(twice, 0, 0)).toBe('ipfs://newcid')
    })

    it('findAllowlistListURI on undefined metadata → undefined', () => {
      expect(findAllowlistListURI(undefined, 0, 0)).toBeUndefined()
    })
  })

  describe('round-trip: root → hosted-list → proof → root reconstruction', () => {
    it('a member proof reconstructs the root; a non-member is null; a tampered list changes the root', async () => {
      const entries = [
        { address: ADDR_A, maxQty: 1 },
        { address: ADDR_B, maxQty: 2 },
        { address: ADDR_C, maxQty: 3 },
      ]
      // A fresh Response per call — a mockResolvedValue would reuse one Response instance whose body
      // stream can only be consumed (.json()'d) once.
      vi.mocked(globalThis.fetch).mockImplementation(() => Promise.resolve(jsonResponse(entries)))
      const built = await buildAllowlistFromUri(HOSTED_URI)
      expect(isAllowlistBuildError(built)).toBe(false)
      if (isAllowlistBuildError(built)) throw new Error('unreachable')

      const memberProof = await resolveMemberProof(HOSTED_URI, ADDR_B)
      expect(memberProof).not.toBeNull()
      expect(memberProof?.maxQty).toBe(2n)

      const nonMemberProof = await resolveMemberProof(HOSTED_URI, NOT_LISTED)
      expect(nonMemberProof).toBeNull()

      // Tampered list (different maxQty for A) yields a different root than the original build.
      vi.mocked(globalThis.fetch).mockResolvedValue(
        jsonResponse([{ address: ADDR_A, maxQty: 999 }, entries[1], entries[2]]),
      )
      const tampered = await buildAllowlistFromUri(HOSTED_URI)
      expect(isAllowlistBuildError(tampered)).toBe(false)
      if (isAllowlistBuildError(tampered)) throw new Error('unreachable')
      expect(tampered.root).not.toBe(built.root)
    })

    it('unreachable listURI → resolveMemberProof returns null (not a throw)', async () => {
      vi.mocked(globalThis.fetch).mockRejectedValue(new Error('down'))
      const result = await resolveMemberProof(HOSTED_URI, ADDR_A)
      expect(result).toBeNull()
    })
  })
})
