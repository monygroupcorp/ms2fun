// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC1155Factory } from "../../../src/factories/erc1155/ERC1155Factory.sol";
import { ERC1155Instance } from "../../../src/factories/erc1155/ERC1155Instance.sol";
import { MockMasterRegistry } from "../../mocks/MockMasterRegistry.sol";
import { FreeMintParams } from "../../../src/interfaces/IFactoryTypes.sol";
import { GatingScope } from "../../../src/gating/IGatingModule.sol";
import {
    FreeMintDisabled,
    FreeMintAlreadyClaimed,
    FreeMintExhausted,
    FreeMintExceedsSupply,
    EditionNotOpen,
    EditionNotFound,
    Unauthorized
} from "../../../src/factories/erc1155/ERC1155Instance.sol";
import { ComponentRegistry } from "../../../src/registry/ComponentRegistry.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { ICreateX, CREATEX } from "../../../src/shared/CreateXConstants.sol";
import { CREATEX_BYTECODE } from "createx-forge/script/CreateX.d.sol";

contract MockVaultERC1155FM {
    function supportsCapability(bytes32) external pure returns (bool) {
        return true;
    }
    receive() external payable { }
}

/// @dev Free-mint is PER EDITION (noesis-135): each edition carries its own allocation, running claim
///      counter, and per-user claimed flag. Allocation is set at edition creation (`addEdition`'s
///      `freeMintAlloc` arg) or adjusted anytime by owner/agent (`setEditionFreeMintAllocation`). The
///      collection-wide free-mint API is retired — the factory REFUSES a non-zero
///      `FreeMintParams.allocation` for ERC1155 (only the gating `scope` is still threaded through).
contract ERC1155FreeMintTest is Test {
    ERC1155Factory factory;
    MockMasterRegistry mockRegistry;
    MockVaultERC1155FM mockVault;
    ComponentRegistry componentRegistry;

    uint256 internal _saltCounter;

    address protocol = makeAddr("protocol");
    address creator = makeAddr("creator");
    address user1 = makeAddr("user1");
    address user2 = makeAddr("user2");
    address agent = makeAddr("agent");
    address nobody = makeAddr("nobody");
    address mockGMR = makeAddr("gmr");

    uint256 constant FREE_ALLOC = 5;

    function _nextSalt() internal returns (bytes32) {
        _saltCounter++;
        return bytes32(abi.encodePacked(address(factory), uint8(0x00), bytes11(uint88(_saltCounter))));
    }

    function setUp() public {
        vm.startPrank(protocol);
        vm.etch(CREATEX, CREATEX_BYTECODE);
        mockRegistry = new MockMasterRegistry();
        mockVault = new MockVaultERC1155FM();

        ComponentRegistry impl = new ComponentRegistry();
        address proxy = LibClone.deployERC1967(address(impl));
        componentRegistry = ComponentRegistry(proxy);
        componentRegistry.initialize(protocol);

        factory = new ERC1155Factory(address(mockRegistry), mockGMR, address(componentRegistry), address(0xBEEF));
        vm.stopPrank();
    }

    function _params(address _creator, GatingScope scope) internal view returns (ERC1155Factory.CreateParams memory) {
        return ERC1155Factory.CreateParams({
            name: "FreeMintEdition",
            symbol: "", // optional collection symbol (noesis-084)
            metadataURI: "ipfs://meta",
            creator: _creator,
            vault: address(mockVault),
            styleUri: "",
            gatingModule: address(0),
            // allocation must be 0 for ERC1155 (per-edition now); scope still applies.
            freeMint: FreeMintParams({ allocation: 0, scope: scope })
        });
    }

    function _deploy(GatingScope scope) internal returns (ERC1155Instance) {
        vm.prank(creator);
        address inst = factory.createInstance(_nextSalt(), _params(creator, scope));
        return ERC1155Instance(payable(inst));
    }

    /// Agent-created instance (agentDelegationEnabled == true): creator is `creator`, msg.sender is a
    /// registered `agent`, so the instance permits delegated agent calls.
    function _deployAgent(GatingScope scope) internal returns (ERC1155Instance) {
        mockRegistry.setAgent(agent, true);
        vm.prank(agent);
        address inst = factory.createInstance(_nextSalt(), _params(creator, scope));
        return ERC1155Instance(payable(inst));
    }

    function _addEdition(ERC1155Instance inst, uint256 supply, uint256 freeAlloc) internal returns (uint256 editionId) {
        vm.prank(creator);
        inst.addEdition(
            "Piece", 0.01 ether, supply, "ipfs://edition", ERC1155Instance.PricingModel.LIMITED_FIXED, 0, 0, freeAlloc
        );
        return inst.nextEditionId() - 1;
    }

    function _addUnlimited(ERC1155Instance inst, uint256 freeAlloc) internal returns (uint256 editionId) {
        vm.prank(creator);
        inst.addEdition(
            "OpenPiece", 0.005 ether, 0, "ipfs://open", ERC1155Instance.PricingModel.UNLIMITED, 0, 0, freeAlloc
        );
        return inst.nextEditionId() - 1;
    }

    function _addEditionAt(ERC1155Instance inst, uint256 supply, uint256 openTime, uint256 freeAlloc)
        internal
        returns (uint256 editionId)
    {
        vm.prank(creator);
        inst.addEdition(
            "Piece",
            0.01 ether,
            supply,
            "ipfs://edition",
            ERC1155Instance.PricingModel.LIMITED_FIXED,
            0,
            openTime,
            freeAlloc
        );
        return inst.nextEditionId() - 1;
    }

    // ── allocation stored per edition ──────────────────────────────────────────

    function test_erc1155_freeMintAllocationStored() public {
        ERC1155Instance inst = _deploy(GatingScope.BOTH);
        uint256 editionId = _addEdition(inst, 100, FREE_ALLOC);
        assertEq(inst.freeMintAllocation(editionId), FREE_ALLOC);
    }

    // ── claimFreeMint happy path ──────────────────────────────────────────────

    function test_erc1155_claimFreeMint_mintsOneToken() public {
        ERC1155Instance inst = _deploy(GatingScope.BOTH);
        uint256 editionId = _addEdition(inst, 100, FREE_ALLOC);

        vm.prank(user1);
        inst.claimFreeMint(editionId, "");

        assertEq(inst.balanceOf(user1, editionId), 1);
        assertEq(inst.freeMintsClaimed(editionId), 1);
        assertTrue(inst.freeMintClaimed(editionId, user1));
    }

    // ── reverts ───────────────────────────────────────────────────────────────

    function test_erc1155_freeMint_revertsWhenDisabled() public {
        ERC1155Instance inst = _deploy(GatingScope.BOTH);
        uint256 editionId = _addEdition(inst, 100, 0); // no free allocation for this edition
        vm.prank(user1);
        vm.expectRevert(FreeMintDisabled.selector);
        inst.claimFreeMint(editionId, "");
    }

    function test_erc1155_freeMint_revertsWhenAlreadyClaimed() public {
        ERC1155Instance inst = _deploy(GatingScope.BOTH);
        uint256 editionId = _addEdition(inst, 100, FREE_ALLOC);
        vm.prank(user1);
        inst.claimFreeMint(editionId, "");
        vm.prank(user1);
        vm.expectRevert(FreeMintAlreadyClaimed.selector);
        inst.claimFreeMint(editionId, "");
    }

    function test_erc1155_freeMint_revertsWhenExhausted() public {
        ERC1155Instance inst = _deploy(GatingScope.BOTH);
        uint256 editionId = _addEdition(inst, 100, 1);
        vm.prank(user1);
        inst.claimFreeMint(editionId, "");
        vm.prank(user2);
        vm.expectRevert(FreeMintExhausted.selector);
        inst.claimFreeMint(editionId, "");
    }

    // ── per-edition independence (the core noesis-135 behaviour) ────────────────

    /// Draining edition A's allocation must NOT consume edition B's — the counters are per edition.
    function test_erc1155_freeMint_perEditionIndependence() public {
        ERC1155Instance inst = _deploy(GatingScope.BOTH);
        uint256 edA = _addEdition(inst, 100, 1); // A: one free mint
        uint256 edB = _addEdition(inst, 100, 1); // B: one free mint

        // user1 claims A → A exhausted, B untouched.
        vm.prank(user1);
        inst.claimFreeMint(edA, "");
        assertEq(inst.freeMintsClaimed(edA), 1);
        assertEq(inst.freeMintsClaimed(edB), 0);

        // user2 can no longer claim A (exhausted) but CAN claim B.
        vm.prank(user2);
        vm.expectRevert(FreeMintExhausted.selector);
        inst.claimFreeMint(edA, "");

        vm.prank(user2);
        inst.claimFreeMint(edB, "");
        assertEq(inst.balanceOf(user2, edB), 1);
        assertEq(inst.freeMintsClaimed(edB), 1);
    }

    /// One free claim per user PER edition: a wallet that claimed A may still claim B, but not A again.
    function test_erc1155_freeMint_oneClaimPerUserPerEdition() public {
        ERC1155Instance inst = _deploy(GatingScope.BOTH);
        uint256 edA = _addEdition(inst, 100, FREE_ALLOC);
        uint256 edB = _addEdition(inst, 100, FREE_ALLOC);

        vm.prank(user1);
        inst.claimFreeMint(edA, "");

        // Same edition again → already claimed.
        vm.prank(user1);
        vm.expectRevert(FreeMintAlreadyClaimed.selector);
        inst.claimFreeMint(edA, "");

        // Different edition → allowed.
        vm.prank(user1);
        inst.claimFreeMint(edB, "");
        assertEq(inst.balanceOf(user1, edA), 1);
        assertEq(inst.balanceOf(user1, edB), 1);
    }

    // ── setEditionFreeMintAllocation (owner/agent, adjustable anytime) ───────────

    function test_erc1155_setEditionFreeMintAllocation_ownerAdjusts() public {
        ERC1155Instance inst = _deploy(GatingScope.BOTH);
        uint256 editionId = _addEdition(inst, 100, 0); // starts disabled

        vm.prank(user1);
        vm.expectRevert(FreeMintDisabled.selector);
        inst.claimFreeMint(editionId, "");

        // Owner enables it later.
        vm.prank(creator);
        inst.setEditionFreeMintAllocation(editionId, 3);
        assertEq(inst.freeMintAllocation(editionId), 3);

        vm.prank(user1);
        inst.claimFreeMint(editionId, "");
        assertEq(inst.balanceOf(user1, editionId), 1);
    }

    /// No lock-at-first-mint: the owner can raise/lower allocation even after claims have landed.
    function test_erc1155_setEditionFreeMintAllocation_anytimeAdjust() public {
        ERC1155Instance inst = _deploy(GatingScope.BOTH);
        uint256 editionId = _addEdition(inst, 100, 1);

        vm.prank(user1);
        inst.claimFreeMint(editionId, ""); // exhausts alloc == 1

        vm.prank(user2);
        vm.expectRevert(FreeMintExhausted.selector);
        inst.claimFreeMint(editionId, "");

        // Owner raises the allocation → user2 can now claim.
        vm.prank(creator);
        inst.setEditionFreeMintAllocation(editionId, 2);

        vm.prank(user2);
        inst.claimFreeMint(editionId, "");
        assertEq(inst.freeMintsClaimed(editionId), 2);

        // Owner may also lower it below what's already claimed (claimed mints stand; stays exhausted).
        vm.prank(creator);
        inst.setEditionFreeMintAllocation(editionId, 1);
        assertEq(inst.freeMintAllocation(editionId), 1);
    }

    function test_erc1155_setEditionFreeMintAllocation_agentGated() public {
        ERC1155Instance inst = _deployAgent(GatingScope.BOTH);
        // Edition created by the owner (creator); agent adjusts its allocation via delegation.
        uint256 editionId = _addEdition(inst, 100, 0);

        vm.prank(agent);
        inst.setEditionFreeMintAllocation(editionId, 4);
        assertEq(inst.freeMintAllocation(editionId), 4);
    }

    function test_erc1155_setEditionFreeMintAllocation_unauthorizedReverts() public {
        ERC1155Instance inst = _deploy(GatingScope.BOTH);
        uint256 editionId = _addEdition(inst, 100, 0);

        // A random wallet (no owner, no agent) cannot adjust.
        vm.prank(nobody);
        vm.expectRevert(Unauthorized.selector);
        inst.setEditionFreeMintAllocation(editionId, 3);
    }

    function test_erc1155_setEditionFreeMintAllocation_nonexistentEditionReverts() public {
        ERC1155Instance inst = _deploy(GatingScope.BOTH);
        vm.prank(creator);
        vm.expectRevert(EditionNotFound.selector);
        inst.setEditionFreeMintAllocation(999, 3);
    }

    // ── reserve-from-supply cap (sub-decision 1) incl. the supply == 0 carve-out ─

    function test_erc1155_addEdition_reserveCapEnforced() public {
        ERC1155Instance inst = _deploy(GatingScope.BOTH);
        vm.prank(creator);
        vm.expectRevert(FreeMintExceedsSupply.selector);
        inst.addEdition("Piece", 0.01 ether, 5, "ipfs://edition", ERC1155Instance.PricingModel.LIMITED_FIXED, 0, 0, 6);
    }

    function test_erc1155_addEdition_reserveCapAtSupplyOk() public {
        ERC1155Instance inst = _deploy(GatingScope.BOTH);
        uint256 editionId = _addEdition(inst, 10, 10); // alloc == supply is allowed
        assertEq(inst.freeMintAllocation(editionId), 10);
    }

    function test_erc1155_setEditionFreeMintAllocation_capEnforced() public {
        ERC1155Instance inst = _deploy(GatingScope.BOTH);
        uint256 editionId = _addEdition(inst, 10, 0);

        vm.prank(creator);
        vm.expectRevert(FreeMintExceedsSupply.selector);
        inst.setEditionFreeMintAllocation(editionId, 11);

        // At the cap is fine.
        vm.prank(creator);
        inst.setEditionFreeMintAllocation(editionId, 10);
        assertEq(inst.freeMintAllocation(editionId), 10);
    }

    /// UNLIMITED edition (supply == 0) accepts any allocation — the cap only applies when supply > 0.
    function test_erc1155_unlimitedEdition_freeMintCarveout() public {
        ERC1155Instance inst = _deploy(GatingScope.BOTH);
        uint256 editionId = _addUnlimited(inst, 1000);
        assertEq(inst.freeMintAllocation(editionId), 1000);

        vm.prank(user1);
        inst.claimFreeMint(editionId, "");
        assertEq(inst.balanceOf(user1, editionId), 1);

        // Setter carve-out too: any value accepted for an unlimited edition.
        vm.prank(creator);
        inst.setEditionFreeMintAllocation(editionId, type(uint128).max);
        assertEq(inst.freeMintAllocation(editionId), type(uint128).max);
    }

    // ── openTime gate on the free path (noesis-115 finding #3) ──────────────────

    /// Free claim before the scheduled open must revert even on the ungated path
    /// (gatingModule == address(0), so the gating block is skipped) — no bot pre-drain.
    function test_erc1155_freeMint_revertsBeforeOpenTime_ungated() public {
        ERC1155Instance inst = _deploy(GatingScope.BOTH);
        uint256 openTime = block.timestamp + 1 days;
        uint256 editionId = _addEditionAt(inst, 100, openTime, FREE_ALLOC);

        vm.prank(user1);
        vm.expectRevert(EditionNotOpen.selector);
        inst.claimFreeMint(editionId, "");
    }

    /// PAID_ONLY scope also skips the gating block; openTime is still enforced.
    function test_erc1155_freeMint_revertsBeforeOpenTime_paidOnlyScope() public {
        ERC1155Instance inst = _deploy(GatingScope.PAID_ONLY);
        uint256 openTime = block.timestamp + 1 days;
        uint256 editionId = _addEditionAt(inst, 100, openTime, FREE_ALLOC);

        vm.prank(user1);
        vm.expectRevert(EditionNotOpen.selector);
        inst.claimFreeMint(editionId, "");
    }

    /// At or after openTime the free claim succeeds.
    function test_erc1155_freeMint_succeedsAtOpenTime() public {
        ERC1155Instance inst = _deploy(GatingScope.BOTH);
        uint256 openTime = block.timestamp + 1 days;
        uint256 editionId = _addEditionAt(inst, 100, openTime, FREE_ALLOC);

        vm.warp(openTime);
        vm.prank(user1);
        inst.claimFreeMint(editionId, "");
        assertEq(inst.balanceOf(user1, editionId), 1);

        vm.warp(openTime + 3 days);
        vm.prank(user2);
        inst.claimFreeMint(editionId, "");
        assertEq(inst.balanceOf(user2, editionId), 1);
    }

    /// openTime == 0 means open immediately (no regression).
    function test_erc1155_freeMint_openTimeZeroOpensImmediately() public {
        ERC1155Instance inst = _deploy(GatingScope.BOTH);
        uint256 editionId = _addEditionAt(inst, 100, 0, FREE_ALLOC);
        vm.prank(user1);
        inst.claimFreeMint(editionId, "");
        assertEq(inst.balanceOf(user1, editionId), 1);
    }

    // ── create-time allocation is refused, not discarded ───────────────────────

    /// A create-time `FreeMintParams.allocation` cannot be applied: allocation is keyed by edition and
    /// editions are added after create. The factory rejects a non-zero value at create.
    function test_erc1155_create_revertsOnNonZeroFreeMintAllocation() public {
        ERC1155Factory.CreateParams memory params = _params(creator, GatingScope.BOTH);
        params.freeMint = FreeMintParams({ allocation: FREE_ALLOC, scope: GatingScope.BOTH });

        vm.prank(creator);
        vm.expectRevert(ERC1155Factory.FreeMintAllocationIsPerEdition.selector);
        factory.createInstance(_nextSalt(), params);
    }

    /// The refusal is on the allocation only: an allocation of 0 creates normally and the gating
    /// `scope` half of `FreeMintParams` is still threaded through to the instance.
    function test_erc1155_create_zeroAllocationStillSetsGatingScope() public {
        ERC1155Instance freeMintOnly = _deploy(GatingScope.FREE_MINT_ONLY);
        assertEq(uint8(freeMintOnly.gatingScope()), uint8(GatingScope.FREE_MINT_ONLY));

        ERC1155Instance paidOnly = _deploy(GatingScope.PAID_ONLY);
        assertEq(uint8(paidOnly.gatingScope()), uint8(GatingScope.PAID_ONLY));

        ERC1155Instance both = _deploy(GatingScope.BOTH);
        assertEq(uint8(both.gatingScope()), uint8(GatingScope.BOTH));
    }

    /// The supported path is unaffected by the create-time refusal: after a create with allocation 0,
    /// `addEdition`'s `freeMintAlloc` still sets the allocation and the claim still works.
    function test_erc1155_create_zeroAllocation_perEditionPathStillWorks() public {
        ERC1155Instance inst = _deploy(GatingScope.BOTH);
        uint256 editionId = _addEdition(inst, 100, FREE_ALLOC);

        assertEq(inst.freeMintAllocation(editionId), FREE_ALLOC);

        vm.prank(user1);
        inst.claimFreeMint(editionId, "");
        assertEq(inst.balanceOf(user1, editionId), 1);
        assertEq(inst.freeMintsClaimed(editionId), 1);
    }

    /// Regression: a caller asking for a non-zero allocation must not end up with a created collection
    /// whose free mint is initialized while every edition allocation is 0 — such a collection can
    /// never be free-claimed, and the create returned no signal. The create now reverts, so no
    /// instance is deployed and no name is registered; the same salt and name then create cleanly once
    /// the allocation moves to the edition.
    function test_erc1155_create_nonZeroAllocation_leavesNoUnclaimableCollection() public {
        ERC1155Factory.CreateParams memory params = _params(creator, GatingScope.BOTH);
        params.freeMint = FreeMintParams({ allocation: 1, scope: GatingScope.BOTH });
        bytes32 salt = _nextSalt();

        vm.prank(creator);
        vm.expectRevert(ERC1155Factory.FreeMintAllocationIsPerEdition.selector);
        factory.createInstance(salt, params);

        // The same salt creating cleanly below is the proof that the refused create deployed nothing:
        // CREATE3 reverts on a redeploy to an occupied deterministic address.
        params.freeMint = FreeMintParams({ allocation: 0, scope: GatingScope.BOTH });
        vm.prank(creator);
        ERC1155Instance inst = ERC1155Instance(payable(factory.createInstance(salt, params)));

        uint256 editionId = _addEdition(inst, 100, FREE_ALLOC);
        assertEq(inst.freeMintAllocation(editionId), FREE_ALLOC);

        vm.prank(user1);
        inst.claimFreeMint(editionId, "");
        assertEq(inst.balanceOf(user1, editionId), 1);
    }
}
