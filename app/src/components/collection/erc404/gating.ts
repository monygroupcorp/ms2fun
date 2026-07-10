/**
 * Gating credential resolution for the ERC404 bonding surface (W-B4). Pure — no React/wagmi — so the
 * password→bytes32 hashing and the free-mint `gatingData` ABI-encoding are unit-tested in isolation.
 *
 * The bonding contract's PASSWORD path (post-#25 merged gating ABI):
 *  - `buyBonding(… bytes gatingData …)` now takes the ABI-encoded credential; the instance forwards it
 *    UNCHANGED to `IGatingModule.canMint(user, 0, amount, bondingOpenTime, data)`. PasswordTierGating
 *    decodes `abi.decode(data, (bytes32 passwordHash))` — bondingOpenTime is an authoritative canMint
 *    parameter now, no longer wrapped into `data`. So the UI derives `passwordHash =
 *    keccak256(utf8(password))` (via `resolveBuyPasswordHash`) and wraps it with `encodeBuyGatingData`.
 *  - `sellBonding(… bytes32 passwordHash …)` STILL takes the raw bytes32 hash directly (unchanged by #25).
 *  - `claimFreeMint(bytes gatingData)` likewise forwards the blob to the same decoder; `encodeGatingData`
 *    still carries the hash in the first word (the trailing openTime word it appends is now ignored).
 *
 * MERKLE SEAM: a merkle-allowlist gating module would instead want
 * `abi.encode(bytes32[] proof)` (or similar) here. When that module ships, branch on `gatingScope` /
 * the resolved module type and build the proof bytes instead of the password tuple — see
 * `resolveBuyPasswordHash` / `encodeGatingData` call sites in the panels.
 */
import { type Hex, encodeAbiParameters, keccak256, stringToBytes, toHex } from 'viem'

/** bytes32 zero — the "open tier" sentinel (no password) the password module treats as tier 0. */
export const ZERO_BYTES32 =
  '0x0000000000000000000000000000000000000000000000000000000000000000' as const

/** Empty bytes — used as `messageData` for buy/sell when the user posts no comment. */
export const EMPTY_BYTES = '0x' as const

/**
 * Resolve a user-typed password into the bytes32 `passwordHash` that `buyBonding`/`sellBonding` expect.
 * Empty/whitespace-only input → the zero sentinel (open tier). Matches legacy
 * `keccak256(toUtf8Bytes(password))`.
 */
export function resolveBuyPasswordHash(password: string): Hex {
  const trimmed = password.trim()
  if (trimmed.length === 0) return ZERO_BYTES32
  return keccak256(stringToBytes(trimmed))
}

/**
 * Encode the `bytes gatingData` blob for the password-gated `buyBonding` paid path (post-#25). The
 * instance forwards it to `PasswordTierGating`, which decodes `abi.decode(data, (bytes32 passwordHash))`,
 * so we ABI-encode the single bytes32 hash. `resolveBuyPasswordHash('')` → bytes32(0) → open tier.
 * Pass `EMPTY_BYTES` ('0x') instead when the buy is ungated (the module isn't consulted).
 */
export function encodeBuyGatingData(passwordHash: Hex): Hex {
  return encodeAbiParameters([{ name: 'passwordHash', type: 'bytes32' }], [passwordHash])
}

/**
 * Encode the `gatingData` blob for `claimFreeMint` — `abi.encode(bytes32 passwordHash, uint256 openTime)`.
 * `bondingOpenTime` is the instance's open time. Post-#25 the module decodes only the leading bytes32
 * (openTime is now a `canMint` parameter); the trailing word is tolerated/ignored, so the free-mint
 * path keeps working unchanged.
 */
export function encodeGatingData(passwordHash: Hex, bondingOpenTime: bigint): Hex {
  return encodeAbiParameters(
    [
      { name: 'passwordHash', type: 'bytes32' },
      { name: 'openTime', type: 'uint256' },
    ],
    [passwordHash, bondingOpenTime],
  )
}

/**
 * Encode a trade comment as the `messageData` bytes the instance forwards to GlobalMessageRegistry:
 * `abi.encode(uint8 messageType, uint256 refId, bytes32 actionRef, bytes32 metadata, string content)`
 * with messageType=0 (POST) and zeroed refs. Empty content → `0x` (no post). Matches legacy.
 */
export function encodeMessageData(content: string): Hex {
  if (content.trim().length === 0) return EMPTY_BYTES
  return encodeAbiParameters(
    [
      { name: 'messageType', type: 'uint8' },
      { name: 'refId', type: 'uint256' },
      { name: 'actionRef', type: 'bytes32' },
      { name: 'metadata', type: 'bytes32' },
      { name: 'content', type: 'string' },
    ],
    [0, 0n, ZERO_BYTES32, ZERO_BYTES32, content],
  )
}

/** The ComponentRegistry tag under which CurveParamsComputer singletons are approved. */
export const CURVE_COMPUTER_TAG: Hex = toHex('curve_computer', { size: 32 })
