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
    /// @dev Storage-append only: this is the last state var so the layout stays proxy-safe.
    ///      Kept alongside `nameHashes` (not replacing it) — `nameHashes` is public/ABI-visible.
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

    /// @notice Revoke a registered instance, hiding it from getInstanceInfo.
    ///         Owner only. TEMPORARY — intended for removal in the next upgrade cycle.
    ///         Do not rely on this as a permanent censorship mechanism.
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
        // Vault-registry gate (choke-point): the alignment tithe must only ever route to a vault the
        // registry has registered + alignment-validated. A code.length check alone lets a creator bind
        // an instance to any contract exposing the vault surface and redirect the tithe off-curation.
        // Gates on the FULL tri-composite (registered && active && target-active) via the shared
        // `_vaultRegistered` predicate — the raw two-flag subset let a NEW ERC1155/721 collection bind a
        // de-curated (revoked-target) vault, since `:243` is the sole vault-legitimacy gate for those
        // families (MRV1-01). `_vaultRegistered` is the same predicate `isVaultRegistered` exposes.
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
    ///      unknown name. Deliberately ignores revocation: a revoked instance still resolves so
    ///      its slug stays reserved and cannot be squatted. Resolution and display are separate
    ///      concerns — the frontend gates revoked instances.
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
    ///      (`vaultInfo[vault].active`, toggled by `deactivateVault`) and its bound alignment
    ///      target's (`AlignmentRegistryV1`, toggled by `deactivateAlignmentTarget`). Registration
    ///      validates target-active at bind time (`registerVault`), but a target can be revoked
    ///      LATER (e.g. a rug is discovered). Without re-checking here, a vault bound to a
    ///      now-revoked target would stay registered — bindable by new ERC404 instances
    ///      (`ERC404Factory` gates the graduation-tithe vault on this read) and otherwise usable.
    ///      Gating on the composite read (rather than mutating `vaultInfo[vault].active` on every
    ///      target deactivation) keeps the two flags independently truthful and covers every vault
    ///      of a revoked target at once, with no extra write surface.
    // slither-disable-next-line timestamp
    function isVaultRegistered(address vault) external view override returns (bool) {
        return _vaultRegistered(vault);
    }

    /// @dev The tri-composite vault-legitimacy predicate: registered, flag-active, AND its
    ///      alignment target still active. The single source of truth for every vault gate —
    ///      the external `isVaultRegistered` read AND the internal write-path gates
    ///      (`registerInstance`, `migrateVault`) all route through here so no path can drift to
    ///      the raw two-flag subset and re-open the revoked-target hole (MRV1-01).
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
        // Full tri-composite gate (MRV1-02): mirror the `registerInstance` predicate so the migrate
        // write-path cannot bind a revoked-target vault either. Inconsequential today (the genesis-targetId
        // match below already pins the target), but kept consistent so no path repeats the raw-subset hole.
        if (!_vaultRegistered(newVault)) revert FactoryNotActive();

        address[] storage vaults = instanceInfo[instance].vaults;
        uint256 genesisTargetId = vaultInfo[vaults[0]].targetId;
        if (vaultInfo[newVault].targetId != genesisTargetId) revert VaultMismatch();

        // Revenue-split family choke-point (audit finding #2): the settlement split (1/80/19 for a
        // yield/endowment collection vs 1/19/80 for a liquidity collection) is chosen by the vault's
        // family. A cross-family migration would let a creator flip an endowment collection's split to
        // the liquidity weights AFTER buyers paid in under the endowment promise — diverting 61% of the
        // proceeds owed to the permanent community endowment to themselves. It also misroutes the vault
        // tithe leg. Cross-family migration is economically nonsensical, so forbid it outright: the new
        // vault must share the genesis vault's family.
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
    ///      An unrecognized family reverts `UnknownVaultFamily` — consistent with the loud-fail policy in
    ///      `RevenueSplitLib`; a registered vault always reports a known family in production.
    function _isVaultLiquidityFamily(address vault) internal view returns (bool) {
        return RevenueSplitLib.isLiquidityFamily(IAlignmentVault(payable(vault)).vaultType());
    }
}
