// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { MerkleGatingModule } from "../../src/gating/MerkleGatingModule.sol";
import { IMerkleGatingModule, MerkleConfig } from "../../src/gating/IMerkleGatingModule.sol";
import { MerkleAllowlistHelper } from "./MerkleAllowlistHelper.sol";
import { MockMasterRegistry } from "../mocks/MockMasterRegistry.sol";
import { Ownable } from "solady/auth/Ownable.sol";

contract MerkleGatingModuleTest is Test {
    MerkleGatingModule module;
    MerkleAllowlistHelper helper;
    MockMasterRegistry mockRegistry;

    address instance1 = address(0xA11CE);
    address instance2 = address(0xB0B);
    address alice = address(0xA1);
    address bob = address(0xB2);
    address carol = address(0xC3);
    address mallory = address(0xDEAD);

    function setUp() public {
        mockRegistry = new MockMasterRegistry();
        module = new MerkleGatingModule(address(mockRegistry));
        helper = new MerkleAllowlistHelper();
        // Test contract is the registering factory of both instances (mirrors password module test).
        mockRegistry.setInstanceFactory(instance1, address(this));
        mockRegistry.setInstanceFactory(instance2, address(this));
    }

    // ── Fixtures ────────────────────────────────────────────────────────────────

    /// @dev allowlist: alice=5, bob=3, carol=10. Returns root + alice's proof/maxQty (index 0).
    function _list() internal pure returns (MerkleAllowlistHelper.Entry[] memory e) {
        e = new MerkleAllowlistHelper.Entry[](3);
        e[0] = MerkleAllowlistHelper.Entry(address(0xA1), 5);
        e[1] = MerkleAllowlistHelper.Entry(address(0xB2), 3);
        e[2] = MerkleAllowlistHelper.Entry(address(0xC3), 10);
    }

    function _singleTierConfig(uint256 editionId, bytes32 root, uint256 openTime)
        internal
        pure
        returns (MerkleConfig memory c)
    {
        bytes32[] memory roots = new bytes32[](1);
        roots[0] = root;
        uint256[] memory times = new uint256[](1);
        times[0] = openTime;
        c = MerkleConfig({ editionId: editionId, roots: roots, tierOpenTimes: times });
    }

    // ── Happy path ────────────────────────────────────────────────────────────────

    function test_validProof_withinCap_allowedAndAccounted() public {
        MerkleAllowlistHelper.Entry[] memory e = _list();
        (bytes32 root, bytes32[] memory proof, uint256 maxQty) = helper.build(e, 0); // alice, maxQty 5
        module.configureFor(instance1, _singleTierConfig(0, root, 0));

        bytes memory data = helper.encodeData(0, maxQty, proof);
        vm.prank(instance1);
        (bool allowed, bool permanent) = module.canMint(alice, 0, 2, 0, data);
        assertTrue(allowed);
        assertFalse(permanent);

        vm.prank(instance1);
        module.onMint(alice, 0, 2);
        assertEq(module.claimed(instance1, 0, alice), 2);

        // second claim of 3 → cumulative 5 == cap, still allowed
        vm.prank(instance1);
        (bool allowed2,) = module.canMint(alice, 0, 3, 0, data);
        assertTrue(allowed2);
    }

    function test_cumulativeOverCap_reverts() public {
        MerkleAllowlistHelper.Entry[] memory e = _list();
        (bytes32 root, bytes32[] memory proof, uint256 maxQty) = helper.build(e, 0); // alice cap 5
        module.configureFor(instance1, _singleTierConfig(0, root, 0));
        bytes memory data = helper.encodeData(0, maxQty, proof);

        vm.prank(instance1);
        module.onMint(alice, 0, 5); // fully claimed
        vm.prank(instance1);
        vm.expectRevert(MerkleGatingModule.QtyCapExceeded.selector);
        module.canMint(alice, 0, 1, 0, data);
    }

    function test_amountExceedingCapInOneShot_reverts() public {
        MerkleAllowlistHelper.Entry[] memory e = _list();
        (bytes32 root, bytes32[] memory proof, uint256 maxQty) = helper.build(e, 0); // cap 5
        module.configureFor(instance1, _singleTierConfig(0, root, 0));
        bytes memory data = helper.encodeData(0, maxQty, proof);
        vm.prank(instance1);
        vm.expectRevert(MerkleGatingModule.QtyCapExceeded.selector);
        module.canMint(alice, 0, 6, 0, data);
    }

    // ── Proof integrity ─────────────────────────────────────────────────────────

    function test_wrongAddress_reverts() public {
        MerkleAllowlistHelper.Entry[] memory e = _list();
        (bytes32 root, bytes32[] memory proof, uint256 maxQty) = helper.build(e, 0); // alice's proof
        module.configureFor(instance1, _singleTierConfig(0, root, 0));
        bytes memory data = helper.encodeData(0, maxQty, proof);
        // mallory presents alice's proof → leaf(mallory, 5) not in tree
        vm.prank(instance1);
        vm.expectRevert(MerkleGatingModule.InvalidProof.selector);
        module.canMint(mallory, 0, 1, 0, data);
    }

    function test_tamperedMaxQty_reverts() public {
        MerkleAllowlistHelper.Entry[] memory e = _list();
        (bytes32 root, bytes32[] memory proof,) = helper.build(e, 0); // alice cap 5
        module.configureFor(instance1, _singleTierConfig(0, root, 0));
        // claim maxQty 999 with alice's real proof → leaf(alice,999) not in tree
        bytes memory data = helper.encodeData(0, 999, proof);
        vm.prank(instance1);
        vm.expectRevert(MerkleGatingModule.InvalidProof.selector);
        module.canMint(alice, 0, 1, 0, data);
    }

    function test_tamperedProofNode_reverts() public {
        MerkleAllowlistHelper.Entry[] memory e = _list();
        (bytes32 root, bytes32[] memory proof, uint256 maxQty) = helper.build(e, 0);
        module.configureFor(instance1, _singleTierConfig(0, root, 0));
        proof[0] = bytes32(uint256(proof[0]) ^ 1); // flip a bit
        bytes memory data = helper.encodeData(0, maxQty, proof);
        vm.prank(instance1);
        vm.expectRevert(MerkleGatingModule.InvalidProof.selector);
        module.canMint(alice, 0, 1, 0, data);
    }

    // ── Tier timing ───────────────────────────────────────────────────────────────

    function test_tierNotOpen_reverts_thenOpens() public {
        MerkleAllowlistHelper.Entry[] memory e = _list();
        (bytes32 root, bytes32[] memory proof, uint256 maxQty) = helper.build(e, 0);
        uint256 openAt = block.timestamp + 1 days;
        module.configureFor(instance1, _singleTierConfig(0, root, openAt));
        bytes memory data = helper.encodeData(0, maxQty, proof);

        vm.prank(instance1);
        vm.expectRevert(MerkleGatingModule.TierNotOpen.selector);
        module.canMint(alice, 0, 1, 0, data);

        vm.warp(openAt);
        vm.prank(instance1);
        (bool allowed,) = module.canMint(alice, 0, 1, 0, data);
        assertTrue(allowed);
    }

    function test_multiTier_timePhased() public {
        // tier 0 open now (root over {alice}), tier 1 opens in 1 day (root over {bob})
        MerkleAllowlistHelper.Entry[] memory t0 = new MerkleAllowlistHelper.Entry[](1);
        t0[0] = MerkleAllowlistHelper.Entry(alice, 5);
        MerkleAllowlistHelper.Entry[] memory t1 = new MerkleAllowlistHelper.Entry[](1);
        t1[0] = MerkleAllowlistHelper.Entry(bob, 4);

        bytes32[] memory roots = new bytes32[](2);
        roots[0] = helper.rootOf(t0);
        roots[1] = helper.rootOf(t1);
        uint256[] memory times = new uint256[](2);
        times[0] = 0;
        times[1] = block.timestamp + 1 days;
        module.configureFor(instance1, MerkleConfig({ editionId: 0, roots: roots, tierOpenTimes: times }));

        // Precompute all proof payloads BEFORE pranking — an inlined external helper call in the
        // canMint argument list would consume the vm.prank itself.
        (, bytes32[] memory p1, uint256 q1) = helper.build(t1, 0);
        bytes memory bobData = helper.encodeData(1, q1, p1);
        (, bytes32[] memory p0, uint256 q0) = helper.build(t0, 0);
        bytes memory aliceData = helper.encodeData(0, q0, p0);

        // bob's tier not open yet
        vm.prank(instance1);
        vm.expectRevert(MerkleGatingModule.TierNotOpen.selector);
        module.canMint(bob, 0, 1, 0, bobData);

        // alice tier 0 works now
        vm.prank(instance1);
        (bool aliceOk,) = module.canMint(alice, 0, 1, 0, aliceData);
        assertTrue(aliceOk);

        // after warp bob's tier opens
        vm.warp(times[1]);
        vm.prank(instance1);
        (bool bobOk,) = module.canMint(bob, 0, 1, 0, bobData);
        assertTrue(bobOk);
    }

    function test_invalidTierId_reverts() public {
        MerkleAllowlistHelper.Entry[] memory e = _list();
        (bytes32 root, bytes32[] memory proof, uint256 maxQty) = helper.build(e, 0);
        module.configureFor(instance1, _singleTierConfig(0, root, 0)); // only tier 0 exists
        bytes memory data = helper.encodeData(1, maxQty, proof); // tierId 1 out of range
        vm.prank(instance1);
        vm.expectRevert(MerkleGatingModule.InvalidTier.selector);
        module.canMint(alice, 0, 1, 0, data);
    }

    // ── Per-edition authority ─────────────────────────────────────────────────────

    function test_wrongEditionProof_reverts() public {
        // edition 0 allowlist includes alice; edition 1 allowlist is a DIFFERENT set (bob only).
        MerkleAllowlistHelper.Entry[] memory ed0 = _list(); // alice, bob, carol
        MerkleAllowlistHelper.Entry[] memory ed1 = new MerkleAllowlistHelper.Entry[](1);
        ed1[0] = MerkleAllowlistHelper.Entry(bob, 3);

        (bytes32 root0, bytes32[] memory proof0, uint256 q0) = helper.build(ed0, 0); // alice on edition 0
        // instance-level "configured" flag → after the first (factory-seeded) config, further editions
        // are owner-authored; instance1 is codeless so mock its owner() to this test contract.
        vm.mockCall(instance1, abi.encodeWithSignature("owner()"), abi.encode(address(this)));
        module.configureFor(instance1, _singleTierConfig(0, root0, 0));
        module.configureFor(instance1, _singleTierConfig(1, helper.rootOf(ed1), 0));

        bytes memory aliceEd0Data = helper.encodeData(0, q0, proof0);

        // Works on the edition it was issued for.
        vm.prank(instance1);
        (bool ok,) = module.canMint(alice, 0, 1, 0, aliceEd0Data);
        assertTrue(ok);

        // Same proof replayed on edition 1 → edition-1 root differs → InvalidProof.
        vm.prank(instance1);
        vm.expectRevert(MerkleGatingModule.InvalidProof.selector);
        module.canMint(alice, 1, 1, 0, aliceEd0Data);
    }

    function test_claimAccountingIsPerEdition() public {
        MerkleAllowlistHelper.Entry[] memory e = _list();
        (bytes32 root, bytes32[] memory proof, uint256 maxQty) = helper.build(e, 0);
        vm.mockCall(instance1, abi.encodeWithSignature("owner()"), abi.encode(address(this)));
        module.configureFor(instance1, _singleTierConfig(0, root, 0));
        module.configureFor(instance1, _singleTierConfig(7, root, 0));
        bytes memory data = helper.encodeData(0, maxQty, proof);

        vm.prank(instance1);
        module.onMint(alice, 0, 5); // exhaust edition 0
        vm.prank(instance1);
        vm.expectRevert(MerkleGatingModule.QtyCapExceeded.selector);
        module.canMint(alice, 0, 1, 0, data);

        // edition 7 is untouched — alice can still claim there
        vm.prank(instance1);
        (bool ok,) = module.canMint(alice, 7, 5, 0, data);
        assertTrue(ok);
    }

    // ── Re-allocation lever ────────────────────────────────────────────────────────

    function test_rootUpdateRaisingMaxQty_allowsDelta() public {
        // v1: alice cap 5. She claims all 5.
        MerkleAllowlistHelper.Entry[] memory v1 = _list(); // alice=5
        (bytes32 root1, bytes32[] memory proof1, uint256 q1) = helper.build(v1, 0);
        bytes memory d1 = helper.encodeData(0, q1, proof1);
        module.configureFor(instance1, _singleTierConfig(0, root1, 0));
        vm.prank(instance1);
        module.onMint(alice, 0, 5);
        vm.prank(instance1);
        vm.expectRevert(MerkleGatingModule.QtyCapExceeded.selector);
        module.canMint(alice, 0, 1, 0, d1);

        // v2: new root raises alice to cap 8. Owner updates the root.
        MerkleAllowlistHelper.Entry[] memory v2 = new MerkleAllowlistHelper.Entry[](1);
        v2[0] = MerkleAllowlistHelper.Entry(alice, 8);
        (bytes32 root2, bytes32[] memory proof2, uint256 q2) = helper.build(v2, 0);
        bytes memory d2 = helper.encodeData(0, q2, proof2);
        vm.mockCall(instance1, abi.encodeWithSignature("owner()"), abi.encode(address(this)));
        module.configureFor(instance1, _singleTierConfig(0, root2, 0));

        // claimed(5) + 3 = 8 <= new cap 8 → delta of 3 claimable
        vm.prank(instance1);
        (bool ok,) = module.canMint(alice, 0, 3, 0, d2);
        assertTrue(ok);
        // but not 4 (would be 9 > 8)
        vm.prank(instance1);
        vm.expectRevert(MerkleGatingModule.QtyCapExceeded.selector);
        module.canMint(alice, 0, 4, 0, d2);
    }

    // ── Isolation ──────────────────────────────────────────────────────────────────

    function test_perInstanceIsolation() public {
        MerkleAllowlistHelper.Entry[] memory e = _list();
        (bytes32 root, bytes32[] memory proof, uint256 maxQty) = helper.build(e, 0);
        module.configureFor(instance1, _singleTierConfig(0, root, 0));
        module.configureFor(instance2, _singleTierConfig(0, root, 0));
        bytes memory data = helper.encodeData(0, maxQty, proof);

        vm.prank(instance1);
        module.onMint(alice, 0, 5); // exhaust on instance1

        // instance2 is unaffected
        vm.prank(instance2);
        (bool ok,) = module.canMint(alice, 0, 5, 0, data);
        assertTrue(ok);
        assertEq(module.claimed(instance2, 0, alice), 0);
    }

    // ── configureFor auth + validation ─────────────────────────────────────────────

    function test_configureFor_rejectsNonOwnerNonFactory() public {
        MerkleAllowlistHelper.Entry[] memory e = _list();
        bytes32 root = helper.rootOf(e);
        address attacker = address(0xBAD);
        vm.mockCall(instance1, abi.encodeWithSignature("owner()"), abi.encode(address(0xC0FFEE)));
        vm.prank(attacker);
        vm.expectRevert(Ownable.Unauthorized.selector);
        module.configureFor(instance1, _singleTierConfig(0, root, 0));
    }

    function test_configureFor_ownerCanUpdate_nonOwnerCannot() public {
        MerkleAllowlistHelper.Entry[] memory e = _list();
        bytes32 root = helper.rootOf(e);
        module.configureFor(instance1, _singleTierConfig(0, root, 0)); // first config by factory (this)

        // subsequent update must be the owner
        vm.mockCall(instance1, abi.encodeWithSignature("owner()"), abi.encode(address(0xC0FFEE)));
        vm.prank(address(0xBAD));
        vm.expectRevert(Ownable.Unauthorized.selector);
        module.configureFor(instance1, _singleTierConfig(0, root, 0));
    }

    function test_configureFor_rejectsLengthMismatch() public {
        bytes32[] memory roots = new bytes32[](2);
        roots[0] = keccak256("a");
        roots[1] = keccak256("b");
        uint256[] memory times = new uint256[](1);
        vm.expectRevert(MerkleGatingModule.LengthMismatch.selector);
        module.configureFor(instance1, MerkleConfig({ editionId: 0, roots: roots, tierOpenTimes: times }));
    }

    function test_configureFor_rejectsEmptyRootSet() public {
        vm.expectRevert(MerkleGatingModule.EmptyRootSet.selector);
        module.configureFor(
            instance1, MerkleConfig({ editionId: 0, roots: new bytes32[](0), tierOpenTimes: new uint256[](0) })
        );
    }

    function test_configureFor_rejectsZeroRoot() public {
        vm.expectRevert(MerkleGatingModule.ZeroRoot.selector);
        module.configureFor(instance1, _singleTierConfig(0, bytes32(0), 0));
    }

    function test_getters() public {
        MerkleAllowlistHelper.Entry[] memory e = _list();
        bytes32 root = helper.rootOf(e);
        module.configureFor(instance1, _singleTierConfig(0, root, 42));
        assertEq(module.getRoots(instance1, 0).length, 1);
        assertEq(module.getRoots(instance1, 0)[0], root);
        assertEq(module.getTierOpenTimes(instance1, 0)[0], 42);
    }
}
