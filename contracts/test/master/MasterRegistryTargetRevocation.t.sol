// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { MasterRegistryV1 } from "../../src/master/MasterRegistryV1.sol";
import { AlignmentRegistryV1 } from "../../src/master/AlignmentRegistryV1.sol";
import { IAlignmentRegistry } from "../../src/master/interfaces/IAlignmentRegistry.sol";
import { IMasterRegistry } from "../../src/master/interfaces/IMasterRegistry.sol";

/// Minimal vault double exposing the `alignmentToken()` the registry static-calls.
contract MockVaultSimple {
    address public alignmentToken;

    constructor(address _token) {
        alignmentToken = _token;
    }
}

/// @notice Regression suite for noesis-109: revoking an alignment target must propagate to the
///         vault-registration read, so a vault bound to a now-revoked target immediately reports
///         unregistered — cascading to the ERC404 create-time vault gate — WITHOUT mutating the
///         vault's own `active` flag.
contract MasterRegistryTargetRevocationTest is Test {
    MasterRegistryV1 public registry;
    AlignmentRegistryV1 public alignmentRegistry;

    address public daoOwner = makeAddr("dao");
    address public creator = makeAddr("creator");
    address public tokenA = address(0xA11CE);
    address public tokenB = address(0xB0B);

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

    // ── tests ──

    /// A vault bound to an active target is registered.
    function test_ActiveTarget_VaultRegistered() public {
        uint256 targetId = _createTarget(tokenA);
        address vault = _registerVault(tokenA, targetId);

        assertTrue(registry.isVaultRegistered(vault), "vault should be registered under active target");
        assertTrue(alignmentRegistry.isAlignmentTargetActive(targetId), "target active precondition");
    }

    /// Deactivating the bound target flips the vault to unregistered via the composite read.
    function test_TargetRevocation_FlipsVaultUnregistered() public {
        uint256 targetId = _createTarget(tokenA);
        address vault = _registerVault(tokenA, targetId);
        assertTrue(registry.isVaultRegistered(vault));

        vm.prank(daoOwner);
        alignmentRegistry.deactivateAlignmentTarget(targetId);

        assertFalse(registry.isVaultRegistered(vault), "revoked-target vault must report unregistered");
    }

    /// The propagation is a gate, not a mutation: the vault's own state is untouched.
    function test_TargetRevocation_DoesNotMutateVaultState() public {
        uint256 targetId = _createTarget(tokenA);
        address vault = _registerVault(tokenA, targetId);

        vm.prank(daoOwner);
        alignmentRegistry.deactivateAlignmentTarget(targetId);

        // registeredVaults + vaultInfo.active remain true — only the composite read flips.
        assertTrue(registry.registeredVaults(vault), "registeredVaults flag untouched");
        assertTrue(registry.getVaultInfo(vault).active, "vaultInfo.active flag untouched (gated, not mutated)");
        assertEq(registry.getVaultInfo(vault).targetId, targetId, "targetId preserved");
    }

    /// The ERC404 create-time bind gate reads exactly `isVaultRegistered`; a revoked-target vault
    /// therefore can no longer be bound by a new instance. This asserts the signal that
    /// `ERC404Factory` reverts on (`UnapprovedVault`) has flipped.
    function test_TargetRevocation_BlocksNewErc404Bind() public {
        uint256 targetId = _createTarget(tokenA);
        address vault = _registerVault(tokenA, targetId);
        assertTrue(registry.isVaultRegistered(vault), "bindable before revocation");

        vm.prank(daoOwner);
        alignmentRegistry.deactivateAlignmentTarget(targetId);

        // ERC404Factory: `if (!masterRegistry.isVaultRegistered(params.vault)) revert UnapprovedVault();`
        assertFalse(registry.isVaultRegistered(vault), "new ERC404 bind gate must now reject this vault");
    }

    /// Revoking one target does not disturb an unrelated, still-active target's vault.
    function test_TargetRevocation_IsolatedToBoundTarget() public {
        uint256 targetA = _createTarget(tokenA);
        uint256 targetB = _createTarget(tokenB);
        address vaultA = _registerVault(tokenA, targetA);
        address vaultB = _registerVault(tokenB, targetB);

        vm.prank(daoOwner);
        alignmentRegistry.deactivateAlignmentTarget(targetA);

        assertFalse(registry.isVaultRegistered(vaultA), "revoked-target vault unregistered");
        assertTrue(registry.isVaultRegistered(vaultB), "unrelated active-target vault still registered");
    }

    /// Full normal-path regression: register under active target, stays registered while active.
    function test_ActiveTarget_NormalPathRegression() public {
        uint256 targetId = _createTarget(tokenA);
        address vault = _registerVault(tokenA, targetId);

        assertTrue(registry.isVaultRegistered(vault));
        // A second, independent vault on the same active target also registers/reads normally.
        address vault2 = _registerVault(tokenA, targetId);
        assertTrue(registry.isVaultRegistered(vault2), "second vault on active target registers normally");
    }
}
