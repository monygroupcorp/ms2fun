// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { Vm } from "forge-std/Vm.sol";
import { ERC1155Factory } from "../../../src/factories/erc1155/ERC1155Factory.sol";
import { ERC1155Instance } from "../../../src/factories/erc1155/ERC1155Instance.sol";
import { MockMasterRegistry } from "../../mocks/MockMasterRegistry.sol";
import { FreeMintParams } from "../../../src/interfaces/IFactoryTypes.sol";
import { GatingScope } from "../../../src/gating/IGatingModule.sol";
import {
    EditionClosed,
    EditionNotOpen,
    EditionNotFound,
    EditionAlreadyMinted,
    ExceedsWalletLimit,
    InvalidCloseTime,
    Unauthorized
} from "../../../src/factories/erc1155/ERC1155Instance.sol";
import { ComponentRegistry } from "../../../src/registry/ComponentRegistry.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { ICreateX, CREATEX } from "../../../src/shared/CreateXConstants.sol";
import { CREATEX_BYTECODE } from "createx-forge/script/CreateX.d.sol";

contract MockVaultERC1155Sched {
    function supportsCapability(bytes32) external pure returns (bool) {
        return true;
    }
    receive() external payable { }
}

/// @dev The timed drop (noesis/open-edition-cannot-close). An edition carries a close time beside the
///      open time it already had, and a ceiling on what one wallet may take; both are enforced on the
///      paid path and the free-claim path, and both stay correctable until the first mint.
contract ERC1155EditionScheduleTest is Test {
    ERC1155Factory factory;
    MockMasterRegistry mockRegistry;
    MockVaultERC1155Sched mockVault;
    ComponentRegistry componentRegistry;

    uint256 internal _saltCounter;

    address protocol = makeAddr("protocol");
    address creator = makeAddr("creator");
    address user1 = makeAddr("user1");
    address user2 = makeAddr("user2");
    address nobody = makeAddr("nobody");
    address mockGMR = makeAddr("gmr");

    uint256 constant PRICE = 0.01 ether;

    function _nextSalt() internal returns (bytes32) {
        _saltCounter++;
        return bytes32(abi.encodePacked(address(factory), uint8(0x00), bytes11(uint88(_saltCounter))));
    }

    function setUp() public {
        vm.startPrank(protocol);
        vm.etch(CREATEX, CREATEX_BYTECODE);
        mockRegistry = new MockMasterRegistry();
        mockVault = new MockVaultERC1155Sched();

        ComponentRegistry impl = new ComponentRegistry();
        address proxy = LibClone.deployERC1967(address(impl));
        componentRegistry = ComponentRegistry(proxy);
        componentRegistry.initialize(protocol);

        // The factory clones THIS, so it must be a real implementation and not itself a clone.
        address erc1155Impl_ = address(new ERC1155Instance());
        factory = new ERC1155Factory(
            address(mockRegistry), mockGMR, address(componentRegistry), address(0xBEEF), erc1155Impl_
        );
        vm.stopPrank();

        // A real timestamp: `_validateSchedule` compares a close time against `block.timestamp` when
        // an edition opens immediately, and forge starts at 1.
        vm.warp(1_700_000_000);
    }

    function _deploy() internal returns (ERC1155Instance) {
        vm.prank(creator);
        address inst = factory.createInstance(
            _nextSalt(),
            ERC1155Factory.CreateParams({
                name: "ScheduledEdition",
                symbol: "",
                metadataURI: "ipfs://meta",
                creator: creator,
                vault: address(mockVault),
                styleUri: "",
                gatingModule: address(0),
                freeMint: FreeMintParams({ allocation: 0, scope: GatingScope.BOTH })
            })
        );
        return ERC1155Instance(payable(inst));
    }

    /// An unlimited edition, open now, with whatever schedule the case is about.
    function _addEdition(ERC1155Instance inst, uint256 openTime, uint256 closeTime, uint256 maxPerWallet)
        internal
        returns (uint256 editionId)
    {
        vm.prank(creator);
        inst.addEdition(
            "Piece",
            PRICE,
            0,
            "ipfs://edition",
            ERC1155Instance.PricingModel.UNLIMITED,
            0,
            openTime,
            0,
            closeTime,
            maxPerWallet
        );
        return inst.nextEditionId() - 1;
    }

    function _mint(ERC1155Instance inst, address who, uint256 editionId, uint256 amount) internal {
        vm.deal(who, 100 ether);
        vm.prank(who);
        inst.mint{ value: PRICE * amount }(editionId, amount, "", "", 0);
    }

    // ── the close time ────────────────────────────────────────────────────────

    function test_schedule_mintSucceedsBeforeClose() public {
        ERC1155Instance inst = _deploy();
        uint256 id = _addEdition(inst, 0, block.timestamp + 1 days, 0);

        vm.warp(block.timestamp + 23 hours);
        _mint(inst, user1, id, 1);
        assertEq(inst.balanceOf(user1, id), 1, "a mint inside the window is a mint");
    }

    function test_schedule_mintRevertsAtCloseTime() public {
        ERC1155Instance inst = _deploy();
        uint256 closeTime = block.timestamp + 1 days;
        uint256 id = _addEdition(inst, 0, closeTime, 0);

        // Exclusive on this side, the way `openTime` is on its own: an edition is over AT its close.
        vm.warp(closeTime);
        vm.deal(user1, 1 ether);
        vm.prank(user1);
        vm.expectRevert(EditionClosed.selector);
        inst.mint{ value: PRICE }(id, 1, "", "", 0);
    }

    function test_schedule_mintRevertsAfterClose() public {
        ERC1155Instance inst = _deploy();
        uint256 id = _addEdition(inst, 0, block.timestamp + 1 days, 0);

        vm.warp(block.timestamp + 8 days);
        vm.deal(user1, 1 ether);
        vm.prank(user1);
        vm.expectRevert(EditionClosed.selector);
        inst.mint{ value: PRICE }(id, 1, "", "", 0);
    }

    function test_schedule_freeClaimRevertsAfterClose() public {
        ERC1155Instance inst = _deploy();
        uint256 closeTime = block.timestamp + 1 days;
        vm.prank(creator);
        inst.addEdition(
            "Piece", PRICE, 100, "ipfs://edition", ERC1155Instance.PricingModel.LIMITED_FIXED, 0, 0, 10, closeTime, 0
        );
        uint256 id = inst.nextEditionId() - 1;

        vm.warp(closeTime + 1);
        vm.prank(user1);
        vm.expectRevert(EditionClosed.selector);
        inst.claimFreeMint(id, "");
    }

    function test_schedule_noCloseTimeRunsForever() public {
        ERC1155Instance inst = _deploy();
        uint256 id = _addEdition(inst, 0, 0, 0);

        vm.warp(block.timestamp + 3650 days);
        _mint(inst, user1, id, 1);
        assertEq(inst.balanceOf(user1, id), 1, "0 = never closes, unchanged from before the schedule");
    }

    function test_schedule_openAndCloseBothHold() public {
        ERC1155Instance inst = _deploy();
        uint256 opensAt = block.timestamp + 1 days;
        uint256 closesAt = opensAt + 1 days;
        uint256 id = _addEdition(inst, opensAt, closesAt, 0);

        vm.deal(user1, 1 ether);
        vm.prank(user1);
        vm.expectRevert(EditionNotOpen.selector);
        inst.mint{ value: PRICE }(id, 1, "", "", 0);

        vm.warp(opensAt);
        _mint(inst, user1, id, 1);

        vm.warp(closesAt);
        vm.prank(user1);
        vm.expectRevert(EditionClosed.selector);
        inst.mint{ value: PRICE }(id, 1, "", "", 0);
    }

    // ── a close time that was already over ────────────────────────────────────

    function test_schedule_rejectsCloseBeforeOpen() public {
        ERC1155Instance inst = _deploy();
        uint256 opensAt = block.timestamp + 7 days;
        vm.prank(creator);
        vm.expectRevert(InvalidCloseTime.selector);
        inst.addEdition(
            "Piece", PRICE, 0, "ipfs://edition", ERC1155Instance.PricingModel.UNLIMITED, 0, opensAt, 0, opensAt - 1, 0
        );
    }

    function test_schedule_rejectsCloseEqualToOpen() public {
        ERC1155Instance inst = _deploy();
        uint256 opensAt = block.timestamp + 7 days;
        vm.prank(creator);
        vm.expectRevert(InvalidCloseTime.selector);
        inst.addEdition(
            "Piece", PRICE, 0, "ipfs://edition", ERC1155Instance.PricingModel.UNLIMITED, 0, opensAt, 0, opensAt, 0
        );
    }

    function test_schedule_rejectsCloseInThePastOnAnImmediateEdition() public {
        ERC1155Instance inst = _deploy();
        vm.prank(creator);
        vm.expectRevert(InvalidCloseTime.selector);
        inst.addEdition(
            "Piece", PRICE, 0, "ipfs://edition", ERC1155Instance.PricingModel.UNLIMITED, 0, 0, 0, block.timestamp - 1, 0
        );
    }

    // ── the per-wallet ceiling ────────────────────────────────────────────────

    function test_ceiling_holdsAcrossSeparateMints() public {
        ERC1155Instance inst = _deploy();
        uint256 id = _addEdition(inst, 0, 0, 3);

        _mint(inst, user1, id, 2);
        _mint(inst, user1, id, 1);

        vm.deal(user1, 1 ether);
        vm.prank(user1);
        vm.expectRevert(ExceedsWalletLimit.selector);
        inst.mint{ value: PRICE }(id, 1, "", "", 0);
    }

    function test_ceiling_rejectsOneOversizedMint() public {
        ERC1155Instance inst = _deploy();
        uint256 id = _addEdition(inst, 0, 0, 3);

        vm.deal(user1, 1 ether);
        vm.prank(user1);
        vm.expectRevert(ExceedsWalletLimit.selector);
        inst.mint{ value: PRICE * 4 }(id, 4, "", "", 0);
    }

    function test_ceiling_isPerWalletNotPerEdition() public {
        ERC1155Instance inst = _deploy();
        uint256 id = _addEdition(inst, 0, 0, 2);

        _mint(inst, user1, id, 2);
        _mint(inst, user2, id, 2);

        assertEq(inst.balanceOf(user1, id), 2);
        assertEq(inst.balanceOf(user2, id), 2);
    }

    /// The ceiling is counted off what a wallet MINTED, never off what it still holds — otherwise one
    /// wallet empties itself between mints and takes the whole edition.
    function test_ceiling_survivesTransferringTokensAway() public {
        ERC1155Instance inst = _deploy();
        uint256 id = _addEdition(inst, 0, 0, 2);

        _mint(inst, user1, id, 2);
        vm.prank(user1);
        inst.safeTransferFrom(user1, nobody, id, 2, "");
        assertEq(inst.balanceOf(user1, id), 0, "emptied itself");

        vm.deal(user1, 1 ether);
        vm.prank(user1);
        vm.expectRevert(ExceedsWalletLimit.selector);
        inst.mint{ value: PRICE }(id, 1, "", "", 0);
    }

    /// One ceiling over both paths: a free claim is a token off the same allowance.
    function test_ceiling_freeClaimCountsAgainstIt() public {
        ERC1155Instance inst = _deploy();
        vm.prank(creator);
        inst.addEdition(
            "Piece", PRICE, 100, "ipfs://edition", ERC1155Instance.PricingModel.LIMITED_FIXED, 0, 0, 10, 0, 1
        );
        uint256 id = inst.nextEditionId() - 1;

        vm.prank(user1);
        inst.claimFreeMint(id, "");
        assertEq(inst.balanceOf(user1, id), 1);

        vm.deal(user1, 1 ether);
        vm.prank(user1);
        vm.expectRevert(ExceedsWalletLimit.selector);
        inst.mint{ value: PRICE }(id, 1, "", "", 0);
    }

    function test_ceiling_paidMintsBlockAFreeClaim() public {
        ERC1155Instance inst = _deploy();
        vm.prank(creator);
        inst.addEdition(
            "Piece", PRICE, 100, "ipfs://edition", ERC1155Instance.PricingModel.LIMITED_FIXED, 0, 0, 10, 0, 2
        );
        uint256 id = inst.nextEditionId() - 1;

        _mint(inst, user1, id, 2);

        vm.prank(user1);
        vm.expectRevert(ExceedsWalletLimit.selector);
        inst.claimFreeMint(id, "");
    }

    function test_ceiling_zeroIsNoCeiling() public {
        ERC1155Instance inst = _deploy();
        uint256 id = _addEdition(inst, 0, 0, 0);

        _mint(inst, user1, id, 50);
        assertEq(inst.balanceOf(user1, id), 50, "0 = no ceiling, unchanged from before the schedule");
    }

    function test_ceiling_tracksMintedPerWallet() public {
        ERC1155Instance inst = _deploy();
        uint256 id = _addEdition(inst, 0, 0, 0);

        _mint(inst, user1, id, 3);
        assertEq(inst.editionMintedBy(id, user1), 3);
        assertEq(inst.editionMintedBy(id, user2), 0);
    }

    // ── correctable until the first sale ──────────────────────────────────────

    function test_reschedule_beforeAnyMint() public {
        ERC1155Instance inst = _deploy();
        uint256 id = _addEdition(inst, 0, 0, 0);

        uint256 closesAt = block.timestamp + 2 days;
        vm.prank(creator);
        inst.setEditionSchedule(id, closesAt, 4);

        assertEq(inst.editionCloseTime(id), closesAt);
        assertEq(inst.editionMaxPerWallet(id), 4);

        vm.warp(closesAt);
        vm.deal(user1, 1 ether);
        vm.prank(user1);
        vm.expectRevert(EditionClosed.selector);
        inst.mint{ value: PRICE }(id, 1, "", "", 0);
    }

    function test_reschedule_refusedAfterTheFirstMint() public {
        ERC1155Instance inst = _deploy();
        uint256 id = _addEdition(inst, 0, block.timestamp + 1 days, 0);

        _mint(inst, user1, id, 1);

        vm.prank(creator);
        vm.expectRevert(EditionAlreadyMinted.selector);
        inst.setEditionSchedule(id, block.timestamp + 30 days, 0);
    }

    function test_reschedule_refusedAfterAFreeClaim() public {
        ERC1155Instance inst = _deploy();
        vm.prank(creator);
        inst.addEdition(
            "Piece", PRICE, 100, "ipfs://edition", ERC1155Instance.PricingModel.LIMITED_FIXED, 0, 0, 10, 0, 0
        );
        uint256 id = inst.nextEditionId() - 1;

        vm.prank(user1);
        inst.claimFreeMint(id, "");

        vm.prank(creator);
        vm.expectRevert(EditionAlreadyMinted.selector);
        inst.setEditionSchedule(id, block.timestamp + 30 days, 0);
    }

    function test_reschedule_canClearACloseTime() public {
        ERC1155Instance inst = _deploy();
        uint256 id = _addEdition(inst, 0, block.timestamp + 1 days, 2);

        vm.prank(creator);
        inst.setEditionSchedule(id, 0, 0);

        vm.warp(block.timestamp + 365 days);
        _mint(inst, user1, id, 10);
        assertEq(inst.balanceOf(user1, id), 10, "cleared before any sale, so the edition runs open-ended");
    }

    function test_reschedule_rejectsACloseTimeBeforeTheOpen() public {
        ERC1155Instance inst = _deploy();
        uint256 opensAt = block.timestamp + 7 days;
        uint256 id = _addEdition(inst, opensAt, 0, 0);

        vm.prank(creator);
        vm.expectRevert(InvalidCloseTime.selector);
        inst.setEditionSchedule(id, opensAt - 1, 0);
    }

    function test_reschedule_refusedForANonOwner() public {
        ERC1155Instance inst = _deploy();
        uint256 id = _addEdition(inst, 0, 0, 0);

        vm.prank(nobody);
        vm.expectRevert(Unauthorized.selector);
        inst.setEditionSchedule(id, block.timestamp + 1 days, 0);
    }

    function test_reschedule_refusedForAnUnknownEdition() public {
        ERC1155Instance inst = _deploy();
        vm.prank(creator);
        vm.expectRevert(EditionNotFound.selector);
        inst.setEditionSchedule(999, block.timestamp + 1 days, 0);
    }

    function test_schedule_emitsOnlyWhenThereIsOne() public {
        ERC1155Instance inst = _deploy();

        vm.recordLogs();
        _addEdition(inst, 0, 0, 0);
        bytes32 topic = keccak256("EditionScheduleSet(uint256,uint256,uint256)");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            assertTrue(logs[i].topics[0] != topic, "no schedule, no event");
        }

        uint256 id = _addEdition(inst, 0, block.timestamp + 1 days, 5);
        assertEq(inst.editionCloseTime(id), block.timestamp + 1 days);
        assertEq(inst.editionMaxPerWallet(id), 5);
    }
}
