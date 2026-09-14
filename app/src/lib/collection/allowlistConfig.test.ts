import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { concat, getAddress, keccak256, type Hex } from 'viem'
import {
  buildAllowlistFromPaste,
  buildAllowlistFromUri,
  findAllowlistListURI,
  isAllowlistBuildError,
  patchAllowlistRow,
  resolveMemberProof,
  toMerkleConfig,
} from './allowlistConfig'
import { leafHash, NO_QTY_SCALE } from '../merkle'
import type { CollectionMetadata } from '../metadata'

const ADDR_A = getAddress('0x1111111111111111111111111111111111111111')
const ADDR_B = getAddress('0x2222222222222222222222222222222222222222')
const ADDR_C = getAddress('0x3333333333333333333333333333333333333333')
const NOT_LISTED = getAddress('0x9999999999999999999999999999999999999999')

const HOSTED_URI = 'https://example.com/allowlist.json'

/** `unit()` on a shipped ERC404 bonding instance: 1e24 coin per whole NFT. */
const UNIT = 10n ** 24n

/**
 * Solady `MerkleProofLib.verify` (commutative / sorted-pair keccak), re-implemented here so a proof is
 * checked the way `MerkleGatingModule.canMint` checks it and not the way we produced it.
 */
function verify(proof: Hex[], root: Hex, leaf: Hex): boolean {
  let computed = leaf
  for (const sibling of proof) {
    computed =
      computed.toLowerCase() <= sibling.toLowerCase()
        ? keccak256(concat([computed, sibling]))
        : keccak256(concat([sibling, computed]))
  }
  return computed.toLowerCase() === root.toLowerCase()
}

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
      const result = await buildAllowlistFromUri(HOSTED_URI, NO_QTY_SCALE)
      expect(isAllowlistBuildError(result)).toBe(false)
      if (isAllowlistBuildError(result)) throw new Error('unreachable')
      expect(result.count).toBe(2)
      expect(result.listURI).toBe(HOSTED_URI)
      expect(result.root).toMatch(/^0x[0-9a-f]{64}$/)
    })

    it('unreachable URI → error, no root', async () => {
      vi.mocked(globalThis.fetch).mockRejectedValue(new Error('network down'))
      const result = await buildAllowlistFromUri(HOSTED_URI, NO_QTY_SCALE)
      expect(isAllowlistBuildError(result)).toBe(true)
    })

    it('malformed JSON → error, no root', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(new Response('not json{{', { status: 200 }))
      const result = await buildAllowlistFromUri(HOSTED_URI, NO_QTY_SCALE)
      expect(isAllowlistBuildError(result)).toBe(true)
    })

    it('empty list → error, no root', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse([]))
      const result = await buildAllowlistFromUri(HOSTED_URI, NO_QTY_SCALE)
      expect(isAllowlistBuildError(result)).toBe(true)
    })

    it('empty uri → error without fetching', async () => {
      const result = await buildAllowlistFromUri('  ', NO_QTY_SCALE)
      expect(isAllowlistBuildError(result)).toBe(true)
      expect(globalThis.fetch).not.toHaveBeenCalled()
    })
  })

  describe('buildAllowlistFromPaste', () => {
    it('paste path yields the identical root to the hosted set AND a fetchable data: listURI', async () => {
      const paste = `${ADDR_A},1\n${ADDR_B},2`
      const pasted = buildAllowlistFromPaste(paste, NO_QTY_SCALE)
      expect(isAllowlistBuildError(pasted)).toBe(false)
      if (isAllowlistBuildError(pasted)) throw new Error('unreachable')
      expect(pasted.listURI.startsWith('data:application/json,')).toBe(true)

      vi.mocked(globalThis.fetch).mockResolvedValue(
        jsonResponse([
          { address: ADDR_A, maxQty: 1 },
          { address: ADDR_B, maxQty: 2 },
        ]),
      )
      const hosted = await buildAllowlistFromUri(HOSTED_URI, NO_QTY_SCALE)
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
      const result = buildAllowlistFromPaste('not-an-address,1\nalso-bad', NO_QTY_SCALE)
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
      const built = await buildAllowlistFromUri(HOSTED_URI, NO_QTY_SCALE)
      expect(isAllowlistBuildError(built)).toBe(false)
      if (isAllowlistBuildError(built)) throw new Error('unreachable')

      const memberProof = await resolveMemberProof(HOSTED_URI, ADDR_B, NO_QTY_SCALE)
      expect(memberProof).not.toBeNull()
      expect(memberProof?.maxQty).toBe(2n)

      const nonMemberProof = await resolveMemberProof(HOSTED_URI, NOT_LISTED, NO_QTY_SCALE)
      expect(nonMemberProof).toBeNull()

      // Tampered list (different maxQty for A) yields a different root than the original build.
      vi.mocked(globalThis.fetch).mockResolvedValue(
        jsonResponse([{ address: ADDR_A, maxQty: 999 }, entries[1], entries[2]]),
      )
      const tampered = await buildAllowlistFromUri(HOSTED_URI, NO_QTY_SCALE)
      expect(isAllowlistBuildError(tampered)).toBe(false)
      if (isAllowlistBuildError(tampered)) throw new Error('unreachable')
      expect(tampered.root).not.toBe(built.root)
    })

    it('unreachable listURI → resolveMemberProof returns null (not a throw)', async () => {
      vi.mocked(globalThis.fetch).mockRejectedValue(new Error('down'))
      const result = await resolveMemberProof(HOSTED_URI, ADDR_A, NO_QTY_SCALE)
      expect(result).toBeNull()
    })
  })

  // ── Denomination (noesis-266) ───────────────────────────────────────────────
  //
  // `MerkleGatingModule.canMint` checks `claimed + amount > maxQty` against whatever the calling instance
  // forwards. ERC-1155 forwards an NFT count; ERC-404 forwards COIN at wei scale — `buyBonding` forwards
  // the purchase, `claimFreeMint` forwards `unit`. A creator types NFTs on both. Before this suite the
  // shipped fixtures all committed a cap of 1e30, which is above every scale and therefore could not tell
  // an NFT-denominated cap from a coin-denominated one: the denomination was asserted nowhere in the tree.
  // These tests state it. Remove the scaling and they go red.
  describe('denomination: what the leaf commits vs. what the creator typed', () => {
    const hostedFiveNfts = (): void => {
      vi.mocked(globalThis.fetch).mockImplementation(() =>
        Promise.resolve(
          jsonResponse([
            { address: ADDR_A, maxQty: 5 },
            { address: ADDR_B, maxQty: 1 },
          ]),
        ),
      )
    }

    it('ERC-404: a creator typing 5 gets a leaf committing 5 * unit, not 5', async () => {
      hostedFiveNfts()
      const built = await buildAllowlistFromUri(HOSTED_URI, UNIT)
      if (isAllowlistBuildError(built)) throw new Error('unreachable')

      // The hosted list — and the entries we hand back to the panel — stay in NFTs.
      expect(built.entries.find((e) => e.address === ADDR_A)?.maxQty).toBe(5n)
      // The leaf does not. 5 is what would brick the wallet; 5 * unit is what lets it buy 5 NFTs' worth.
      expect(built.leafEntries.find((e) => e.address === ADDR_A)?.maxQty).toBe(5n * UNIT)
      expect(built.qtyScale).toBe(UNIT)

      const proven = await resolveMemberProof(HOSTED_URI, ADDR_A, UNIT)
      expect(proven).not.toBeNull()
      expect(proven?.maxQty).toBe(5n * UNIT)
      expect(proven?.maxQtyNfts).toBe(5n)
      // Verified the way the module verifies it: the coin-scaled leaf is the one in the tree.
      expect(verify(proven!.proof, built.root, leafHash(ADDR_A, 5n * UNIT))).toBe(true)
      expect(verify(proven!.proof, built.root, leafHash(ADDR_A, 5n))).toBe(false)
    })

    it('ERC-1155: the same list is byte-identically unscaled — the leaf commits the raw NFT count', async () => {
      hostedFiveNfts()
      const built = await buildAllowlistFromUri(HOSTED_URI, NO_QTY_SCALE)
      if (isAllowlistBuildError(built)) throw new Error('unreachable')

      expect(built.leafEntries).toEqual(built.entries)
      expect(built.qtyScale).toBe(NO_QTY_SCALE)

      const proven = await resolveMemberProof(HOSTED_URI, ADDR_A, NO_QTY_SCALE)
      expect(proven?.maxQty).toBe(5n)
      expect(proven?.maxQtyNfts).toBe(5n)
      expect(verify(proven!.proof, built.root, leafHash(ADDR_A, 5n))).toBe(true)
    })

    it('the two families root the same list differently — the scale is what separates them', async () => {
      hostedFiveNfts()
      const asErc404 = await buildAllowlistFromUri(HOSTED_URI, UNIT)
      const asErc1155 = await buildAllowlistFromUri(HOSTED_URI, NO_QTY_SCALE)
      if (isAllowlistBuildError(asErc404) || isAllowlistBuildError(asErc1155)) {
        throw new Error('unreachable')
      }
      expect(asErc404.root).not.toBe(asErc1155.root)
    })

    it('build and resolve must be handed the SAME scale — a mismatched proof does not verify', async () => {
      hostedFiveNfts()
      const built = await buildAllowlistFromUri(HOSTED_URI, UNIT)
      if (isAllowlistBuildError(built)) throw new Error('unreachable')

      // The failure this pins is the dangerous one: resolving unscaled against a scaled root returns a
      // perfectly well-formed proof that the module then rejects, and the symptom is indistinguishable
      // from the bug the scaling exists to fix.
      const mismatched = await resolveMemberProof(HOSTED_URI, ADDR_A, NO_QTY_SCALE)
      expect(mismatched).not.toBeNull()
      expect(verify(mismatched!.proof, built.root, leafHash(ADDR_A, mismatched!.maxQty))).toBe(
        false,
      )
    })

    it('changing the scale moves both paths together, at every cap', async () => {
      for (const scale of [NO_QTY_SCALE, 10n ** 18n, UNIT]) {
        for (const cap of [1n, 5n, 1000n]) {
          vi.mocked(globalThis.fetch).mockImplementation(() =>
            Promise.resolve(
              jsonResponse([
                { address: ADDR_A, maxQty: cap.toString() },
                { address: ADDR_B, maxQty: 1 },
                { address: ADDR_C, maxQty: 7 },
              ]),
            ),
          )
          const built = await buildAllowlistFromUri(HOSTED_URI, scale)
          if (isAllowlistBuildError(built)) throw new Error('unreachable')
          const proven = await resolveMemberProof(HOSTED_URI, ADDR_A, scale)
          expect(proven?.maxQty).toBe(cap * scale)
          expect(proven?.maxQtyNfts).toBe(cap)
          expect(verify(proven!.proof, built.root, leafHash(ADDR_A, cap * scale))).toBe(true)
        }
      }
    })

    it('the paste path self-hosts the list in NFTs, so the resolve path scales it exactly once', () => {
      const pasted = buildAllowlistFromPaste(`${ADDR_A},5`, UNIT)
      if (isAllowlistBuildError(pasted)) throw new Error('unreachable')

      // If the data: URI held the already-scaled number, resolveMemberProof would scale it a second time
      // and every proof would miss the tree by a factor of unit.
      const decoded = JSON.parse(
        decodeURIComponent(pasted.listURI.slice('data:application/json,'.length)),
      )
      expect(decoded).toEqual([{ address: ADDR_A, maxQty: '5' }])
      expect(pasted.root).toBe(leafHash(ADDR_A, 5n * UNIT))
    })
  })
})
