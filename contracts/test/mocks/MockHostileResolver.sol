// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IMetadataResolver } from "../../src/metadata/IMetadataResolver.sol";

/// @title MockHostileResolver
/// @notice A deliberately misbehaving metadata resolver for the §4.5 invariant tests. It exists to prove
///         the instance's `_tokenURI` seam (defensive `try/catch` + `m.code.length` guard, ADR-0006/0007)
///         can never let a wired-in resolver brick a token transfer, and (for two of three modes) never
///         let it revert a metadata read. Three hostile modes:
///           - REVERT:   reverts with a reason string on every `resolve`.
///           - GAS_BOMB: spins an unbounded assembly loop until it runs out of gas (a true OOG revert in
///                       the child). The caller survives on the 1/64 gas EIP-150 retains and its `catch`
///                       degrades to base — the resilience §4.5 asserts.
///           - MALFORMED: returns raw, ABI-undecodable bytes (a string length far larger than the
///                        returndata) via assembly. The EVM call SUCCEEDS, but the caller's
///                        `try … returns (string)` return-value decode reverts, and that revert is NOT
///                        swallowed by a Solidity `catch`. This is the read-brick escape hatch §4.5
///                        documents (transfer still lands; the READ is a known gap, not fixed here).
/// @dev Implements IMetadataResolver (→ IComponentModule) so it can be approved under the RESOLVER tag
///      and wired as an instance's single resolver. Holds no state beyond its immutable mode.
contract MockHostileResolver is IMetadataResolver {
    enum Mode {
        REVERT,
        GAS_BOMB,
        MALFORMED
    }

    Mode public immutable mode;

    constructor(Mode _mode) {
        mode = _mode;
    }

    /// @inheritdoc IMetadataResolver
    function resolve(address, uint256, address) external view override returns (string memory) {
        if (mode == Mode.REVERT) {
            revert("hostile: revert");
        }
        if (mode == Mode.GAS_BOMB) {
            // Unbounded loop → consumes all forwarded gas → OutOfGas revert in the child. The caller's
            // try/catch survives on the 1/64 gas EIP-150 retains and degrades to base.
            assembly {
                for { } 1 { } { }
            }
        }
        // MALFORMED — an ABI head claiming a string length of 2**256-1, far past the returndata. The
        // caller's decode into `string` reverts; that revert escapes the `catch`.
        assembly {
            mstore(0x00, 0x20) // offset to the string
            mstore(0x20, not(0)) // length = 2**256 - 1 (undecodable)
            return(0x00, 0x40)
        }
    }

    function metadataURI() external pure override returns (string memory) {
        return "";
    }

    function setMetadataURI(string calldata) external override { }
}
