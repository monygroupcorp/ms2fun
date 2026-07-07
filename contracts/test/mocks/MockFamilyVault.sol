// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAlignmentVault} from "../../src/interfaces/IAlignmentVault.sol";
import {Currency} from "v4-core/types/Currency.sol";

/// @notice Minimal IAlignmentVault whose `vaultType()` is set at construction, so a test can drive
///         the family-aware settlement split down any branch (liquidity / yield / unknown). Accepts
///         and holds ETH so the vault cut is observable via `address(vault).balance`.
contract MockFamilyVault is IAlignmentVault {
    string private _vaultType;

    constructor(string memory vt) {
        _vaultType = vt;
    }

    function receiveContribution(Currency, uint256 amount, address) external payable override {
        require(msg.value >= amount, "insufficient ETH");
    }

    receive() external payable override {}

    function vaultType() external view override returns (string memory) { return _vaultType; }

    function claimFees() external pure override returns (uint256) { return 0; }
    function claimFeesAsDelegate(address[] calldata) external pure override returns (uint256) { return 0; }
    function delegateBenefactor(address) external pure override {}
    function calculateClaimableAmount(address) external pure override returns (uint256) { return 0; }
    function getBenefactorShares(address) external pure override returns (uint256) { return 0; }
    function getBenefactorContribution(address) external pure override returns (uint256) { return 0; }
    function getBenefactorDelegate(address b) external pure override returns (address) { return b; }
    function totalShares() external pure override returns (uint256) { return 0; }
    function accumulatedFees() external pure override returns (uint256) { return 0; }
    function description() external pure override returns (string memory) { return ""; }
    function supportsCapability(bytes32) external pure override returns (bool) { return false; }
    function currentPolicy() external pure override returns (bytes memory) { return ""; }
    function validateCompliance(address) external pure override returns (bool) { return true; }
}
