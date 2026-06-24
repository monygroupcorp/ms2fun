/**
 * Pure encoding helpers for ERC1155 gated/message mints — kept React-free so they can be unit
 * tested directly (mirrors the erc404/erc721 pattern of a pure module + colocated tests).
 *
 * GATING APPROACH
 * ---------------
 * The instance stores an immutable `gatingScope` (BOTH | FREE_MINT_ONLY | PAID_ONLY) and an
 * optional `gatingModule` address. A call site consults the module only when:
 *   - paid `mint`        → module set AND scope != FREE_MINT_ONLY
 *   - `claimFreeMint`    → module set AND scope != PAID_ONLY
 * (see contracts/docs/plans/2026-03-02-free-mints-gating-scope-design.md)
 *
 * When the module gates a call it receives a `gatingData` credential which it forwards to
 * `canMint(addr, amount, gatingData)`. The one shipped module is PasswordTierGating: the
 * credential is the keccak256 hash of the user's plaintext password (the same `passwordHash`
 * bytes32 that ERC404BondingInstance.buyBonding accepts). We therefore resolve a password tier
 * by hashing the plaintext client-side.
 *
 * Two encodings differ by call site because the ABI types differ:
 *   - `mint(... bytes32 gatingData ...)`  → the raw keccak256 hash (a bytes32)
 *   - `claimFreeMint(bytes gatingData)`   → that same hash, typed as `bytes`
 *
 * MERKLE SEAM: an allowlist (merkle-allowlist-gating) module would instead expect an
 * ABI-encoded merkle proof (`bytes32[]`) as gatingData. Resolving a proof needs the full leaf
 * set / a proof service, which is out of scope for this slice — see `resolveMerkleGatingData`
 * for the clearly-marked seam. Until that lands, a user with no password supplied falls back to
 * the zero credential so the call reaches the module and reverts visibly (normal tx-failed UX)
 * rather than fabricating a credential.
 */
import { encodeAbiParameters, keccak256, toHex, type Hex } from 'viem'

/** Mirrors `enum GatingScope` on the instance. */
export const GatingScope = {
  BOTH: 0,
  FREE_MINT_ONLY: 1,
  PAID_ONLY: 2,
} as const

export type GatingScopeValue = (typeof GatingScope)[keyof typeof GatingScope]

/** bytes32 zero — the credential for open (ungated) call sites. */
export const ZERO_BYTES32 =
  '0x0000000000000000000000000000000000000000000000000000000000000000' as const

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const

/** True when `module` is a real (non-zero) gating module address. */
export function hasGatingModule(module: `0x${string}` | undefined): boolean {
  return !!module && module.toLowerCase() !== ZERO_ADDRESS
}

/** Does a paid `mint` consult the gating module? Only when a module is set and scope isn't free-only. */
export function isPaidMintGated(
  module: `0x${string}` | undefined,
  scope: number | undefined,
): boolean {
  return hasGatingModule(module) && scope !== GatingScope.FREE_MINT_ONLY
}

/** Does `claimFreeMint` consult the gating module? Only when a module is set and scope isn't paid-only. */
export function isFreeMintGated(
  module: `0x${string}` | undefined,
  scope: number | undefined,
): boolean {
  return hasGatingModule(module) && scope !== GatingScope.PAID_ONLY
}

/**
 * Resolve a plaintext password into the `bytes32` credential the paid `mint` path expects.
 * Empty input → ZERO_BYTES32 (treated as "no credential supplied").
 */
export function passwordToBytes32(password: string): Hex {
  const trimmed = password.trim()
  if (trimmed === '') return ZERO_BYTES32
  return keccak256(toHex(trimmed))
}

/**
 * Resolve a plaintext password into the `bytes` credential the `claimFreeMint` path expects.
 * It is the same keccak256 hash, just typed as `bytes` rather than `bytes32`. Empty → '0x'.
 */
export function passwordToBytes(password: string): Hex {
  const trimmed = password.trim()
  if (trimmed === '') return '0x'
  return keccak256(toHex(trimmed))
}

/**
 * Encode an optional mint message into the `messageData` bytes the instance forwards to the
 * GlobalMessageRegistry. The on-chain shape (matching legacy ERC1155Adapter.mintWithMessage) is:
 *   abi.encode(uint8 messageType, uint256 refId, bytes32 actionRef, bytes32 metadata, string content)
 * with messageType/refId/actionRef/metadata all zero for a plain mint comment. An empty message
 * yields '0x' (no message attached) — the same default the ungated mint used before.
 */
export function encodeMintMessage(message: string): Hex {
  const trimmed = message.trim()
  if (trimmed === '') return '0x'
  return encodeAbiParameters(
    [
      { name: 'messageType', type: 'uint8' },
      { name: 'refId', type: 'uint256' },
      { name: 'actionRef', type: 'bytes32' },
      { name: 'metadata', type: 'bytes32' },
      { name: 'content', type: 'string' },
    ],
    [0, 0n, ZERO_BYTES32, ZERO_BYTES32, trimmed],
  )
}

/**
 * MERKLE SEAM — not yet implemented. An allowlist module expects an ABI-encoded merkle proof
 * (`bytes32[]`) for the connected wallet. Computing it requires the full leaf set or a proof
 * service, neither of which is wired in this slice. Returns the zero credential so the call
 * reaches the module and reverts visibly rather than fabricating a proof.
 */
export function resolveMerkleGatingData(): Hex {
  return ZERO_BYTES32
}
