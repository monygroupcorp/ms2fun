// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IExitTaxSink
/// @notice The accrual side of the ERC404 bonding exit tax: where a taxed sell sends the two legs it
///         must not pay inline, and where those legs are claimed from.
/// @dev Implemented by `ERC404ExitTaxSink`, called by `ERC404BondingInstance.sellBonding` through the
///      instance's sealed `modules[EXIT_TAX_SINK]` slot. Declared as an interface so the instance
///      carries the call signature and none of the accrual bytecode: the sink exists because the
///      instance has no EIP-170 budget left for it.
interface IExitTaxSink {
    /// @notice Take the CALLING instance's whole exit tax as `msg.value`, split it 1/19/80, pay the
    ///         protocol leg through to the instance's treasury and accrue the other two.
    /// @dev The accrual is keyed by `msg.sender`. The split lives on the sink rather than the
    ///      instance because the instance has no EIP-170 budget for it.
    /// @param seller The seller whose sell was taxed, for the accrual event.
    function stash(address seller) external payable;

    /// @notice Deliver one accrued leg of `instance` — the creator's when `creatorLeg` is true, the
    ///         alignment vault's otherwise. Permissionless.
    function claim(address instance, bool creatorLeg) external;

    /// @notice Both unclaimed legs of `instance`.
    function pending(address instance) external view returns (uint256 vaultCut, uint256 creatorCut);
}
