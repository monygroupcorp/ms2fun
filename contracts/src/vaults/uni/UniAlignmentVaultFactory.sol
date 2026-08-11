// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { UniAlignmentVault } from "./UniAlignmentVault.sol";
import { IVaultPriceValidator } from "../../interfaces/IVaultPriceValidator.sol";
import { IAlignmentRegistry } from "../../master/interfaces/IAlignmentRegistry.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { ICreateX, CREATEX } from "../../shared/CreateXConstants.sol";
import { Ownable } from "solady/auth/Ownable.sol";

/// @title UniAlignmentVaultFactory
/// @notice Deploys UniAlignmentVault clones; zRouter config is shared across all vaults.
///         The factory is the owner of every vault it deploys, so pool key configuration
///         must go through setVaultPoolKey (onlyOwner) rather than calling the vault directly.
contract UniAlignmentVaultFactory is Ownable {
    address public immutable vaultImplementation;
    IVaultPriceValidator public immutable defaultPriceValidator;
    IAlignmentRegistry public immutable alignmentRegistry;

    address public immutable weth;
    address public immutable poolManager;
    /// @notice Destination of the 1% protocol yield cut, threaded into every vault at initialize.
    ///         Fixed at factory construction — the vault carries no setter, so the destination a
    ///         vault is born with is the destination it keeps (mirrors ZAMMAlignmentVaultFactory).
    address public immutable protocolTreasury;
    address public immutable zRouter;
    uint24 public immutable zRouterFee;
    int24 public immutable zRouterTickSpacing;
    /// @notice zQuoter wired into every deployed vault for best-route acquisition (Front 2). When
    ///         address(0), vaults acquire via the fixed zRouterFee/zRouterTickSpacing pool only.
    address public immutable zQuoter;

    event VaultDeployed(address indexed vault, address indexed alignmentToken);

    constructor(
        // slither-disable-next-line missing-zero-check
        address _weth,
        // slither-disable-next-line missing-zero-check
        address _poolManager,
        // slither-disable-next-line missing-zero-check
        address _zRouter,
        uint24 _zRouterFee,
        int24 _zRouterTickSpacing,
        address _protocolTreasury,
        IVaultPriceValidator _defaultPriceValidator,
        IAlignmentRegistry _alignmentRegistry,
        // slither-disable-next-line missing-zero-check
        address _zQuoter
    ) {
        _initializeOwner(msg.sender);
        weth = _weth;
        poolManager = _poolManager;
        zRouter = _zRouter;
        zRouterFee = _zRouterFee;
        zRouterTickSpacing = _zRouterTickSpacing;
        protocolTreasury = _protocolTreasury;
        defaultPriceValidator = _defaultPriceValidator;
        alignmentRegistry = _alignmentRegistry;
        zQuoter = _zQuoter;
        vaultImplementation = address(new UniAlignmentVault());
    }

    /// @notice Set the V4 pool key on a vault deployed by this factory.
    ///         Only the factory owner can call this — the vault's owner is the factory.
    /// @param vault Address of the vault (must have been deployed by this factory)
    /// @param poolKey The V4 pool key to configure on the vault
    function setVaultPoolKey(address vault, PoolKey calldata poolKey) external onlyOwner {
        UniAlignmentVault(payable(vault)).setV4PoolKey(poolKey);
    }

    /// @notice Rotate the price validator on a vault deployed by this factory.
    /// @dev The factory owns every vault it deploys, so the vault's onlyOwner setPriceValidator is
    ///      only reachable here. onlyOwner so the anti-manipulation validator can be rotated if it is
    ///      ever broken. Mirrors setVaultPoolKey.
    /// @param vault Address of the vault (must have been deployed by this factory)
    /// @param validator The price validator to set on the vault
    function setVaultPriceValidator(address vault, address validator) external onlyOwner {
        UniAlignmentVault(payable(vault)).setPriceValidator(validator);
    }

    /// @notice Set the maximum allowed price deviation on a vault deployed by this factory.
    /// @dev onlyOwner passthrough — the factory owns the vault. Mirrors setVaultPoolKey.
    /// @param vault Address of the vault (must have been deployed by this factory)
    /// @param bps Deviation in basis points
    function setVaultMaxPriceDeviationBps(address vault, uint256 bps) external onlyOwner {
        UniAlignmentVault(payable(vault)).setMaxPriceDeviationBps(bps);
    }

    /// @notice Set the dust distribution threshold on a vault deployed by this factory.
    /// @dev onlyOwner passthrough — the factory owns the vault. The vault's default threshold is
    ///      1e18, which is denominated in the vault's own share units; a vault whose alignment token
    ///      does not use 18 decimals needs the threshold retuned after deployment. Mirrors
    ///      setVaultPoolKey.
    /// @param vault Address of the vault (must have been deployed by this factory)
    /// @param newThreshold Minimum accumulated dust shares before redistribution (must be > 0)
    function setVaultDustDistributionThreshold(address vault, uint256 newThreshold) external onlyOwner {
        UniAlignmentVault(payable(vault)).setDustDistributionThreshold(newThreshold);
    }

    /// @notice Deploy a new vault clone via CREATE3
    /// @param salt CREATE3 deployment salt for deterministic vanity address
    /// @param alignmentToken The token this vault aligns to
    /// @param alignmentTargetId The alignment target this vault is bound to
    /// @param priceValidator Custom price validator; uses defaultPriceValidator if address(0)
    /// @return vault Address of the deployed vault clone
    // slither-disable-next-line reentrancy-events
    function deployVault(
        bytes32 salt,
        address alignmentToken,
        uint256 alignmentTargetId,
        IVaultPriceValidator priceValidator
    ) external returns (address vault) {
        bytes memory proxyCreationCode = abi.encodePacked(
            hex"3d602d80600a3d3981f3363d3d373d3d3d363d73", vaultImplementation, hex"5af43d82803e903d91602b57fd5bf3"
        );
        // Bind salt to msg.sender to prevent front-running the deterministic CREATE3 address.
        bytes32 senderBoundSalt = keccak256(abi.encodePacked(msg.sender, salt));
        vault = ICreateX(CREATEX).deployCreate3(senderBoundSalt, proxyCreationCode);

        UniAlignmentVault(payable(vault))
            .initialize(
                address(this),
                weth,
                poolManager,
                alignmentToken,
                zRouter,
                zRouterFee,
                zRouterTickSpacing,
                priceValidator == IVaultPriceValidator(address(0)) ? defaultPriceValidator : priceValidator,
                alignmentRegistry,
                alignmentTargetId,
                protocolTreasury
            );

        // Wire best-route acquisition post-init (factory is the vault owner). address(0) leaves the
        // vault on fixed-pool acquisition, so this is a no-op change to today's behavior until set.
        if (zQuoter != address(0)) UniAlignmentVault(payable(vault)).setZQuoter(zQuoter);

        emit VaultDeployed(vault, alignmentToken);
    }

    /// @notice Preview the deterministic address for a given salt
    function computeVaultAddress(address creator, bytes32 salt) external view returns (address) {
        bytes32 senderBoundSalt = keccak256(abi.encodePacked(creator, salt));
        bytes32 guardedSalt = keccak256(abi.encode(senderBoundSalt)); // CreateX RandomBytes guard path
        return ICreateX(CREATEX).computeCreate3Address(guardedSalt, CREATEX);
    }
}
