// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { CypherAlignmentVault } from "./CypherAlignmentVault.sol";
import { IVaultPriceValidator } from "../../interfaces/IVaultPriceValidator.sol";
import { ICreateX, CREATEX } from "../../shared/CreateXConstants.sol";

/// @title CypherAlignmentVaultFactory
/// @notice Deploys CypherAlignmentVault clones via CREATE3
contract CypherAlignmentVaultFactory {
    address public immutable vaultImplementation;
    /// @notice Oracle/TWAP validator wired into every deployed vault. The vault's harvest swap floor
    ///         is inert when this is address(0), so production must pass the shared validator.
    IVaultPriceValidator public immutable defaultPriceValidator;

    event VaultDeployed(address indexed vault, address indexed alignmentToken);

    // slither-disable-next-line missing-zero-check
    constructor(address _vaultImplementation, IVaultPriceValidator _defaultPriceValidator) {
        vaultImplementation = _vaultImplementation;
        defaultPriceValidator = _defaultPriceValidator;
    }

    // slither-disable-next-line reentrancy-events
    function createVault(
        bytes32 salt,
        address positionManager,
        address swapRouterAddr,
        address weth,
        address alignmentToken,
        address protocolTreasury,
        address liquidityDeployer
    ) external returns (CypherAlignmentVault vault) {
        bytes memory proxyCreationCode = abi.encodePacked(
            hex"3d602d80600a3d3981f3363d3d373d3d3d363d73", vaultImplementation, hex"5af43d82803e903d91602b57fd5bf3"
        );
        // Bind salt to msg.sender to prevent front-running the deterministic CREATE3 address.
        bytes32 senderBoundSalt = keccak256(abi.encodePacked(msg.sender, salt));
        vault = CypherAlignmentVault(payable(ICreateX(CREATEX).deployCreate3(senderBoundSalt, proxyCreationCode)));
        vault.initialize(
            positionManager,
            swapRouterAddr,
            weth,
            alignmentToken,
            protocolTreasury,
            liquidityDeployer,
            address(defaultPriceValidator)
        );
        emit VaultDeployed(address(vault), alignmentToken);
    }

    /// @notice Preview the deterministic address for a given salt
    function computeVaultAddress(address creator, bytes32 salt) external view returns (address) {
        bytes32 senderBoundSalt = keccak256(abi.encodePacked(creator, salt));
        bytes32 guardedSalt = keccak256(abi.encode(senderBoundSalt)); // CreateX RandomBytes guard path
        return ICreateX(CREATEX).computeCreate3Address(guardedSalt, CREATEX);
    }
}
