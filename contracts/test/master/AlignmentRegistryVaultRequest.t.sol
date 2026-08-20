// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { AlignmentRegistryV1 } from "../../src/master/AlignmentRegistryV1.sol";
import { IAlignmentRegistry } from "../../src/master/interfaces/IAlignmentRegistry.sol";

/// @notice noesis-367 — `requestVault`: the permissionless ASK that pairs with owner-only vault deployment.
///         The wizard no longer deploys a vault from the visitor's wallet; it emits a request the owner
///         fulfils by deploying a curated vault through the (owner-gated) factories.
contract AlignmentRegistryVaultRequestTest is Test {
    AlignmentRegistryV1 public registry;

    address public daoOwner = makeAddr("dao");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public memberToken = makeAddr("MEMBER");
    address public strangerToken = makeAddr("STRANGER");

    event VaultRequested(uint256 indexed targetId, address indexed token, address indexed requester);

    function setUp() public {
        AlignmentRegistryV1 impl = new AlignmentRegistryV1(makeAddr("WETH"));
        address proxy = LibClone.deployERC1967(address(impl));
        registry = AlignmentRegistryV1(proxy);
        registry.initialize(daoOwner);
    }

    function _registerTarget() internal returns (uint256) {
        IAlignmentRegistry.AlignmentAsset[] memory assets = new IAlignmentRegistry.AlignmentAsset[](1);
        assets[0] =
            IAlignmentRegistry.AlignmentAsset({ token: memberToken, symbol: "MEMBER", info: "", metadataURI: "" });
        vm.prank(daoOwner);
        return registry.registerAlignmentTarget("Community", "", "", assets);
    }

    // ── happy path ─────────────────────────────────────────────────────────────

    /// An active target + a member token emits the request with all three fields intact.
    function test_RequestVault_EmitsWithTargetTokenAndRequester() public {
        uint256 targetId = _registerTarget();

        vm.expectEmit(true, true, true, true);
        emit VaultRequested(targetId, memberToken, alice);
        vm.prank(alice);
        registry.requestVault(targetId, memberToken);
    }

    /// The point of the surface: ANYONE may ask. This asserts the success, so a later "hardening" to
    /// `onlyOwner` reds here rather than silently removing the feature.
    function test_RequestVault_NonOwnerCanRequest() public {
        uint256 targetId = _registerTarget();

        assertTrue(alice != registry.owner(), "fixture must request as a non-owner");

        vm.expectEmit(true, true, true, true);
        emit VaultRequested(targetId, memberToken, alice);
        vm.prank(alice);
        registry.requestVault(targetId, memberToken);
    }

    /// No dedup and no storage: repeat asks are allowed and each emits. The owner filters the feed.
    function test_RequestVault_DuplicateRequestsAreAllowed() public {
        uint256 targetId = _registerTarget();

        vm.prank(alice);
        registry.requestVault(targetId, memberToken);

        vm.expectEmit(true, true, true, true);
        emit VaultRequested(targetId, memberToken, bob);
        vm.prank(bob);
        registry.requestVault(targetId, memberToken);

        vm.expectEmit(true, true, true, true);
        emit VaultRequested(targetId, memberToken, alice);
        vm.prank(alice);
        registry.requestVault(targetId, memberToken);
    }

    // ── validation ─────────────────────────────────────────────────────────────

    /// A deactivated target takes no more requests.
    function test_RequestVault_RevertsForInactiveTarget() public {
        uint256 targetId = _registerTarget();

        vm.prank(daoOwner);
        registry.deactivateAlignmentTarget(targetId);

        vm.expectRevert(AlignmentRegistryV1.TargetNotFound.selector);
        vm.prank(alice);
        registry.requestVault(targetId, memberToken);
    }

    /// A target id that was never registered is inactive by the same check.
    function test_RequestVault_RevertsForUnknownTarget() public {
        vm.expectRevert(AlignmentRegistryV1.TargetNotFound.selector);
        vm.prank(alice);
        registry.requestVault(999, memberToken);
    }

    /// The ask is (target, token) and the token must belong to the target — an arbitrary token is refused.
    function test_RequestVault_RevertsForTokenNotInTarget() public {
        uint256 targetId = _registerTarget();

        vm.expectRevert(AlignmentRegistryV1.TokenNotInTarget.selector);
        vm.prank(alice);
        registry.requestVault(targetId, strangerToken);
    }

    /// The zero address is not a member token either; it takes the same membership path, not a special case.
    function test_RequestVault_RevertsForZeroToken() public {
        uint256 targetId = _registerTarget();

        vm.expectRevert(AlignmentRegistryV1.TokenNotInTarget.selector);
        vm.prank(alice);
        registry.requestVault(targetId, address(0));
    }

    // ── the request grants nothing ─────────────────────────────────────────────

    /// A request is informational: it must not register a vault, appoint an ambassador, or move any
    /// curated configuration. Read the owner-curated surfaces back after a request and assert they are
    /// untouched — this is what keeps `requestVault` an ASK rather than a write path.
    function test_RequestVault_DoesNotMutateCuratedState() public {
        uint256 targetId = _registerTarget();
        uint256 idBefore = registry.nextAlignmentTargetId();

        vm.prank(alice);
        registry.requestVault(targetId, memberToken);

        assertEq(registry.nextAlignmentTargetId(), idBefore, "request must not create a target");
        assertEq(registry.getCommunityPayout(targetId), address(0), "request must not set a payout");
        assertEq(registry.getAmbassadors(targetId).length, 0, "request must not appoint an ambassador");
        assertEq(
            uint256(registry.getAcquireRoute(targetId, memberToken).venue),
            uint256(IAlignmentRegistry.Venue.NONE),
            "request must not set a route"
        );
        assertEq(
            registry.getReferencePool(targetId, memberToken).pool, address(0), "request must not pin a reference pool"
        );
        assertTrue(registry.isAlignmentTargetActive(targetId), "request must not change target activity");
    }
}
