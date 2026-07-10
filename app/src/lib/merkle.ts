/**
 * Client-side merkle-allowlist tooling for the launch wizard.
 *
 * A creator hosts their allowlist (thousands of `address,maxQty` entries) at a URL — IPFS, Arweave, or
 * any HTTPS host — and the wizard fetches it and computes the merkle ROOT here. Only the 32-byte root
 * ever goes on-chain; the entry list stays off-chain. At mint time the SAME construction regenerates
 * each caller's proof plus the `maxQty` it commits to (that half lands with the on-chain module).
 *
 * Leaf construction MUST stay byte-identical to the merged `MerkleGatingModule`
 * (`contracts/src/gating/MerkleGatingModule.sol`, `canMint`):
 *
 *     leaf = keccak256(bytes.concat(keccak256(abi.encode(address user, uint256 maxQty))))
 *
 * i.e. a 64-byte ABI preimage (`address` left-padded to 32 bytes ++ `uint256`), hashed, then
 * double-hashed — `bytes.concat` of a single `bytes32` is just those 32 bytes, so the outer hash is a
 * plain `keccak256` of the inner digest. viem's `encodeAbiParameters([{type:'address'},{type:'uint256'}])`
 * produces the same 64-byte static encoding as Solidity's `abi.encode(address,uint256)`, so the roots and
 * proofs this builder emits verify against the on-chain module. (Cross-checked against foundry `cast`
 * output in `merkle.test.ts` — see the hardcoded Solidity-produced leaf vectors there.)
 *
 * Internal nodes use COMMUTATIVE / sorted-pair keccak, matching Solady's `MerkleProofLib.verify`, so the
 * on-chain verifier and this builder agree on parent hashing.
 */
import { concat, encodeAbiParameters, getAddress, isAddress, keccak256, type Hex } from 'viem'

/** One allowlist entry: a checksummed address and the per-user mint cap committed into its leaf. */
export interface AllowlistEntry {
  address: `0x${string}`
  maxQty: bigint
}

export interface AllowlistParseResult {
  /** Unique, checksummed entries accepted from the source. */
  entries: AllowlistEntry[]
  /** Raw rows that were not a valid `address,maxQty` pair (for surfacing to the creator). */
  invalid: string[]
  /** Count of duplicate addresses collapsed (see parseAllowlist for the collapse-to-max policy). */
  duplicates: number
}

export interface MerkleResult {
  root: Hex
  count: number
}

/**
 * Double-hashed leaf, byte-identical to the on-chain module:
 * `keccak256(keccak256(abi.encode(address, uint256 maxQty)))`.
 *
 * `maxQty` is a `uint256`; callers pass a positive `bigint`. The address is ABI-encoded case-insensitively
 * (left-padded to 32 bytes), so a checksummed or lowercase input yields the same leaf.
 */
export function leafHash(address: `0x${string}`, maxQty: bigint): Hex {
  return keccak256(
    keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [address, maxQty])),
  )
}

/** Commutative (sorted-pair) parent hash — matches Solady MerkleProofLib. */
function hashPair(a: Hex, b: Hex): Hex {
  return a.toLowerCase() <= b.toLowerCase() ? keccak256(concat([a, b])) : keccak256(concat([b, a]))
}

/**
 * Parse a positive-integer `maxQty` from a JSON number/bigint/string. Returns `null` for anything that is
 * not a whole integer >= 1 — zero, negatives, decimals, `NaN`, non-numeric strings, or unsafe JSON
 * floats. `uint256` capacity is enforced (values above 2^256-1 are rejected).
 */
const MAX_UINT256 = (1n << 256n) - 1n
function parseQty(raw: unknown): bigint | null {
  let value: bigint
  if (typeof raw === 'bigint') {
    value = raw
  } else if (typeof raw === 'number') {
    if (!Number.isInteger(raw)) return null
    value = BigInt(raw)
  } else if (typeof raw === 'string') {
    const s = raw.trim()
    if (!/^\d+$/.test(s)) return null
    value = BigInt(s)
  } else {
    return null
  }
  if (value < 1n || value > MAX_UINT256) return null
  return value
}

/**
 * Pull `(address, maxQty)` entries out of whatever the hosted list is:
 *   - a JSON array of `{ address, maxQty }` objects (`maxQty` a number or numeric string),
 *   - a `{ entries: [ { address, maxQty }, ... ] }` wrapper,
 *   - plain text, one entry per line as `0xADDR,QTY` (comma OR whitespace separated).
 * Lenient on the container, STRICT on each entry.
 *
 * Policy decisions (this is Phase 2's input contract — the on-chain module only ever sees the resulting
 * root, so these choices are load-bearing and cannot be re-litigated on-chain):
 *   - `maxQty` is REQUIRED per entry. There is no default: a wrong default silently caps (or over-grants)
 *     every user in production, so a row without a parseable positive-integer qty is rejected to `invalid`
 *     rather than guessed.
 *   - `maxQty` of 0 or a non-integer is rejected (see parseQty). 0 would gate the user out; a fraction is
 *     not a `uint256`.
 *   - DUPLICATE ADDRESSES ARE COLLAPSED TO THE MAX qty, and each extra occurrence is counted in
 *     `duplicates`. The tree admits any address at most once, so a user can never prove two different
 *     caps; collapsing to the max makes the effective cap deterministic and order-independent (whichever
 *     order the rows arrive, the highest listed qty wins). This mirrors the on-chain module's own
 *     "most-generous tier wins" stance rather than silently dropping a creator's intended raise.
 */
