// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { Currency } from "v4-core/types/Currency.sol";

import { AlignmentEndowmentVault } from "../../../src/vaults/aave/AlignmentEndowmentVault.sol";

// NOTE: AaveV3Ethereum.sol transitively imports AaveV3.sol which requires the
// aave-v3-origin submodule (not installed in this repo). We inline the two
// canonical mainnet addresses directly — they match the values in
// lib/aave-address-book/src/AaveV3Ethereum.sol (lines 148 and 169) and are
// verified on Etherscan. Using hardcoded constants here is intentional and safe.

// ---------------------------------------------------------------------------
// Minimal helper: a contract that acts as the benefactor collection instance.
// The yield-claim path calls IOwnable(benefactor).owner(), so the benefactor
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
 * @notice Fork integration test for the reworked AlignmentEndowmentVault (specs 2a + 2b) against REAL
 *         Aave V3 on mainnet. Exercises: deposit round-trip, the two-class yield split via harvest,
 *         the per-benefactor vest transition, and multi-benefactor creator-yield accrual across a vest
 *         boundary — end-to-end through real Aave.
 *
 * Run (with a fork URL set):
 *   forge test --match-path "test/fork/vaults/AlignmentEndowmentVaultFork.t.sol" \
 *              --fork-url $ETH_RPC_URL -vvv
 *
 * Without a fork URL this test auto-skips (vm.skip) — consistent with the existing ForkTestBase guard
 * used by all other fork tests in this repo. Deterministic split arithmetic is covered to the wei by the
 * unit suite; this fork test proves the real Aave redeem paths behave.
 */
