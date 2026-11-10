// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { AlignmentEndowmentVault } from "../../../src/vaults/aave/AlignmentEndowmentVault.sol";
import {
    MockWETH,
    MockStataToken,
    MockMasterRegistry,
    MockAmbassadorRegistry,
    MockOwnable
} from "../../vaults/aave/AlignmentEndowmentVault.t.sol";

/// @dev Hypothesis: after an ambassador `execute` lowers `totalPrincipal` (not to zero), the share
///      price falls and a T4 late depositor mints shares cheaply. Claim tested: after `harvest` and
///      `claimYieldPurse`, the late joiner's yield-per-deposited-wei EXCEEDS the earlier benefactors'
///      yield-per-wei-of-their-remaining-principal, i.e. the late joiner takes creator yield from
///      pre-existing benefactors beyond rounding.
contract LateJoinerYieldTest is Test {
    AlignmentEndowmentVault vault;
    MockWETH weth;
    MockStataToken stata;
    MockMasterRegistry masterRegistry;
    MockAmbassadorRegistry ambassadorRegistry;

    address vaultOwner = address(0xAA01);
    address treasury = address(0xAA02);
    address alignmentToken = address(0xAA03);
    address communityPayout = address(0xAA04);
    uint256 constant TARGET_ID = 7;

    address alice = address(0xBB01);
    address bob = address(0xBB02);
    address carol = address(0xBB03); // the T4 late joiner
    address ambassador = address(0xBB04);
    address recipient = address(0xD1);

    MockOwnable aliceB;
    MockOwnable bobB;
    MockOwnable carolB;

    Currency nativeCurrency = Currency.wrap(address(0));

    function setUp() public {
        weth = new MockWETH();
        stata = new MockStataToken(address(weth));
        masterRegistry = new MockMasterRegistry();
        ambassadorRegistry = new MockAmbassadorRegistry();
        masterRegistry.setAlignmentRegistry(address(ambassadorRegistry));
        ambassadorRegistry.setAmbassador(TARGET_ID, ambassador, true);
        ambassadorRegistry.setCommunityPayout(TARGET_ID, communityPayout);

        aliceB = new MockOwnable(alice);
        bobB = new MockOwnable(bob);
        carolB = new MockOwnable(carol);

        address impl = address(new AlignmentEndowmentVault());
        vault = AlignmentEndowmentVault(payable(LibClone.clone(impl)));
        vault.initialize(
            vaultOwner, address(weth), address(stata), treasury, address(masterRegistry), alignmentToken, TARGET_ID
        );

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(carol, 100 ether);
        vm.warp(1_000_000);
    }

    function _contribute(address owner_, MockOwnable b, uint256 amount) internal {
        vm.prank(owner_);
        vault.receiveContribution{ value: amount }(nativeCurrency, amount, address(b));
    }

    function test_Defended_lateJoinerYieldRateMatchesPrincipal() public {
        // Two early benefactors: 10 ETH each, 1:1 pricing.
        _contribute(alice, aliceB, 10 ether);
        _contribute(bob, bobB, 10 ether);
        assertEq(vault.totalPrincipal(), 20 ether);

        // Ambassador deploys most of the corpus: principal 20 -> 2, shares untouched, price/share 0.1.
        vm.prank(ambassador);
        vault.execute(recipient, 18 ether, "");
        assertEq(vault.totalPrincipal(), 2 ether);

        // T4 late joiner deposits 2 ETH against the sliver: mints 20e18 shares for 2 ETH.
        uint256 sharesBefore = vault.totalPrincipalShares();
        _contribute(carol, carolB, 2 ether);
        uint256 carolShares = vault.principalShares(address(carolB));
        assertEq(carolShares, 20 ether); // 2 ETH priced at 0.1 bought the pool's full old share count
        assertEq(vault.totalPrincipalShares(), sharesBefore + carolShares);
        assertEq(vault.totalPrincipal(), 4 ether);

        // Simulated Aave yield, as the existing tests simulate it: +2 ETH into the position.
        uint256 yield_ = 2 ether;
        vm.deal(address(weth), address(weth).balance + yield_);
        weth.mint(address(this), yield_);
        weth.approve(address(stata), yield_);
        stata.simulateYield(yield_);

        vm.prank(carol); // harvest is permissionless (T4)
        vault.harvest();

        // Claims (creator leg 80% of 2 ETH = 1.6 ETH: alice 0.4, bob 0.4, carol 0.8).
        uint256 beforeCarol = carol.balance;
        vm.prank(carol);
        uint256 carolYield = vault.claimYieldPurse(address(carolB));
        assertEq(carol.balance - beforeCarol, carolYield);
        assertEq(carolYield, 0.8 ether);

        uint256 honestYield = 0;
        vm.prank(alice);
        honestYield += vault.claimYieldPurse(address(aliceB));
        vm.prank(bob);
        honestYield += vault.claimYieldPurse(address(bobB));
        assertEq(honestYield, 0.8 ether);

        // Remaining principal of the early benefactors after everything.
        uint256 honestRemaining = vault.principalOf(address(aliceB)) + vault.principalOf(address(bobB));
        assertEq(honestRemaining, 2 ether);

        // Rates in fixed-point (yield per wei, x1e18): carol 0.8/2 vs honest 0.8/2.
        uint256 carolRate = (carolYield * 1e18) / 2 ether;
        uint256 honestRate = (honestYield * 1e18) / honestRemaining;

        // Defense holds: the late joiner's rate does NOT exceed the honest rate by more than rounding.
        // Pro-rata share minting at join time (`amount * shares / principal`) plus the harvest-at-
        // deposit crystallize make the two rates equal up to division dust.
        assertLe(carolRate, honestRate + 1e9, "late joiner took excess creator yield");
    }
}