export function parseAllowlist(raw: string | unknown): AllowlistParseResult {
  type Row = { address: string; qty: unknown }
  let rows: Row[] = []

  const fromJson = (data: unknown): Row[] | null => {
    const arr = Array.isArray(data)
      ? data
      : data && typeof data === 'object' && Array.isArray((data as { entries?: unknown }).entries)
        ? (data as { entries: unknown[] }).entries
        : null
    if (!arr) return null
    return arr.map((e) => {
      if (e && typeof e === 'object') {
        const o = e as { address?: unknown; maxQty?: unknown }
        return { address: typeof o.address === 'string' ? o.address : '', qty: o.maxQty }
      }
      return { address: '', qty: undefined }
    })
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    let parsedJson: Row[] | null = null
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        parsedJson = fromJson(JSON.parse(trimmed))
      } catch {
        parsedJson = null
      }
    }
    rows =
      parsedJson ??
      trimmed.split(/\r?\n/).map((line) => {
        const parts = line
          .trim()
          .split(/[\s,]+/)
          .filter(Boolean)
        return { address: parts[0] ?? '', qty: parts[1] }
      })
  } else {
    rows = fromJson(raw) ?? []
  }

  // First pass: validate rows into (checksummed address -> best qty).
  const byAddress = new Map<string, { address: `0x${string}`; maxQty: bigint }>()
  const invalid: string[] = []
  let duplicates = 0

  for (const row of rows) {
    const addr = row.address.trim()
    if (!addr && row.qty === undefined) continue // blank line
    const qty = parseQty(row.qty)
    if (!isAddress(addr, { strict: false }) || qty === null) {
      const rendered = row.qty === undefined ? addr : `${addr},${String(row.qty)}`
      invalid.push(rendered.trim())
      continue
    }
    const checksummed = getAddress(addr)
    const key = checksummed.toLowerCase()
    const existing = byAddress.get(key)
    if (existing) {
      duplicates++
      if (qty > existing.maxQty) existing.maxQty = qty // collapse to the max
      continue
    }
    byAddress.set(key, { address: checksummed, maxQty: qty })
  }

  return { entries: [...byAddress.values()], invalid, duplicates }
}

/**
 * Compute the merkle root of an allowlist. Deterministic: leaves are sorted before the tree is built, so
 * the same set of entries always yields the same root regardless of input order. An odd node at any layer
 * is paired with itself (standard). Empty input throws — a root over nothing is a footgun (it would gate
 * everyone out or, worse, look valid).
 */
export function buildMerkleRoot(entries: AllowlistEntry[]): MerkleResult {
  if (entries.length === 0) throw new Error('allowlist is empty')

  let layer = entries
    .map((e) => leafHash(e.address, e.maxQty))
    .sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1))
  const count = layer.length

  while (layer.length > 1) {
    const next: Hex[] = []
    for (let i = 0; i < layer.length; i += 2) {
      const a = layer[i]!
      const b = i + 1 < layer.length ? layer[i + 1]! : a
      next.push(hashPair(a, b))
    }
    layer = next
  }

  return { root: layer[0]!, count }
}

/**
 * Generate the merkle proof for `address` within `entries`, plus the `maxQty` it is proven at. Returns
 * `null` if the address is not in the tree. The returned `{ proof, maxQty }` is exactly what the mint
 * caller abi-encodes into the module's `data` argument
 * (`abi.encode(uint256 tierId, uint256 maxQty, bytes32[] proof)`); the module recomputes
 * `leaf(user, maxQty)` and checks `MerkleProofLib.verify(proof, root, leaf)`.
 *
 * The tree is rebuilt with the SAME sort + self-pairing as `buildMerkleRoot`, so the sibling path this
 * returns reconstructs the identical root.
 */
export function getProof(
  entries: AllowlistEntry[],
  address: `0x${string}`,
): { proof: Hex[]; maxQty: bigint } | null {
  if (entries.length === 0) return null
  if (!isAddress(address, { strict: false })) return null

  const target = getAddress(address).toLowerCase()
  const entry = entries.find((e) => e.address.toLowerCase() === target)
  if (!entry) return null

  const targetLeaf = leafHash(entry.address, entry.maxQty)
  let layer = entries
    .map((e) => leafHash(e.address, e.maxQty))
    .sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1))

  // Index of our leaf in the sorted layer. Leaves are unique (parseAllowlist dedupes addresses, and each
  // distinct (address, maxQty) yields a distinct hash), so findIndex is unambiguous.
  let index = layer.findIndex((h) => h === targetLeaf)
  if (index === -1) return null

  const proof: Hex[] = []
  while (layer.length > 1) {
    const isRight = index % 2 === 1
    const siblingIndex = isRight ? index - 1 : index + 1
    // Odd node at the end pairs with itself; its sibling in the proof is its own hash.
    const sibling = siblingIndex < layer.length ? layer[siblingIndex]! : layer[index]!
    proof.push(sibling)

    const next: Hex[] = []
    for (let i = 0; i < layer.length; i += 2) {
      const a = layer[i]!
      const b = i + 1 < layer.length ? layer[i + 1]! : a
      next.push(hashPair(a, b))
    }
    layer = next
    index = Math.floor(index / 2)
  }

  return { proof, maxQty: entry.maxQty }
}
