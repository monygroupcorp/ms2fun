// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {RevenueSplitLib} from "../../src/shared/libraries/RevenueSplitLib.sol";

/// @title RevenueSplitInvariantTest
/// @notice Fuzz-based invariant: protocolCut + vaultCut + remainder == input (no wei leak or creation)
contract RevenueSplitInvariantTest is Test {
    // amount * 80 must not overflow; cap at type(uint256).max / 80
    uint256 constant MAX_AMOUNT = type(uint256).max / 80;

    function testFuzz_splitSumsToInput(uint256 amount) external pure {
        amount = bound(amount, 0, MAX_AMOUNT);
        RevenueSplitLib.Split memory s = RevenueSplitLib.split(amount);
        assertEq(
            s.protocolCut + s.vaultCut + s.remainder,
            amount,
            "split leaks or creates wei"
        );
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
        assertEq(s.remainder, 0.80 ether);
    }

    function testFuzz_SplitSumsToTotal(uint256 amount) external pure {
        amount = bound(amount, 0, MAX_AMOUNT);
        RevenueSplitLib.Split memory s = RevenueSplitLib.split(amount);
        assertEq(
            s.protocolCut + s.vaultCut + s.remainder,
            amount,
            "protocol + vault + remainder != amount"
        );
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

    // ── splitMint (ADR-0003): 1% protocol / 80% vault / 19% creator ──────────

    function testFuzz_splitMintSumsToInput(uint256 amount) external pure {
        amount = bound(amount, 0, MAX_AMOUNT);
        RevenueSplitLib.Split memory s = RevenueSplitLib.splitMint(amount);
        assertEq(
            s.protocolCut + s.vaultCut + s.remainder,
            amount,
            "splitMint leaks or creates wei"
        );
    }

    function testFuzz_splitMintProtocolIsOnePercFloor(uint256 amount) external pure {
        amount = bound(amount, 0, MAX_AMOUNT);
        RevenueSplitLib.Split memory s = RevenueSplitLib.splitMint(amount);
        assertEq(s.protocolCut, amount / 100, "splitMint: protocolCut != floor(amount/100)");
    }

    function testFuzz_splitMintVaultIsEightyPercFloor(uint256 amount) external pure {
        amount = bound(amount, 0, MAX_AMOUNT);
        RevenueSplitLib.Split memory s = RevenueSplitLib.splitMint(amount);
        assertEq(s.vaultCut, (amount * 80) / 100, "splitMint: vaultCut != floor(amount*80/100)");
    }

    function testFuzz_splitMintRemainderAbsorbsDust(uint256 amount) external pure {
        amount = bound(amount, 0, MAX_AMOUNT);
        RevenueSplitLib.Split memory s = RevenueSplitLib.splitMint(amount);
        uint256 expected = amount - (amount / 100) - ((amount * 80) / 100);
        assertEq(s.remainder, expected, "splitMint: remainder doesn't absorb rounding dust");
    }

    function test_splitMintZero() external pure {
        RevenueSplitLib.Split memory s = RevenueSplitLib.splitMint(0);
        assertEq(s.protocolCut, 0);
        assertEq(s.vaultCut, 0);
        assertEq(s.remainder, 0);
    }

    function test_splitMintHundred() external pure {
        RevenueSplitLib.Split memory s = RevenueSplitLib.splitMint(100);
        assertEq(s.protocolCut, 1,  "splitMint(100): protocol should be 1");
        assertEq(s.vaultCut,   80, "splitMint(100): vault should be 80");
        assertEq(s.remainder,  19, "splitMint(100): creator should be 19");
    }

    function test_splitMintOneEther() external pure {
        RevenueSplitLib.Split memory s = RevenueSplitLib.splitMint(1 ether);
        assertEq(s.protocolCut, 0.01 ether,  "splitMint(1e18): protocol");
        assertEq(s.vaultCut,   0.80 ether,  "splitMint(1e18): vault");
        assertEq(s.remainder,  0.19 ether,  "splitMint(1e18): creator");
    }

    /// @notice split() (DN404 graduation) is UNCHANGED: vault=19%, remainder=80%.
    function test_splitStillGivesLegacyWeights() external pure {
        RevenueSplitLib.Split memory s = RevenueSplitLib.split(1 ether);
        assertEq(s.protocolCut, 0.01 ether);
        assertEq(s.vaultCut,   0.19 ether);
        assertEq(s.remainder,  0.80 ether);
    }

    // ── splitMintFor (family-aware): liquidity flips creator-80; yield keeps 1/80/19 ─────────

    /// @notice Both family branches conserve value exactly (no wei leaked or minted).
    function testFuzz_splitMintForConservesValue(uint256 amount, bool liquidityFamily) external pure {
        amount = bound(amount, 0, MAX_AMOUNT);
        RevenueSplitLib.Split memory s = RevenueSplitLib.splitMintFor(amount, liquidityFamily);
        assertEq(s.protocolCut + s.vaultCut + s.remainder, amount, "splitMintFor leaks or creates wei");
    }

    /// @notice Liquidity branch pays the creator the 80% leg (1% protocol / 19% vault / 80% creator).
    function testFuzz_splitMintForLiquidityFlipsCreator(uint256 amount) external pure {
        amount = bound(amount, 0, MAX_AMOUNT);
        RevenueSplitLib.Split memory s = RevenueSplitLib.splitMintFor(amount, true);
        RevenueSplitLib.Split memory graduation = RevenueSplitLib.split(amount);
        // Liquidity family == split() weights exactly: vault 19%, creator (remainder) 80%.
        assertEq(s.protocolCut, graduation.protocolCut, "liquidity protocol != split protocol");
        assertEq(s.vaultCut, graduation.vaultCut, "liquidity vault != 19%");
        assertEq(s.remainder, graduation.remainder, "liquidity creator != 80%");
        assertEq(s.vaultCut, (amount * 19) / 100, "liquidity vault != floor(19%)");
    }

    /// @notice Yield branch is byte-identical to the legacy splitMint (1% / 80% vault / 19% creator).
    function testFuzz_splitMintForYieldUnchanged(uint256 amount) external pure {
        amount = bound(amount, 0, MAX_AMOUNT);
        RevenueSplitLib.Split memory s = RevenueSplitLib.splitMintFor(amount, false);
        RevenueSplitLib.Split memory legacy = RevenueSplitLib.splitMint(amount);
        assertEq(s.protocolCut, legacy.protocolCut, "yield protocol regressed");
        assertEq(s.vaultCut, legacy.vaultCut, "yield vault regressed");
        assertEq(s.remainder, legacy.remainder, "yield creator regressed");
        assertEq(s.vaultCut, (amount * 80) / 100, "yield vault != floor(80%)");
    }

    function test_splitMintForOneEther() external pure {
        RevenueSplitLib.Split memory liq = RevenueSplitLib.splitMintFor(1 ether, true);
        assertEq(liq.protocolCut, 0.01 ether);
        assertEq(liq.vaultCut, 0.19 ether);
        assertEq(liq.remainder, 0.80 ether, "liquidity creator should net 80%");

        RevenueSplitLib.Split memory yld = RevenueSplitLib.splitMintFor(1 ether, false);
        assertEq(yld.protocolCut, 0.01 ether);
        assertEq(yld.vaultCut, 0.80 ether);
        assertEq(yld.remainder, 0.19 ether, "yield creator should net 19%");
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
