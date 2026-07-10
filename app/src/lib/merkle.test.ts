import { concat, keccak256, type Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import { buildMerkleRoot, getProof, leafHash, parseAllowlist, type AllowlistEntry } from './merkle'

const A = '0x54EfD4549AE44bD03B2cCC1C72492CA9A3219C86' as const
const B = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as const
const C = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const
const D = '0x90F79bf6EB2c4f870365E785982E1f101E93b906' as const

const entry = (address: `0x${string}`, maxQty: bigint): AllowlistEntry => ({ address, maxQty })

/**
 * Independent re-implementation of Solady's `MerkleProofLib.verify` (commutative / sorted-pair keccak),
 * matching the on-chain module's proof check. Used to prove that a `getProof` result reconstructs the
 * root the module would compute — i.e. that the proof our tooling emits verifies on-chain.
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

describe('leafHash — byte-parity with the on-chain MerkleGatingModule', () => {
  // Cross-verification against the REAL contract, not against ourselves. These literals were produced by
  // the foundry toolchain (Solidity's own ABI encoder), independent of viem:
  //   inner = cast keccak $(cast abi-encode "f(address,uint256)" <addr> <qty>)
  //   leaf  = cast keccak $inner
  // which is exactly the module's `keccak256(bytes.concat(keccak256(abi.encode(user, maxQty))))`.
  // If viem's encodeAbiParameters ever diverges from Solidity's abi.encode for (address, uint256), these
  // fail — that is the whole point (a wrong leaf = every proof fails silently at mint time).
  it('matches the Solidity-produced vector for (A, 5)', () => {
    expect(leafHash(A, 5n)).toBe(
      '0xff192eb4101f6a9df7d2b566dfb8bacae1470163817330ca1b109ea71f54a663',
    )
  })

  it('matches the Solidity-produced vector for (B, 1)', () => {
    expect(leafHash(B, 1n)).toBe(
      '0x457aa17fe0228467c8ff03c94ef937caf43d83d6102043300dc6a2e9a13a7006',
    )
  })

  it('matches the Solidity-produced vector for (C, 100)', () => {
    expect(leafHash(C, 100n)).toBe(
      '0x6a9ce9822687cfc256f353882a96be5fe95f4de311b84f737ad8a5e184a0dd4f',
    )
  })

  it('is case-insensitive on the address (ABI-encoded, not checksum-sensitive)', () => {
    expect(leafHash(A.toLowerCase() as `0x${string}`, 5n)).toBe(leafHash(A, 5n))
  })

  it('binds maxQty — a different qty is a different leaf', () => {
    expect(leafHash(A, 5n)).not.toBe(leafHash(A, 6n))
  })
})

describe('parseAllowlist', () => {
  it('parses a JSON array of { address, maxQty } objects', () => {
    const r = parseAllowlist(
      JSON.stringify([
        { address: A, maxQty: 5 },
        { address: B, maxQty: 2 },
      ]),
    )
    expect(r.entries).toEqual([entry(A, 5n), entry(B, 2n)])
    expect(r.invalid).toEqual([])
  })

  it('accepts numeric-string maxQty', () => {
    const r = parseAllowlist(JSON.stringify([{ address: A, maxQty: '42' }]))
    expect(r.entries).toEqual([entry(A, 42n)])
  })

  it('parses an { entries: [...] } wrapper', () => {
    const r = parseAllowlist(JSON.stringify({ entries: [{ address: A, maxQty: 3 }] }))
    expect(r.entries).toEqual([entry(A, 3n)])
  })

  it('parses plain-text `address,qty` lines (comma or whitespace separated)', () => {
    const r = parseAllowlist(`${A},5\n${B} 2\n${C}\t9`)
    expect(r.entries).toEqual([entry(A, 5n), entry(B, 2n), entry(C, 9n)])
  })

  it('checksums lowercase input and collapses duplicates to the MAX qty', () => {
    const r = parseAllowlist(`${A.toLowerCase()},5\n${A},9`)
    expect(r.entries).toEqual([entry(A, 9n)])
    expect(r.duplicates).toBe(1)
  })

  it('collapse-to-max is order-independent', () => {
    const hi = parseAllowlist(`${A},9\n${A},5`)
    const lo = parseAllowlist(`${A},5\n${A},9`)
    expect(hi.entries).toEqual([entry(A, 9n)])
    expect(lo.entries).toEqual([entry(A, 9n)])
  })

  it('requires maxQty — a row without a qty is invalid, not defaulted', () => {
    const r = parseAllowlist(`${A}\n${B},4`)
    expect(r.entries).toEqual([entry(B, 4n)])
    expect(r.invalid).toEqual([A])
  })

  it('rejects qty 0, negatives, and non-integers', () => {
    const r = parseAllowlist(`${A},0\n${B},-1\n${C},1.5\n${D},x`)
    expect(r.entries).toEqual([])
    expect(r.invalid).toEqual([`${A},0`, `${B},-1`, `${C},1.5`, `${D},x`])
  })

  it('collects invalid addresses instead of throwing', () => {
    const r = parseAllowlist(`${A},5\nnot-an-address,5\n0x1234,5`)
    expect(r.entries).toEqual([entry(A, 5n)])
    expect(r.invalid).toEqual(['not-an-address,5', '0x1234,5'])
  })
})

describe('buildMerkleRoot', () => {
  const abc = [entry(A, 5n), entry(B, 2n), entry(C, 9n)]

  it('is a 32-byte hex root', () => {
    const { root, count } = buildMerkleRoot(abc)
    expect(root).toMatch(/^0x[0-9a-f]{64}$/)
    expect(count).toBe(3)
  })

  it('is order-independent (leaves are sorted)', () => {
    expect(buildMerkleRoot(abc).root).toBe(
      buildMerkleRoot([entry(C, 9n), entry(A, 5n), entry(B, 2n)]).root,
    )
  })

  it('is sensitive to membership', () => {
    expect(buildMerkleRoot([entry(A, 5n), entry(B, 2n)]).root).not.toBe(
      buildMerkleRoot([entry(A, 5n), entry(C, 9n)]).root,
    )
  })

  it('is sensitive to maxQty (leaf binds the cap)', () => {
    expect(buildMerkleRoot([entry(A, 5n)]).root).not.toBe(buildMerkleRoot([entry(A, 6n)]).root)
  })

  it('single-entry root equals that leaf', () => {
    expect(buildMerkleRoot([entry(A, 5n)]).root).toBe(leafHash(A, 5n))
  })

  it('throws on an empty allowlist', () => {
    expect(() => buildMerkleRoot([])).toThrow(/empty/)
  })
})

describe('getProof — proofs verify the way the on-chain module would', () => {
  const entries = [entry(A, 5n), entry(B, 2n), entry(C, 9n), entry(D, 7n)]
  const { root } = buildMerkleRoot(entries)

  it('produces a proof + maxQty that reconstructs the root for every member', () => {
    for (const e of entries) {
      const res = getProof(entries, e.address)
      expect(res).not.toBeNull()
      expect(res!.maxQty).toBe(e.maxQty)
      expect(verify(res!.proof, root, leafHash(e.address, res!.maxQty))).toBe(true)
    }
  })

  it('works for an odd-sized tree (self-paired node)', () => {
    const odd = [entry(A, 5n), entry(B, 2n), entry(C, 9n)]
    const { root: oddRoot } = buildMerkleRoot(odd)
    for (const e of odd) {
      const res = getProof(odd, e.address)!
      expect(verify(res.proof, oddRoot, leafHash(e.address, res.maxQty))).toBe(true)
    }
  })

  it('single-entry proof is empty and verifies against the leaf-root', () => {
    const one = [entry(A, 5n)]
    const res = getProof(one, A)!
    expect(res.proof).toEqual([])
    expect(res.maxQty).toBe(5n)
    expect(verify(res.proof, buildMerkleRoot(one).root, leafHash(A, 5n))).toBe(true)
  })

  it('returns null for an address not in the tree', () => {
    expect(getProof(entries, '0x000000000000000000000000000000000000dEaD')).toBeNull()
  })

  it('returns null for an empty tree', () => {
    expect(getProof([], A)).toBeNull()
  })

  it('is address-case-insensitive', () => {
    const res = getProof(entries, A.toLowerCase() as `0x${string}`)
    expect(res).not.toBeNull()
    expect(res!.maxQty).toBe(5n)
  })

  it('a TAMPERED proof does not verify (would revert InvalidProof on-chain)', () => {
    const res = getProof(entries, A)!
    const tampered = [...res.proof]
    // flip one byte of the first sibling
    tampered[0] = (tampered[0]!.slice(0, -1) + (tampered[0]!.endsWith('0') ? '1' : '0')) as Hex
    expect(verify(tampered, root, leafHash(A, res.maxQty))).toBe(false)
  })

  it('a WRONG maxQty does not verify (proof is bound to the proven cap)', () => {
    const res = getProof(entries, A)!
    // Same valid sibling path, but claim a larger cap: the recomputed leaf differs, so verify fails —
    // exactly what stops a user from proving a bigger allocation than they were granted.
    expect(verify(res.proof, root, leafHash(A, res.maxQty + 1n))).toBe(false)
  })
})
