// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IMasterRegistry } from "../../src/master/interfaces/IMasterRegistry.sol";
import { IComponentRegistry } from "../../src/registry/interfaces/IComponentRegistry.sol";

/**
 * @title MockMasterRegistry
 * @notice Mock implementation of IMasterRegistry for testing
 * @dev Provides no-op implementations of all registry functions
 */
contract MockMasterRegistry is IMasterRegistry {
    // Simple no-op implementations for testing

    function registerInstance(address instance, address factory, address, string memory, string memory, address)
        external
        override
    {
        // Record instance→factory so config/seal modules' factory-of-instance auth (D1) works for the
        // honest createInstance flow (factory registers the instance before wiring its modules).
        _instanceFactory[instance] = factory;
    }

    function getFactoryInfo(uint256) external view override returns (FactoryInfo memory) {
        return FactoryInfo({
            factoryAddress: address(0),
            factoryId: 0,
            contractType: "",
            title: "",
            displayTitle: "",
            metadataURI: "",
            features: new bytes32[](0),
            creator: address(0),
            active: false,
            registeredAt: 0
        });
    }

    function getFactoryInfoByAddress(address) external view override returns (FactoryInfo memory) {
        return FactoryInfo({
            factoryAddress: address(0),
            factoryId: 0,
            contractType: "",
            title: "",
            displayTitle: "",
            metadataURI: "",
            features: new bytes32[](0),
            creator: address(0),
            active: false,
            registeredAt: 0
        });
    }

    function getTotalFactories() external view override returns (uint256) {
        return 0;
    }

    // Per-instance factory, settable for least-privilege auth tests (D1). Default address(0).
    mapping(address => address) private _instanceFactory;

    /// @dev TEST HELPER: record which factory "registered" `instance` (what getInstanceInfo reports).
    function setInstanceFactory(address instance, address factory) external {
        _instanceFactory[instance] = factory;
    }

    function getInstanceInfo(address instance) external view override returns (InstanceInfo memory) {
        return InstanceInfo({
            instance: instance,
            factory: _instanceFactory[instance],
            creator: address(0),
            vaults: new address[](0),
            name: "",
            metadataURI: "",
            nameHash: bytes32(0),
            registeredAt: 0
        });
    }

    function registerVault(address, address, string memory, string memory, uint256) external override { }

    function getVaultInfo(address) external view override returns (VaultInfo memory) {
        return VaultInfo({
            vault: address(0),
            creator: address(0),
            name: "",
            metadataURI: "",
            active: false,
            registeredAt: 0,
            targetId: 0
        });
    }

    // Vaults are registered by default so the broad createInstance/graduation suites keep passing
    // without per-test registration. A test can mark a specific vault unregistered to exercise the
    // ERC404Factory create-time vault gate (Finding 1).
    mapping(address => bool) private _vaultUnregistered;

    /// @dev TEST HELPER: flip a vault's registry status (default = registered/true).
    function setVaultRegistered(address vault, bool registered) external {
        _vaultUnregistered[vault] = !registered;
    }

    function isVaultRegistered(address vault) external view override returns (bool) {
        return !_vaultUnregistered[vault];
    }

    function deactivateVault(address) external override { }

    function deactivateFactory(address) external override { }

    function isFactoryRegistered(address) external view override returns (bool) {
        return true; // Always return true in mock for testing
    }

    function isInstanceFromApprovedFactory(address) external view override returns (bool) {
        return true; // Always return true in mock for testing
    }

    // Registered-instance tracking. Default (unset) is registered=true to preserve the historic
    // always-true mock behavior other suites rely on; callers can force a specific address
    // unregistered to exercise the deployer caller-guard.
    mapping(address => bool) private _forcedUnregistered;

    /// @dev TEST HELPER: toggle whether `instance` is treated as a registered instance.
    function setRegisteredInstance(address instance, bool registered) external {
        _forcedUnregistered[instance] = !registered;
    }

    function isRegisteredInstance(address instance) external view override returns (bool) {
        return !_forcedUnregistered[instance];
    }

    function migrateVault(address, address) external override { }

    function getInstanceVaults(address) external view override returns (address[] memory) {
        return new address[](0);
    }

    function getActiveVault(address) external view override returns (address) {
        return address(0);
    }

    function componentRegistry() external view override returns (IComponentRegistry) {
        return IComponentRegistry(address(0));
    }

    function setComponentRegistry(address) external override { }

    function updateInstanceMetadata(address, string calldata) external override { }

    function revokeInstance(address) external override { }

    // Agent tracking for testing
    mapping(address => bool) private _agents;

    function isAgent(address agent) external view returns (bool) {
        return _agents[agent];
    }

    function setAgent(address agent, bool authorized) external {
        _agents[agent] = authorized;
    }

    // Namespace tracking for name collision tests
    mapping(bytes32 => bool) private _nameHashes;

    function isNameTaken(string memory name) external view override returns (bool) {
        bytes32 nameHash = keccak256(abi.encodePacked(_toLowerCase(name)));
        return _nameHashes[nameHash];
    }

    // Reverse index for name→instance resolution, mirroring MasterRegistryV1.instanceByNameHash.
    mapping(bytes32 => address) private _instanceByNameHash;

    function resolveName(string calldata name) external view override returns (address) {
        bytes32 nameHash = keccak256(abi.encodePacked(_toLowerCase(name)));
        return _instanceByNameHash[nameHash];
    }

    /// @dev TEST HELPER: record which instance a name resolves to.
    function setResolvedName(string calldata name, address instance) external {
        bytes32 nameHash = keccak256(abi.encodePacked(_toLowerCase(name)));
        _instanceByNameHash[nameHash] = instance;
    }

    // Helper to mark a name as taken (for testing)
    function markNameTaken(string memory name) external {
        bytes32 nameHash = keccak256(abi.encodePacked(_toLowerCase(name)));
        _nameHashes[nameHash] = true;
    }

    // Simple lowercase helper (matches MetadataUtils behavior)
    function _toLowerCase(string memory str) internal pure returns (string memory) {
        bytes memory bStr = bytes(str);
        bytes memory bLower = new bytes(bStr.length);
        for (uint256 i = 0; i < bStr.length; i++) {
            if ((uint8(bStr[i]) >= 65) && (uint8(bStr[i]) <= 90)) {
                bLower[i] = bytes1(uint8(bStr[i]) + 32);
            } else {
                bLower[i] = bStr[i];
            }
        }
        return string(bLower);
    }
}
