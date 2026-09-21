// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC721AuctionInstance } from "../../src/factories/erc721/ERC721AuctionInstance.sol";
import { RoyaltyLib } from "../../src/shared/libraries/RoyaltyLib.sol";
import { MockRevertingVault } from "../mocks/MockRevertingVault.sol";

/// @dev The registry read the settle path makes. Royalty never touches settlement, so an
///      always-registered stub is enough to construct.
contract MockMRRoyalty {
    function isAgent(address) external pure returns (bool) {
        return false;
    }

    function isVaultRegistered(address) external pure returns (bool) {
        return true;
    }
}

/**
 * @title Erc2981RoyaltyTest
 * @notice EIP-2981 on the ERC-721 auction family.
 *
 * WHY ONLY THIS FAMILY. The goal that produced this asked for royalties across all three factories.
 * Two of them cannot take it, for two different reasons, and neither is an oversight:
 *
 * - **ERC-404** has no marketplace sale to withhold a royalty from. A graduated ERC-404 trades as a
 *   coin in an AMM pool, not as a listing; the NFT leg a marketplace would probe is Solady's
 *   `DN404Mirror`, a vendored dependency noesis does not author. Its post-primary value already
 *   flows through the Uniswap V4 alignment hook — to the community rather than the creator, and
 *   only on that one venue (`docs/phases/vault-flavors.md`).
 *
 * - **ERC-1155 is blocked on EIP-170, measured.** `ERC1155Factory` embeds the whole of
 *   `ERC1155Instance`'s creation code in its own runtime, so a byte added to the instance is a byte
 *   added to the factory. The factory stands 561B under the 24,576B limit before this feature. A
 *   full implementation matching this one costs it 976B; stripped to the bone — no event, no
 *   configurable receiver, one setter — it still costs 534B and leaves 27B. There is no version of
 *   EIP-2981 that fits. The lever is the one `test/metadata/InstanceBytecodeSize.t.sol` already
 *   names: get that initcode out of the factory. That changes deployed addresses and the deploy
 *   scripts, so it is its own piece of work and not a rider on this one.
 *
 * The invariant that matters most here is the one the last tests name: a royalty and the 19%
 * alignment tithe are separate systems. The tithe is levied on PRIMARY settlement and cannot reach
 * a resale; the royalty is quoted on a resale and cannot reach the vault. Two creator-facing
 * surfaces used to say otherwise.
 */
