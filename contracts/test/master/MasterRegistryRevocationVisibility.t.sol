// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { MasterRegistryV1 } from "../../src/master/MasterRegistryV1.sol";
import { AlignmentRegistryV1 } from "../../src/master/AlignmentRegistryV1.sol";
import { IMasterRegistry } from "../../src/master/interfaces/IMasterRegistry.sol";
import { IAlignmentRegistry } from "../../src/master/interfaces/IAlignmentRegistry.sol";

contract MockFactory {
    address public creator;
    address public protocol;

    constructor(address _creator, address _protocol) {
        creator = _creator;
        protocol = _protocol;
    }
}

contract MockVaultSimple {
    address public alignmentToken;

    constructor(address _token) {
        alignmentToken = _token;
    }
}

contract MockInstance {
    address public vault;
    address public protocolTreasury;

    function initialize(address _vault, address _treasury) external {
        vault = _vault;
        protocolTreasury = _treasury;
    }

    function instanceType() external pure returns (bytes32) {
        return keccak256("erc404");
    }
}

/// @notice noesis-052: de-listing (`revokeInstance`) must be honored by ALL three existence/legitimacy
///         read paths — `getInstanceInfo`, `isRegisteredInstance`, `isInstanceFromApprovedFactory` — while
///         `resolveName` stays deliberately revocation-blind so the slug remains reserved (anti-squat).
contract MasterRegistryRevocationVisibilityTest is Test {
    MasterRegistryV1 public registry;
    AlignmentRegistryV1 public alignmentRegistry;
    address public daoOwner = makeAddr("dao");
    address public alice = makeAddr("alice");
    address public dummyToken = address(0x1234);
    string internal constant NAME = "CulledProject";

    function setUp() public {
        registry = new MasterRegistryV1();
        registry.initialize(daoOwner);

        alignmentRegistry = new AlignmentRegistryV1(makeAddr("WETH"));
        alignmentRegistry.initialize(daoOwner);

        vm.prank(daoOwner);
        registry.setAlignmentRegistry(address(alignmentRegistry));
    }

    function _setupTargetAndVault(address token) internal returns (uint256 targetId, address vault) {
        IAlignmentRegistry.AlignmentAsset[] memory assets = new IAlignmentRegistry.AlignmentAsset[](1);
        assets[0] = IAlignmentRegistry.AlignmentAsset({ token: token, symbol: "TKN", info: "", metadataURI: "" });
        vm.prank(daoOwner);
        targetId = alignmentRegistry.registerAlignmentTarget("Target", "", "", assets);
        vault = address(new MockVaultSimple(token));
        vm.prank(daoOwner);
        registry.registerVault(vault, alice, "Vault One", "ipfs://v1", targetId);
    }

    function _registerFactory() internal returns (address factory) {
        factory = address(new MockFactory(alice, daoOwner));
        vm.prank(daoOwner);
        registry.registerFactory(
            factory, "ERC404", "Test", "Test Factory", "ipfs://factory", new bytes32[](0), address(0)
        );
    }

    function _registerInstance(address factory, address vault) internal returns (address instance) {
        MockInstance inst = new MockInstance();
        inst.initialize(vault, alice);
        vm.prank(factory);
        registry.registerInstance(address(inst), factory, alice, NAME, "ipfs://proj", vault);
        return address(inst);
    }

    function _register() internal returns (address instance) {
        (, address vault) = _setupTargetAndVault(dummyToken);
        address factory = _registerFactory();
        instance = _registerInstance(factory, vault);
    }

    /// @notice Before revocation, all three existence reads agree the instance is live and resolveName finds it.
    function test_BeforeRevoke_AllExistenceReadsTrue() public {
        address instance = _register();

        // getInstanceInfo does not revert
        IMasterRegistry.InstanceInfo memory info = registry.getInstanceInfo(instance);
        assertEq(info.instance, instance);

        assertTrue(registry.isRegisteredInstance(instance));
        assertTrue(registry.isInstanceFromApprovedFactory(instance));
        assertEq(registry.resolveName(NAME), instance);
    }

    /// @notice After revocation, all three existence reads drop the instance; resolveName still finds it.
    function test_AfterRevoke_AllExistenceReadsDrop_NameStaysReserved() public {
        address instance = _register();

        vm.prank(daoOwner);
        registry.revokeInstance(instance);

        // getInstanceInfo reverts
        vm.expectRevert(MasterRegistryV1.NotRegistered.selector);
        registry.getInstanceInfo(instance);

        // the two booleans now agree with getInstanceInfo
        assertFalse(registry.isRegisteredInstance(instance));
        assertFalse(registry.isInstanceFromApprovedFactory(instance));

        // resolveName is deliberately revocation-blind: slug stays reserved (anti-squat)
        assertEq(registry.resolveName(NAME), instance);
    }
}
