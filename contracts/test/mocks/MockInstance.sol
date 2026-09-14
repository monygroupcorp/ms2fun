// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IInstanceLifecycle, TYPE_ERC404 } from "../../src/interfaces/IInstanceLifecycle.sol";

/// @notice Minimal IFactoryInstance + IInstanceLifecycle mock for testing registry enforcement
contract MockInstance is IInstanceLifecycle {
    address public vault;
    address public protocolTreasury;
    address public globalMessageRegistryAddr;
    /// @dev IFactoryInstance.owner() — the creator a shared module reads back when a de-curated target
    ///      sends the community cut home (noesis-435).
    address public owner;

    constructor(address _vault) {
        vault = _vault;
        protocolTreasury = address(0xFEE);
        owner = address(0xC0FFEE);
    }

    function setOwner(address _owner) external {
        owner = _owner;
    }

    function getGlobalMessageRegistry() external view returns (address) {
        return globalMessageRegistryAddr;
    }

    function instanceType() external pure override returns (bytes32) {
        return TYPE_ERC404;
    }
}
