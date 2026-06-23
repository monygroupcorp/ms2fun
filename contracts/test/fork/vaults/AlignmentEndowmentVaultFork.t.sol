// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {LibClone} from "solady/utils/LibClone.sol";
import {Currency} from "v4-core/types/Currency.sol";

import {AlignmentEndowmentVault} from "../../../src/vaults/aave/AlignmentEndowmentVault.sol";

// NOTE: AaveV3Ethereum.sol transitively imports AaveV3.sol which requires the
// aave-v3-origin submodule (not installed in this repo). We inline the two
// canonical mainnet addresses directly — they match the values in
// lib/aave-address-book/src/AaveV3Ethereum.sol (lines 148 and 169) and are
// verified on Etherscan. Using hardcoded constants here is intentional and safe.

// ---------------------------------------------------------------------------
// Minimal helper: a contract that acts as the benefactor collection instance.
// withdrawPrincipal() calls IOwnable(benefactor).owner(), so the benefactor
// must be a real contract whose owner() returns our test address.
// ---------------------------------------------------------------------------
contract MockBenefactor {
    address public owner;

    constructor(address _owner) {
        owner = _owner;
    }
}

// ---------------------------------------------------------------------------
// Minimal IMasterRegistry stub — isAgent always returns false so the test
// exercises the creator-owner path, not the agent path.
// ---------------------------------------------------------------------------
contract MockMasterRegistry {
    function isAgent(address) external pure returns (bool) {
        return false;
    }
}

/**
 * @title AlignmentEndowmentVaultFork
 * @notice Fork integration test for AlignmentEndowmentVault against REAL Aave V3 on mainnet.
 *
 * Run (with a fork URL set):
 *   forge test --match-path "test/fork/vaults/AlignmentEndowmentVaultFork.t.sol" \
 *              --fork-url $ETH_RPC_URL -vvv
 *
 * Without a fork URL this test auto-skips (vm.skip) — consistent with the
 * existing ForkTestBase guard used by all other fork tests in this repo.
 *
 * Guard: if the WETH bytecode is absent (no fork) we skip rather than revert.
 *
 * Rounding tolerance: ±5 wei absolute for the individual-recipient checks (the
 * ERC-4626 redeem is exact-assets; the only rounding is integer division in the
 * BPS split). convertToAssets ≈ principal is asserted within 2 wei (stataToken
 * exchange rate starts at 1:1 and barely moves in the same block).
 */
