// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Ownable } from "solady/auth/Ownable.sol";

/// @title SafeOwnable
/// @notice Ownable base for contracts that must never become ownerless.
/// @dev The owner of a vault factory is the owner of every vault it deploys, and the only address
///      that can ever wire one: an ownerless factory can neither deploy a vault nor set the pool key
///      an unwired vault needs before it can LP, and no address can restore it. Renouncing is
///      therefore not a power the owner should hold.
///
///      Single-step `transferOwnership` is deliberately KEPT. Handing these contracts to the
///      governance Timelock is a single-step transfer by the deployer (`script/MigrateOwnership.s.sol`),
///      because Solady's two-step handover requires the incoming owner to broadcast the request leg
///      itself — which a Timelock cannot do without a governance proposal per contract. The UUPS
///      contracts pay that cost for the upgrade authority they carry; these do not carry it.
abstract contract SafeOwnable is Ownable {
    error RenounceDisabled();

    /// @dev Reverts — an ownerless factory can never wire or deploy another vault.
    function renounceOwnership() public payable override {
        revert RenounceDisabled();
    }
}
