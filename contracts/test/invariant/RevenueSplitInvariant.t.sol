// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { RevenueSplitLib } from "../../src/shared/libraries/RevenueSplitLib.sol";

/// @title RevenueSplitInvariantTest
/// @notice Fuzz-based invariant: protocolCut + vaultCut + remainder == input (no wei leak or creation)
contract RevenueSplitInvariantTest is Test {
    // amount * 80 must not overflow; cap at type(uint256).max / 80
    uint256 constant MAX_AMOUNT = type(uint256).max / 80;

    function testFuzz_splitSumsToInput(uint256 amount) external pure {
        amount = bound(amount, 0, MAX_AMOUNT);
        RevenueSplitLib.Split memory s = RevenueSplitLib.split(amount);
        assertEq(s.protocolCut + s.vaultCut + s.remainder, amount, "split leaks or creates wei");
    }

    function testFuzz_protocolCutIsOnePercFloor(uint256 amount) external pure {
        amount = bound(amount, 0, MAX_AMOUNT);
        RevenueSplitLib.Split memory s = RevenueSplitLib.split(amount);
        assertEq(s.protocolCut, amount / 100, "protocolCut != floor(amount/100)");
    }

    function testFuzz_vaultCutIsNineteenPercFloor(uint256 amount) external pure {
        amount = bound(amount, 0, MAX_AMOUNT);
        RevenueSplitLib.Split memory s = RevenueSplitLib.split(amount);
        assertEq(s.vaultCut, (amount * 19) / 100, "vaultCut != floor(amount*19/100)");
    }

    function testFuzz_remainderAbsorbsDust(uint256 amount) external pure {
        amount = bound(amount, 0, MAX_AMOUNT);
        RevenueSplitLib.Split memory s = RevenueSplitLib.split(amount);
        uint256 expected = amount - (amount / 100) - ((amount * 19) / 100);
        assertEq(s.remainder, expected, "remainder doesn't absorb rounding dust");
    }

    function testFuzz_remainderGteEightyPercent(uint256 amount) external pure {
        amount = bound(amount, 100, MAX_AMOUNT);
        RevenueSplitLib.Split memory s = RevenueSplitLib.split(amount);
        // remainder >= 80% floor: remainder absorbs dust so it's always >= floor(80%)
        assertGe(s.remainder, amount / 100 * 80, "remainder below 80%");
    }

    function test_splitZero() external pure {
        RevenueSplitLib.Split memory s = RevenueSplitLib.split(0);
        assertEq(s.protocolCut, 0);
        assertEq(s.vaultCut, 0);
        assertEq(s.remainder, 0);
    }

    function test_splitOne() external pure {
        RevenueSplitLib.Split memory s = RevenueSplitLib.split(1);
        assertEq(s.protocolCut, 0);
        assertEq(s.vaultCut, 0);
        assertEq(s.remainder, 1);
    }

    function test_splitHundred() external pure {
        RevenueSplitLib.Split memory s = RevenueSplitLib.split(100);
        assertEq(s.protocolCut, 1);
        assertEq(s.vaultCut, 19);
        assertEq(s.remainder, 80);
    }

    function test_splitNinetyNine() external pure {
        RevenueSplitLib.Split memory s = RevenueSplitLib.split(99);
        assertEq(s.protocolCut, 0);
        assertEq(s.vaultCut, 18);
        assertEq(s.remainder, 81);
    }

    function test_splitOneEther() external pure {
        RevenueSplitLib.Split memory s = RevenueSplitLib.split(1 ether);
        assertEq(s.protocolCut, 0.01 ether);
        assertEq(s.vaultCut, 0.19 ether);
        assertEq(s.remainder, 0.8 ether);
    }

    function testFuzz_SplitSumsToTotal(uint256 amount) external pure {
        amount = bound(amount, 0, MAX_AMOUNT);
        RevenueSplitLib.Split memory s = RevenueSplitLib.split(amount);
        assertEq(s.protocolCut + s.vaultCut + s.remainder, amount, "protocol + vault + remainder != amount");
    }

    function testFuzz_ProtocolNeverExceedsOnePercent(uint256 amount) external pure {
        amount = bound(amount, 0, MAX_AMOUNT);
        RevenueSplitLib.Split memory s = RevenueSplitLib.split(amount);
        assertLe(s.protocolCut, amount / 100, "protocol exceeds 1%");
    }

    function testFuzz_VaultNeverExceedsNineteenPercent(uint256 amount) external pure {
        amount = bound(amount, 0, MAX_AMOUNT);
        RevenueSplitLib.Split memory s = RevenueSplitLib.split(amount);
        assertLe(s.vaultCut, (amount * 19) / 100, "vault exceeds 19%");
    }

    /// @notice split() is UNCHANGED, and it is now the only split: vault=19%, remainder=80%.
    function test_splitStillGivesLegacyWeights() external pure {
        RevenueSplitLib.Split memory s = RevenueSplitLib.split(1 ether);
        assertEq(s.protocolCut, 0.01 ether);
        assertEq(s.vaultCut, 0.19 ether);
        assertEq(s.remainder, 0.8 ether);
    }

    // ── One split, every family ──────────────────────────────────────────────
    // The endowment's inverted mint split (1% protocol / 80% vault / 19% creator) is GONE, along with the
    // vesting duality it fed. Nothing routes a family-specific split any more, so there is no second
    // primitive to conserve value, and no branch for a caller to select.

    /// @notice `splitMint` is deleted. Its absence is the assertion — a reintroduced 80%-to-vault mint
    ///         split would have to appear here first.
    function test_splitMintIsGone() external pure {
        // A compile-time fact, restated as a runtime one: the only split weights the library can produce
        // put 19% at the vault, never 80%.
        assertEq(RevenueSplitLib.split(1 ether).vaultCut, 0.19 ether, "the vault leg is 19%, always");
        assertTrue(RevenueSplitLib.split(100).vaultCut != 80, "no path still routes 80% to the vault");
    }

    // ── isLiquidityFamily: classification + loud revert on unknown ───────────────────────────

    function test_isLiquidityFamilyLiquiditySet() external pure {
        assertTrue(RevenueSplitLib.isLiquidityFamily("UniswapV4LP"), "UniswapV4LP is liquidity");
        assertTrue(RevenueSplitLib.isLiquidityFamily("ZAMMLP"), "ZAMMLP is liquidity");
        assertTrue(RevenueSplitLib.isLiquidityFamily("CypherLP"), "CypherLP is liquidity");
    }

    function test_isLiquidityFamilyYieldSet() external pure {
        assertFalse(RevenueSplitLib.isLiquidityFamily("AaveEndowment"), "AaveEndowment is yield");
    }

    /// @dev The internal lib call inlines into the caller; route through an external wrapper so the
    ///      revert lands a frame below the cheatcode (vm.expectRevert requirement).
    function classify(string calldata vaultType) external pure returns (bool) {
        return RevenueSplitLib.isLiquidityFamily(vaultType);
    }

    function test_isLiquidityFamilyUnknownReverts() external {
        vm.expectRevert(abi.encodeWithSelector(RevenueSplitLib.UnknownVaultFamily.selector, "MysteryVault"));
        this.classify("MysteryVault");
    }

    /// @dev Guards against a near-miss (case/substring) silently passing as a known family.
    function test_isLiquidityFamilyNearMissReverts() external {
        vm.expectRevert(abi.encodeWithSelector(RevenueSplitLib.UnknownVaultFamily.selector, "uniswapv4lp"));
        this.classify("uniswapv4lp");
    }

    function test_isLiquidityFamilyEmptyReverts() external {
        vm.expectRevert(abi.encodeWithSelector(RevenueSplitLib.UnknownVaultFamily.selector, ""));
        this.classify("");
    }
}
