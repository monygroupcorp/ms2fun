// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import {
    ERC721AuctionInstance,
    NoFeesToClaim,
    TokenDoesNotExist
} from "../../../src/factories/erc721/ERC721AuctionInstance.sol";

// ── Mocks ────────────────────────────────────────────────────────────────────

/// @dev Registry stub covering the methods the claim and settlement paths reach.
contract MockRegistryClaim721 {
    function isVaultRegistered(address) external pure returns (bool) {
        return true;
    }
}

/// @dev A liquidity-family vault that pays the benefactor by PUSHING ETH, the way the real vaults do.
contract MockPayingVaultClaim721 {
    uint256 public payout;

    function setPayout(uint256 p) external {
        payout = p;
    }

    function vaultType() external pure returns (string memory) {
        return "ZAMMLP";
    }

    function receiveContribution(address, uint256, address) external payable { }

    function claimFees() external returns (uint256 ethClaimed) {
        ethClaimed = payout;
        payout = 0;
        (bool ok,) = payable(msg.sender).call{ value: ethClaimed }("");
        require(ok, "push failed");
    }

    receive() external payable { }
}

/// @dev A vault that REPORTS a claim it never pays. This is the shape of any vault whose payout lands
///      somewhere other than the caller — the three LP families pay `benefactorDelegate[msg.sender]`
///      when one is set and still return the amount.
contract MockReportingVaultClaim721 {
    uint256 public reported;

    function setReported(uint256 r) external {
        reported = r;
    }

    function vaultType() external pure returns (string memory) {
        return "ZAMMLP";
    }

    function receiveContribution(address, uint256, address) external payable { }

    function claimFees() external view returns (uint256 ethClaimed) {
        ethClaimed = reported; // reports the figure, pays the caller nothing
    }

    receive() external payable { }
}

// ── Tests ────────────────────────────────────────────────────────────────────

