// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { SafeOwnableUUPS } from "../shared/SafeOwnableUUPS.sol";
import { IMasterRegistry } from "./interfaces/IMasterRegistry.sol";
import { IAlignmentRegistry } from "./interfaces/IAlignmentRegistry.sol";
import { IComponentRegistry } from "../registry/interfaces/IComponentRegistry.sol";
import { MetadataUtils } from "../shared/libraries/MetadataUtils.sol";
import { IFactoryInstance } from "../interfaces/IFactoryInstance.sol";
import { IFactory } from "../interfaces/IFactory.sol";
import { IInstanceLifecycle } from "../interfaces/IInstanceLifecycle.sol";
import { IAlignmentVault } from "../interfaces/IAlignmentVault.sol";
import { RevenueSplitLib } from "../shared/libraries/RevenueSplitLib.sol";

/**
 * @title MasterRegistryV1
 * @notice Central registry for factories, instances, and vaults
 * @dev UUPS upgradeable. Owner is the Safe multisig via Timelock.
 *      Alignment target curation is handled by AlignmentRegistryV1.
 */
contract MasterRegistryV1 is SafeOwnableUUPS, IMasterRegistry {
    // ── Custom Errors ──
    error InvalidAddress();
    error InvalidContractType();
    error InvalidTitle();
    error InvalidName();
    error InvalidMetadataURI();
    error AlreadyRegistered();
    error NotRegistered();
    error FactoryNotActive();
    error FactoryHasNoProtocol();
    error InstanceHasNoVault();
    error VaultMismatch();
    error VaultNotDeployed();
    error InstanceHasNoTreasury();
    error MissingInstanceType();
    error NameAlreadyTaken();
    error TargetNotActive();
    error TokenNotInTarget();
    error VaultMustBeContract();
    error UnregisteredVault();
    error VaultAlreadyInArray();
    error VaultFamilyMismatch();
    error NoVaults();
    error NoAlignmentToken();
    error NotEmergencyRevoker();

    // ── Core State ──
    uint256 public nextFactoryId;
    bool private _initialized;

    // ── Factory Registry ──
    mapping(uint256 => address) public factoryIdToAddress;
    mapping(address => FactoryInfo) public factoryInfo;
    mapping(address => bool) public registeredFactories;

    // ── Instance Registry ──
    mapping(address => IMasterRegistry.InstanceInfo) public instanceInfo;
    mapping(bytes32 => bool) public nameHashes;

    // ── Vault Registry ──
    mapping(address => IMasterRegistry.VaultInfo) public vaultInfo;
    mapping(address => bool) public registeredVaults;

    // ── External Modules ──
    IAlignmentRegistry public alignmentRegistry;
    IComponentRegistry public componentRegistry;

    // ── Agent Management ──
    mapping(address => bool) public isAgent;
    address public emergencyRevoker;

    /// @notice Tracks revoked instances. Revoked instances are invisible to all existence/legitimacy reads.
    mapping(address => bool) public revokedInstances;

    /// @notice nameHash => instance. The reverse of `nameHashes`, for slug resolution.
    /// @dev Storage is append-only behind the proxy, so this stays the last state var. Kept alongside
    ///      the public `nameHashes`.
    mapping(bytes32 => address) public instanceByNameHash;

    // Events
    event AlignmentRegistrySet(address indexed oldRegistry, address indexed newRegistry);
    event CreatorInstanceAdded(address indexed creator, address indexed instance);
    event AgentUpdated(address indexed agent, bool authorized);
    event EmergencyRevokerSet(address indexed oldRevoker, address indexed newRevoker);

    constructor() {
        _initializeOwner(msg.sender);
    }

    /**
     * @notice Initialize the contract with a single owner (DAO address)
     * @param _owner Address of the DAO or owner
     */
    function initialize(address _owner) public {
        if (_initialized) revert AlreadyInitialized();
        if (_owner == address(0)) revert InvalidAddress();

        _initialized = true;
        _setOwner(_owner);
        nextFactoryId = 1;
    }

    // ============ Alignment Registry Wiring ============

    function setAlignmentRegistry(address _alignmentRegistry) external onlyOwner {
        if (_alignmentRegistry == address(0)) revert InvalidAddress();
        address old = address(alignmentRegistry);
        alignmentRegistry = IAlignmentRegistry(_alignmentRegistry);
        emit AlignmentRegistrySet(old, _alignmentRegistry);
    }

    // ============ ComponentRegistry Wiring ============

    function setComponentRegistry(address _componentRegistry) external onlyOwner {
        if (_componentRegistry == address(0)) revert InvalidAddress();
        componentRegistry = IComponentRegistry(_componentRegistry);
        emit ComponentRegistrySet(_componentRegistry);
    }

    // ============ Emergency Revoker Wiring ============

    function setEmergencyRevoker(address _revoker) external onlyOwner {
        address old = emergencyRevoker;
        emergencyRevoker = _revoker;
        emit EmergencyRevokerSet(old, _revoker);
    }

    // ============ Agent Management ============

    /// @notice Authorize or deauthorize a protocol agent (DAO only, via Timelock)
    function setAgent(address agent, bool authorized) external onlyOwner {
        isAgent[agent] = authorized;
        emit AgentUpdated(agent, authorized);
    }

    /// @notice Emergency agent revocation (bypasses Timelock)
    function revokeAgent(address agent) external {
        if (msg.sender != emergencyRevoker) revert NotEmergencyRevoker();
        isAgent[agent] = false;
        emit AgentUpdated(agent, false);
    }

    // ============ Factory Registration ============

    /**
     * @notice Register a factory (admin only)
     */
    function registerFactory(
        address factoryAddress,
        string memory contractType,
        string memory title,
        string memory displayTitle,
        string memory metadataURI,
        bytes32[] memory features,
        address creator
    ) external onlyOwner {
        if (factoryAddress == address(0)) revert InvalidAddress();
        if (bytes(contractType).length == 0) revert InvalidContractType();
        if (registeredFactories[factoryAddress]) revert AlreadyRegistered();
        if (!MetadataUtils.isValidName(title)) revert InvalidTitle();
        if (!MetadataUtils.isValidURI(metadataURI)) revert InvalidMetadataURI();

        address factoryProtocol = IFactory(factoryAddress).protocol();
        if (factoryProtocol == address(0)) revert FactoryHasNoProtocol();

        uint256 factoryId = nextFactoryId++;
        factoryIdToAddress[factoryId] = factoryAddress;

        factoryInfo[factoryAddress] = FactoryInfo({
            factoryAddress: factoryAddress,
            factoryId: factoryId,
            contractType: contractType,
            title: title,
            displayTitle: displayTitle,
            metadataURI: metadataURI,
            features: features,
            creator: creator,
            active: true,
            registeredAt: block.timestamp
        });

        registeredFactories[factoryAddress] = true;

        emit FactoryRegistered(factoryAddress, factoryId, contractType);
    }

    // ============ Factory Deactivation ============

    function deactivateFactory(address factoryAddress) external override onlyOwner {
        if (!registeredFactories[factoryAddress]) revert NotRegistered();
        if (!factoryInfo[factoryAddress].active) revert FactoryNotActive();
        factoryInfo[factoryAddress].active = false;
        emit FactoryDeactivated(factoryAddress, factoryInfo[factoryAddress].factoryId);
    }

    /// @notice Update the metadata URI for a registered instance.
    ///         Callable by the instance's creator or the registry owner.
    function updateInstanceMetadata(address instance, string calldata uri) external override {
        IMasterRegistry.InstanceInfo storage info = instanceInfo[instance];
        if (info.instance == address(0)) revert NotRegistered();
        if (msg.sender != info.creator && msg.sender != owner()) revert Unauthorized();
        if (!MetadataUtils.isValidURI(uri)) revert InvalidMetadataURI();
        info.metadataURI = uri;
        emit InstanceMetadataUpdated(instance, uri);
    }

    /// @notice Revoke a registered instance. Owner only, and permanent: there is no un-revoke path.
    /// @dev    What the flag reaches:
    ///         - Honored: `getInstanceInfo` reverts `NotRegistered`; `isRegisteredInstance` and
    ///           `isInstanceFromApprovedFactory` both return false. Those are the existence and
    ///           legitimacy reads, so anything gating on them stops seeing the instance.
    ///         - Not honored: name resolution. `resolveName` still returns the instance's address so its
    ///           slug stays reserved (see that function).
    ///         - Not honored: trade execution. Every ERC-404 / ERC-1155 / ERC-721 instance forwards a
    ///           user's comment to `GlobalMessageRegistry.postForAction` on its buy / sell / mint / bid
    ///           path, and that call gates on `isInstanceFromApprovedFactory`. The instances pre-check the
    ///           same read and skip the post rather than revert, so revocation silences a revoked
    ///           instance's comments without stopping its trades. Revocation is a listing decision, not a
    ///           trading halt, and this contract has no mechanism that is. `GlobalMessageRegistry.post`
    ///           is permissionless in any case.
    ///         Recovery means registering a new instance under a new name; the revoked instance's
    ///         `nameHash` stays claimed in `nameHashes`.
    function revokeInstance(address instance) external override onlyOwner {
        if (instanceInfo[instance].instance == address(0)) revert NotRegistered();
        revokedInstances[instance] = true;
        emit InstanceRevoked(instance);
    }

    // ============ Instance Registration ============

    /**
     * @notice Register an instance (called by factory)
     */
    function registerInstance(
        address instance,
        address factory,
        address creator,
        string memory name,
        string memory metadataURI,
        address vault
    ) external override {
        if (!registeredFactories[factory]) revert NotRegistered();
        if (!factoryInfo[factory].active) revert FactoryNotActive();
        if (msg.sender != factory) revert Unauthorized();
        if (instance == address(0)) revert InvalidAddress();
        if (creator == address(0)) revert InvalidAddress();
        if (!MetadataUtils.isValidName(name)) revert InvalidName();
        if (!MetadataUtils.isValidURI(metadataURI)) revert InvalidMetadataURI();

        address instanceVault = IFactoryInstance(instance).vault();
        if (instanceVault == address(0)) revert InstanceHasNoVault();
        if (instanceVault != vault) revert VaultMismatch();
        if (instanceVault.code.length == 0) revert VaultNotDeployed();
        // Vault-registry gate: the alignment tithe must only route to a vault the registry has registered
        // and alignment-validated; a code.length check alone lets a creator bind an instance to any
        // contract exposing the vault surface and redirect the tithe off-curation. Uses the full
        // registered && active && target-active predicate (`_vaultRegistered`, the same one
        // `isVaultRegistered` exposes), since this is the sole vault-legitimacy gate for ERC1155/721
        // collections and the two-flag subset would let them bind a de-curated vault.
        if (!_vaultRegistered(vault)) revert UnregisteredVault();

        address instanceTreasury = IFactoryInstance(instance).protocolTreasury();
        if (instanceTreasury == address(0)) revert InstanceHasNoTreasury();

        if (IInstanceLifecycle(instance).instanceType() == bytes32(0)) revert MissingInstanceType();

        bytes32 nameHash = MetadataUtils.toNameHash(name);
        if (nameHashes[nameHash]) revert NameAlreadyTaken();

        nameHashes[nameHash] = true;
        instanceByNameHash[nameHash] = instance;

        address[] memory initialVaults = new address[](1);
        initialVaults[0] = vault;

        instanceInfo[instance] = IMasterRegistry.InstanceInfo({
            instance: instance,
            factory: factory,
            creator: creator,
            vaults: initialVaults,
            name: name,
            metadataURI: metadataURI,
            nameHash: nameHash,
            registeredAt: block.timestamp
        });

        emit InstanceRegistered(instance, factory, creator, name);
        emit CreatorInstanceAdded(creator, instance);
    }

    // ============ Factory Queries ============

    function getFactoryInfo(uint256 factoryId) external view returns (FactoryInfo memory) {
        address factoryAddress = factoryIdToAddress[factoryId];
        if (factoryAddress == address(0)) revert NotRegistered();
        return factoryInfo[factoryAddress];
    }

    function getFactoryInfoByAddress(address factoryAddress) external view returns (FactoryInfo memory) {
        if (!registeredFactories[factoryAddress]) revert NotRegistered();
        return factoryInfo[factoryAddress];
    }

    // slither-disable-next-line timestamp
    function getInstanceInfo(address instance) external view returns (IMasterRegistry.InstanceInfo memory) {
        if (instanceInfo[instance].instance == address(0) || revokedInstances[instance]) revert NotRegistered();
        return instanceInfo[instance];
    }

    function getTotalFactories() external view returns (uint256) {
        return nextFactoryId - 1;
    }

    function isFactoryRegistered(address factory) external view returns (bool) {
        return registeredFactories[factory];
    }

    function isInstanceFromApprovedFactory(address instance) external view override returns (bool) {
        IMasterRegistry.InstanceInfo storage info = instanceInfo[instance];
        return info.instance != address(0) && registeredFactories[info.factory] && !revokedInstances[instance];
    }

    // slither-disable-next-line timestamp
    function isRegisteredInstance(address instance) external view override returns (bool) {
        return instanceInfo[instance].instance != address(0) && !revokedInstances[instance];
    }

    function isNameTaken(string memory name) external view override returns (bool) {
        bytes32 nameHash = MetadataUtils.toNameHash(name);
        return nameHashes[nameHash];
    }

    /// @notice Resolve a collection name to its instance address.
    /// @dev Case-insensitive (names are lowercased before hashing). Returns address(0) for an
    ///      unknown name. Ignores revocation: a revoked instance still resolves so its slug stays
    ///      reserved and cannot be squatted. The frontend gates display of revoked instances.
    function resolveName(string calldata name) external view override returns (address) {
        return instanceByNameHash[MetadataUtils.toNameHash(name)];
    }

    // ============ Vault Registry ============

    /**
     * @notice Register a vault (callable by active factory or owner)
     * @param vault Vault address
     * @param creator Address credited as vault creator
     * @param name Vault name
     * @param metadataURI Metadata URI
     * @param targetId Alignment target ID
     */
    // slither-disable-next-line timestamp
    function registerVault(
        address vault,
        address creator,
        string memory name,
        string memory metadataURI,
        uint256 targetId
    ) external override {
        bool isActiveFactory =
            registeredFactories[msg.sender] && factoryInfo[msg.sender].active;
        if (!isActiveFactory && msg.sender != owner()) revert Unauthorized();

        if (vault == address(0)) revert InvalidAddress();
        if (creator == address(0)) revert InvalidAddress();
        if (bytes(name).length == 0 || bytes(name).length > 256) revert InvalidName();
        if (registeredVaults[vault]) revert AlreadyRegistered();
        if (!MetadataUtils.isValidURI(metadataURI)) revert InvalidMetadataURI();
        if (vault.code.length == 0) revert VaultMustBeContract();

        // Alignment validation via AlignmentRegistry
        if (!alignmentRegistry.isAlignmentTargetActive(targetId)) revert TargetNotActive();
        address vaultToken = _getVaultAlignmentToken(vault);
        if (!alignmentRegistry.isTokenInTarget(targetId, vaultToken)) revert TokenNotInTarget();

        registeredVaults[vault] = true;

        vaultInfo[vault] = IMasterRegistry.VaultInfo({
            vault: vault,
            creator: creator,
            name: name,
            metadataURI: metadataURI,
            active: true,
            registeredAt: block.timestamp,
            targetId: targetId
        });

        emit VaultRegistered(vault, creator, name, targetId);
    }

    function getVaultInfo(address vault) external view override returns (VaultInfo memory) {
        if (!registeredVaults[vault]) revert NotRegistered();
        return vaultInfo[vault];
    }

    /// @notice Whether a vault is registered AND its bound alignment target is still active.
    /// @dev Composite read across two independently-mutated `active` flags: the vault's own
    ///      (`vaultInfo[vault].active`, toggled by `deactivateVault`) and its bound alignment target's
    ///      (`AlignmentRegistryV1`, toggled by `deactivateAlignmentTarget`). Registration validates
    ///      target-active only at bind time, and a target can be revoked afterwards; re-checking here keeps
    ///      a vault of a revoked target from being bound by new ERC404 instances (`ERC404Factory` gates
    ///      the graduation-tithe vault on this read). Composing the read, rather than mutating
    ///      `vaultInfo[vault].active` on target deactivation, keeps both flags truthful and covers every
    ///      vault of a revoked target at once.
    // slither-disable-next-line timestamp
    function isVaultRegistered(address vault) external view override returns (bool) {
        return _vaultRegistered(vault);
    }

    /// @dev The vault-legitimacy predicate: registered, flag-active, and its alignment target still
    ///      active. The external `isVaultRegistered` read and the write-path gates (`registerInstance`,
    ///      `migrateVault`) all route through here, so no path accepts a vault of a revoked target.
    // slither-disable-next-line timestamp
    function _vaultRegistered(address vault) internal view returns (bool) {
        return registeredVaults[vault] && vaultInfo[vault].active
            && alignmentRegistry.isAlignmentTargetActive(vaultInfo[vault].targetId);
    }

    function deactivateVault(address vault) external override onlyOwner {
        if (!registeredVaults[vault]) revert NotRegistered();
        vaultInfo[vault].active = false;
        emit VaultDeactivated(vault);
    }

    // ============ Instance Vault Migration ============

    // slither-disable-next-line timestamp
    function migrateVault(address instance, address newVault) external override {
        if (msg.sender != instance) revert Unauthorized();
        if (instanceInfo[instance].instance == address(0)) revert NotRegistered();
        // Same predicate as `registerInstance`, so migration cannot bind a revoked-target vault either
        // (the genesis-targetId match below also pins the target).
        if (!_vaultRegistered(newVault)) revert FactoryNotActive();

        address[] storage vaults = instanceInfo[instance].vaults;
        uint256 genesisTargetId = vaultInfo[vaults[0]].targetId;
        if (vaultInfo[newVault].targetId != genesisTargetId) revert VaultMismatch();

        // Family choke-point: buyers paid in under a promise. An endowment collection tithes into a
        // permanent Aave position whose yield streams to the community; a liquidity collection tithes into
        // a pool with different exposure (impermanent loss, sell pressure, MEV). Swapping one for the other
        // changes what the tithe is, not merely where it sits, so the new vault must share the genesis
        // vault's family.
        if (_isVaultLiquidityFamily(newVault) != _isVaultLiquidityFamily(vaults[0])) {
            revert VaultFamilyMismatch();
        }

        for (uint256 i = 0; i < vaults.length; i++) {
            if (vaults[i] == newVault) revert VaultAlreadyInArray();
        }

        vaults.push(newVault);
        emit InstanceVaultMigrated(instance, newVault, vaults.length - 1);
    }

    function getInstanceVaults(address instance) external view override returns (address[] memory) {
        return instanceInfo[instance].vaults;
    }

    function getActiveVault(address instance) external view override returns (address) {
        address[] storage vaults = instanceInfo[instance].vaults;
        if (vaults.length == 0) revert NoVaults();
        return vaults[vaults.length - 1];
    }

    // ============ Internal Helpers ============

    function _getVaultAlignmentToken(address vault) internal view returns (address) {
        (bool success, bytes memory data) = vault.staticcall(abi.encodeWithSignature("alignmentToken()"));
        if (!success || data.length < 32) revert NoAlignmentToken();
        return abi.decode(data, (address));
    }

    /// @dev Resolve a vault's revenue-split family from its self-reported `vaultType()`, exactly as the
    ///      settlement instances do (`ERC1155Instance.withdraw` / `ERC721AuctionInstance.settleAuction`).
    ///      An unrecognized family reverts `UnknownVaultFamily`, per the loud-fail policy in `RevenueSplitLib`.
    function _isVaultLiquidityFamily(address vault) internal view returns (bool) {
        return RevenueSplitLib.isLiquidityFamily(IAlignmentVault(payable(vault)).vaultType());
    }
}
