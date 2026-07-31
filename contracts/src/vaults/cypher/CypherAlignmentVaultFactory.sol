// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { CypherAlignmentVault } from "./CypherAlignmentVault.sol";
import { IVaultPriceValidator } from "../../interfaces/IVaultPriceValidator.sol";
import { IAlignmentRegistry } from "../../master/interfaces/IAlignmentRegistry.sol";
import { ICreateX, CREATEX } from "../../shared/CreateXConstants.sol";
import { Ownable } from "solady/auth/Ownable.sol";

/// @title CypherAlignmentVaultFactory
/// @notice Deploys CypherAlignmentVault clones via CREATE3. Shared acquisition/registry config
///         (Algebra factory, zRouter/zQuoter best-route surface, alignment registry, price validator)
///         is baked at construction and threaded into every vault; per-vault config (the external
///         target token and its alignment target id) is supplied per deploy.
/// @dev The factory is the owner of every vault it deploys, so the vaults' onlyOwner setters
///      (setPriceValidator/setMaxPriceDeviationBps) are only reachable through the owner-gated
///      passthroughs below — mirroring UniAlignmentVaultFactory.setVaultPoolKey.
contract CypherAlignmentVaultFactory is Ownable {
    address public immutable vaultImplementation;
    /// @notice Oracle/TWAP validator wired into every deployed vault. Reads the canonical reference
    ///         TWAP and floors the vault's swaps; production must pass the shared validator.
    IVaultPriceValidator public immutable defaultPriceValidator;
    /// @notice Algebra factory the vault resolves/creates its target/WETH LP pool through.
    address public immutable algebraFactory;
    /// @notice zRouter (typed best-route legs) for the acquire swap.
    address public immutable zRouter;
    /// @notice zQuoter for on-chain best-route selection; address(0) = Algebra fixed-pool fallback only.
    address public immutable zQuoter;
    /// @notice Registry that curates alignment targets and pins each target's reference/acquire route.
    IAlignmentRegistry public immutable alignmentRegistry;

    event VaultDeployed(address indexed vault, address indexed alignmentToken);

    // slither-disable-next-line missing-zero-check
    constructor(
        address _vaultImplementation,
        IVaultPriceValidator _defaultPriceValidator,
        address _algebraFactory,
        address _zRouter,
        address _zQuoter,
        IAlignmentRegistry _alignmentRegistry
    ) {
        _initializeOwner(msg.sender);
        vaultImplementation = _vaultImplementation;
        defaultPriceValidator = _defaultPriceValidator;
        algebraFactory = _algebraFactory;
        zRouter = _zRouter;
        zQuoter = _zQuoter;
        alignmentRegistry = _alignmentRegistry;
    }

    /// @notice Rotate the price validator on a vault deployed by this factory.
    /// @dev The factory is the owner of every vault it deploys, so the vault's onlyOwner
    ///      setPriceValidator is only reachable here. onlyOwner (the deployer/protocol) so the
    ///      anti-manipulation validator can be rotated if it is ever broken. Mirrors setVaultPoolKey.
    /// @param vault Address of the vault (must have been deployed by this factory)
    /// @param validator The price validator to set on the vault
    function setVaultPriceValidator(address vault, address validator) external onlyOwner {
        CypherAlignmentVault(payable(vault)).setPriceValidator(validator);
    }

    /// @notice Set the maximum allowed price deviation on a vault deployed by this factory.
    /// @dev onlyOwner passthrough — the factory owns the vault. Mirrors setVaultPoolKey.
    /// @param vault Address of the vault (must have been deployed by this factory)
    /// @param bps Deviation in basis points
    function setVaultMaxPriceDeviationBps(address vault, uint256 bps) external onlyOwner {
        CypherAlignmentVault(payable(vault)).setMaxPriceDeviationBps(bps);
    }

    // slither-disable-next-line reentrancy-events
    function createVault(
        bytes32 salt,
        address positionManager,
        address swapRouterAddr,
        address weth,
        address alignmentToken,
        address protocolTreasury,
        uint256 alignmentTargetId
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
            algebraFactory,
            weth,
            alignmentToken,
            protocolTreasury,
            zRouter,
            zQuoter,
            address(defaultPriceValidator),
            alignmentRegistry,
            alignmentTargetId
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
