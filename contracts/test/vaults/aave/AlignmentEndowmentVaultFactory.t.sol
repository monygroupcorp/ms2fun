// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { Ownable } from "solady/auth/Ownable.sol";
import { AlignmentEndowmentVaultFactory } from "../../../src/vaults/aave/AlignmentEndowmentVaultFactory.sol";
import { MasterRegistryV1 } from "../../../src/master/MasterRegistryV1.sol";
import { AlignmentRegistryV1 } from "../../../src/master/AlignmentRegistryV1.sol";
import { IAlignmentRegistry } from "../../../src/master/interfaces/IAlignmentRegistry.sol";
import { IMasterRegistry } from "../../../src/master/interfaces/IMasterRegistry.sol";
import { IFactory } from "../../../src/interfaces/IFactory.sol";
import { CREATEX } from "../../../src/shared/CreateXConstants.sol";
import { CREATEX_BYTECODE } from "createx-forge/script/CreateX.d.sol";

// ─── Minimal mocks (deploy-time surface only) ────────────────────────────────
// The vault's initialize() only calls weth.approve(stata, max) and stores stata — nothing on stata
// is called at deploy time. Keep these trivial so the factory's self-register path is what's tested.

/// @dev WETH stand-in: initialize() sets a max approval against the stataToken.
contract MockWETH {
    mapping(address => mapping(address => uint256)) public allowance;

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
}

/// @dev StataToken stand-in — only needs to be a contract (initialize stores it; nothing calls it here).
contract MockStata {
    function asset() external view returns (address) {
        return address(this);
    }
}

