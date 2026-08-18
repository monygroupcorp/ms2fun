// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC721AuctionInstance } from "../../../src/factories/erc721/ERC721AuctionInstance.sol";

// ── Mocks ────────────────────────────────────────────────────────────────────

/// @dev Registry stub covering the three methods the settlement and sweep paths reach.
contract MockRegistryEscrow {
    address[] internal _vaults;
    bool public vaultRegistered = true;

    function setVaults(address[] memory v) external {
        _vaults = v;
    }

    function setVaultRegistered(bool r) external {
        vaultRegistered = r;
    }

    function getInstanceVaults(address) external view returns (address[] memory) {
        return _vaults;
    }

    function isVaultRegistered(address) external view returns (bool) {
        return vaultRegistered;
    }
}

/// @dev A liquidity-family vault that accepts the tithe. Its `claimFees()` REPORTS a figure it does
///      not pay — the shape of any vault whose payout lands somewhere other than the caller (the real
///      vaults pay `benefactorDelegate[msg.sender]` when one is set, and still return the amount).
contract MockReportingVaultEscrow {
    uint256 public reported;
    uint256 public received;

    function setReported(uint256 r) external {
        reported = r;
    }

    function vaultType() external pure returns (string memory) {
        return "ZAMMLP";
    }

    function receiveContribution(address, uint256 amount, address) external payable {
        received += amount;
    }

    function claimFees() external view returns (uint256 ethClaimed) {
        ethClaimed = reported; // reports, pays the caller nothing
    }

    receive() external payable { }
}

// ── Tests ────────────────────────────────────────────────────────────────────

/// @notice Pins the escrow property of the auction instance: the contract custodies other people's
///         ETH (every queued creator's deposit and the live high bid of every running line), so a
///         fee sweep must move ONLY what a vault actually delivered, and a settlement must move
///         exactly the settled piece's own deposit and bid.
contract ERC721AuctionEscrowInvariantsTest is Test {
    address internal creator = address(0xC0FFEE);
    address internal treasury = address(0x7EA);
    address internal bidder = address(0xB1D);
    address internal gmr = address(0xDEAD);

    MockRegistryEscrow internal registry;

    function _deploy(address vault) internal returns (ERC721AuctionInstance inst) {
        registry = new MockRegistryEscrow();
        ERC721AuctionInstance.ConstructorParams memory p = ERC721AuctionInstance.ConstructorParams({
            vault: vault,
            protocolTreasury: treasury,
            owner: creator,
            name: "AuctionEscrow",
            symbol: "AES",
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

    /// @dev `claimAllFees` measures what the vaults DELIVERED (balance delta), never what they
    ///      reported. A vault that returns a figure without paying must move nothing: the owner is
    ///      paid zero and the live bid + queued deposits stay in custody.
    function test_claimAllFees_paysOnlyWhatVaultsDelivered_escrowUntouched() public {
        MockReportingVaultEscrow vault = new MockReportingVaultEscrow();
        ERC721AuctionInstance inst = _deploy(address(vault));

        vm.deal(creator, 1 ether);
        vm.prank(creator);
        inst.queuePiece{ value: 1 ether }("ipfs://piece-1");
        vm.deal(bidder, 5 ether);
        vm.prank(bidder);
        inst.createBid{ value: 5 ether }(1, "");

        uint256 escrow = address(inst).balance;
        assertEq(escrow, 6 ether, "escrow = creator deposit + live high bid");

        address[] memory list = new address[](1);
        list[0] = address(vault);
        registry.setVaults(list);
        vault.setReported(4 ether); // reports 4 ETH, delivers none

        uint256 ownerBefore = creator.balance;
        vm.prank(creator);
        inst.claimAllFees();

        assertEq(creator.balance, ownerBefore, "owner paid nothing the vault did not deliver");
        assertEq(address(inst).balance, escrow, "custodied bid and deposit untouched by the sweep");
    }

    /// @dev A settlement moves exactly the settled piece's deposit and bid, and nothing belonging to
    ///      any other queued piece. Liquidity family: 1% protocol / 19% vault / 80% creator, plus the
    ///      creator's own deposit refunded in full.
    function test_settleAuction_movesOnlyTheSettledPiecesFunds() public {
        MockReportingVaultEscrow vault = new MockReportingVaultEscrow();
        ERC721AuctionInstance inst = _deploy(address(vault));

        vm.deal(creator, 1.5 ether);
        vm.startPrank(creator);
        inst.queuePiece{ value: 1 ether }("ipfs://piece-1"); // starts immediately
        inst.queuePiece{ value: 0.5 ether }("ipfs://piece-2"); // queued behind it
        vm.stopPrank();

        vm.deal(bidder, 5 ether);
        vm.prank(bidder);
        inst.createBid{ value: 5 ether }(1, "");

        assertEq(address(inst).balance, 6.5 ether, "both deposits plus the live bid are custodied");

        vm.warp(block.timestamp + 2 hours);
        uint256 ownerBefore = creator.balance;
        inst.settleAuction(1); // permissionless

        assertEq(treasury.balance, 0.05 ether, "protocol 1% of the winning bid");
        assertEq(vault.received(), 0.95 ether, "vault 19% of the winning bid");
        assertEq(creator.balance - ownerBefore, 5 ether, "creator: 80% of the bid + the full deposit back");
        assertEq(address(inst).balance, 0.5 ether, "the second piece's deposit is still in custody");
        assertEq(inst.ownerOf(1), bidder, "winner holds the piece");
    }
}
