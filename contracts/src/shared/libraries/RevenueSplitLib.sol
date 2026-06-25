// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title RevenueSplitLib
/// @notice Revenue splits: `split` = 1/19/80 (DN404 graduation); `splitMint` = 1/80/19 (mints).
library RevenueSplitLib {
    struct Split {
        uint256 protocolCut; // 1%
        uint256 vaultCut;    // vault share
        uint256 remainder;   // creator/LP share
    }

    /// @notice 1/19/80 split (DN404/ERC404 graduation — vault 19%, remainder 80% to LP).
    /// @dev Protocol = amount / 100 (floor), vault = amount * 19 / 100 (floor),
    ///      remainder = amount - protocol - vault (absorbs rounding dust).
    function split(uint256 amount) internal pure returns (Split memory s) {
        s.protocolCut = amount / 100;
        s.vaultCut = (amount * 19) / 100;
        s.remainder = amount - s.protocolCut - s.vaultCut;
    }

    /// @notice Mint settlement split (ERC1155/ERC721): 1% protocol / 80% vault / 19% creator.
    /// @dev ADR-0003: mints route the heavy share to the (endowment) vault — the inverse of `split`'s
    ///      vault/creator weights. Same `Split` shape: `vaultCut` = 80%, `remainder` = creator's 19%.
    function splitMint(uint256 amount) internal pure returns (Split memory s) {
        s.protocolCut = amount / 100;
        s.vaultCut = (amount * 80) / 100;
        s.remainder = amount - s.protocolCut - s.vaultCut;
    }
}