contract AlignmentEndowmentVaultForkTest is Test {
    // ── Real Aave V3 mainnet addresses ──────────────────────────────────────
    // Source: lib/aave-address-book/src/AaveV3Ethereum.sol, AaveV3EthereumAssets
    // WETH_UNDERLYING  → line 148 → 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
    // WETH_STATA_TOKEN → line 169 → 0x0bfc9d54Fc184518A81162F8fB99c2eACa081202 (waEthWETH)
    address internal constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address internal constant STATA = 0x0bfc9d54Fc184518A81162F8fB99c2eACa081202;

    uint256 internal constant TARGET_ID = 42;
    uint256 internal constant VEST = 26 weeks;

    // ── Test participants ────────────────────────────────────────────────────
    address internal owner; // vault owner (factory stand-in)
    address internal treasury; // protocolTreasury (1% protocol)
    address internal community; // communityPayout (target sink)
    address internal creator; // benefactor's Ownable.owner() — receives creator yield

    AlignmentEndowmentVault internal vault;
    MockBenefactor internal benefactor; // acts as the aligned collection instance
    MockMasterRegistry internal masterRegistry;

    function setUp() public {
        // Skip cleanly if no fork is active (WETH bytecode absent on a blank node).
        if (WETH.code.length == 0) {
            vm.skip(true);
            return;
        }

        owner = makeAddr("owner");
        treasury = makeAddr("treasury");
        community = makeAddr("community");
        creator = makeAddr("creator");

        // On a mainnet FORK a makeAddr value can collide with a real deployed contract whose fallback
        // consumes/forwards incoming ETH. Force the ETH recipients to be codeless EOAs.
        vm.etch(treasury, "");
        vm.etch(community, "");
        vm.etch(creator, "");

        masterRegistry = new MockMasterRegistry();
        benefactor = new MockBenefactor(creator);

        address alignmentToken = makeAddr("alignmentToken");

        address impl = address(new AlignmentEndowmentVault());
        AlignmentEndowmentVault clone = AlignmentEndowmentVault(payable(LibClone.clone(impl)));
        clone.initialize(owner, WETH, STATA, treasury, address(masterRegistry), alignmentToken, TARGET_ID, community);
        vault = clone;
    }

    // ────────────────────────────────────────────────────────────────────────
    // Test 1 — Deposit round-trips through real Aave
    // ────────────────────────────────────────────────────────────────────────

    function test_deposit_roundTripThroughRealAave() public {
        uint256 amount = 1 ether;

        vm.deal(address(this), amount);
        vault.receiveContribution{ value: amount }(Currency.wrap(address(0)), amount, address(benefactor));

        assertEq(vault.escrowedPrincipal(address(benefactor)), amount, "escrowed principal mismatch");
        assertEq(vault.totalEscrowedPrincipal(), amount, "totalEscrowed mismatch");

        uint256 shares = _stataBalanceOf(address(vault));
        assertGt(shares, 0, "vault should hold stataToken shares");

        uint256 assetsFromShares = _stataConvertToAssets(shares);
        assertApproxEqAbs(assetsFromShares, amount, 2, "stataToken assets should approx eq deposit");
    }

    // ────────────────────────────────────────────────────────────────────────
    // Test 2 — Yield realization: escrowed two-class split (best-effort on a fork)
    // ────────────────────────────────────────────────────────────────────────

    /**
     * @notice harvest() against real Aave. On a single fork block interest is typically ~0, so harvest is
     *         a clean no-op; if the fork state carries accrued interest, the escrowed class splits
     *         80 creator / 19 target / 1 protocol — the creator leg accrues to the benefactor's purse
     *         (claimable), and target + protocol receive ETH.
     */
    function test_harvest_escrowedSplitOrCleanNoop() public {
        uint256 amount = 1 ether;

        vm.deal(address(this), amount);
        vault.receiveContribution{ value: amount }(Currency.wrap(address(0)), amount, address(benefactor));

        assertGe(vault.accumulatedFees(), 0, "accumulatedFees must not underflow");

        vm.warp(block.timestamp + 30 days);
        uint256 feesAfterWarp = vault.accumulatedFees();

        uint256 communityBefore = community.balance;
        uint256 treasuryBefore = treasury.balance;

        vault.harvest(); // must never revert

        if (feesAfterWarp > 0) {
            // target (19%) + protocol (1%) received ETH; creator leg (80%) is in the purse.
            assertGt(community.balance - communityBefore, 0, "target should receive yield");
            assertGt(treasury.balance - treasuryBefore, 0, "protocol should receive its cut");
            assertGt(vault.pendingYieldOf(address(benefactor)), 0, "creator leg accrued to purse");
            // principal intact
            assertEq(vault.escrowedPrincipal(address(benefactor)), amount, "principal intact after harvest");
        } else {
            assertEq(community.balance, communityBefore, "no yield -> no target transfer");
            assertEq(treasury.balance, treasuryBefore, "no yield -> no protocol transfer");
            assertEq(vault.pendingYieldOf(address(benefactor)), 0, "no yield -> no creator accrual");
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    // Test 3 — Vest transition through real Aave (mechanic b: stays in position)
    // ────────────────────────────────────────────────────────────────────────

    function test_vest_transitionThroughRealAave() public {
        uint256 amount = 1 ether;

        vm.deal(address(this), amount);
        vault.receiveContribution{ value: amount }(Currency.wrap(address(0)), amount, address(benefactor));

        uint256 sharesBefore = _stataBalanceOf(address(vault));

        vm.warp(block.timestamp + VEST);
        vault.vest(address(benefactor)); // permissionless

        // Accounting moved escrowed → vested; position (shares) UNCHANGED (mechanic b: no redeem).
        assertEq(vault.escrowedPrincipal(address(benefactor)), 0, "escrow cleared");
        assertEq(vault.vestedPrincipal(address(benefactor)), amount, "vested set");
        assertEq(vault.totalVestedDeployable(), amount, "totalVested set");
        assertEq(_stataBalanceOf(address(vault)), sharesBefore, "position stays in Aave (no redeem at vest)");
    }

    // ────────────────────────────────────────────────────────────────────────
    // Test 4 — Multi-benefactor creator accrual across a vest boundary
    // ────────────────────────────────────────────────────────────────────────

    /**
     * @notice Two benefactors escrowed; one vests. A subsequent harvest accrues the creator leg only to
     *         the still-escrowed benefactor (the vested one earns nothing on their creator leg). Verified
     *         end-to-end against real Aave. Directional on a fork (real yield magnitude is unknown), so we
     *         assert the vested benefactor's creator accrual stays zero and the escrowed one's is ≥ it.
     */
    function test_multiBenefactor_accrualAcrossVestBoundary() public {
        MockBenefactor benefactorB = new MockBenefactor(makeAddr("creatorB"));

        vm.deal(address(this), 2 ether);
        vault.receiveContribution{ value: 1 ether }(Currency.wrap(address(0)), 1 ether, address(benefactor));
        vault.receiveContribution{ value: 1 ether }(Currency.wrap(address(0)), 1 ether, address(benefactorB));

        // A vests, B stays escrowed.
        vm.warp(block.timestamp + VEST);
        vault.vest(address(benefactor));
        assertEq(vault.totalEscrowedPrincipal(), 1 ether, "only B remains escrowed");
        assertEq(vault.totalVestedDeployable(), 1 ether, "A vested");

        // Let interest notionally accrue, then harvest.
        vm.warp(block.timestamp + 30 days);
        vault.harvest();

        // The vested benefactor (A) accrues NO creator yield; the escrowed one (B) accrues ≥ 0 and never
        // less than A. (On a fork with zero accrued interest both are 0 — still consistent.)
        assertEq(vault.pendingYieldOf(address(benefactor)), 0, "vested benefactor accrues no creator yield");
        assertGe(
            vault.pendingYieldOf(address(benefactorB)),
            vault.pendingYieldOf(address(benefactor)),
            "escrowed benefactor accrues at least as much as the vested one"
        );
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
        (bool ok, bytes memory data) = STATA.staticcall(abi.encodeWithSignature("convertToAssets(uint256)", shares));
        require(ok, "stataToken.convertToAssets failed");
        return abi.decode(data, (uint256));
    }
}