contract Erc2981RoyaltyTest is Test {
    ERC721AuctionInstance internal auctions;

    address internal creator = address(0xC1);
    address internal newOwner = address(0xC2);
    address internal splitter = address(0x5911);
    address internal treasury = address(0xFEE);
    address internal vaultAddr;
    address internal gmr = address(0x6D72);
    address internal weth = address(0xE770);

    /// @dev Constructed with `factory = address(this)`, so this test contract IS the factory for
    ///      `initializeRoyalty` and exercises the real create-time path.
    function setUp() public {
        vaultAddr = address(new MockRevertingVault());
        auctions = new ERC721AuctionInstance(
            ERC721AuctionInstance.ConstructorParams({
                vault: vaultAddr,
                protocolTreasury: treasury,
                owner: creator,
                name: "Auctions",
                symbol: "AUC",
                metadataURI: "",
                lines: 1,
                baseDuration: 1 days,
                timeBuffer: 10 minutes,
                bidIncrement: 0.05 ether,
                globalMessageRegistry: gmr,
                masterRegistry: address(new MockMRRoyalty()),
                factory: address(this),
                weth: weth
            })
        );
    }

    // ── Interface detection ───────────────────────────────────────────────────

    /// @dev A marketplace probes ERC-165 once at index time. If the answer is false there it never
    ///      asks for a rate again, so the instance must answer before any rate is set.
    function test_supportsInterface_answers2981_beforeAnyRateIsSet() public view {
        assertEq(auctions.royaltyBps(), 0, "starts unset");
        assertTrue(auctions.supportsInterface(0x2a55205a), "must answer EIP-2981");
    }

    function test_supportsInterface_keepsItsExistingAnswers() public view {
        assertTrue(auctions.supportsInterface(0x01ffc9a7), "ERC-165");
        assertTrue(auctions.supportsInterface(0x80ac58cd), "ERC-721");
        assertTrue(auctions.supportsInterface(0x5b5e139f), "ERC-721 metadata");
    }

    /// @dev ERC-165 requires `false` for 0xffffffff, and a probe must never revert.
    function test_supportsInterface_isFalseAndQuietForUnknownIds() public view {
        assertFalse(auctions.supportsInterface(0xffffffff), "0xffffffff");
        assertFalse(auctions.supportsInterface(0xdeadbeef), "unknown id");
    }

    // ── Quoting ───────────────────────────────────────────────────────────────

    /// @dev Unset means "this collection asks for nothing", which is what every collection deployed
    ///      before this field existed reports.
    function test_royaltyInfo_unsetQuotesNothing() public view {
        (address r, uint256 owed) = auctions.royaltyInfo(1, 100 ether);
        assertEq(owed, 0, "owes nothing unset");
        assertEq(r, address(0), "names nobody unset");
    }

    function test_royaltyInfo_quotesTheCreatorAtTheSetRate() public {
        auctions.initializeRoyalty(address(0), 500);
        (address r, uint256 owed) = auctions.royaltyInfo(7, 10 ether);
        assertEq(r, creator, "pays the creator");
        assertEq(owed, 0.5 ether, "5% of 10 ether");
    }

    /// @dev Collection-wide by design: the rate is a property of the creator's terms, not of a
    ///      piece, and a token that was never minted is still quoted rather than reverted — a revert
    ///      makes a marketplace treat the whole collection as royalty-less.
    function test_royaltyInfo_isCollectionWideAndQuietOnUnknownIds() public {
        auctions.initializeRoyalty(address(0), 250);
        (, uint256 low) = auctions.royaltyInfo(1, 4 ether);
        (, uint256 high) = auctions.royaltyInfo(type(uint256).max, 4 ether);
        assertEq(low, high, "every id quotes the same rate");
        assertEq(low, 0.1 ether, "2.5% of 4 ether");
    }

    /// @dev Floor division, so a quote can never exceed the rate the creator asked for.
    function test_royaltyInfo_roundsDownSoItNeverOverQuotes() public {
        auctions.initializeRoyalty(address(0), 333);
        (, uint256 owed) = auctions.royaltyInfo(1, 1000); // 1000 * 333 / 10000 = 33.3
        assertEq(owed, 33, "floored, not rounded");
        assertLe(owed * 10_000, 1000 * uint256(333), "never over-quotes");
    }

    // ── Who gets paid ─────────────────────────────────────────────────────────

    /// @dev The default receiver is resolved at READ time, not written at create. A creator who
    ///      rotates the owner — a compromised key, a hand-off to a studio — otherwise keeps quoting
    ///      a dead address to every marketplace forever with no signal that it went stale.
    function test_defaultReceiverFollowsOwnershipInsteadOfGoingStale() public {
        auctions.initializeRoyalty(address(0), 1000);
        (address before,) = auctions.royaltyInfo(1, 1 ether);
        assertEq(before, creator, "quotes the creator first");

        vm.prank(creator);
        auctions.transferOwnership(newOwner);

        (address afterRotation,) = auctions.royaltyInfo(1, 1 ether);
        assertEq(afterRotation, newOwner, "follows the owner");
    }

    /// @dev An explicit receiver is for collaboration splits and payment splitters, and is honored
    ///      as written — it does NOT follow the owner.
    function test_explicitReceiverIsHonoredAndDoesNotFollowOwnership() public {
        auctions.initializeRoyalty(splitter, 750);
        vm.prank(creator);
        auctions.transferOwnership(newOwner);

        (address r, uint256 owed) = auctions.royaltyInfo(1, 8 ether);
        assertEq(r, splitter, "explicit receiver stands");
        assertEq(owed, 0.6 ether, "7.5% of 8 ether");
    }

    // ── Changing it ───────────────────────────────────────────────────────────

    function test_setRoyalty_isOwnerOnly() public {
        vm.prank(address(0xBAD));
        vm.expectRevert();
        auctions.setRoyalty(address(0xBAD), 1000);
    }

    function test_setRoyalty_changesBothFields() public {
        auctions.initializeRoyalty(address(0), 500);
        vm.prank(creator);
        auctions.setRoyalty(splitter, 100);

        (address r, uint256 owed) = auctions.royaltyInfo(1, 10 ether);
        assertEq(r, splitter, "receiver moved");
        assertEq(owed, 0.1 ether, "rate moved");
    }

    /// @dev Turning it back off is always allowed. A creator who set a rate and regretted it should
    ///      not have to redeploy to stop asking for one.
    function test_setRoyalty_canTurnItBackOff() public {
        auctions.initializeRoyalty(address(0), 1000);
        vm.prank(creator);
        auctions.setRoyalty(address(0), 0);

        (address r, uint256 owed) = auctions.royaltyInfo(1, 10 ether);
        assertEq(owed, 0, "owes nothing again");
        assertEq(r, address(0), "names nobody again");
        assertTrue(auctions.supportsInterface(0x2a55205a), "still answers the interface");
    }

    // ── The cap ───────────────────────────────────────────────────────────────

    /// @dev The cap is what stops a creator publishing a rate that makes their work unsellable at
    ///      every venue that honors EIP-2981 at all.
    function test_cap_refusesAnOverCapRateAtCreate() public {
        uint16 over = RoyaltyLib.MAX_ROYALTY_BPS + 1;
        vm.expectRevert(abi.encodeWithSelector(RoyaltyLib.RoyaltyTooHigh.selector, over, RoyaltyLib.MAX_ROYALTY_BPS));
        auctions.initializeRoyalty(address(0), over);
    }

    function test_cap_refusesAnOverCapRateLater() public {
        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(RoyaltyLib.RoyaltyTooHigh.selector, uint16(10_000), RoyaltyLib.MAX_ROYALTY_BPS)
        );
        auctions.setRoyalty(address(0), 10_000);
    }

    function test_cap_allowsExactlyTheCap() public {
        auctions.initializeRoyalty(address(0), RoyaltyLib.MAX_ROYALTY_BPS);
        (, uint256 owed) = auctions.royaltyInfo(1, 100 ether);
        assertEq(owed, 10 ether, "10% of 100 ether");
    }

    // ── Who may set it at create ──────────────────────────────────────────────

    function test_initializeRoyalty_isFactoryOnly() public {
        vm.prank(creator);
        vm.expectRevert();
        auctions.initializeRoyalty(address(0), 500);
    }

    /// @dev Once the factory has set it, only the owner may change it — the protocol must not be
    ///      able to reach into a deployed collection and alter what its creator asks for.
    function test_initializeRoyalty_isOnceOnly() public {
        auctions.initializeRoyalty(address(0), 500);
        vm.expectRevert();
        auctions.initializeRoyalty(address(0), 100);
    }

    // ── The separation this whole change exists to make true ──────────────────

    /**
     * A royalty and the 19% alignment tithe are separate systems, and the app said for months that
     * they were one: the wizard's alignment step and the `/learn` explainer both told a creator the
     * community takes 19% "on every resale". Nothing did.
     *
     * This pins the half that is a contract fact. A royalty quote names the creator or the address
     * the creator nominated, and never the alignment vault or the protocol treasury — so nobody can
     * later read `royaltyInfo` as the resale leg of the tithe. The other half, that a resale pays
     * the vault nothing, is structural: the instance overrides no transfer to charge for one.
     */
    function test_aRoyaltyQuoteNeverNamesTheVaultOrTheTreasury() public {
        auctions.initializeRoyalty(address(0), 1000);
        (address r,) = auctions.royaltyInfo(1, 100 ether);
        assertTrue(r != vaultAddr && r != treasury, "a royalty is not the tithe");
        assertEq(r, creator, "it pays the creator");
    }

    /// @dev Setting a royalty moves no ETH and no accounting. The 19% is settled out of the winning
    ///      bid at `settleAuction`; a royalty must never touch that path, or a marketplace transfer
    ///      would start paying the vault a second time.
    function test_settingARoyaltyTouchesNoSettlementAccounting() public {
        uint256 pendingBefore = auctions.pendingVaultCut();

        auctions.initializeRoyalty(address(0), 1000);
        vm.prank(creator);
        auctions.setRoyalty(splitter, 500);

        assertEq(auctions.pendingVaultCut(), pendingBefore, "no vault cut accrued");
        assertEq(address(auctions).balance, 0, "no ETH moved");
        assertEq(vaultAddr.balance, 0, "the vault was not paid");
    }
}
