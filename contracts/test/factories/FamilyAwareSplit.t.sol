// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC1155Instance } from "../../src/factories/erc1155/ERC1155Instance.sol";
import { ERC721AuctionInstance } from "../../src/factories/erc721/ERC721AuctionInstance.sol";
import { RevenueSplitLib } from "../../src/shared/libraries/RevenueSplitLib.sol";
import { MockFamilyVault } from "../mocks/MockFamilyVault.sol";

contract MockGMRFam {
    function postForAction(address, address, bytes calldata) external { }
}

contract MockMRFam {
    function isAgent(address) external pure returns (bool) {
        return false;
    }

    // noesis-113: the settle path now reads `masterRegistry.isVaultRegistered(vault)` before the tithe.
    // These tests exercise the NORMAL (active-target) settle, so the registry answers true — unchanged path.
    function isVaultRegistered(address) external pure returns (bool) {
        return true;
    }
    function migrateVault(address, address) external { }

    function getInstanceVaults(address) external pure returns (address[] memory) {
        return new address[](0);
    }
}

/// @notice Settlement split at the instance level, driven down each branch by swapping the vault's
///         `vaultType()`. The split is FAMILY-BLIND — 1% protocol / 19% vault / 80% creator, whichever
///         family the pinned genesis vault belongs to — so the branches must agree to the wei. The family
///         read survives only as a deploy-config guard, so an unknown `vaultType()` still reverts.
contract FamilyBlindSplitTest is Test {
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
            false,
            "", // metadataURI (contractURI)
            "" // symbol (optional)
        );
        vm.prank(CREATOR);
        inst.addEdition("Piece", 1 ether, 0, "ipfs://m", ERC1155Instance.PricingModel.UNLIMITED, 0, 0, 0);
        vm.prank(BUYER);
        inst.mint{ value: 1 ether }(1, 1, bytes(""), "", 0);
    }

    function test_1155_yieldFamily_takes_1_19_80() public {
        (ERC1155Instance inst, MockFamilyVault vault) = _deploy1155("AaveEndowment");

        uint256 vaultBefore = address(vault).balance;
        uint256 treasuryBefore = TREASURY.balance;
        uint256 creatorBefore = CREATOR.balance;

        vm.prank(CREATOR);
        inst.withdraw(1 ether);

        // The endowment's inverted 1/80/19 is gone with the vesting duality it fed: the vault takes the
        // same 19% here it takes everywhere.
        assertEq(TREASURY.balance - treasuryBefore, 0.01 ether, "protocol 1%");
        assertEq(address(vault).balance - vaultBefore, 0.19 ether, "endowment vault 19%");
        assertEq(CREATOR.balance - creatorBefore, 0.8 ether, "endowment creator 80%");
    }

    function test_1155_liquidityFamily_takes_1_19_80() public {
        // A non-Uni liquidity venue settles identically — that is the point.
        (ERC1155Instance inst, MockFamilyVault vault) = _deploy1155("CypherLP");

        uint256 vaultBefore = address(vault).balance;
        uint256 treasuryBefore = TREASURY.balance;
        uint256 creatorBefore = CREATOR.balance;

        vm.prank(CREATOR);
        inst.withdraw(1 ether);

        assertEq(TREASURY.balance - treasuryBefore, 0.01 ether, "protocol 1%");
        assertEq(address(vault).balance - vaultBefore, 0.19 ether, "liquidity vault 19%");
        assertEq(CREATOR.balance - creatorBefore, 0.8 ether, "liquidity creator 80%");
    }

    function test_1155_unknownFamily_reverts() public {
        (ERC1155Instance inst,) = _deploy1155("MysteryVault");
        vm.prank(CREATOR);
        vm.expectRevert(abi.encodeWithSelector(RevenueSplitLib.UnknownVaultFamily.selector, "MysteryVault"));
        inst.withdraw(1 ether);
    }

    function test_1155_bothFamilies_conserveValue() public {
        // Sum of every leg equals the withdrawn amount whichever family is bound (no wei leak/mint).
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
                metadataURI: "",
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
        inst.queuePiece{ value: 0.1 ether }("ipfs://piece");
        vm.prank(BUYER);
        inst.createBid{ value: 1 ether }(1, "");
        ERC721AuctionInstance.Auction memory a = inst.getAuction(1);
        vm.warp(a.endTime);
    }

    function test_721_yieldFamily_takes_1_19_80() public {
        (ERC721AuctionInstance inst, MockFamilyVault vault) = _deploy721("AaveEndowment");

        uint256 vaultBefore = address(vault).balance;
        uint256 treasuryBefore = TREASURY.balance;
        uint256 creatorBefore = CREATOR.balance;

        inst.settleAuction(1);

        assertEq(TREASURY.balance - treasuryBefore, 0.01 ether, "protocol 1%");
        assertEq(address(vault).balance - vaultBefore, 0.19 ether, "endowment vault 19%");
        // Creator receives the queued deposit refund (0.1) plus the 80% creator leg.
        assertEq(CREATOR.balance - creatorBefore, 0.1 ether + 0.8 ether, "endowment creator 80% + deposit");
    }

    function test_721_liquidityFamily_takes_1_19_80() public {
        (ERC721AuctionInstance inst, MockFamilyVault vault) = _deploy721("ZAMMLP");

        uint256 vaultBefore = address(vault).balance;
        uint256 treasuryBefore = TREASURY.balance;
        uint256 creatorBefore = CREATOR.balance;

        inst.settleAuction(1);

        assertEq(TREASURY.balance - treasuryBefore, 0.01 ether, "protocol 1%");
        assertEq(address(vault).balance - vaultBefore, 0.19 ether, "liquidity vault 19%");
        assertEq(CREATOR.balance - creatorBefore, 0.1 ether + 0.8 ether, "liquidity creator 80% + deposit");
    }

    function test_721_unknownFamily_reverts() public {
        (ERC721AuctionInstance inst,) = _deploy721("MysteryVault");
        vm.expectRevert(abi.encodeWithSelector(RevenueSplitLib.UnknownVaultFamily.selector, "MysteryVault"));
        inst.settleAuction(1);
    }
}
