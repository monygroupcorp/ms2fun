/**
 * Pure encoding helpers for ERC1155 gated/message mints — kept React-free so they can be unit
 * tested directly (mirrors the erc404/erc721 pattern of a pure module + colocated tests).
 *
 * GATING APPROACH (post-#25 merged ABI)
 * -------------------------------------
 * The instance stores an immutable `gatingScope` (BOTH | FREE_MINT_ONLY | PAID_ONLY) and an
 * optional `gatingModule` address. A call site consults the module only when:
 *   - paid `mint`        → module set AND scope != FREE_MINT_ONLY
 *   - `claimFreeMint`    → module set AND scope != PAID_ONLY
 * (see contracts/docs/plans/2026-03-02-free-mints-gating-scope-design.md)
 *
 * Both entry points now take `bytes gatingData` and forward it UNCHANGED to
 * `IGatingModule.canMint(user, editionId, amount, openTime, data)`. `openTime` is an authoritative
 * parameter supplied by the instance (`edition.openTime`) — it is NO LONGER wrapped into `data` (#25;
 * the old `mint` took a raw `bytes32` that the instance re-wrapped as `abi.encode(hash, openTime)`).
 * The one shipped module, PasswordTierGating, decodes `abi.decode(data, (bytes32 passwordHash))` where
 * passwordHash = keccak256(utf8(plaintext)) and bytes32(0) selects the open tier. So a SINGLE encoder
 * (`encodePasswordGatingData`) now serves both the paid and free password paths: `abi.encode(bytes32)`.
 *
 * MERKLE SEAM: an allowlist (MerkleGatingModule) would instead expect an ABI-encoded merkle proof as
 * `data`. Resolving a proof needs the full leaf set / a proof service, out of scope for this slice —
 * see `resolveMerkleGatingData` for the clearly-marked seam (noesis-029/030 own it). Until that lands,
 * a user with no password supplied falls back to the zero credential so the call reaches the module
 * and reverts visibly (normal tx-failed UX) rather than fabricating a credential.
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
 * Resolve a plaintext password into its keccak256 `bytes32` password hash — the value the
 * PasswordTierGating module keys tiers by. Empty input → ZERO_BYTES32 (the open-tier sentinel).
 * This is the INNER hash; `encodePasswordGatingData` wraps it into the `bytes` credential the
 * mint call sites pass.
 */
export function passwordToBytes32(password: string): Hex {
  const trimmed = password.trim()
  if (trimmed === '') return ZERO_BYTES32
  return keccak256(toHex(trimmed))
}

/**
 * Encode the `bytes gatingData` credential for the password-gated paid `mint` AND `claimFreeMint`
 * paths. Post-#25 both entry points forward this blob straight to PasswordTierGating, which decodes
 * `abi.decode(data, (bytes32 passwordHash))` (the edition's openTime now arrives as its own
 * `canMint` parameter, not inside `data`). So we ABI-encode the single bytes32 hash. An empty
 * password yields `abi.encode(bytes32(0))` → the module reads the open tier (0). Pass '0x' instead
 * when the call is ungated: the module isn't consulted and `abi.decode('0x', (bytes32))` would revert.
 */
export function encodePasswordGatingData(password: string): Hex {
  return encodeAbiParameters(
    [{ name: 'passwordHash', type: 'bytes32' }],
    [passwordToBytes32(password)],
  )
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
