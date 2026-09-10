// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { Ownable } from "solady/auth/Ownable.sol";
import { Currency } from "v4-core/types/Currency.sol";

import { AlignmentEndowmentVault } from "../../../src/vaults/aave/AlignmentEndowmentVault.sol";
import { AlignmentEndowmentVaultFactory } from "../../../src/vaults/aave/AlignmentEndowmentVaultFactory.sol";
import { AlignmentRegistryV1 } from "../../../src/master/AlignmentRegistryV1.sol";
import { IAlignmentRegistry } from "../../../src/master/interfaces/IAlignmentRegistry.sol";

import { MockWETH, MockStataToken, MockMasterRegistry, MockOwnable } from "./AlignmentEndowmentVault.t.sol";

/// @notice A community rotates its own payout, and the endowment vault follows it.
///
/// @dev    `AlignmentRegistryV1` pins a target's payout once and lets only the address currently
///         receiving it move that payout on. That capability is worth exactly as much as the vaults
///         honour it, and the Aave endowment vault used to not: it kept an owner-writable copy of the
///         sink, consulted whenever the registry's answer was zero, and the factory that owns every
///         clone kept an `onlyOwner` setter pointed at that copy. Since pinning the registry's payout is
///         itself `onlyOwner`, an owner who simply never pinned one kept a sink they could re-point at
///         will — over a community that had no pinned payout to rotate and no way to pin one itself.
///
///         This suite runs the whole path against the REAL registry, the REAL vault and the REAL factory,
///         because the defect lived in the seam between them and no mock has that seam. It goes red if
///         the vault regains a sink of its own, if the factory regains a way to write one, or if
///         `_targetSink()` stops reading the registry live.
contract AlignmentEndowmentPayoutRotationTest is Test {
    AlignmentRegistryV1 internal registry;
    AlignmentEndowmentVaultFactory internal factory;
    AlignmentEndowmentVault internal vault;
    MockWETH internal weth;
    MockStataToken internal stata;
    MockMasterRegistry internal masterRegistry;
    MockOwnable internal benefactor;

    address internal protocolOwner = makeAddr("protocolOwner");
    address internal treasury = makeAddr("treasury");
    address internal alignmentToken = makeAddr("alignmentToken");
    address internal alice = makeAddr("alice");

    address internal communityMultisig = makeAddr("communityMultisig");
    address internal communityNewMultisig = makeAddr("communityNewMultisig");
    address internal attackerSink = makeAddr("attackerSink");

    uint256 internal targetId;

    uint256 constant ONE_ETH = 1 ether;
    Currency internal nativeCurrency = Currency.wrap(address(0));

    function setUp() public {
        weth = new MockWETH();
        stata = new MockStataToken(address(weth));
        masterRegistry = new MockMasterRegistry();

        registry = new AlignmentRegistryV1(address(weth));
        registry.initialize(protocolOwner);
        masterRegistry.setAlignmentRegistry(address(registry));

        IAlignmentRegistry.AlignmentAsset[] memory assets = new IAlignmentRegistry.AlignmentAsset[](1);
        assets[0] =
            IAlignmentRegistry.AlignmentAsset({ token: alignmentToken, symbol: "ALGN", info: "", metadataURI: "" });
        vm.prank(protocolOwner);
        targetId = registry.registerAlignmentTarget("Remilia", "", "", assets);

        vm.prank(protocolOwner);
        factory = new AlignmentEndowmentVaultFactory(
            address(weth), address(stata), treasury, address(masterRegistry), IAlignmentRegistry(address(registry))
        );

        vault = _deployVault();
        benefactor = new MockOwnable(alice);

        vm.deal(alice, 100 ether);
        vm.deal(address(this), 100 ether);
        vm.warp(1_000_000);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// @dev A clone wired exactly as the factory wires one, minus the CREATE3/roster machinery this suite
    ///      does not exercise. Owned by the FACTORY, as `deployVault` owns them — that ownership is what
    ///      used to make the factory's setter a redirect, so a test that owned this clone by an EOA would
    ///      pass for the wrong reason. Note what `initialize` no longer takes: a payout.
    function _deployVault() internal returns (AlignmentEndowmentVault v) {
        v = AlignmentEndowmentVault(payable(LibClone.clone(factory.vaultImplementation())));
        v.initialize(
            address(factory), address(weth), address(stata), treasury, address(masterRegistry), alignmentToken, targetId
        );
    }

    function _contribute(uint256 amount) internal {
        vm.prank(alice);
        vault.receiveContribution{ value: amount }(nativeCurrency, amount, address(benefactor));
    }

    function _simulateYield(uint256 extra) internal {
        vm.deal(address(weth), address(weth).balance + extra);
        weth.mint(address(this), extra);
        weth.approve(address(stata), extra);
        stata.simulateYield(extra);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // The clause this suite exists for
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev End to end: the owner pins the payout once, the community rotates it with its own key, and a
    ///      harvest through the vault pays the address the community rotated TO. The registry-only test
    ///      of `rotateCommunityPayout` cannot see this leg — it proves the mapping moved, not that a
    ///      single wei followed it.
    function test_communityRotatesItsPayout_andTheVaultPaysTheNewSink() public {
        vm.prank(protocolOwner);
        registry.setCommunityPayout(targetId, communityMultisig);

        // The community changes multisig and moves its own payout. Nobody moves it for them.
        vm.prank(communityMultisig);
        registry.rotateCommunityPayout(targetId, communityNewMultisig);

        _contribute(ONE_ETH);
        _simulateYield(0.1 ether);

        uint256 oldBefore = communityMultisig.balance;
        uint256 newBefore = communityNewMultisig.balance;
        vault.harvest(); // escrowed class → 0.08 creator / 0.019 target / 0.001 protocol

        assertEq(communityNewMultisig.balance - newBefore, 0.019 ether, "the rotated-to sink was paid");
        assertEq(communityMultisig.balance, oldBefore, "the rotated-from sink was not");
        assertEq(vault.accumulatedTargetFees(), 0, "and nothing was stranded");
    }

    /// @dev A rotation mid-life reaches a vault that was already deployed and already accruing. Were the
    ///      sink resolved once and cached, this is the case that would keep force-sending to an address
    ///      the community had already moved off, with nothing to claw back and no revert to notice.
    function test_rotationMidLifeRedirectsTheNextHarvest() public {
        vm.prank(protocolOwner);
        registry.setCommunityPayout(targetId, communityMultisig);

        _contribute(ONE_ETH);
        _simulateYield(0.1 ether);
        vault.harvest();
        assertEq(communityMultisig.balance, 0.019 ether, "first harvest paid the original sink");

        vm.prank(communityMultisig);
        registry.rotateCommunityPayout(targetId, communityNewMultisig);

        _simulateYield(0.1 ether);
        vault.harvest();

        assertEq(communityNewMultisig.balance, 0.019 ether, "second harvest followed the rotation");
        assertEq(communityMultisig.balance, 0.019 ether, "the old sink got nothing further");
    }

    /// @dev The accrued leg follows the registry too. A vault that harvested before any payout existed
    ///      holds the target leg in `accumulatedTargetFees`; the community that later gets pinned and
    ///      rotates is the one that collects it, in full.
    function test_accruedLegFollowsAPinThenARotation() public {
        _contribute(ONE_ETH);
        _simulateYield(0.1 ether);
        vault.harvest();
        assertEq(vault.accumulatedTargetFees(), 0.019 ether, "accrued while no sink existed");

        vm.expectRevert(AlignmentEndowmentVault.CommunityPayoutNotSet.selector);
        vault.flushTargetFees();

        vm.prank(protocolOwner);
        registry.setCommunityPayout(targetId, communityMultisig);
        vm.prank(communityMultisig);
        registry.rotateCommunityPayout(targetId, communityNewMultisig);

        assertEq(vault.flushTargetFees(), 0.019 ether, "the whole accrued leg is delivered");
        assertEq(communityNewMultisig.balance, 0.019 ether, "to the address the community rotated to");
        assertEq(communityMultisig.balance, 0, "never to the one it rotated off");
    }

    /// @dev THE hold, stated as a test. The protocol owner holds every key there is — registry owner,
    ///      factory owner, and through the factory the vault's owner — and still cannot point one wei of
    ///      the target leg anywhere. Every route the old code offered is tried here by selector, so this
    ///      goes red the moment any of them comes back.
    function test_ownerHoldingEveryKeyCannotRedirectTheTargetLeg() public {
        vm.prank(protocolOwner);
        registry.setCommunityPayout(targetId, communityMultisig);

        vm.startPrank(protocolOwner);

        // 1. The registry's pin is write-once.
        vm.expectRevert(AlignmentRegistryV1.CommunityPayoutAlreadySet.selector);
        registry.setCommunityPayout(targetId, attackerSink);

        // 2. Rotation answers to the sink, and the owner is not it.
        vm.expectRevert(Ownable.Unauthorized.selector);
        registry.rotateCommunityPayout(targetId, attackerSink);

        // 3. The factory no longer forwards a sink write to the vaults it owns.
        (bool ok,) = address(factory)
            .call(abi.encodeWithSignature("setVaultCommunityPayout(address,address)", address(vault), attackerSink));
        assertFalse(ok, "the factory has no vault-payout setter");

        // 4. Nor does the vault itself, to the factory or to anyone. Asserted by selector against the
        //    deployed bytecode: what matters is what a held key can send, not what this file can name.
        (ok,) = address(vault).call(abi.encodeWithSignature("setCommunityPayout(address)", attackerSink));
        assertFalse(ok, "the vault has no sink setter");
        (ok,) = address(vault).call(abi.encodeWithSignature("communityPayout()"));
        assertFalse(ok, "and no stored sink to read");

        vm.stopPrank();

        // And the money proves it: a harvest after all four attempts still pays the community.
        _contribute(ONE_ETH);
        _simulateYield(0.1 ether);
        vault.harvest();

        assertEq(communityMultisig.balance, 0.019 ether, "the community was paid");
        assertEq(attackerSink.balance, 0, "the owner's chosen address got nothing");
        assertEq(registry.getCommunityPayout(targetId), communityMultisig, "and the pin never moved");
    }

    /// @dev The owner cannot get the lever back by withholding the pin either — that was the shape of the
    ///      original defect. With no payout pinned there is no fallback for them to write and aim: the
    ///      target leg simply waits in the vault until a community sink exists.
    function test_withholdingThePinYieldsNoFallbackToAim() public {
        assertEq(registry.getCommunityPayout(targetId), address(0), "nothing pinned");

        vm.startPrank(protocolOwner);
        (bool ok,) = address(factory)
            .call(abi.encodeWithSignature("setVaultCommunityPayout(address,address)", address(vault), attackerSink));
        assertFalse(ok);
        (ok,) = address(vault).call(abi.encodeWithSignature("setCommunityPayout(address)", attackerSink));
        assertFalse(ok);
        vm.stopPrank();

        _contribute(ONE_ETH);
        _simulateYield(0.1 ether);
        vault.harvest();

        assertEq(attackerSink.balance, 0, "no sink to aim, so nothing was aimed");
        assertEq(vault.accumulatedTargetFees(), 0.019 ether, "the leg waits for a community instead");
    }

    /// @dev De-curation is not a way to freeze a community out of its own sink: the target leg keeps
    ///      resolving, and the community can still rotate after the protocol has walked away.
    function test_rotationStillReachesTheVaultAfterDecuration() public {
        vm.prank(protocolOwner);
        registry.setCommunityPayout(targetId, communityMultisig);

        _contribute(ONE_ETH);
        _simulateYield(0.1 ether);
        vault.harvest();

        vm.prank(protocolOwner);
        registry.deactivateAlignmentTarget(targetId);

        vm.prank(communityMultisig);
        registry.rotateCommunityPayout(targetId, communityNewMultisig);

        _simulateYield(0.1 ether);
        vault.harvest();

        assertEq(communityNewMultisig.balance, 0.019 ether, "a de-curated community still moves its own sink");
    }
}
