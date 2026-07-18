// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { MasterRegistryV1 } from "../../src/master/MasterRegistryV1.sol";
import { AlignmentRegistryV1 } from "../../src/master/AlignmentRegistryV1.sol";
import { IMasterRegistry } from "../../src/master/interfaces/IMasterRegistry.sol";
import { IAlignmentRegistry } from "../../src/master/interfaces/IAlignmentRegistry.sol";
import { MetadataUtils } from "../../src/shared/libraries/MetadataUtils.sol";

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

/// @notice Coverage for the name→instance reverse index (`resolveName` / `instanceByNameHash`),
///         added for chain-scoped slug routing. Locks in the deliberate design choices from the
///         spec: case-insensitive resolution, revocation-independent resolution, and the invariant
///         that `nameHashes` and `instanceByNameHash` never disagree.
contract MasterRegistryResolveNameTest is Test {
    MasterRegistryV1 public registry;
    AlignmentRegistryV1 public alignmentRegistry;

    address public daoOwner = makeAddr("dao");
    address public alice = makeAddr("alice");
    address public dummyToken = address(0x1234);

    address internal factory;
    address internal sharedVault;

    function setUp() public {
        MasterRegistryV1 impl = new MasterRegistryV1();
        registry = MasterRegistryV1(LibClone.deployERC1967(address(impl)));
        registry.initialize(daoOwner);

        alignmentRegistry = new AlignmentRegistryV1(makeAddr("WETH"));
        alignmentRegistry.initialize(daoOwner);

        vm.prank(daoOwner);
        registry.setAlignmentRegistry(address(alignmentRegistry));

        // One factory + one vault, reused by every instance in these tests.
        factory = address(new MockFactory(alice, daoOwner));
        vm.prank(daoOwner);
        registry.registerFactory(
            factory, "ERC404", "Test", "Test Factory", "ipfs://factory", new bytes32[](0), address(0)
        );

        sharedVault = address(new MockVaultSimple(dummyToken));
    }

    function _register(string memory name) internal returns (address instance) {
        MockInstance inst = new MockInstance();
        inst.initialize(sharedVault, alice);
        vm.prank(factory);
        registry.registerInstance(address(inst), factory, alice, name, "ipfs://proj", sharedVault);
        return address(inst);
    }

    // ── resolveName basics ──────────────────────────────────────────────────────

    function test_ResolveName_ReturnsInstanceForRegisteredName() public {
        address instance = _register("Milady");
        assertEq(registry.resolveName("Milady"), instance);
        // public getter mirrors resolveName
        assertEq(registry.instanceByNameHash(MetadataUtils.toNameHash("Milady")), instance);
    }

    function test_ResolveName_ReturnsZeroForUnknownName() public view {
        assertEq(registry.resolveName("does-not-exist"), address(0));
    }

    // ── Case-insensitivity ──────────────────────────────────────────────────────

    function test_ResolveName_CaseInsensitive() public {
        address instance = _register("Milady");
        assertEq(registry.resolveName("milady"), instance, "lowercase must resolve");
        assertEq(registry.resolveName("MILADY"), instance, "uppercase must resolve");
        assertEq(registry.resolveName("MiLaDy"), instance, "mixed case must resolve");
    }

    function test_RegisterInstance_RevertsOnCaseVariantReRegistration() public {
        _register("Milady");

        MockInstance dup = new MockInstance();
        dup.initialize(sharedVault, alice);
        vm.prank(factory);
        vm.expectRevert(MasterRegistryV1.NameAlreadyTaken.selector);
        registry.registerInstance(address(dup), factory, alice, "milady", "ipfs://dup", sharedVault);
    }

    // ── Revocation independence (locked decision 2) ─────────────────────────────

    function test_ResolveName_RevokedInstanceStillResolves() public {
        address instance = _register("Milady");

        vm.prank(daoOwner);
        registry.revokeInstance(instance);

        // Sanity: revocation took effect for display.
        assertTrue(registry.revokedInstances(instance));
        vm.expectRevert(MasterRegistryV1.NotRegistered.selector);
        registry.getInstanceInfo(instance);

        // Chosen behavior: the name still resolves so the slug stays reserved.
        assertEq(registry.resolveName("Milady"), instance, "revoked instance must still resolve by name");
        // And the name stays taken — a squatter cannot re-register it.
        MockInstance squatter = new MockInstance();
        squatter.initialize(sharedVault, alice);
        vm.prank(factory);
        vm.expectRevert(MasterRegistryV1.NameAlreadyTaken.selector);
        registry.registerInstance(address(squatter), factory, alice, "Milady", "ipfs://squat", sharedVault);
    }

    // ── Upgrade preserves reads (storage-append safety) ─────────────────────────

    function test_Upgrade_PreservesInstanceReadsAndResolveName() public {
        address a = _register("Alpha");
        address b = _register("Bravo");

        IMasterRegistry.InstanceInfo memory aBefore = registry.getInstanceInfo(a);
        IMasterRegistry.InstanceInfo memory bBefore = registry.getInstanceInfo(b);

        address newImpl = address(new MasterRegistryV1());
        vm.prank(daoOwner);
        registry.upgradeToAndCall(newImpl, "");

        // Every prior instance read is byte-identical after the upgrade.
        IMasterRegistry.InstanceInfo memory aAfter = registry.getInstanceInfo(a);
        assertEq(aAfter.instance, aBefore.instance);
        assertEq(aAfter.factory, aBefore.factory);
        assertEq(aAfter.creator, aBefore.creator);
        assertEq(aAfter.name, aBefore.name);
        assertEq(aAfter.metadataURI, aBefore.metadataURI);
        assertEq(aAfter.nameHash, aBefore.nameHash);
        assertEq(aAfter.registeredAt, aBefore.registeredAt);

        IMasterRegistry.InstanceInfo memory bAfter = registry.getInstanceInfo(b);
        assertEq(bAfter.nameHash, bBefore.nameHash);
        assertEq(bAfter.registeredAt, bBefore.registeredAt);

        // The reverse index survives the upgrade too.
        assertEq(registry.resolveName("Alpha"), a);
        assertEq(registry.resolveName("Bravo"), b);
    }

    // ── Invariant: nameHashes and instanceByNameHash never disagree ─────────────

    function testFuzz_NameHashesAndReverseIndexNeverDisagree(uint8 n) public {
        uint256 count = bound(uint256(n), 1, 12);

        address[] memory instances = new address[](12);
        for (uint256 i = 0; i < count; i++) {
            string memory name = string(abi.encodePacked("col", vm.toString(i)));
            instances[i] = _register(name);
        }

        // For every registered name, both indexes agree and point at the same instance.
        for (uint256 i = 0; i < count; i++) {
            string memory name = string(abi.encodePacked("col", vm.toString(i)));
            bytes32 h = MetadataUtils.toNameHash(name);
            assertTrue(registry.nameHashes(h), "registered name must be in nameHashes set");
            assertEq(registry.instanceByNameHash(h), instances[i], "reverse index must point at instance");
            // The core invariant: set membership <=> non-zero reverse entry.
            assertEq(registry.nameHashes(h), registry.instanceByNameHash(h) != address(0));
            assertEq(registry.resolveName(name), instances[i]);
        }

        // An un-registered name violates neither index.
        bytes32 unknown = MetadataUtils.toNameHash("never-registered-name");
        assertFalse(registry.nameHashes(unknown));
        assertEq(registry.instanceByNameHash(unknown), address(0));
        assertEq(registry.nameHashes(unknown), registry.instanceByNameHash(unknown) != address(0));
        assertEq(registry.resolveName("never-registered-name"), address(0));
    }
}
