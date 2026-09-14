// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC1155Instance } from "../../../src/factories/erc1155/ERC1155Instance.sol";
import { MockFamilyVault } from "../../mocks/MockFamilyVault.sol";

contract MockGMRPin1155 {
    function postForAction(address, address, bytes calldata) external { }
}

/// @notice Registry stub whose `migrateVault` is a no-op — it lets the instance swap its live `vault`
///         pointer WITHOUT the MasterRegistryV1 cross-family reject firing, so this test can isolate what
///         a family change does to settlement at the instance level.
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

/// @notice Audit finding #2 (defense-in-depth, ERC1155): a vault migration must never move the creator's
///         share of settlement. It cannot, and now for a stronger reason than the genesis pin — the split
///         is FAMILY-BLIND, 1% protocol / 19% vault / 80% creator, so there is no other proportion for a
///         migration to reach. The pin survives as the answer to "whose `vaultType()` must be
///         recognized", and this suite holds the money assertion that used to depend on it.
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

    /// @notice The old exploit shape: endowment genesis, then swap the live vault to a liquidity-family
    ///         vault. Nothing moves. The 19% community leg follows the live active vault, as it always did,
    ///         and the creator's 80% is the same 80% either way — a migration has no proportion to change.
    ///         (In production the registry choke-point forbids this cross-family swap anyway; this is the
    ///         belt-and-suspenders assertion that it would be inert even if one occurred.)
    function test_migrateVault_cannotMoveTheSplit() public {
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

        // The one split: 1% protocol / 19% vault / 80% creator, before the migration and after it.
        assertEq(TREASURY.balance - treasuryBefore, 0.01 ether, "protocol 1%");
        assertEq(CREATOR.balance - creatorBefore, 0.8 ether, "creator 80%, unmoved by the migration");
        assertEq(address(lp).balance - lpBefore, 0.19 ether, "19% community leg to the live active vault");
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
