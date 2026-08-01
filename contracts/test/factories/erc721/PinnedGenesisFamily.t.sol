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

/// @notice Audit finding #2 (defense-in-depth, ERC721): a vault migration must never flip an endowment
///         collection's 1/80/19 auction-settlement split to the liquidity 1/19/80. The family is pinned
///         to the genesis vault at construction.
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

    /// @notice The exploit: endowment genesis, then swap the live vault to a liquidity-family vault. The
    ///         split proportion stays keyed to the pinned genesis family, so the creator is capped at the
    ///         19% leg (plus its deposit refund) and can NEVER capture the 80% community leg. (In production
    ///         the registry choke-point forbids this cross-family swap; the instance pin is defense-in-depth.)
    function test_migrateToLiquidity_doesNotFlipSplit() public {
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

        // Pinned genesis (endowment) split proportion: 1% protocol / 80% vault / 19% creator — NOT flipped.
        assertEq(TREASURY.balance - treasuryBefore, 0.01 ether, "protocol 1%");
        // Creator receives the queued deposit refund (0.1) plus the 19% creator leg — not the 80% flip.
        assertEq(CREATOR.balance - creatorBefore, 0.1 ether + 0.19 ether, "creator capped at deposit + 19%");
        assertEq(
            address(lp).balance - lpBefore, 0.8 ether, "80% community leg preserved (to active vault), not to creator"
        );
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
