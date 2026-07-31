// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IMetadataResolver } from "./IMetadataResolver.sol";

/// @title SafeResolverLib
/// @notice Shared defensive seam for calling a wired metadata resolver (ADR-0006/0007). Guarantees the
///         "tokenURI can never be bricked" promise for EVERY resolver-return class — including the one a
///         plain `try IMetadataResolver(m).resolve(...) returns (string) {} catch {}` does NOT cover: a
///         call that SUCCEEDS but returns ABI-undecodable bytes. Solidity routes only a *reverting* call
///         to `catch`; a return-data decode failure escapes the `catch` and reverts the read. This lib
///         replaces the naive try/catch with a low-level `staticcall` + a guarded, pre-validated
///         `abi.decode`, so a malformed success degrades to the caller's base EXACTLY like a revert or a
///         gas-bomb already does (both surface here as `ok == false`).
/// @dev Used by BOTH `ERC404BondingInstance._tokenURI` and `MetadataResolverRouter.resolve` (dedup +
///      keeps the EIP-170-tight instance small). `tryResolve` is `public` (a DEPLOYED library): the
///      guard+decode logic inlined into the instance overflows EIP-170 by ~1.46KB (measured, noesis-107),
///      so callers reach it via `delegatecall` to the linked library instead — the code lives once, off
///      the instance. It is `view` and touches no storage, so the delegatecall is safe under a `tokenURI`
///      staticcall. No explicit gas cap: a runaway (gas-bomb) resolver OOGs the child, the `staticcall`
///      returns
///      `false`, and the caller survives on the 1/64 gas EIP-150 retains — identical to the prior
///      try/catch resilience. A low-level `staticcall` to a code-less address returns `success == true`
///      with empty returndata, which `_isDecodableString` rejects → degrades to base; so the caller no
///      longer needs an explicit `code.length` guard to survive a self-destructed/revoked resolver.
library SafeResolverLib {
    /// @notice Call `resolver.resolve(inst, id, holder)` defensively.
    /// @return ok  True iff the call succeeded AND its return data is a well-framed ABI `string`.
    /// @return aug The decoded augmentation on success, else `""` — the caller falls back to base.
    function tryResolve(address resolver, address inst, uint256 id, address holder)
        public
        view
        returns (bool ok, string memory aug)
    {
        (bool success, bytes memory ret) =
            resolver.staticcall(abi.encodeCall(IMetadataResolver.resolve, (inst, id, holder)));
        // Guard the framing BEFORE decoding so `abi.decode` can never revert on malformed bytes.
        if (success && _isDecodableString(ret)) {
            aug = abi.decode(ret, (string));
            ok = true;
        }
        // else: ok == false, aug == "" (revert / gas-bomb / malformed / code-less all land here).
    }

    /// @dev Validate that `ret` is the ABI encoding of a single `string` return: a 32-byte offset word
    ///      equal to 0x20, a 32-byte length word `len`, and `len` payload bytes that fit within `ret`.
    ///      A 2**256-1 length (the classic malformed probe) fails the `len <= ret.length - 64` bound.
    function _isDecodableString(bytes memory ret) private pure returns (bool) {
        if (ret.length < 64) return false; // need at least the offset + length head
        uint256 offset;
        uint256 len;
        assembly {
            offset := mload(add(ret, 0x20)) // first word: offset to the string
            len := mload(add(ret, 0x40)) // second word: string byte-length
        }
        if (offset != 0x20) return false; // canonical single-string encoding only
        return len <= ret.length - 64; // payload must fit after the 64-byte head (no overrun)
    }
}
