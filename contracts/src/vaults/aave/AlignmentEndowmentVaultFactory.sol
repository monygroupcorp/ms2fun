// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AlignmentEndowmentVault} from "./AlignmentEndowmentVault.sol";
import {IAlignmentRegistry} from "../../master/interfaces/IAlignmentRegistry.sol";
import {ICreateX, CREATEX} from "../../shared/CreateXConstants.sol";
import {Ownable} from "solady/auth/Ownable.sol";

/// @title AlignmentEndowmentVaultFactory
/// @notice Deploys AlignmentEndowmentVault clones via CREATE3 (EIP-1167 minimal proxy).
///         The factory becomes the owner of every vault it deploys, so community-payout
///         updates must go through setVaultCommunityPayout (onlyOwner) rather than
///         calling the vault directly.
contract AlignmentEndowmentVaultFactory is Ownable {
    address public immutable vaultImplementation;
    address public immutable weth;
    address public immutable stataToken;
    address public immutable protocolTreasury;
    address public immutable masterRegistry;
    IAlignmentRegistry public immutable alignmentRegistry;

    event VaultDeployed(address indexed vault, address indexed alignmentToken, uint256 indexed targetId);

    constructor(
        // slither-disable-next-line missing-zero-check
        address _weth,
        // slither-disable-next-line missing-zero-check
        address _stataToken,
        // slither-disable-next-line missing-zero-check
        address _protocolTreasury,
        // slither-disable-next-line missing-zero-check
        address _masterRegistry,
        IAlignmentRegistry _alignmentRegistry
    ) {
        _initializeOwner(msg.sender);
        weth = _weth;
        stataToken = _stataToken;
        protocolTreasury = _protocolTreasury;
        masterRegistry = _masterRegistry;
        alignmentRegistry = _alignmentRegistry;
        vaultImplementation = address(new AlignmentEndowmentVault());
    }

    /// @notice Update the community payout address on a vault deployed by this factory.
    ///         Only the factory owner can call this — the vault's owner is the factory.
    /// @param vault Address of the vault (must have been deployed by this factory)
    /// @param payout New community payout address
    function setVaultCommunityPayout(address vault, address payout) external onlyOwner {
        AlignmentEndowmentVault(payable(vault)).setCommunityPayout(payout);
    }

    /// @notice Deploy a new vault clone via CREATE3
    /// @param salt CREATE3 deployment salt for deterministic vanity address
    /// @param alignmentToken The token this vault aligns to
    /// @param alignmentTargetId The alignment target this vault is bound to
    /// @return vault Address of the deployed vault clone
    // slither-disable-next-line reentrancy-events
    function deployVault(bytes32 salt, address alignmentToken, uint256 alignmentTargetId)
        external
        returns (address vault)
    {
        bytes memory proxyCreationCode = abi.encodePacked(
            hex"3d602d80600a3d3981f3363d3d373d3d3d363d73",
            vaultImplementation,
            hex"5af43d82803e903d91602b57fd5bf3"
        );
        vault = ICreateX(CREATEX).deployCreate3(salt, proxyCreationCode);

        address payout = alignmentRegistry.getCommunityPayout(alignmentTargetId);

        AlignmentEndowmentVault(payable(vault)).initialize(
            address(this), weth, stataToken, protocolTreasury, masterRegistry, alignmentToken, payout
        );

        emit VaultDeployed(vault, alignmentToken, alignmentTargetId);
    }

    /// @notice Preview the deterministic address for a given salt
    function computeVaultAddress(bytes32 salt) external view returns (address) {
        bytes32 guardedSalt = keccak256(abi.encodePacked(uint256(uint160(address(this))), salt));
        return ICreateX(CREATEX).computeCreate3Address(guardedSalt, CREATEX);
    }
}
