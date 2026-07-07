// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1155Instance} from "../../src/factories/erc1155/ERC1155Instance.sol";
import {ERC721AuctionInstance} from "../../src/factories/erc721/ERC721AuctionInstance.sol";
import {RevenueSplitLib} from "../../src/shared/libraries/RevenueSplitLib.sol";
import {MockFamilyVault} from "../mocks/MockFamilyVault.sol";

contract MockGMRFam {
    function postForAction(address, address, bytes calldata) external {}
}

contract MockMRFam {
    function isAgent(address) external pure returns (bool) { return false; }
    function migrateVault(address, address) external {}
    function getInstanceVaults(address) external pure returns (address[] memory) {
        return new address[](0);
    }
}

/// @notice Family-aware settlement split, driven at the instance level down each branch by swapping
///         the vault's `vaultType()`. Liquidity → creator-80; yield → 1/80/19 (endowment,
///         unregressed); unknown → revert. Liquidity-80 for real vaults is additionally covered by
///         the factory settle/withdraw tests (which use the "UniswapV4LP" UniAlignmentVault).
contract FamilyAwareSplitTest is Test {
    address internal constant CREATOR = address(0xC1);
    address internal constant BUYER = address(0xB2);
    address internal constant TREASURY = address(0xFEE);
    address internal weth = address(0xE770);

    MockGMRFam internal gmr;
    MockMRFam internal registry;

    function setUp() public {
        gmr = new MockGMRFam();
        registry = new MockMRFam();
        vm.deal(BUYER, 100 ether);
        vm.deal(CREATOR, 10 ether);
        vm.deal(TREASURY, 1 ether);
    }

    // ── ERC1155.withdraw ──────────────────────────────────────────────────────

    function _deploy1155(string memory vt) internal returns (ERC1155Instance inst, MockFamilyVault vault) {
        vault = new MockFamilyVault(vt);
        inst = new ERC1155Instance(
            "Fam",
            CREATOR,
            address(this),
            address(vault),
            "",
            ERC1155Instance.InstanceInit({
                globalMessageRegistry: address(gmr),
                protocolTreasury: TREASURY,
                masterRegistry: address(registry),
                gatingModule: address(0),
                dynamicPricingModule: address(0),
                weth: weth
            }),
            false
        );
        vm.prank(CREATOR);
        inst.addEdition("Piece", 1 ether, 0, "ipfs://m", ERC1155Instance.PricingModel.UNLIMITED, 0, 0);
        vm.prank(BUYER);
        inst.mint{value: 1 ether}(1, 1, bytes32(0), "", 0);
    }

    function test_1155_yieldFamily_keeps_1_80_19() public {
        (ERC1155Instance inst, MockFamilyVault vault) = _deploy1155("AaveEndowment");

        uint256 vaultBefore = address(vault).balance;
        uint256 treasuryBefore = TREASURY.balance;
        uint256 creatorBefore = CREATOR.balance;

        vm.prank(CREATOR);
        inst.withdraw(1 ether);

        assertEq(TREASURY.balance - treasuryBefore, 0.01 ether, "protocol 1%");
        assertEq(address(vault).balance - vaultBefore, 0.80 ether, "yield vault 80% (endowment)");
        assertEq(CREATOR.balance - creatorBefore, 0.19 ether, "yield creator 19%");
    }

    function test_1155_liquidityFamily_flips_creator_80() public {
        // A non-Uni liquidity venue exercises the same flip through classification.
        (ERC1155Instance inst, MockFamilyVault vault) = _deploy1155("CypherLP");

        uint256 vaultBefore = address(vault).balance;
        uint256 treasuryBefore = TREASURY.balance;
        uint256 creatorBefore = CREATOR.balance;

        vm.prank(CREATOR);
        inst.withdraw(1 ether);

        assertEq(TREASURY.balance - treasuryBefore, 0.01 ether, "protocol 1%");
        assertEq(address(vault).balance - vaultBefore, 0.19 ether, "liquidity vault 19%");
        assertEq(CREATOR.balance - creatorBefore, 0.80 ether, "liquidity creator 80%");
    }

    function test_1155_unknownFamily_reverts() public {
        (ERC1155Instance inst, ) = _deploy1155("MysteryVault");
        vm.prank(CREATOR);
        vm.expectRevert(abi.encodeWithSelector(RevenueSplitLib.UnknownVaultFamily.selector, "MysteryVault"));
        inst.withdraw(1 ether);
    }

    function test_1155_bothBranches_conserveValue() public {
        // Sum of every leg equals the withdrawn amount on both branches (no wei leak/mint).
        _assert1155Conserves("AaveEndowment");
        _assert1155Conserves("ZAMMLP");
    }

    function _assert1155Conserves(string memory vt) internal {
        (ERC1155Instance inst, MockFamilyVault vault) = _deploy1155(vt);
        uint256 vaultBefore = address(vault).balance;
        uint256 treasuryBefore = TREASURY.balance;
        uint256 creatorBefore = CREATOR.balance;
        vm.prank(CREATOR);
        inst.withdraw(1 ether);
        uint256 total = (address(vault).balance - vaultBefore) + (TREASURY.balance - treasuryBefore)
            + (CREATOR.balance - creatorBefore);
        assertEq(total, 1 ether, "split does not sum to withdrawn amount");
    }

    // ── ERC721.settleAuction ──────────────────────────────────────────────────

    function _deploy721(string memory vt) internal returns (ERC721AuctionInstance inst, MockFamilyVault vault) {
        vault = new MockFamilyVault(vt);
        inst = new ERC721AuctionInstance(
            ERC721AuctionInstance.ConstructorParams({
                vault: address(vault),
                protocolTreasury: TREASURY,
                owner: CREATOR,
                name: "Fam",
                symbol: "FAM",
                lines: 1,
                baseDuration: 1 hours,
                timeBuffer: 5 minutes,
                bidIncrement: 0.01 ether,
                globalMessageRegistry: address(gmr),
                masterRegistry: address(registry),
                factory: address(this),
                weth: weth
            })
        );
        vm.prank(CREATOR);
        inst.queuePiece{value: 0.1 ether}("ipfs://piece");
        vm.prank(BUYER);
        inst.createBid{value: 1 ether}(1, "");
        ERC721AuctionInstance.Auction memory a = inst.getAuction(1);
        vm.warp(a.endTime);
    }

    function test_721_yieldFamily_keeps_1_80_19() public {
        (ERC721AuctionInstance inst, MockFamilyVault vault) = _deploy721("AaveEndowment");

        uint256 vaultBefore = address(vault).balance;
        uint256 treasuryBefore = TREASURY.balance;
        uint256 creatorBefore = CREATOR.balance;

        inst.settleAuction(1);

        assertEq(TREASURY.balance - treasuryBefore, 0.01 ether, "protocol 1%");
        assertEq(address(vault).balance - vaultBefore, 0.80 ether, "yield vault 80% (endowment)");
        // Creator receives the queued deposit refund (0.1) plus the 19% creator leg.
        assertEq(CREATOR.balance - creatorBefore, 0.1 ether + 0.19 ether, "yield creator 19% + deposit");
    }

    function test_721_liquidityFamily_flips_creator_80() public {
        (ERC721AuctionInstance inst, MockFamilyVault vault) = _deploy721("ZAMMLP");

        uint256 vaultBefore = address(vault).balance;
        uint256 treasuryBefore = TREASURY.balance;
        uint256 creatorBefore = CREATOR.balance;

        inst.settleAuction(1);

        assertEq(TREASURY.balance - treasuryBefore, 0.01 ether, "protocol 1%");
        assertEq(address(vault).balance - vaultBefore, 0.19 ether, "liquidity vault 19%");
        assertEq(CREATOR.balance - creatorBefore, 0.1 ether + 0.80 ether, "liquidity creator 80% + deposit");
    }

    function test_721_unknownFamily_reverts() public {
        (ERC721AuctionInstance inst, ) = _deploy721("MysteryVault");
        vm.expectRevert(abi.encodeWithSelector(RevenueSplitLib.UnknownVaultFamily.selector, "MysteryVault"));
        inst.settleAuction(1);
    }
}
