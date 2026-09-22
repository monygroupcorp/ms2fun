// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { UUPSUpgradeable } from "solady/utils/UUPSUpgradeable.sol";
import { SafeOwnable } from "./SafeOwnable.sol";

/// @title SafeOwnableUUPS
/// @notice Base for UUPS contracts that forces two-step ownership handover.
/// @dev Disables single-step transferOwnership on top of `SafeOwnable`'s no-renounce policy.
///      Use requestOwnershipHandover() + completeOwnershipHandover() instead.
abstract contract SafeOwnableUUPS is UUPSUpgradeable, SafeOwnable {
    error UseRequestOwnershipHandover();

    /// @dev Reverts — use the two-step handover flow instead. The no-renounce half of the policy
    ///      (`RenounceDisabled`) comes from `SafeOwnable`, which the vault factories share.
    function transferOwnership(address) public payable override {
        revert UseRequestOwnershipHandover();
    }

    /// @dev Only the owner can authorize upgrades.
    function _authorizeUpgrade(address) internal override onlyOwner { }
}
