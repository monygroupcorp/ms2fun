// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { ERC1155Instance, InstanceAlreadyInitialized } from "../../../src/factories/erc1155/ERC1155Instance.sol";
import { MockFamilyVault } from "../../mocks/MockFamilyVault.sol";

contract MockGMRInit1155 {
    function postForAction(address, address, bytes calldata) external { }
}

contract MockMRInit1155 {
    function isAgent(address) external pure returns (bool) {
        return false;
    }

    function isVaultRegistered(address) external pure returns (bool) {
        return true;
    }
    function migrateVault(address, address) external { }

    function getInstanceVaults(address) external pure returns (address[] memory) {
        return new address[](0);
    }
}

/**
 * @notice The surface a collection grows by becoming an EIP-1167 clone: a constructor that could
 *         only ever run once, with arguments nobody else could supply, becomes an external
 *         `initialize` that anybody can call.
 *
 *         Two things must hold for that trade to be safe, and neither is visible from reading
 *         `initialize` alone:
 *
 *           - the IMPLEMENTATION must be born locked. It sits at a known address forever, it is
 *             never initialized by anyone, and if it could be initialized the caller would become
 *             its owner — of the contract every collection delegatecalls into.
 *           - a CLONE must be claimable exactly once. The factory deploys and initializes in one
 *             transaction so there is no window, but the guard must hold even if there were.
 *
 *         Ownership is the stake in both: `initialize` calls `_initializeOwner(_creator)`.
 */
contract ERC1155CloneInitializationTest is Test {
    address internal constant CREATOR = address(0xC1);
    address internal constant ATTACKER = address(0xBAD);
    address internal constant TREASURY = address(0xFEE);

    MockGMRInit1155 internal gmr;
    MockMRInit1155 internal registry;
    MockFamilyVault internal vault;

    function setUp() public {
        gmr = new MockGMRInit1155();
        registry = new MockMRInit1155();
        vault = new MockFamilyVault("uni");
    }

    function _init() internal view returns (ERC1155Instance.InstanceInit memory) {
        return ERC1155Instance.InstanceInit({
            globalMessageRegistry: address(gmr),
            protocolTreasury: TREASURY,
            masterRegistry: address(registry),
            gatingModule: address(0),
            dynamicPricingModule: address(0),
            weth: address(0xE770)
        });
    }

    function _initialize(ERC1155Instance inst, address creator) internal {
        inst.initialize("Coll", creator, address(this), address(vault), "", _init(), false, "", "");
    }

    /// @dev The implementation the factory points at is locked by its own constructor, so the
    ///      contract every clone delegatecalls into has no owner for anyone to become.
    function test_theImplementationIsBornLocked() public {
        ERC1155Instance implementation = new ERC1155Instance();

        vm.prank(ATTACKER);
        vm.expectRevert(InstanceAlreadyInitialized.selector);
        _initialize(implementation, ATTACKER);

        assertEq(implementation.owner(), address(0), "an implementation nobody owns");
    }

    /// @dev A clone is claimed once. The second caller is refused whoever they are.
    function test_aCloneIsClaimedOnceAndOnlyOnce() public {
        ERC1155Instance inst = ERC1155Instance(payable(LibClone.clone(address(new ERC1155Instance()))));

        _initialize(inst, CREATOR);
        assertEq(inst.owner(), CREATOR, "the first caller set the creator as owner");

        vm.prank(ATTACKER);
        vm.expectRevert(InstanceAlreadyInitialized.selector);
        _initialize(inst, ATTACKER);

        assertEq(inst.owner(), CREATOR, "and could not take it");
    }

    /// @dev The four values that stopped being `immutable` so that clones could exist. Nothing
    ///      writes them after `initialize` — there is no setter — and this is the assertion that
    ///      says so for the three the genesis-pin suite does not already cover.
    function test_theSetOnceValuesAreWhatInitializeWrote() public {
        ERC1155Instance inst = ERC1155Instance(payable(LibClone.clone(address(new ERC1155Instance()))));
        _initialize(inst, CREATOR);

        assertEq(inst.genesisVault(), address(vault), "genesisVault");
        assertEq(address(inst.globalMessageRegistry()), address(gmr), "globalMessageRegistry");
        assertEq(inst.protocolTreasury(), TREASURY, "protocolTreasury");
        assertEq(inst.weth(), address(0xE770), "weth");
    }

    /// @dev Two clones off ONE implementation keep separate storage — the property that makes a
    ///      shared implementation safe, and the one a per-instance `immutable` would have broken.
    function test_twoClonesOfOneImplementationDoNotShareState() public {
        ERC1155Instance implementation = new ERC1155Instance();
        ERC1155Instance a = ERC1155Instance(payable(LibClone.clone(address(implementation))));
        ERC1155Instance b = ERC1155Instance(payable(LibClone.clone(address(implementation))));

        MockFamilyVault otherVault = new MockFamilyVault("zamm");
        _initialize(a, CREATOR);
        b.initialize("Other", ATTACKER, address(this), address(otherVault), "", _init(), false, "", "");

        assertEq(a.owner(), CREATOR, "a's owner");
        assertEq(b.owner(), ATTACKER, "b's owner");
        assertEq(a.genesisVault(), address(vault), "a's genesis vault");
        assertEq(b.genesisVault(), address(otherVault), "b's genesis vault");
    }
}
