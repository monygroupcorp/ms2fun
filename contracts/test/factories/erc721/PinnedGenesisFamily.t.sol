// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC721AuctionInstance } from "../../../src/factories/erc721/ERC721AuctionInstance.sol";
import { MockFamilyVault } from "../../mocks/MockFamilyVault.sol";

contract MockGMRPin721 {
    function postForAction(address, address, bytes calldata) external { }
}

/// @notice Registry stub whose `migrateVault` is a no-op — lets the instance swap its live `vault`
///         pointer without the MasterRegistryV1 cross-family reject firing, isolating the instance-level
///         defense-in-depth pin.
contract MockMRPin721 {
    function isAgent(address) external pure returns (bool) {
        return false;
    }

    // noesis-113: settle reads `isVaultRegistered(vault)` before the tithe; active target → true.
    function isVaultRegistered(address) external pure returns (bool) {
        return true;
    }
    function migrateVault(address, address) external { }

    function getInstanceVaults(address) external pure returns (address[] memory) {
        return new address[](0);
    }
}

/// @notice Audit finding #2 (defense-in-depth, ERC721 auction): a vault migration must never move the
///         creator's share of settlement. It cannot, and now for a stronger reason than the genesis pin —
///         the split is FAMILY-BLIND, so there is no other proportion for a migration to reach. The pin
///         survives as the answer to "whose `vaultType()` must be recognized".
contract PinnedGenesisFamily721Test is Test {
    address internal constant CREATOR = address(0xC1);
    address internal constant BUYER = address(0xB2);
    address internal constant TREASURY = address(0xFEE);
    address internal weth = address(0xE770);

    MockGMRPin721 internal gmr;
    MockMRPin721 internal registry;

    function setUp() public {
        gmr = new MockGMRPin721();
        registry = new MockMRPin721();
        vm.deal(BUYER, 100 ether);
        vm.deal(CREATOR, 10 ether);
    }

    function _deploy(string memory genesisType) internal returns (ERC721AuctionInstance inst, MockFamilyVault genesis) {
        genesis = new MockFamilyVault(genesisType);
        inst = new ERC721AuctionInstance(
            ERC721AuctionInstance.ConstructorParams({
                vault: address(genesis),
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

    function test_genesisVault_pinnedAtConstruction() public {
        (ERC721AuctionInstance inst, MockFamilyVault genesis) = _deploy("AaveEndowment");
        assertEq(inst.genesisVault(), address(genesis), "genesisVault pinned to construction vault");
    }

    /// @notice The old exploit shape: endowment genesis, then swap the live vault to a liquidity-family
    ///         vault. Nothing moves. The split is FAMILY-BLIND — 1% protocol / 19% vault / 80% creator —
    ///         so a migration has no proportion to reach. (In production the registry choke-point forbids
    ///         this cross-family swap anyway; this asserts it would be inert even if one occurred.)
    function test_migrateVault_cannotMoveTheSplit() public {
        (ERC721AuctionInstance inst, MockFamilyVault genesis) = _deploy("AaveEndowment");

        MockFamilyVault lp = new MockFamilyVault("UniswapV4LP");
        vm.prank(CREATOR);
        inst.migrateVault(address(lp));
        assertEq(address(inst.vault()), address(lp), "live vault migrated");
        assertEq(inst.genesisVault(), address(genesis), "genesis unchanged");

        uint256 treasuryBefore = TREASURY.balance;
        uint256 creatorBefore = CREATOR.balance;
        uint256 lpBefore = address(lp).balance;

        inst.settleAuction(1);

        // The one split: 1% protocol / 19% vault / 80% creator, before the migration and after it.
        assertEq(TREASURY.balance - treasuryBefore, 0.01 ether, "protocol 1%");
        // Creator receives the queued deposit refund (0.1) plus the 80% creator leg.
        assertEq(CREATOR.balance - creatorBefore, 0.1 ether + 0.8 ether, "creator 80% + deposit, unmoved");
        assertEq(address(lp).balance - lpBefore, 0.19 ether, "19% community leg to the live active vault");
    }

    /// @notice Regression: a genuinely liquidity-family genesis still settles 1/19/80 (creator 80%).
    function test_liquidityGenesis_keepsCreator80() public {
        (ERC721AuctionInstance inst, MockFamilyVault genesis) = _deploy("ZAMMLP");

        uint256 treasuryBefore = TREASURY.balance;
        uint256 creatorBefore = CREATOR.balance;
        uint256 genesisBefore = address(genesis).balance;

        inst.settleAuction(1);

        assertEq(TREASURY.balance - treasuryBefore, 0.01 ether, "protocol 1%");
        assertEq(address(genesis).balance - genesisBefore, 0.19 ether, "liquidity vault 19%");
        assertEq(CREATOR.balance - creatorBefore, 0.1 ether + 0.8 ether, "liquidity creator 80% + deposit");
    }
}
