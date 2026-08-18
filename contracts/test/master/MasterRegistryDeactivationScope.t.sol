// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { MasterRegistryV1 } from "../../src/master/MasterRegistryV1.sol";
import { AlignmentRegistryV1 } from "../../src/master/AlignmentRegistryV1.sol";
import { IAlignmentRegistry } from "../../src/master/interfaces/IAlignmentRegistry.sol";
import { GlobalMessageRegistry } from "../../src/registry/GlobalMessageRegistry.sol";

contract DeactivationScopeFactory {
    address public creator;
    address public protocol;

    constructor(address _c, address _p) {
        creator = _c;
        protocol = _p;
    }
}

contract DeactivationScopeVault {
    address public alignmentToken;

    constructor(address t) {
        alignmentToken = t;
    }
}

contract DeactivationScopeInstance {
    address public vault;
    address public protocolTreasury;

    function initialize(address _v, address _t) external {
        vault = _v;
        protocolTreasury = _t;
    }

    function instanceType() external pure returns (bytes32) {
        return keccak256("erc404");
    }
}

/// @title MasterRegistryDeactivationScope
/// @notice noesis-291: pins the BLAST RADIUS of `deactivateFactory` — it stops NEW instances and
///         touches nothing about the ones already deployed.
/// @dev Why this exists. `isInstanceFromApprovedFactory` is the only registry read that reaches a live
///      trade: every ERC-404 / ERC-1155 / ERC-721 instance calls `GlobalMessageRegistry.postForAction`
///      on its buy / sell / mint / bid path whenever the user attaches a comment, and that call gates
///      on this read. `deactivateFactory` deliberately flips only `factoryInfo[].active` and leaves
///      `registeredFactories[factory]` true, so the read is unmoved. A future "tightening" of
///      `isInstanceFromApprovedFactory` to also require `factoryInfo[].active` would look like a
///      correctness fix and would in fact brick the commented-trade path of every instance a
///      deactivated factory ever produced — fleet-wide, at the moment the DAO retires a factory
///      version. This suite makes that change fail loudly.
///
///      It pins the SCOPE of deactivation only. It deliberately asserts nothing about what
///      `revokeInstance` does to the same path — that behaviour is under a ruling (`noesis-289`) and
///      asserting today's answer would encode it.
contract MasterRegistryDeactivationScopeTest is Test {
    MasterRegistryV1 registry;
    AlignmentRegistryV1 alignmentRegistry;
    GlobalMessageRegistry msgReg;

    address dao = makeAddr("dao");
    address alice = makeAddr("alice");
    address user = makeAddr("user");
    address dummyToken = address(0x1234);

    address factory;
    address vaultAddr;
    address instance;

    function setUp() public {
        MasterRegistryV1 impl = new MasterRegistryV1();
        registry = MasterRegistryV1(LibClone.deployERC1967(address(impl)));
        registry.initialize(dao);

        alignmentRegistry = new AlignmentRegistryV1(makeAddr("WETH"));
        alignmentRegistry.initialize(dao);
        vm.prank(dao);
        registry.setAlignmentRegistry(address(alignmentRegistry));

        factory = address(new DeactivationScopeFactory(alice, dao));
        vm.prank(dao);
        registry.registerFactory(
            factory, "ERC404", "Test", "Test Factory", "ipfs://factory", new bytes32[](0), address(0)
        );

        vaultAddr = address(new DeactivationScopeVault(dummyToken));
        IAlignmentRegistry.AlignmentAsset[] memory assets = new IAlignmentRegistry.AlignmentAsset[](1);
        assets[0] = IAlignmentRegistry.AlignmentAsset({ token: dummyToken, symbol: "DUMMY", info: "", metadataURI: "" });
        vm.prank(dao);
        uint256 targetId = alignmentRegistry.registerAlignmentTarget("Test Target", "", "", assets);
        vm.prank(dao);
        registry.registerVault(vaultAddr, dao, "Shared Vault", "ipfs://vault", targetId);

        instance = _deployInstance("probeinstance");

        msgReg = new GlobalMessageRegistry();
        msgReg.initialize(dao, address(registry));
    }

    function _deployInstance(string memory name) internal returns (address) {
        DeactivationScopeInstance inst = new DeactivationScopeInstance();
        inst.initialize(vaultAddr, alice);
        vm.prank(factory);
        registry.registerInstance(address(inst), factory, alice, name, "ipfs://proj", vaultAddr);
        return address(inst);
    }

    function _messageData() internal pure returns (bytes memory) {
        return abi.encode(uint8(0), uint256(0), bytes32(0), bytes32(0), string("gm"));
    }

    /// @dev The invariant: an instance from a deactivated factory keeps its trade-path message call.
    function test_deactivatedFactoryLeavesExistingInstanceTradePathIntact() public {
        vm.prank(instance);
        msgReg.postForAction(user, instance, _messageData());
        assertEq(msgReg.messageCount(), 1, "baseline: message accepted before deactivation");

        vm.prank(dao);
        registry.deactivateFactory(factory);

        assertTrue(
            registry.isInstanceFromApprovedFactory(instance),
            "deactivating a factory must not un-approve instances it already produced"
        );

        vm.prank(instance);
        msgReg.postForAction(user, instance, _messageData());
        assertEq(msgReg.messageCount(), 2, "commented trade path still works after deactivation");
    }

    /// @dev The other half of the scope: deactivation DOES stop new instances.
    function test_deactivatedFactoryCannotRegisterNewInstances() public {
        vm.prank(dao);
        registry.deactivateFactory(factory);

        DeactivationScopeInstance fresh = new DeactivationScopeInstance();
        fresh.initialize(vaultAddr, alice);
        vm.prank(factory);
        vm.expectRevert(MasterRegistryV1.FactoryNotActive.selector);
        registry.registerInstance(address(fresh), factory, alice, "freshinstance", "ipfs://fresh", vaultAddr);
    }

    /// @dev Deactivation is not registration removal — the factory stays registered and enumerable.
    function test_deactivatedFactoryStaysRegistered() public {
        vm.prank(dao);
        registry.deactivateFactory(factory);

        assertTrue(registry.isFactoryRegistered(factory), "deactivation leaves the factory registered");
        assertFalse(registry.getFactoryInfoByAddress(factory).active, "but marks it inactive");
    }
}