/// @title AlignmentEndowmentVaultFactory — permissionless self-registration (noesis-077)
/// @notice Exercises the real MasterRegistryV1 + AlignmentRegistryV1 gate: a non-owner wallet deploys a
///         vault for an approved active target, and the factory self-registers it with an on-chain-derived
///         name + hardcoded metadataURI, crediting the caller. Also covers dedup, target/token gating,
///         and the "factory must be an active IFactory" ordering requirement.
contract AlignmentEndowmentVaultFactoryTest is Test {
    AlignmentEndowmentVaultFactory internal factory;
    MasterRegistryV1 internal registry;
    AlignmentRegistryV1 internal alignmentRegistry;
    MockWETH internal weth;
    MockStata internal stata;

    address internal treasury = makeAddr("treasury");
    address internal creator = makeAddr("creator"); // a non-owner wallet paying its own gas
    address internal alignmentToken = makeAddr("CULT");

    string internal constant TARGET_TITLE = "Remilia";
    string internal constant EXPECTED_NAME = "Remilia Aave Endowment Vault";

    uint256 internal targetId;
    uint256 internal saltNonce;

    function setUp() public {
        vm.etch(CREATEX, CREATEX_BYTECODE);

        weth = new MockWETH();
        stata = new MockStata();

        // Owner is this test contract (no prank needed for owner-gated calls).
        registry = new MasterRegistryV1();
        registry.initialize(address(this));
        alignmentRegistry = new AlignmentRegistryV1(address(weth));
        alignmentRegistry.initialize(address(this));
        registry.setAlignmentRegistry(address(alignmentRegistry));

        targetId = _registerTarget(TARGET_TITLE, alignmentToken);

        factory = new AlignmentEndowmentVaultFactory(
            address(weth), address(stata), treasury, address(registry), IAlignmentRegistry(address(alignmentRegistry))
        );

        _registerFactory(factory);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    function _registerTarget(string memory title, address token) internal returns (uint256 id) {
        IAlignmentRegistry.AlignmentAsset[] memory assets = new IAlignmentRegistry.AlignmentAsset[](1);
        assets[0] = IAlignmentRegistry.AlignmentAsset({ token: token, symbol: "TKN", info: "", metadataURI: "" });
        id = alignmentRegistry.registerAlignmentTarget(title, "desc", "", assets);
    }

    function _registerFactory(AlignmentEndowmentVaultFactory f) internal {
        registry.registerFactory(
            address(f),
            "AAVE",
            "Aave-Endowment-Vault-Factory",
            "Aave Endowment Vault",
            "https://ms2.fun",
            new bytes32[](0),
            address(0)
        );
    }

    function _salt() internal returns (bytes32) {
        return keccak256(abi.encodePacked("salt", saltNonce++));
    }

    // ── IFactory promotion ─────────────────────────────────────────────────────

    function test_isFactory_protocolIsOwner() public view {
        assertEq(factory.protocol(), factory.owner(), "protocol() must be owner()");
        assertTrue(factory.protocol() != address(0), "protocol must be non-zero (registerFactory gate)");
        assertEq(factory.features().length, 0, "features() empty");
        assertEq(factory.requiredFeatures().length, 0, "requiredFeatures() empty");
    }

    // ── Permissionless self-registration ───────────────────────────────────────

    function test_selfRegister_nonOwnerPermissionless() public {
        vm.prank(creator);
        address vault = factory.deployVault(_salt(), alignmentToken, targetId);

        assertTrue(registry.isVaultRegistered(vault), "vault must be registered by the factory self-register");

        IMasterRegistry.VaultInfo memory info = registry.getVaultInfo(vault);
        assertEq(info.name, EXPECTED_NAME, "name must be the on-chain-derived <title> Aave Endowment Vault");
        assertEq(info.creator, creator, "creator must be the deploying wallet (msg.sender)");
        assertEq(info.metadataURI, "https://ms2.fun", "metadataURI must be the factory-hardcoded constant");
        assertEq(info.targetId, targetId, "targetId must be preserved");
    }

    function test_derivedName_matchesTargetTitle() public {
        vm.prank(creator);
        address vault = factory.deployVault(_salt(), alignmentToken, targetId);
        assertEq(
            registry.getVaultInfo(vault).name,
            string.concat(TARGET_TITLE, " Aave Endowment Vault"),
            "derived name must be title + ' Aave Endowment Vault'"
        );
    }

    // ── Dedup ──────────────────────────────────────────────────────────────────

    function test_dedup_secondDeploySameTargetTokenReverts() public {
        vm.prank(creator);
        address vault = factory.deployVault(_salt(), alignmentToken, targetId);
        assertEq(factory.canonicalVault(keccak256(abi.encode(targetId, alignmentToken))), vault, "canonical recorded");

        // A second deploy for the same (targetId, token) — even from a different wallet / salt — reverts.
        vm.prank(makeAddr("otherWallet"));
        vm.expectRevert(AlignmentEndowmentVaultFactory.VaultAlreadyExists.selector);
        factory.deployVault(_salt(), alignmentToken, targetId);
    }

    // ── Target / token gating (bubbles from registry.registerVault) ─────────────

    function test_nonApprovedToken_revertsTokenNotInTarget() public {
        address rogueToken = makeAddr("rogue"); // not registered in the target's assets
        vm.prank(creator);
        vm.expectRevert(MasterRegistryV1.TokenNotInTarget.selector);
        factory.deployVault(_salt(), rogueToken, targetId);
    }

    function test_inactiveTarget_revertsTargetNotActive() public {
        address token2 = makeAddr("token2");
        uint256 target2 = _registerTarget("Cabal", token2);
        alignmentRegistry.deactivateAlignmentTarget(target2);

        vm.prank(creator);
        vm.expectRevert(MasterRegistryV1.TargetNotActive.selector);
        factory.deployVault(_salt(), token2, target2);
    }

    // ── Factory-must-be-active ordering requirement ─────────────────────────────

    function test_unregisteredFactory_revertsUnauthorized() public {
        // A fresh factory that was NEVER registerFactory'd cannot self-register — documents why DeployCore
        // must registerFactory + activate BEFORE the seed loop deploys vaults through it.
        AlignmentEndowmentVaultFactory fresh = new AlignmentEndowmentVaultFactory(
            address(weth), address(stata), treasury, address(registry), IAlignmentRegistry(address(alignmentRegistry))
        );

        vm.prank(creator);
        vm.expectRevert(Ownable.Unauthorized.selector);
        fresh.deployVault(_salt(), alignmentToken, targetId);
    }
}
