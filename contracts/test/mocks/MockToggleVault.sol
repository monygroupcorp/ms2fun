// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IAlignmentVault } from "../../src/interfaces/IAlignmentVault.sol";
import { Currency } from "v4-core/types/Currency.sol";

/// @notice Mock vault whose receiveContribution reverts while `broken` is true and accepts (recording the
///         contribution + retaining the ETH) once `setBroken(false)` is called. Lets a single vault address
///         transition from reverting to healthy — exactly the scenario the ERC404 graduation
///         pendingVaultCut stash + flushPendingVaultCut retry must survive.
contract MockToggleVault is IAlignmentVault {
    error VaultBroken();

    bool public broken = true;
    mapping(address => uint256) public received;
    uint256 public totalReceived;

    function setBroken(bool b) external {
        broken = b;
    }

    function receiveContribution(Currency, uint256 amount, address benefactor) external payable override {
        if (broken) revert VaultBroken();
        received[benefactor] += amount;
        totalReceived += amount;
    }

    receive() external payable override {
        if (broken) revert VaultBroken();
    }

    function claimFees() external pure override returns (uint256) {
        return 0;
    }

    function claimFeesAsDelegate(address[] calldata) external pure override returns (uint256) {
        return 0;
    }

    function delegateBenefactor(address) external pure override { }

    function calculateClaimableAmount(address) external pure override returns (uint256) {
        return 0;
    }

    function getBenefactorShares(address) external pure override returns (uint256) {
        return 0;
    }

    function getBenefactorContribution(address b) external view override returns (uint256) {
        return received[b];
    }

    function getBenefactorDelegate(address b) external pure override returns (address) {
        return b;
    }

    function totalShares() external pure override returns (uint256) {
        return 0;
    }

    function accumulatedFees() external pure override returns (uint256) {
        return 0;
    }

    function vaultType() external pure override returns (string memory) {
        return "UniswapV4LP";
    }

    function description() external pure override returns (string memory) {
        return "";
    }

    function supportsCapability(bytes32) external pure override returns (bool) {
        return false;
    }

    function currentPolicy() external pure override returns (bytes memory) {
        return "";
    }

    function validateCompliance(address) external pure override returns (bool) {
        return true;
    }
}
