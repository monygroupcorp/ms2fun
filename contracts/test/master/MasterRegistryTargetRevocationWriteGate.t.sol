// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { MasterRegistryV1 } from "../../src/master/MasterRegistryV1.sol";
import { AlignmentRegistryV1 } from "../../src/master/AlignmentRegistryV1.sol";
import { IAlignmentRegistry } from "../../src/master/interfaces/IAlignmentRegistry.sol";
import { IMasterRegistry } from "../../src/master/interfaces/IMasterRegistry.sol";

/// Minimal vault double exposing the `alignmentToken()` the registry static-calls at registration.
contract MockVaultSimple {
    address public alignmentToken;

    constructor(address _token) {
        alignmentToken = _token;
    }
}

/// Minimal factory double — only its address/registration matters to the gate.
contract MockFactory {
    address public creator;
    address public protocol;

    constructor(address _creator, address _protocol) {
        creator = _creator;
        protocol = _protocol;
    }
}

/// Minimal instance double exposing the surface `registerInstance` reads (vault / protocolTreasury /
/// instanceType) and able to drive `migrateVault` under its own identity.
contract MockInstance {
    address public vault;
    address public protocolTreasury;
    address private _masterRegistry;

    function initialize(address _vault, address _treasury, address _mr) external {
        vault = _vault;
        protocolTreasury = _treasury;
        _masterRegistry = _mr;
    }

    function instanceType() external pure returns (bytes32) {
        return keccak256("erc1155");
    }

    function migrateVault(address newVault) external {
        IMasterRegistry(_masterRegistry).migrateVault(address(this), newVault);
    }
}

