/**
 * Gating credential resolution for the ERC404 bonding surface (W-B4). Pure — no React/wagmi — so the
 * password→bytes32 hashing and the free-mint `gatingData` ABI-encoding are unit-tested in isolation.
 *
 * The bonding contract's PASSWORD path:
 *  - `buyBonding`/`sellBonding` take a `passwordHash` (bytes32) directly; the instance internally wraps
 *    it as `abi.encode(passwordHash, bondingOpenTime)` before calling the gating module. So the UI only
 *    needs to derive `passwordHash = keccak256(utf8(password))` (matches legacy TierStatusPanel).
 *  - `claimFreeMint(bytes gatingData)` takes the FULL encoded blob; the module decodes
 *    `(bytes32 passwordHash, uint256 openTime)`. So free-mint must pass `encodeGatingData(...)`.
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
 * Encode the `gatingData` blob for `claimFreeMint` — `abi.encode(bytes32 passwordHash, uint256 openTime)`.
 * `bondingOpenTime` is the instance's open time (the module uses it for time-tier checks).
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
