// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IZAMM, ZAMMAlignmentVault} from "./ZAMMAlignmentVault.sol";
import {IVaultPriceValidator} from "../../interfaces/IVaultPriceValidator.sol";
import {ICreateX, CREATEX} from "../../shared/CreateXConstants.sol";

/// @title ZAMMAlignmentVaultFactory
/// @notice Deploys ZAMMAlignmentVault clones via CREATE3. No peripherals — just zamm + zRouter singletons.
contract ZAMMAlignmentVaultFactory {
    address public immutable vaultImplementation;
    address public immutable zamm;
    address public immutable zRouter;
    address public immutable protocolTreasury;
    /// @notice Oracle/TWAP validator wired into every deployed vault (F5). The vault's swap floor is
    ///         inert when this is address(0), so production must pass the shared validator.
    IVaultPriceValidator public immutable defaultPriceValidator;

    event VaultDeployed(address indexed vault, address indexed alignmentToken);

    constructor(
        address _zamm,
        address _zRouter,
        address _protocolTreasury,
        IVaultPriceValidator _defaultPriceValidator
    ) {
        zamm = _zamm;
        zRouter = _zRouter;
        protocolTreasury = _protocolTreasury;
        defaultPriceValidator = _defaultPriceValidator;
        vaultImplementation = address(new ZAMMAlignmentVault());
    }

    /// @notice Deploy a new ZAMM-backed vault clone via CREATE3
    /// @param salt CREATE3 deployment salt for deterministic vanity address
    /// @param alignmentToken The token this vault aligns to
    /// @param poolKey ZAMM pool key for the ETH/alignmentToken pool
    /// @return vault Address of the deployed vault clone
    function deployVault(
        bytes32 salt,
        address alignmentToken,
        IZAMM.PoolKey calldata poolKey
    ) external returns (address vault) {
        bytes memory proxyCreationCode = abi.encodePacked(
            hex"3d602d80600a3d3981f3363d3d373d3d3d363d73",
            vaultImplementation,
            hex"5af43d82803e903d91602b57fd5bf3"
        );
        // Bind salt to msg.sender to prevent front-running the deterministic CREATE3 address.
        bytes32 senderBoundSalt = keccak256(abi.encodePacked(msg.sender, salt));
        vault = ICreateX(CREATEX).deployCreate3(senderBoundSalt, proxyCreationCode);
        ZAMMAlignmentVault(payable(vault)).initialize(
            zamm,
            zRouter,
            alignmentToken,
            poolKey,
            protocolTreasury,
            address(defaultPriceValidator)
        );
        emit VaultDeployed(vault, alignmentToken);
    }

    /// @notice Preview the deterministic address for a given salt
    function computeVaultAddress(address creator, bytes32 salt) external view returns (address) {
        bytes32 senderBoundSalt = keccak256(abi.encodePacked(creator, salt));
        bytes32 guardedSalt = keccak256(abi.encode(senderBoundSalt)); // CreateX RandomBytes guard path
        return ICreateX(CREATEX).computeCreate3Address(guardedSalt, CREATEX);
    }
}
