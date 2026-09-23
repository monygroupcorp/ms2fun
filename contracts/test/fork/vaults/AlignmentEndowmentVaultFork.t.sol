// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { Currency } from "v4-core/types/Currency.sol";

import { AlignmentEndowmentVault } from "../../../src/vaults/aave/AlignmentEndowmentVault.sol";
import { ERC4626_FLOOR_WEI } from "../helpers/Erc4626Rounding.sol";

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
    address public alignmentRegistry;

    function setAlignmentRegistry(address registry) external {
        alignmentRegistry = registry;
    }

    function isAgent(address) external pure returns (bool) {
        return false;
    }
}

// Minimal alignment-registry stub. The vault reads its target sink from here on every send and keeps no
// copy of its own, so this is the only place the community payout can live.
contract MockSinkRegistry {
    mapping(uint256 => address) public getCommunityPayout;
    mapping(uint256 => mapping(address => bool)) internal _ambassadors;

    function setCommunityPayout(uint256 targetId, address payout) external {
        getCommunityPayout[targetId] = payout;
    }

    function setAmbassador(uint256 targetId, address account, bool flag) external {
        _ambassadors[targetId][account] = flag;
    }

    function isAmbassador(uint256 targetId, address account) external view returns (bool) {
        return _ambassadors[targetId][account];
    }

    function isAlignmentTargetActive(uint256) external pure returns (bool) {
        return true;
    }
}