/// @notice Covers the single-vault claim path. The auction instance is the only instance family that
///         custodies third-party ETH between blocks — every queued creator's deposit and every live
///         high bid sits here until the piece settles — so `claimVaultFees` must forward only what a
///         vault actually delivered, never the figure it reports.
contract ERC721ClaimVaultFeesTest is Test {
    address internal creator = address(0xC0FFEE);
    address internal treasury = address(0x7EA);
    address internal bidder = address(0xB1D);
    address internal gmr = address(0xDEAD);

    MockRegistryClaim721 internal registry;

    function _deploy(address vault) internal returns (ERC721AuctionInstance inst) {
        registry = new MockRegistryClaim721();
        ERC721AuctionInstance.ConstructorParams memory p = ERC721AuctionInstance.ConstructorParams({
            vault: vault,
            protocolTreasury: treasury,
            owner: creator,
            name: "AuctionClaim",
            symbol: "ACL",
            metadataURI: "ipfs://meta",
            lines: 1,
            baseDuration: 1 hours,
            timeBuffer: 5 minutes,
            bidIncrement: 0.01 ether,
            globalMessageRegistry: gmr,
            masterRegistry: address(registry),
            factory: address(0xFAC7),
            weth: address(0)
        });
        inst = new ERC721AuctionInstance(p);
    }

    /// @dev Fill the instance with other people's money: one queued deposit and one live high bid.
    function _loadEscrow(ERC721AuctionInstance inst) internal {
        vm.deal(creator, 1.5 ether);
        vm.prank(creator);
        inst.queuePiece{ value: 1 ether }("ipfs://piece-1");
        vm.deal(bidder, 5 ether);
        vm.prank(bidder);
        inst.createBid{ value: 5 ether }(1, "");
        assertEq(address(inst).balance, 6 ether, "escrow = creator deposit + live high bid");
    }

    // ── claimVaultFees ────────────────────────────────────────────────────────

    /// @dev A vault that reports fees it never delivered must move nothing. Before the balance-delta
    ///      measurement this forwarded 4 ETH of bidder and creator escrow to the owner, after which
    ///      the piece could no longer settle.
    function test_claimVaultFees_reportedButUnpaidLeavesEscrowIntact() public {
        MockReportingVaultClaim721 vault = new MockReportingVaultClaim721();
        ERC721AuctionInstance inst = _deploy(address(vault));
        _loadEscrow(inst);

        vault.setReported(4 ether);

        uint256 ownerBefore = creator.balance;
        vm.prank(creator);
        vm.expectRevert(NoFeesToClaim.selector);
        inst.claimVaultFees();

        assertEq(creator.balance, ownerBefore, "owner paid nothing the vault did not deliver");
        assertEq(address(inst).balance, 6 ether, "custodied bid and deposit untouched");
    }

    /// @dev The escrow survives the drain attempt intact: the piece still settles and the winner is
    ///      minted. This is the consequence the measurement protects, not just the balance.
    function test_settleAuctionStillSucceedsAfterAReportingVaultClaim() public {
        MockReportingVaultClaim721 vault = new MockReportingVaultClaim721();
        ERC721AuctionInstance inst = _deploy(address(vault));
        _loadEscrow(inst);

        vault.setReported(4 ether);
        vm.prank(creator);
        vm.expectRevert(NoFeesToClaim.selector);
        inst.claimVaultFees();

        vm.warp(block.timestamp + 2 hours);
        inst.settleAuction(1);

        assertEq(inst.ownerOf(1), bidder, "winner holds the piece");
        assertEq(address(inst).balance, 0, "the settled piece's escrow is fully paid out");
    }

    /// @dev An honest vault that pushes ETH: the owner receives exactly what arrived, and the escrow
    ///      it was pushed alongside is left alone.
    function test_claimVaultFees_forwardsExactlyWhatThePayingVaultDelivered() public {
        MockPayingVaultClaim721 vault = new MockPayingVaultClaim721();
        ERC721AuctionInstance inst = _deploy(address(vault));
        _loadEscrow(inst);

        vm.deal(address(vault), 3 ether);
        vault.setPayout(3 ether);

        uint256 ownerBefore = creator.balance;
        vm.prank(creator);
        uint256 claimed = inst.claimVaultFees();

        assertEq(claimed, 3 ether, "the delivered amount is reported back");
        assertEq(creator.balance - ownerBefore, 3 ether, "owner receives exactly what arrived");
        assertEq(address(inst).balance, 6 ether, "escrow untouched");
    }

    /// @dev Nothing delivered → NoFeesToClaim, as before.
    function test_claimVaultFees_revertsWhenNothingArrives() public {
        MockPayingVaultClaim721 vault = new MockPayingVaultClaim721();
        ERC721AuctionInstance inst = _deploy(address(vault));

        vm.prank(creator);
        vm.expectRevert(NoFeesToClaim.selector);
        inst.claimVaultFees();
    }

    /// @dev Only the owner may claim.
    function test_claimVaultFees_onlyOwner() public {
        MockPayingVaultClaim721 vault = new MockPayingVaultClaim721();
        ERC721AuctionInstance inst = _deploy(address(vault));

        vm.prank(address(0xBAD));
        vm.expectRevert();
        inst.claimVaultFees();
    }

    // ── tokenURI ──────────────────────────────────────────────────────────────

    /// @dev `tokenURI` narrows its argument to the `uint24` id space the contract actually mints in.
    ///      An id above that space must not alias down onto a minted piece and report its art, and a
    ///      queued-but-unminted id must revert rather than return the empty string.
    function test_tokenURI_revertsForUnmintedAndAliasedIds() public {
        MockPayingVaultClaim721 vault = new MockPayingVaultClaim721();
        ERC721AuctionInstance inst = _deploy(address(vault));
        _loadEscrow(inst);

        vm.prank(creator);
        inst.queuePiece{ value: 0.5 ether }("ipfs://piece-2"); // queued behind it, never minted

        vm.expectRevert(TokenDoesNotExist.selector);
        inst.tokenURI(2);

        // 2**24 + 1 truncates to 1, which IS minted below — the check must be made on the full id.
        vm.warp(block.timestamp + 2 hours);
        inst.settleAuction(1);
        assertEq(inst.tokenURI(1), "ipfs://piece-1", "the minted piece reads back its own art");

        vm.expectRevert(TokenDoesNotExist.selector);
        inst.tokenURI(uint256(2) ** 24 + 1);
    }
}
