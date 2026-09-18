// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { CurationRegistry } from "../../src/registry/CurationRegistry.sol";
import { ICurationRegistry } from "../../src/registry/interfaces/ICurationRegistry.sol";

contract CurationRegistryTest is Test {
    CurationRegistry public registry;

    address public alice = address(0xAAAA);
    address public bob = address(0xBBBB);
    address public carol = address(0xCCCC);

    string internal constant URI_A = "ipfs://QmCurationA";
    string internal constant URI_B = "ipfs://QmCurationB";

    function setUp() public {
        registry = new CurationRegistry();
    }

    // ── publishing is open to anyone ───────────────────────────────────────────

    /// The clause the contract exists for: no value, no instance, no badge, no allowlist.
    function test_createCuration_isOpenToAnyAddressAndCostsNothing() public {
        address stranger = address(0xD00D);
        assertEq(stranger.balance, 0, "collector funds nothing");

        vm.prank(stranger);
        uint256 id = registry.createCuration(URI_A);

        assertEq(id, 1);
        assertEq(registry.getCuration(id).curator, stranger);
        assertEq(stranger.balance, 0);
    }

    function test_createCuration_storesRecordAndEmits() public {
        vm.expectEmit(true, true, false, true);
        emit ICurationRegistry.CurationCreated(1, alice, URI_A);

        vm.warp(1_700_000_000);
        vm.prank(alice);
        uint256 id = registry.createCuration(URI_A);

        ICurationRegistry.Curation memory c = registry.getCuration(id);
        assertEq(c.curator, alice);
        assertEq(c.uri, URI_A);
        assertEq(c.updatedAt, 1_700_000_000);
        assertFalse(c.retired);
        assertEq(registry.totalCurations(), 1);
    }

    function test_createCuration_idsAreDenseAndOneBased() public {
        vm.prank(alice);
        assertEq(registry.createCuration(URI_A), 1);
        vm.prank(bob);
        assertEq(registry.createCuration(URI_B), 2);
        vm.prank(alice);
        assertEq(registry.createCuration(URI_A), 3);
        assertEq(registry.totalCurations(), 3);
    }

    function test_createCuration_rejectsDisallowedUriScheme() public {
        vm.prank(alice);
        vm.expectRevert(CurationRegistry.InvalidURI.selector);
        registry.createCuration("data:text/html,<script>alert(1)</script>");

        vm.prank(alice);
        vm.expectRevert(CurationRegistry.InvalidURI.selector);
        registry.createCuration("");
    }

    function test_createCuration_acceptsInlineJsonDataUri() public {
        vm.prank(alice);
        uint256 id = registry.createCuration('data:application/json,{"name":"Blues"}');
        assertEq(registry.getCuration(id).curator, alice);
    }

    // ── editing ────────────────────────────────────────────────────────────────

    function test_setCurationURI_curatorRepointsAndEmits() public {
        vm.prank(alice);
        uint256 id = registry.createCuration(URI_A);

        vm.warp(block.timestamp + 1 days);
        vm.expectEmit(true, true, false, true);
        emit ICurationRegistry.CurationUpdated(id, alice, URI_B);

        vm.prank(alice);
        registry.setCurationURI(id, URI_B);

        ICurationRegistry.Curation memory c = registry.getCuration(id);
        assertEq(c.uri, URI_B);
        assertEq(c.updatedAt, uint64(block.timestamp));
    }

    function test_setCurationURI_strangerCannot() public {
        vm.prank(alice);
        uint256 id = registry.createCuration(URI_A);

        vm.prank(bob);
        vm.expectRevert(CurationRegistry.NotEditor.selector);
        registry.setCurationURI(id, URI_B);

        assertEq(registry.getCuration(id).uri, URI_A);
    }

    function test_setCurationURI_rejectsDisallowedUriScheme() public {
        vm.prank(alice);
        uint256 id = registry.createCuration(URI_A);

        vm.prank(alice);
        vm.expectRevert(CurationRegistry.InvalidURI.selector);
        registry.setCurationURI(id, "http://example.com/c.json");
    }

    // ── collaborators ──────────────────────────────────────────────────────────

    function test_setCollaborator_grantsEditThenRevokes() public {
        vm.prank(alice);
        uint256 id = registry.createCuration(URI_A);

        assertFalse(registry.canEdit(id, bob));

        vm.expectEmit(true, true, false, true);
        emit ICurationRegistry.CurationCollaboratorSet(id, bob, true);
        vm.prank(alice);
        registry.setCollaborator(id, bob, true);

        assertTrue(registry.canEdit(id, bob));

        vm.prank(bob);
        registry.setCurationURI(id, URI_B);
        assertEq(registry.getCuration(id).uri, URI_B);

        vm.prank(alice);
        registry.setCollaborator(id, bob, false);
        assertFalse(registry.canEdit(id, bob));

        vm.prank(bob);
        vm.expectRevert(CurationRegistry.NotEditor.selector);
        registry.setCurationURI(id, URI_A);
    }

    /// A collaborator assembles; only the curator decides who assembles and whether it is on view.
    function test_collaborator_cannotRetireOrAddCollaborators() public {
        vm.prank(alice);
        uint256 id = registry.createCuration(URI_A);
        vm.prank(alice);
        registry.setCollaborator(id, bob, true);

        vm.prank(bob);
        vm.expectRevert(CurationRegistry.NotCurator.selector);
        registry.setRetired(id, true);

        vm.prank(bob);
        vm.expectRevert(CurationRegistry.NotCurator.selector);
        registry.setCollaborator(id, carol, true);
    }

    function test_setCollaborator_strangerCannot() public {
        vm.prank(alice);
        uint256 id = registry.createCuration(URI_A);

        vm.prank(bob);
        vm.expectRevert(CurationRegistry.NotCurator.selector);
        registry.setCollaborator(id, carol, true);
    }

    function test_setCollaborator_rejectsZeroAndTheCuratorThemselves() public {
        vm.prank(alice);
        uint256 id = registry.createCuration(URI_A);

        vm.prank(alice);
        vm.expectRevert(CurationRegistry.InvalidCollaborator.selector);
        registry.setCollaborator(id, address(0), true);

        vm.prank(alice);
        vm.expectRevert(CurationRegistry.InvalidCollaborator.selector);
        registry.setCollaborator(id, alice, true);

        // ...and the curator edits anyway, with no row.
        assertTrue(registry.canEdit(id, alice));
    }

    function test_collaboratorRights_areScopedToOneCuration() public {
        vm.startPrank(alice);
        uint256 first = registry.createCuration(URI_A);
        uint256 second = registry.createCuration(URI_B);
        registry.setCollaborator(first, bob, true);
        vm.stopPrank();

        assertTrue(registry.canEdit(first, bob));
        assertFalse(registry.canEdit(second, bob));
    }

    // ── retiring ───────────────────────────────────────────────────────────────

    function test_setRetired_takesOffViewAndBack_recordSurvives() public {
        vm.prank(alice);
        uint256 id = registry.createCuration(URI_A);

        vm.expectEmit(true, false, false, true);
        emit ICurationRegistry.CurationRetired(id, true);
        vm.prank(alice);
        registry.setRetired(id, true);

        ICurationRegistry.Curation memory c = registry.getCuration(id);
        assertTrue(c.retired);
        assertEq(c.uri, URI_A, "a retired curation still resolves");
        assertEq(registry.totalCurations(), 1, "ids are never reused");

        vm.prank(alice);
        registry.setRetired(id, false);
        assertFalse(registry.getCuration(id).retired);
    }

    // ── enumeration ────────────────────────────────────────────────────────────

    function test_curationIdsOf_listsOnlyThatCuratorsWork_oldestFirst() public {
        vm.prank(alice);
        registry.createCuration(URI_A);
        vm.prank(bob);
        registry.createCuration(URI_B);
        vm.prank(alice);
        registry.createCuration(URI_B);

        uint256[] memory mine = registry.curationIdsOf(alice);
        assertEq(mine.length, 2);
        assertEq(mine[0], 1);
        assertEq(mine[1], 3);

        assertEq(registry.curationIdsOf(carol).length, 0);
    }

    function test_getCurations_readsManyInOneCall() public {
        vm.prank(alice);
        registry.createCuration(URI_A);
        vm.prank(bob);
        registry.createCuration(URI_B);

        uint256[] memory ids = new uint256[](2);
        ids[0] = 2;
        ids[1] = 1;
        ICurationRegistry.Curation[] memory got = registry.getCurations(ids);

        assertEq(got.length, 2);
        assertEq(got[0].curator, bob);
        assertEq(got[1].curator, alice);
    }

    function test_unknownId_revertsEverywhereItIsAsked() public {
        vm.expectRevert(CurationRegistry.UnknownCuration.selector);
        registry.getCuration(1);

        uint256[] memory ids = new uint256[](1);
        ids[0] = 7;
        vm.expectRevert(CurationRegistry.UnknownCuration.selector);
        registry.getCurations(ids);

        vm.prank(alice);
        vm.expectRevert(CurationRegistry.UnknownCuration.selector);
        registry.setCurationURI(1, URI_A);

        vm.prank(alice);
        vm.expectRevert(CurationRegistry.UnknownCuration.selector);
        registry.setRetired(1, true);

        assertFalse(registry.canEdit(1, alice));
        assertFalse(registry.canEdit(0, alice));
    }

    // ── the discovery page ─────────────────────────────────────────────────────

    function test_latestCurations_newestFirst() public {
        _publish(alice, 3);

        (uint256[] memory ids, ICurationRegistry.Curation[] memory got) = registry.latestCurations(0, 10);

        assertEq(ids.length, 3);
        assertEq(ids[0], 3);
        assertEq(ids[1], 2);
        assertEq(ids[2], 1);
        assertEq(got.length, 3);
        assertEq(got[0].curator, alice);
    }

    function test_latestCurations_pagesAndTrimsTheLastPage() public {
        _publish(alice, 5);

        (uint256[] memory page1,) = registry.latestCurations(0, 2);
        assertEq(page1.length, 2);
        assertEq(page1[0], 5);
        assertEq(page1[1], 4);

        (uint256[] memory page3,) = registry.latestCurations(4, 2);
        assertEq(page3.length, 1, "short last page is trimmed, not zero-padded");
        assertEq(page3[0], 1);

        (uint256[] memory past,) = registry.latestCurations(50, 2);
        assertEq(past.length, 0);

        (uint256[] memory none,) = registry.latestCurations(0, 0);
        assertEq(none.length, 0);
    }

    /// `offset` counts what is on view, so a retirement under a reader's feet cannot hide a page.
    function test_latestCurations_skipsRetiredAndKeepsPagesFull() public {
        _publish(alice, 5);

        vm.startPrank(alice);
        registry.setRetired(4, true);
        registry.setRetired(3, true);
        vm.stopPrank();

        (uint256[] memory ids,) = registry.latestCurations(0, 2);
        assertEq(ids.length, 2);
        assertEq(ids[0], 5);
        assertEq(ids[1], 2, "retired 4 and 3 are skipped, not returned as holes");

        (uint256[] memory rest,) = registry.latestCurations(2, 2);
        assertEq(rest.length, 1);
        assertEq(rest[0], 1);
    }

    function test_latestCurations_emptyRegistry() public view {
        (uint256[] memory ids, ICurationRegistry.Curation[] memory got) = registry.latestCurations(0, 12);
        assertEq(ids.length, 0);
        assertEq(got.length, 0);
    }

    // ── no admin surface exists ────────────────────────────────────────────────

    /// The registry is ownerless by construction: nothing on it answers an owner/pause/fee call.
    function test_registry_hasNoAdminSurface() public {
        string[4] memory sigs = ["owner()", "pause()", "setFee(uint256)", "withdraw()"];
        for (uint256 i = 0; i < sigs.length; i++) {
            (bool ok,) = address(registry).call(abi.encodeWithSignature(sigs[i]));
            assertFalse(ok, sigs[i]);
        }
    }

    /// Publishing never accepts value — there is no price to raise later.
    function test_createCuration_isNotPayable() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(registry).call{ value: 1 ether }(abi.encodeWithSignature("createCuration(string)", URI_A));
        assertFalse(ok);
    }

    // ── fuzz ───────────────────────────────────────────────────────────────────

    function testFuzz_anyAddressCanPublishAndOnlyItCurates(address who, address other) public {
        vm.assume(who != address(0) && other != address(0) && who != other);

        vm.prank(who);
        uint256 id = registry.createCuration(URI_A);

        assertTrue(registry.canEdit(id, who));
        assertFalse(registry.canEdit(id, other));

        vm.prank(other);
        vm.expectRevert(CurationRegistry.NotCurator.selector);
        registry.setRetired(id, true);
    }

    function _publish(address who, uint256 n) internal {
        vm.startPrank(who);
        for (uint256 i = 0; i < n; i++) {
            registry.createCuration(URI_A);
        }
        vm.stopPrank();
    }
}