/**
 * @title AlignmentEndowmentVaultFork
 * @notice Fork integration test for the AlignmentEndowmentVault against REAL Aave V3 on mainnet.
 *         Exercises: deposit round-trip, the flat yield split via harvest, an ambassador withdrawal out
 *         of the real position, and pro-rata creator-yield accrual across it — end-to-end through real
 *         Aave.
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

    // ── Test participants ────────────────────────────────────────────────────
    address internal owner; // vault owner (factory stand-in)
    address internal treasury; // protocolTreasury (1% protocol)
    address internal community; // the target sink, held in the registry stub the vault reads
    address internal creator; // benefactor's Ownable.owner() — receives creator yield
    address internal ambassador; // seated on the target: eligibility to withdraw the corpus

    AlignmentEndowmentVault internal vault;
    MockBenefactor internal benefactor; // acts as the aligned collection instance
    MockMasterRegistry internal masterRegistry;
    MockSinkRegistry internal sinkRegistry;

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
        sinkRegistry = new MockSinkRegistry();
        masterRegistry.setAlignmentRegistry(address(sinkRegistry));
        sinkRegistry.setCommunityPayout(TARGET_ID, community);
        benefactor = new MockBenefactor(creator);
        ambassador = makeAddr("ambassador");
        sinkRegistry.setAmbassador(TARGET_ID, ambassador, true);

        address alignmentToken = makeAddr("alignmentToken");

        address impl = address(new AlignmentEndowmentVault());
        AlignmentEndowmentVault clone = AlignmentEndowmentVault(payable(LibClone.clone(impl)));
        clone.initialize(owner, WETH, STATA, treasury, address(masterRegistry), alignmentToken, TARGET_ID);
        vault = clone;
    }

    // ────────────────────────────────────────────────────────────────────────
    // Test 1 — Deposit round-trips through real Aave
    // ────────────────────────────────────────────────────────────────────────

    function test_deposit_roundTripThroughRealAave() public {
        uint256 amount = 1 ether;

        vm.deal(address(this), amount);
        vault.receiveContribution{ value: amount }(Currency.wrap(address(0)), amount, address(benefactor));

        assertEq(vault.principalOf(address(benefactor)), amount, "principal mismatch");
        assertEq(vault.totalPrincipal(), amount, "totalPrincipal mismatch");

        uint256 shares = _stataBalanceOf(address(vault));
        assertGt(shares, 0, "vault should hold stataToken shares");

        uint256 assetsFromShares = _stataConvertToAssets(shares);
        assertApproxEqAbs(assetsFromShares, amount, 2, "stataToken assets should approx eq deposit");
    }

    // ────────────────────────────────────────────────────────────────────────
    // Test 2 — Yield realization: the flat split (best-effort on a fork)
    // ────────────────────────────────────────────────────────────────────────

    /**
     * @notice harvest() against real Aave. On a single fork block interest is typically ~0, so harvest is
     *         a clean no-op; if the fork state carries accrued interest, it splits 80 creator / 19 target /
     *         1 protocol — the creator leg accrues to the benefactor's purse (claimable), and target +
     *         protocol receive ETH.
     */
    function test_harvest_flatSplitOrCleanNoop() public {
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
            assertEq(vault.principalOf(address(benefactor)), amount, "principal intact after harvest");
        } else {
            assertEq(community.balance, communityBefore, "no yield -> no target transfer");
            assertEq(treasury.balance, treasuryBefore, "no yield -> no protocol transfer");
            assertEq(vault.pendingYieldOf(address(benefactor)), 0, "no yield -> no creator accrual");
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    // Test 3 — A withdrawal through real Aave debits exactly what left
    // ────────────────────────────────────────────────────────────────────────

    /// @notice The corpus is the whole principal from the block it lands, and an ambassador's withdrawal
    ///         redeems it out of the real Aave position. What is debited is what actually left.
    function test_withdraw_throughRealAave() public {
        uint256 amount = 1 ether;

        vm.deal(address(this), amount);
        vault.receiveContribution{ value: amount }(Currency.wrap(address(0)), amount, address(benefactor));
        // `deployableCorpus` is `min(stataValue, totalPrincipal)`, and a real ERC-4626 deposit floors, so
        // one wei after the deposit the position reads a wei under the basis and the min picks the
        // position. That direction is the safe one and is the point of the min: the figure bounds what an
        // ambassador may take out, so under-reading can only authorise less than the vault holds.
        // Over-reading would authorise more, which is what ERC4626_FLOOR_WEI's upper assert pins.
        assertLe(vault.deployableCorpus(), amount, "deployable MORE than was deposited");
        assertGe(vault.deployableCorpus() + ERC4626_FLOOR_WEI, amount, "the whole deposit is deployable at once");

        address sink = makeAddr("deploy_sink");
        vm.etch(sink, "");
        uint256 half = amount / 2;

        vm.prank(ambassador);
        vault.execute(sink, half, "");

        assertEq(sink.balance, half, "the redeemed ETH reached the sink");
        // The sink is paid exactly, and the basis absorbs the redeem's floor: one conversion stands
        // between the position and the ETH that left. Under-debiting the basis would be the unsafe
        // direction -- it would leave the vault believing it holds principal it has already paid out --
        // so that is asserted on its own, ahead of the magnitude.
        assertLe(vault.totalPrincipal(), amount - half, "basis debited by LESS than what left");
        assertGe(vault.totalPrincipal() + ERC4626_FLOOR_WEI, amount - half, "basis debited by what left");
        // `principalOf` floors once more on top, reading a share of the basis back.
        assertLe(
            vault.principalOf(address(benefactor)),
            vault.totalPrincipal(),
            "the donor is credited more basis than the vault holds"
        );
        assertGe(
            vault.principalOf(address(benefactor)) + 2 * ERC4626_FLOOR_WEI,
            amount - half,
            "and the donor's share fell with it"
        );

        // Two floors stand between the deposit and this read: the ERC-4626 deposit that minted the
        // vault's stata shares, and the `convertToAssets` that values them back. Hence 2 * the per-
        // conversion floor, named rather than the bare `+ 2` that stood here with no bound stated.
        uint256 positionAfter = _stataConvertToAssets(_stataBalanceOf(address(vault)));
        assertGe(positionAfter + 2 * ERC4626_FLOOR_WEI, amount - half, "the rest is still in the Aave position");
    }

    // ────────────────────────────────────────────────────────────────────────
    // Test 4 — Multi-benefactor creator accrual is pro-rata, and stays so after a withdrawal
    // ────────────────────────────────────────────────────────────────────────

    /**
     * @notice Two benefactors, equal principal, so the creator leg divides evenly — and it keeps dividing
     *         evenly after a withdrawal takes half the pool, because the withdrawal came out of the pool
     *         rather than out of one of them. Directional on a fork (real yield magnitude is unknown), so
     *         the assertion is on the shape: both grow, and they grow together.
     */
    function test_multiBenefactor_accrualIsProRataAcrossAWithdrawal() public {
        MockBenefactor benefactorB = new MockBenefactor(makeAddr("creatorB"));

        vm.deal(address(this), 2 ether);
        vault.receiveContribution{ value: 1 ether }(Currency.wrap(address(0)), 1 ether, address(benefactor));
        vault.receiveContribution{ value: 1 ether }(Currency.wrap(address(0)), 1 ether, address(benefactorB));

        address sink = makeAddr("deploy_sink");
        vm.etch(sink, "");
        vm.prank(ambassador);
        vault.execute(sink, 1 ether, ""); // half the pool leaves

        // "Halved" is a claim about the SPLIT, so assert it against the live basis rather than against a
        // round number the vault never holds. Two 1 ETH deposits do not mint exactly equal principal
        // shares -- each one's ERC-4626 deposit floors on its own -- and `principalOf` floors again when
        // it reads a share back, so neither benefactor lands on exactly 0.5 ether and they can sit a wei
        // apart from each other. What must hold is that the debit fell on both alike and that the vault
        // never credits out more basis than it carries.
        uint256 principalA = vault.principalOf(address(benefactor));
        uint256 principalB = vault.principalOf(address(benefactorB));
        uint256 basis = vault.totalPrincipal();
        assertApproxEqAbs(principalA, basis / 2, ERC4626_FLOOR_WEI, "A halved");
        assertApproxEqAbs(principalB, basis / 2, ERC4626_FLOOR_WEI, "B halved with it");
        assertApproxEqAbs(principalA, principalB, ERC4626_FLOOR_WEI, "and the debit fell on both alike");
        // The sum may fall under the basis by one floor per benefactor and must NEVER exceed it: crediting
        // out more basis than the vault carries is the failure this bound exists to catch.
        assertLe(principalA + principalB, basis, "benefactors are credited more basis than the vault holds");
        assertGe(principalA + principalB + 2 * ERC4626_FLOOR_WEI, basis, "basis went missing beyond the floors");

        uint256 pendingABefore = vault.pendingYieldOf(address(benefactor));
        uint256 pendingBBefore = vault.pendingYieldOf(address(benefactorB));

        vm.warp(block.timestamp + 30 days);
        vault.harvest();

        uint256 pendingAAfter = vault.pendingYieldOf(address(benefactor));
        uint256 pendingBAfter = vault.pendingYieldOf(address(benefactorB));

        assertGt(pendingAAfter, pendingABefore, "A keeps accruing on what is left");
        assertEq(pendingAAfter - pendingABefore, pendingBAfter - pendingBBefore, "and both accrue equally");
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