/// @notice noesis-113 Part 1 (MRV1-01 MED + MRV1-02 LOW): the `registerInstance` and `migrateVault`
///         WRITE gates must reject a vault whose alignment target has been revoked — not just the raw
///         two-flag subset (`registeredVaults && active`) that stays true after a target revocation.
///         `registerInstance` is the SOLE vault-legitimacy gate for the ERC1155/721 families
///         (their factories pass `params.vault` straight through with only a code.length check), so a
///         raw-subset gate let a NEW collection bind a de-curated vault and evade curation.
contract MasterRegistryTargetRevocationWriteGateTest is Test {
    MasterRegistryV1 public registry;
    AlignmentRegistryV1 public alignmentRegistry;

    address public daoOwner = makeAddr("dao");
    address public creator = makeAddr("creator");
    address public tokenA = address(0xA11CE);

    function setUp() public {
        registry = new MasterRegistryV1();
        registry.initialize(daoOwner);

        alignmentRegistry = new AlignmentRegistryV1(makeAddr("WETH"));
        alignmentRegistry.initialize(daoOwner);

        vm.prank(daoOwner);
        registry.setAlignmentRegistry(address(alignmentRegistry));
    }

    // ── helpers ──

    function _createTarget(address token) internal returns (uint256 targetId) {
        IAlignmentRegistry.AlignmentAsset[] memory assets = new IAlignmentRegistry.AlignmentAsset[](1);
        assets[0] = IAlignmentRegistry.AlignmentAsset({ token: token, symbol: "SYM", info: "", metadataURI: "" });
        vm.prank(daoOwner);
        targetId = alignmentRegistry.registerAlignmentTarget("Target", "", "", assets);
    }

    function _registerVault(address token, uint256 targetId) internal returns (address vault) {
        vault = address(new MockVaultSimple(token));
        vm.prank(daoOwner);
        registry.registerVault(vault, creator, "Vault", "ipfs://v", targetId);
    }

    function _registerFactory() internal returns (address factory) {
        factory = address(new MockFactory(creator, daoOwner));
        vm.prank(daoOwner);
        registry.registerFactory(
            factory, "ERC1155", "Test", "Test Factory", "ipfs://factory", new bytes32[](0), address(0)
        );
    }

    function _newInstance(address vault) internal returns (MockInstance inst) {
        inst = new MockInstance();
        inst.initialize(vault, creator, address(registry));
    }

    function _register(address factory, MockInstance inst, string memory name) internal {
        address vault = inst.vault(); // read BEFORE prank — a call would consume the prank
        vm.prank(factory);
        registry.registerInstance(address(inst), factory, creator, name, "ipfs://proj", vault);
    }

    // ── Part 1a: registerInstance write-gate ──

    /// Baseline: an ERC1155/721-style instance binds an ACTIVE-target vault and registers.
    function test_RegisterInstance_ActiveTarget_Succeeds() public {
        uint256 targetId = _createTarget(tokenA);
        address vault = _registerVault(tokenA, targetId);
        address factory = _registerFactory();

        _register(factory, _newInstance(vault), "Active");
        assertTrue(registry.isVaultRegistered(vault), "active-target vault registered");
    }

    /// The MED: after the bound target is revoked, a NEW instance binding that same vault must be
    /// rejected — the raw `registeredVaults && active` subset is still true, only the tri-composite flips.
    function test_RegisterInstance_RevokedTarget_Reverts() public {
        uint256 targetId = _createTarget(tokenA);
        address vault = _registerVault(tokenA, targetId);
        address factory = _registerFactory();

        // First bind while active succeeds (the vault is legitimately registered).
        _register(factory, _newInstance(vault), "First");

        // DAO revokes the alignment target (a rug discovered).
        vm.prank(daoOwner);
        alignmentRegistry.deactivateAlignmentTarget(targetId);

        // Raw subset is still true; the write-gate must now reject on the target-active leg.
        assertTrue(registry.registeredVaults(vault), "raw registeredVaults still true");
        assertTrue(registry.getVaultInfo(vault).active, "raw vaultInfo.active still true");

        MockInstance rogue = _newInstance(vault);
        vm.prank(factory);
        vm.expectRevert(MasterRegistryV1.UnregisteredVault.selector);
        registry.registerInstance(address(rogue), factory, creator, "Rogue", "ipfs://proj", vault);
    }

    /// Regression: revoking one target does not block a bind onto an unrelated, still-active-target vault.
    function test_RegisterInstance_UnrelatedActiveTarget_StillBinds() public {
        uint256 targetA = _createTarget(tokenA);
        address vaultA = _registerVault(tokenA, targetA);
        uint256 targetB = _createTarget(address(0xB0B));
        address vaultB = _registerVault(address(0xB0B), targetB);
        address factory = _registerFactory();

        vm.prank(daoOwner);
        alignmentRegistry.deactivateAlignmentTarget(targetA);

        // A: revoked → blocked.
        MockInstance a = _newInstance(vaultA);
        vm.prank(factory);
        vm.expectRevert(MasterRegistryV1.UnregisteredVault.selector);
        registry.registerInstance(address(a), factory, creator, "A", "ipfs://proj", vaultA);

        // B: unrelated active target → still binds.
        _register(factory, _newInstance(vaultB), "B");
        assertTrue(registry.isVaultRegistered(vaultB), "unrelated active-target vault still bindable");
    }

    // ── Part 1b: migrateVault write-gate (MRV1-02 predicate consistency) ──

    /// migrateVault must use the same tri-composite: migrating onto a vault whose target is revoked
    /// reverts (`FactoryNotActive`, the migrate gate's selector), even though its raw subset stays true.
    function test_MigrateVault_RevokedTarget_Reverts() public {
        uint256 targetId = _createTarget(tokenA);
        address vault1 = _registerVault(tokenA, targetId);
        address factory = _registerFactory();

        MockInstance inst = _newInstance(vault1);
        _register(factory, inst, "Proj");

        // A second vault on the SAME target (so the genesis-targetId match would otherwise pass).
        address vault2 = _registerVault(tokenA, targetId);

        // Revoke the shared target.
        vm.prank(daoOwner);
        alignmentRegistry.deactivateAlignmentTarget(targetId);
        assertTrue(registry.registeredVaults(vault2), "raw registeredVaults still true for vault2");

        vm.expectRevert(MasterRegistryV1.FactoryNotActive.selector);
        inst.migrateVault(vault2);
    }

    /// Regression: migrating onto an active-target vault still works.
    function test_MigrateVault_ActiveTarget_Succeeds() public {
        uint256 targetId = _createTarget(tokenA);
        address vault1 = _registerVault(tokenA, targetId);
        address factory = _registerFactory();

        MockInstance inst = _newInstance(vault1);
        _register(factory, inst, "Proj");

        address vault2 = _registerVault(tokenA, targetId);
        inst.migrateVault(vault2);

        address[] memory vaults = registry.getInstanceVaults(address(inst));
        assertEq(vaults.length, 2, "migrate appended");
        assertEq(vaults[1], vault2, "active-target migrate succeeded");
    }
}
