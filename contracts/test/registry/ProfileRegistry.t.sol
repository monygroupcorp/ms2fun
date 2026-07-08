// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ProfileRegistry } from "../../src/registry/ProfileRegistry.sol";
import { IProfileRegistry } from "../../src/registry/interfaces/IProfileRegistry.sol";

contract ProfileRegistryTest is Test {
    ProfileRegistry public registry;

    address public alice = address(0xAAAA);
    address public bob = address(0xBBBB);

    function setUp() public {
        registry = new ProfileRegistry();
    }

    // ── setProfile with valid URIs ─────────────────────────────────────────────

    function test_setProfile_validHttps_storesAndEmits() public {
        string memory uri = "https://example.com/profile.json";

        vm.expectEmit(true, false, false, true);
        emit IProfileRegistry.ProfileUpdated(alice, uri);

        vm.prank(alice);
        registry.setProfile(uri);

        assertEq(registry.profileURI(alice), uri);
    }

    function test_setProfile_validHttp_storesAndEmits() public {
        string memory uri = "http://example.com/profile.json";

        vm.expectEmit(true, false, false, true);
        emit IProfileRegistry.ProfileUpdated(alice, uri);

        vm.prank(alice);
        registry.setProfile(uri);

        assertEq(registry.profileURI(alice), uri);
    }

    function test_setProfile_validIpfs_storesAndEmits() public {
        string memory uri = "ipfs://QmX1234567890abcdefgh";

        vm.expectEmit(true, false, false, true);
        emit IProfileRegistry.ProfileUpdated(alice, uri);

        vm.prank(alice);
        registry.setProfile(uri);

        assertEq(registry.profileURI(alice), uri);
    }

    function test_setProfile_validArweave_storesAndEmits() public {
        string memory uri = "ar://tx_id_hash_here";

        vm.expectEmit(true, false, false, true);
        emit IProfileRegistry.ProfileUpdated(alice, uri);

        vm.prank(alice);
        registry.setProfile(uri);

        assertEq(registry.profileURI(alice), uri);
    }

    function test_setProfile_validDataUri_storesAndEmits() public {
        string memory uri = "data:application/json,{\"name\":\"Alice\"}";

        vm.expectEmit(true, false, false, true);
        emit IProfileRegistry.ProfileUpdated(alice, uri);

        vm.prank(alice);
        registry.setProfile(uri);

        assertEq(registry.profileURI(alice), uri);
    }

    // ── setProfile with invalid URIs ───────────────────────────────────────────

    function test_setProfile_emptyUri_reverts() public {
        string memory emptyUri = "";

        vm.prank(alice);
        vm.expectRevert(ProfileRegistry.InvalidURI.selector);
        registry.setProfile(emptyUri);
    }

    function test_setProfile_invalidScheme_reverts() public {
        string memory invalidUri = "ftp://example.com/profile.json";

        vm.prank(alice);
        vm.expectRevert(ProfileRegistry.InvalidURI.selector);
        registry.setProfile(invalidUri);
    }

    function test_setProfile_noScheme_reverts() public {
        string memory noSchemeUri = "example.com/profile.json";

        vm.prank(alice);
        vm.expectRevert(ProfileRegistry.InvalidURI.selector);
        registry.setProfile(noSchemeUri);
    }

    // ── clearProfile ───────────────────────────────────────────────────────────

    function test_clearProfile_deletesEntry() public {
        // First set a profile
        string memory uri = "https://example.com/alice.json";
        vm.prank(alice);
        registry.setProfile(uri);
        assertEq(registry.profileURI(alice), uri);

        // Now clear it
        vm.prank(alice);
        registry.clearProfile();

        // Should return empty string
        assertEq(registry.profileURI(alice), "");
    }

    function test_clearProfile_emitsEvent() public {
        // First set a profile
        string memory uri = "https://example.com/alice.json";
        vm.prank(alice);
        registry.setProfile(uri);

        // Expect clear to emit with empty URI
        vm.expectEmit(true, false, false, true);
        emit IProfileRegistry.ProfileUpdated(alice, "");

        vm.prank(alice);
        registry.clearProfile();
    }

    function test_clearProfile_onNeverSetProfile() public {
        // Should be able to clear a profile that was never set
        // Should emit with empty string
        vm.expectEmit(true, false, false, true);
        emit IProfileRegistry.ProfileUpdated(alice, "");

        vm.prank(alice);
        registry.clearProfile();

        assertEq(registry.profileURI(alice), "");
    }

    // ── Per-address isolation ──────────────────────────────────────────────────

    function test_setProfile_isolatedPerAddress() public {
        string memory aliceUri = "https://example.com/alice.json";
        string memory bobUri = "ipfs://QmBobProfile";

        vm.prank(alice);
        registry.setProfile(aliceUri);

        vm.prank(bob);
        registry.setProfile(bobUri);

        // Each address maintains its own profile
        assertEq(registry.profileURI(alice), aliceUri);
        assertEq(registry.profileURI(bob), bobUri);
    }

    function test_clearProfile_isolatedPerAddress() public {
        string memory aliceUri = "https://example.com/alice.json";
        string memory bobUri = "ipfs://QmBobProfile";

        // Set profiles for both
        vm.prank(alice);
        registry.setProfile(aliceUri);

        vm.prank(bob);
        registry.setProfile(bobUri);

        // Clear only alice's
        vm.prank(alice);
        registry.clearProfile();

        // Alice's is gone, bob's remains
        assertEq(registry.profileURI(alice), "");
        assertEq(registry.profileURI(bob), bobUri);
    }

    function test_setProfile_replaceExisting() public {
        string memory uri1 = "https://example.com/alice-v1.json";
        string memory uri2 = "https://example.com/alice-v2.json";

        vm.prank(alice);
        registry.setProfile(uri1);
        assertEq(registry.profileURI(alice), uri1);

        // Replace with new URI
        vm.expectEmit(true, false, false, true);
        emit IProfileRegistry.ProfileUpdated(alice, uri2);

        vm.prank(alice);
        registry.setProfile(uri2);
        assertEq(registry.profileURI(alice), uri2);
    }

    function test_readProfile_unsetAddress() public {
        // Reading a profile that was never set should return empty string
        assertEq(registry.profileURI(alice), "");
    }
}