contract AlignmentEndowmentVaultForkTest is Test {
    // ── Real Aave V3 mainnet addresses ──────────────────────────────────────
    // Source: lib/aave-address-book/src/AaveV3Ethereum.sol, AaveV3EthereumAssets
    // WETH_UNDERLYING  → line 148 → 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
    // WETH_STATA_TOKEN → line 169 → 0x0bfc9d54Fc184518A81162F8fB99c2eACa081202 (waEthWETH)
    // Direct import avoided because AaveV3Ethereum.sol requires the aave-v3-origin
    // submodule which is absent from this repo's lib tree.
    address internal constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address internal constant STATA = 0x0bfc9d54Fc184518A81162F8fB99c2eACa081202;

    // ── Test participants ────────────────────────────────────────────────────
    address internal owner;        // vault owner (factory stand-in)
    address internal treasury;     // protocolTreasury (1% platform)
    address internal community;    // communityPayout  (99% yield / 19-or-80% principal)
    address internal creator;      // benefactor's Ownable.owner() — receives 80% on maturity

    AlignmentEndowmentVault internal vault;
    MockBenefactor internal benefactor; // acts as the aligned collection instance
    MockMasterRegistry internal masterRegistry;

    function setUp() public {
        // ── Fork guard: skip cleanly if no fork is active ───────────────────
        // This mirrors ForkTestBase.loadAddresses(). WETH bytecode is absent
        // on a plain anvil/blank node, so code.length == 0 means no fork.
        if (WETH.code.length == 0) {
            vm.skip(true);
            return;
        }

        // ── Named test addresses ─────────────────────────────────────────────
        owner = makeAddr("owner");
        treasury = makeAddr("treasury");
        community = makeAddr("community");
        creator = makeAddr("creator");

        // On a mainnet FORK a makeAddr value can collide with a real deployed contract whose
        // fallback consumes/forwards incoming ETH — which would silently zero out a split leg and
        // break balance assertions. Force the ETH recipients to be codeless EOAs.
        vm.etch(treasury, "");
        vm.etch(community, "");
        vm.etch(creator, "");

        // ── Deploy stub contracts ────────────────────────────────────────────
        masterRegistry = new MockMasterRegistry();
        benefactor = new MockBenefactor(creator);

        // ── Deploy + initialize vault clone (mirrors factory flow) ───────────
        // Use a non-zero placeholder for alignmentToken (not exercised here).
        address alignmentToken = makeAddr("alignmentToken");

        address impl = address(new AlignmentEndowmentVault());
        AlignmentEndowmentVault clone =
            AlignmentEndowmentVault(payable(LibClone.clone(impl)));
        clone.initialize(
            owner,
            WETH,
            STATA,
            treasury,
            address(masterRegistry),
            alignmentToken,
            community
        );
        vault = clone;
    }

    // ────────────────────────────────────────────────────────────────────────
    // Test 1 — Deposit round-trips through real Aave
    // ────────────────────────────────────────────────────────────────────────

    /**
     * @notice Sending ETH through receiveContribution wraps to WETH, supplies Aave,
     *         and the vault holds real stataToken shares whose asset value ≈ the deposit.
     */
    function test_deposit_roundTripThroughRealAave() public {
        uint256 amount = 1 ether;

        // Fund the caller and call receiveContribution
        vm.deal(address(this), amount);
        vault.receiveContribution{value: amount}(
            Currency.wrap(address(0)),
            amount,
            address(benefactor)
        );

        // Principal tracked correctly
        assertEq(vault.principal(address(benefactor)), amount, "principal mismatch");
        assertEq(vault.totalPrincipal(), amount, "totalPrincipal mismatch");

        // Vault actually received stataToken shares from real Aave
        uint256 shares = _stataBalanceOf(address(vault));
        assertGt(shares, 0, "vault should hold stataToken shares");

        // Shares convert back to approximately the deposited amount.
        // The stataToken exchange rate starts at 1:1 and only moves with block-level
        // interest; on the same fork block the rounding is at most a few wei.
        uint256 assetsFromShares = _stataConvertToAssets(shares);
        // Allow 2 wei rounding (ERC-4626 floor division).
        assertApproxEqAbs(assetsFromShares, amount, 2, "stataToken assets should approx eq deposit");
    }

    // ────────────────────────────────────────────────────────────────────────
    // Test 2 — Principal withdraw returns funds via real Aave (matured path)
    // ────────────────────────────────────────────────────────────────────────

    /**
     * @notice After maturity (365 days) the creator calls withdrawPrincipal.
     *         Real stataToken redeems WETH → ETH and the 80/19/1 split is delivered.
     *
     * Split math:
     *   creator    = 80% = MAJOR_BPS / BPS
     *   community  = 19% = MINOR_BPS / BPS
     *   treasury   = remainder (~1%, absorbs rounding dust)
     *
     * Tolerance: 5 wei absolute per recipient (integer BPS division + ETH transfer).
     * Deterministic split math is covered by the unit test; this test proves the
     * real Aave redeem path delivers the right ETH amounts end-to-end.
     */
    function test_withdrawPrincipal_matured_returnsFundsSplit() public {
        uint256 amount = 1 ether;

        // --- deposit ---
        vm.deal(address(this), amount);
        vault.receiveContribution{value: amount}(
            Currency.wrap(address(0)),
            amount,
            address(benefactor)
        );

        // --- warp past maturity ---
        vm.warp(block.timestamp + 365 days + 1);

        // --- snapshot balances ---
        uint256 creatorBefore = creator.balance;
        uint256 communityBefore = community.balance;
        uint256 treasuryBefore = treasury.balance;

        // --- withdraw as benefactor's owner (creator) ---
        vm.prank(creator);
        vault.withdrawPrincipal(address(benefactor));

        // --- accounting cleared ---
        assertEq(vault.principal(address(benefactor)), 0, "principal should be 0 after withdrawal");
        assertEq(vault.totalPrincipal(), 0, "totalPrincipal should be 0 after withdrawal");

        // --- recipients received ETH ---
        uint256 creatorGot = creator.balance - creatorBefore;
        uint256 communityGot = community.balance - communityBefore;
        uint256 treasuryGot = treasury.balance - treasuryBefore;

        uint256 totalOut = creatorGot + communityGot + treasuryGot;

        // Total should equal ~amount (real Aave redeem is exact-assets, so amount itself
        // is returned; any additional compounding above principal is accumulatedFees and
        // NOT included in the principal redemption path).
        // Allow 2 wei for ERC-4626 rounding in stataToken.withdraw.
        assertApproxEqAbs(totalOut, amount, 2, "total out should approx eq deposit amount");

        // Individual split checks: 80 / 19 / ~1.
        // Expected values from integer BPS math on `totalOut`.
        uint256 expectedCreator = (totalOut * 8000) / 10_000;
        uint256 expectedCommunity = (totalOut * 1900) / 10_000;
        uint256 expectedTreasury = totalOut - expectedCreator - expectedCommunity;

        // 5-wei tolerance covers the BPS integer division across the three legs.
        assertApproxEqAbs(creatorGot, expectedCreator, 5, "creator cut mismatch");
        assertApproxEqAbs(communityGot, expectedCommunity, 5, "community cut mismatch");
        assertApproxEqAbs(treasuryGot, expectedTreasury, 5, "treasury cut mismatch");
    }

    // ────────────────────────────────────────────────────────────────────────
    // Test 3 — Yield realization (best-effort on a fork)
    // ────────────────────────────────────────────────────────────────────────

    /**
     * @notice Demonstrates the harvest() path against real Aave.
     *
     * WETH supply APY on Aave V3 mainnet is typically low (often < 0.1%).
     * On a single fork block no interest accrues, so accumulatedFees() is
     * almost certainly 0 and harvest() is a clean no-op. This is expected and
     * acceptable — the yield split arithmetic is covered deterministically by
     * the unit test suite; this fork test proves:
     *   (a) harvest() never reverts or underflows when fees ≈ 0.
     *   (b) If fees somehow exceed 0 (non-zero Aave state at the fork block),
     *       community and treasury receive their share and principal is intact.
     *   (c) accumulatedFees() never underflows (always ≥ 0).
     *
     * We warp 365 days to let interest notionally compound. Whether the fork
     * reflects any accrued interest depends on when the fork block was taken.
     */
    function test_harvest_yieldRealizationOrCleanNoop() public {
        uint256 amount = 1 ether;

        // --- deposit ---
        vm.deal(address(this), amount);
        vault.receiveContribution{value: amount}(
            Currency.wrap(address(0)),
            amount,
            address(benefactor)
        );

        // accumulatedFees() should never underflow — a key safety invariant.
        uint256 feesBefore = vault.accumulatedFees();
        assertGe(feesBefore, 0, "accumulatedFees must not underflow"); // uint so always true; documents intent

        // Warp one year to allow interest to accrue in the fork state.
        vm.warp(block.timestamp + 365 days);

        uint256 feesAfterWarp = vault.accumulatedFees();
        assertGe(feesAfterWarp, 0, "accumulatedFees after warp must not underflow");

        uint256 communityBefore = community.balance;
        uint256 treasuryBefore = treasury.balance;

        // harvest() must never revert regardless of accumulated amount.
        vault.harvest();

        if (feesAfterWarp > 0) {
            // Yield was present — verify split (99% community / ~1% platform).
            uint256 communityGot = community.balance - communityBefore;
            uint256 treasuryGot = treasury.balance - treasuryBefore;

            assertGt(communityGot, 0, "community should receive yield");
            assertGt(treasuryGot, 0, "treasury should receive platform cut");

            // After harvest, principal is unaffected.
            assertEq(vault.principal(address(benefactor)), amount, "principal must be intact after harvest");
            assertEq(vault.totalPrincipal(), amount, "totalPrincipal must be intact after harvest");

            // accumulatedFees resets to ~0 post-harvest (any leftover is sub-wei rounding).
            assertLe(vault.accumulatedFees(), 1, "fees should be ~0 after harvest");
        } else {
            // No yield on this fork block — harvest is a clean no-op.
            assertEq(community.balance, communityBefore, "community balance should be unchanged (no yield)");
            assertEq(treasury.balance, treasuryBefore, "treasury balance should be unchanged (no yield)");
            // Principal unaffected.
            assertEq(vault.principal(address(benefactor)), amount, "principal must be intact after noop harvest");
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    // Internal helpers — raw staticcalls to avoid importing the full stataToken ABI
    // ────────────────────────────────────────────────────────────────────────

    function _stataBalanceOf(address account) internal view returns (uint256) {
        (bool ok, bytes memory data) = STATA.staticcall(abi.encodeWithSignature("balanceOf(address)", account));
        require(ok, "stataToken.balanceOf failed");
        return abi.decode(data, (uint256));
    }

    function _stataConvertToAssets(uint256 shares) internal view returns (uint256) {
        (bool ok, bytes memory data) =
            STATA.staticcall(abi.encodeWithSignature("convertToAssets(uint256)", shares));
        require(ok, "stataToken.convertToAssets failed");
        return abi.decode(data, (uint256));
    }
}
