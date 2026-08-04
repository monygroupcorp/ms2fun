// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC1155Instance } from "../../../src/factories/erc1155/ERC1155Instance.sol";
import { MockFamilyVault } from "../../mocks/MockFamilyVault.sol";

contract MockGMRPin1155 {
    function postForAction(address, address, bytes calldata) external { }
}

/// @notice Registry stub whose `migrateVault` is a no-op — it lets the instance swap its live `vault`
///         pointer WITHOUT the MasterRegistryV1 cross-family reject firing, so this test can isolate the
///         instance-level defense-in-depth: even if the live vault's family changes, the settlement split
///         must stay keyed to the genesis vault pinned at construction.
contract MockMRPin1155 {
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

/// @notice Audit finding #2 (defense-in-depth, ERC1155): a vault migration must never flip an endowment
///         collection's 1/80/19 settlement split to the liquidity 1/19/80. The family is pinned to the
///         genesis vault at construction, so swapping the live vault to a liquidity-family vault leaves
///         the split untouched.
contract PinnedGenesisFamily1155Test is Test {
    address internal constant CREATOR = address(0xC1);
    address internal constant BUYER = address(0xB2);
    address internal constant TREASURY = address(0xFEE);
    address internal weth = address(0xE770);

    MockGMRPin1155 internal gmr;
    MockMRPin1155 internal registry;

    function setUp() public {
        gmr = new MockGMRPin1155();
        registry = new MockMRPin1155();
        vm.deal(BUYER, 100 ether);
        vm.deal(CREATOR, 10 ether);
    }

    function _deploy(string memory genesisType) internal returns (ERC1155Instance inst, MockFamilyVault genesis) {
        genesis = new MockFamilyVault(genesisType);
        inst = new ERC1155Instance(
            "Fam",
            CREATOR,
            address(this),
            address(genesis),
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

    function test_genesisVault_pinnedAtConstruction() public {
        (ERC1155Instance inst, MockFamilyVault genesis) = _deploy("AaveEndowment");
        assertEq(inst.genesisVault(), address(genesis), "genesisVault pinned to construction vault");
    }

    /// @notice The exploit: endowment genesis, then swap the live vault to a liquidity-family vault. The
    ///         SPLIT PROPORTION stays keyed to the pinned genesis family, so the creator is capped at 19%
    ///         and can NEVER capture the 80% community leg — the whole point of finding #2. (In production
    ///         the registry choke-point already forbids this cross-family swap; the instance pin is the
    ///         belt-and-suspenders that neutralizes it even if a family change somehow occurred. The 80%
    ///         vault leg follows the live active vault; the creator diversion is what is being prevented.)
    function test_migrateToLiquidity_doesNotFlipSplit() public {
        (ERC1155Instance inst, MockFamilyVault genesis) = _deploy("AaveEndowment");

        // Attacker swaps the live vault to a liquidity-family vault (registry reject is stubbed out here).
        MockFamilyVault lp = new MockFamilyVault("UniswapV4LP");
        vm.prank(CREATOR);
        inst.migrateVault(address(lp));
        assertEq(address(inst.vault()), address(lp), "live vault migrated");
        assertEq(inst.genesisVault(), address(genesis), "genesis unchanged");

        uint256 treasuryBefore = TREASURY.balance;
        uint256 creatorBefore = CREATOR.balance;
        uint256 lpBefore = address(lp).balance;

        vm.prank(CREATOR);
        inst.withdraw(1 ether);

        // Pinned genesis (endowment) split proportion: 1% protocol / 80% vault / 19% creator — NOT flipped.
        assertEq(TREASURY.balance - treasuryBefore, 0.01 ether, "protocol 1%");
        assertEq(CREATOR.balance - creatorBefore, 0.19 ether, "creator capped at 19%, not the flipped 80%");
        assertEq(
            address(lp).balance - lpBefore, 0.8 ether, "80% community leg preserved (to active vault), not to creator"
        );
    }

    /// @notice Regression: a genuinely liquidity-family genesis still settles 1/19/80 (creator 80%).
    function test_liquidityGenesis_keepsCreator80() public {
        (ERC1155Instance inst, MockFamilyVault genesis) = _deploy("CypherLP");

        uint256 treasuryBefore = TREASURY.balance;
        uint256 creatorBefore = CREATOR.balance;
        uint256 genesisBefore = address(genesis).balance;

        vm.prank(CREATOR);
        inst.withdraw(1 ether);

        assertEq(TREASURY.balance - treasuryBefore, 0.01 ether, "protocol 1%");
        assertEq(address(genesis).balance - genesisBefore, 0.19 ether, "liquidity vault 19%");
        assertEq(CREATOR.balance - creatorBefore, 0.8 ether, "liquidity creator 80%");
    }
}
