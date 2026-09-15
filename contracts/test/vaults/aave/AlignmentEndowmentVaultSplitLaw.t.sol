// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { Currency } from "v4-core/types/Currency.sol";

import { AlignmentEndowmentVault } from "../../../src/vaults/aave/AlignmentEndowmentVault.sol";
import { AlignmentRegistryV1 } from "../../../src/master/AlignmentRegistryV1.sol";
import { IAlignmentRegistry } from "../../../src/master/interfaces/IAlignmentRegistry.sol";

import { MockWETH, MockStataToken, MockMasterRegistry, MockOwnable } from "./AlignmentEndowmentVault.t.sol";

/// @dev A creator contract that re-enters the vault from its ETH receive hook. The endowment pays the
///      creator leg with a force-send carrying a ~100k gas stipend, which is ample to make a call back
///      in — so "the guard holds" is a claim about `nonReentrant`, not about the recipient's gas budget,
///      and it has to be driven from a recipient that actually tries.
contract ReentrantCreator {
    AlignmentEndowmentVault public vault;
    address public benefactor;
    /// @dev 1 = claim the same purse again, 2 = harvest, 3 = flushTargetFees.
    uint256 public mode;
    bool public tried;
    bool public succeeded;

    function arm(AlignmentEndowmentVault v, address b, uint256 m) external {
        vault = v;
        benefactor = b;
        mode = m;
        tried = false;
        succeeded = false;
    }

    receive() external payable {
        if (mode == 0 || tried) return;
        tried = true;
        bool ok;
        if (mode == 1) {
            (ok,) = address(vault).call(abi.encodeWithSelector(vault.claimYieldPurse.selector, benefactor));
        } else if (mode == 2) {
            (ok,) = address(vault).call(abi.encodeWithSelector(vault.harvest.selector));
        } else {
            (ok,) = address(vault).call(abi.encodeWithSelector(vault.flushTargetFees.selector));
        }
        // Swallowed on purpose: the outer claim must still settle, so the assertion can be "paid exactly
        // once" rather than "the whole thing reverted".
        succeeded = ok;
    }
}

/// @notice The endowment's yield split, division by division, and the surfaces that decide where each leg
///         lands.
///
/// @dev    The vault's split law is three hard constants and one subtraction — 1% protocol, 19% target,
///         and the creator taking what is left. The existing suite proves the law at round numbers
///         (1 ETH of yield over a 4 ETH pool, where every division is exact) and proves it repeats. What
///         it does not do is push on the divisions themselves: what the legs are when a harvest is too
///         small to carry a 1% leg at all, whether the remainder always lands on the creator rather than
///         the target, whether the per-share accumulator can actually deliver the creator leg it was
///         handed, and who the target leg reaches when the registry's answer is an address that is not a
///         community.
///
///         Every test here drives the REAL `AlignmentRegistryV1`, not a payout mock. Two of the findings
///         below live in the seam between the registry's "only the current payee may rotate" rule and the
///         vault's `execute`, and a mock registry has no such seam.
contract AlignmentEndowmentVaultSplitLawTest is Test {
    AlignmentEndowmentVault internal vault;
    AlignmentRegistryV1 internal registry;
    MockWETH internal weth;
    MockStataToken internal stata;
    MockMasterRegistry internal masterRegistry;
    MockOwnable internal benefactor;

    address internal protocolOwner = makeAddr("protocolOwner");
    address internal vaultOwner = makeAddr("vaultOwner");
    address internal treasury = makeAddr("treasury");
    address internal alignmentToken = makeAddr("alignmentToken");
    address internal alice = makeAddr("alice");
    address internal ambassador = makeAddr("ambassador");
    address internal communityMultisig = makeAddr("communityMultisig");
    address internal attackerSink = makeAddr("attackerSink");

    uint256 internal targetId;
    Currency internal nativeCurrency = Currency.wrap(address(0));

    /// @dev Mirrors of the vault's internal constants, so a change to either goes red here by name.
    uint256 internal constant BPS = 10_000;
    uint256 internal constant PROTOCOL_BPS = 100;
    uint256 internal constant TARGET_BPS = 1_900;
    uint256 internal constant ACC_PRECISION = 1e18;
    uint256 internal constant MIN_SHARE_PRICE_INVERSE = 1e9;

    function setUp() public {
        weth = new MockWETH();
        stata = new MockStataToken(address(weth));
        masterRegistry = new MockMasterRegistry();

        registry = new AlignmentRegistryV1(address(weth), address(0), address(0));
        registry.initialize(protocolOwner);
        masterRegistry.setAlignmentRegistry(address(registry));

        IAlignmentRegistry.AlignmentAsset[] memory assets = new IAlignmentRegistry.AlignmentAsset[](1);
        assets[0] =
            IAlignmentRegistry.AlignmentAsset({ token: alignmentToken, symbol: "ALGN", info: "", metadataURI: "" });
        vm.prank(protocolOwner);
        targetId = registry.registerAlignmentTarget("Remilia", "", "", assets);
        vm.prank(protocolOwner);
        registry.addAmbassador(targetId, ambassador);

        vault = _deployVault();
        benefactor = new MockOwnable(alice);

        vm.deal(alice, 1000 ether);
        vm.deal(address(this), 1000 ether);
        vm.warp(1_000_000);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function _deployVault() internal returns (AlignmentEndowmentVault v) {
        address impl = address(new AlignmentEndowmentVault());
        v = AlignmentEndowmentVault(payable(LibClone.clone(impl)));
        v.initialize(
            vaultOwner, address(weth), address(stata), treasury, address(masterRegistry), alignmentToken, targetId
        );
    }

    function _pinSink(address payout) internal {
        vm.prank(protocolOwner);
        registry.setCommunityPayout(targetId, payout);
    }

    function _contribute(address b, uint256 amount) internal {
        vm.deal(alice, alice.balance + amount);
        vm.prank(alice);
        vault.receiveContribution{ value: amount }(nativeCurrency, amount, b);
    }

    /// @dev Raise the position's value-per-share by `extra`, backed by real ETH so redemptions settle.
    function _simulateYield(uint256 extra) internal {
        vm.deal(address(weth), address(weth).balance + extra);
        weth.mint(address(this), extra);
        weth.approve(address(stata), extra);
        stata.simulateYield(extra);
    }

    /// @dev The yields the divisions actually turn over: below the 1% quantum, below the 19% quantum, on
    ///      each side of both boundaries, and two sizes with no exact division anywhere.
    function _yieldLadder() internal pure returns (uint256[10] memory) {
        return [uint256(1), 5, 6, 52, 99, 100, 101, 12_345, 999_999_999, 3.333333333333333333 ether];
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 1. The split, division by division
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev Conservation first: whatever a harvest realizes, the three legs account for every wei of it.
    ///      The creator leg is a SUBTRACTION (`got − protocolLeg − targetLeg`), so this is the property
    ///      that makes the other two floors safe — nothing is created and nothing is dropped, at any
    ///      magnitude, including the ones where neither percentage divides evenly.
    function test_split_conservesEveryWeiAtEveryMagnitude() public {
        _pinSink(communityMultisig);
        _contribute(address(benefactor), 1 ether);

        uint256[10] memory ladder = _yieldLadder();
        for (uint256 i; i < ladder.length; ++i) {
            uint256 y = ladder[i];
            uint256 communityBefore = communityMultisig.balance;
            uint256 treasuryBefore = treasury.balance;
            uint256 creatorBefore = vault.pendingYieldOf(address(benefactor));

            _simulateYield(y);
            vault.harvest();

            uint256 targetLeg = communityMultisig.balance - communityBefore;
            uint256 protocolLeg = treasury.balance - treasuryBefore;
            uint256 creatorLeg = vault.pendingYieldOf(address(benefactor)) - creatorBefore;

            assertEq(targetLeg, (y * TARGET_BPS) / BPS, "target leg is the floor of 19%");
            assertEq(protocolLeg, (y * PROTOCOL_BPS) / BPS, "protocol leg is the floor of 1%");
            assertEq(creatorLeg, y - targetLeg - protocolLeg, "creator leg is the remainder");
            assertEq(targetLeg + protocolLeg + creatorLeg, y, "every wei of the harvest is accounted for");
        }
    }

    /// @dev Which leg the rounding dust falls on is a policy, and it is the CREATOR's — never the target's
    ///      and never the protocol's. Both percentage legs floor, so across the whole ladder the creator
    ///      is paid at least its nominal 80% and the other two are paid at most their nominal share. This
    ///      is the direction that matters: a rounding law that leaned the other way would shave the
    ///      creator by a wei on every harvest forever.
    function test_split_theDustFallsOnTheCreatorNeverOnTheTargetOrTheProtocol() public {
        _pinSink(communityMultisig);
        _contribute(address(benefactor), 1 ether);

        uint256[10] memory ladder = _yieldLadder();
        for (uint256 i; i < ladder.length; ++i) {
            uint256 y = ladder[i];
            uint256 communityBefore = communityMultisig.balance;
            uint256 treasuryBefore = treasury.balance;
            uint256 creatorBefore = vault.pendingYieldOf(address(benefactor));

            _simulateYield(y);
            vault.harvest();

            uint256 targetLeg = communityMultisig.balance - communityBefore;
            uint256 protocolLeg = treasury.balance - treasuryBefore;
            uint256 creatorLeg = vault.pendingYieldOf(address(benefactor)) - creatorBefore;

            assertLe(targetLeg * BPS, y * TARGET_BPS, "target is never paid above 19%");
            assertLe(protocolLeg * BPS, y * PROTOCOL_BPS, "protocol is never paid above 1%");
            assertGe(creatorLeg * BPS, y * (BPS - TARGET_BPS - PROTOCOL_BPS), "creator is never paid below 80%");
        }
    }

    /// @dev The sacred 1% does not exist below 100 wei of harvest, and the sacred 19% does not exist below
    ///      6 wei. That is not a defect — it is the floor doing what a floor does — but it is a state of
    ///      the split with no test on it, and "1% of all yield, hard, no setter" reads as unconditional.
    ///      A vault harvested often enough on a small position spends real time in this band.
    function test_split_bothPercentageLegsVanishUnderTheirQuantum() public {
        _pinSink(communityMultisig);
        _contribute(address(benefactor), 1 ether);

        // Under the protocol quantum: 99 wei cannot carry a 1% leg, and the whole of it less the target
        // leg goes to the creator.
        uint256 communityBefore = communityMultisig.balance;
        uint256 treasuryBefore = treasury.balance;
        uint256 creatorBefore = vault.pendingYieldOf(address(benefactor));
        _simulateYield(99);
        vault.harvest();
        assertEq(treasury.balance - treasuryBefore, 0, "no protocol leg at 99 wei");
        assertEq(communityMultisig.balance - communityBefore, 18, "target leg floors to 18 wei");
        assertEq(vault.pendingYieldOf(address(benefactor)) - creatorBefore, 81, "creator takes 81 of 99");

        // Under the target quantum too: 5 wei carries neither leg, and the creator takes all of it.
        communityBefore = communityMultisig.balance;
        treasuryBefore = treasury.balance;
        creatorBefore = vault.pendingYieldOf(address(benefactor));
        _simulateYield(5);
        vault.harvest();
        assertEq(treasury.balance - treasuryBefore, 0, "no protocol leg at 5 wei");
        assertEq(communityMultisig.balance - communityBefore, 0, "no target leg at 5 wei");
        assertEq(vault.pendingYieldOf(address(benefactor)) - creatorBefore, 5, "creator takes all 5");

        // And the boundary itself is exact: 100 wei is the first harvest that pays the protocol.
        treasuryBefore = treasury.balance;
        _simulateYield(100);
        vault.harvest();
        assertEq(treasury.balance - treasuryBefore, 1, "100 wei is the first harvest carrying a 1% leg");
    }

    /// @dev The other two divisions in the money path: share pricing at deposit and `principalOf` at read.
    ///      Both floor, and both must floor DOWNWARD against the pool — a deposit never buys more weight
    ///      than its ETH is worth, and the benefactors' principals never sum above the basis behind them.
    ///      Amounts here are deliberately co-prime with the pool so neither division is exact.
    function test_rounding_sharePricingAndPrincipalOfNeverOverIssue() public {
        _pinSink(communityMultisig);
        _contribute(address(benefactor), 1 ether);

        // Move the pool off 1:1 so the pricing division has a remainder to lose.
        vm.prank(ambassador);
        vault.execute(makeAddr("elsewhere"), 333_333_333_333_333_333, "");

        address[5] memory owners = [makeAddr("b1"), makeAddr("b2"), makeAddr("b3"), makeAddr("b4"), makeAddr("b5")];
        uint256[5] memory amounts = [uint256(7), 999_999_999_999_999_997, 1_000_000_007, 3, 123_456_789_012_345_679];
        address[5] memory benefactors;
        for (uint256 i; i < owners.length; ++i) {
            benefactors[i] = address(new MockOwnable(owners[i]));
            uint256 basisBefore = vault.totalPrincipal();
            uint256 sharesBefore = vault.totalPrincipalShares();
            _contribute(benefactors[i], amounts[i]);
            uint256 minted = vault.totalPrincipalShares() - sharesBefore;

            // A deposit buys `amount * shares / principal` shares, floored: never more weight than the
            // pool's live price says the ETH is worth.
            assertLe(minted * basisBefore, amounts[i] * sharesBefore, "pricing never mints above the pool price");
        }

        // Every benefactor's live principal is `shares * basis / totalShares`, floored, so the sum over
        // all of them lands at or below the basis actually in the position. It must never exceed it: the
        // basis is what the redeem can deliver, and a sum above it is principal the vault cannot pay.
        uint256 sum = vault.principalOf(address(benefactor));
        for (uint256 i; i < benefactors.length; ++i) {
            sum += vault.principalOf(benefactors[i]);
        }
        assertLe(sum, vault.totalPrincipal(), "the benefactors' principals never sum above the basis");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 2. The creator leg the accumulator cannot carry  (FINDING — see noesis-452)
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev FINDING (noesis-452). `AlignmentEndowmentVault.sol:454` credits the creator leg as
    ///      `accCreatorYieldPerShare += (creatorLeg * ACC_PRECISION) / totalPrincipalShares`, and line 455
    ///      books the whole leg in `_totalYieldToCreators` whatever that division returned. When the share
    ///      count has outrun `creatorLeg · 1e18` the division is ZERO: the accumulator does not move, no
    ///      benefactor can ever claim the leg, the ETH stays in the vault as untracked native balance —
    ///      and `totalYieldToCreators()` reports it as routed to creators anyway.
    ///
    ///      This is not sub-wei dust. The share-price floor deliberately admits prices down to 1e-9
    ///      (`MIN_SHARE_PRICE_INVERSE`), so a pool drained to the floor and refunded carries ~1e27 shares
    ///      per ETH, and EVERY creator leg below 1 gwei is swallowed whole. One gwei on a 1 ETH pool is
    ///      about one second of yield at 3% APR, so on a drained-and-refunded pool any harvest cadence
    ///      faster than a few seconds loses the entire 80% leg — repeatably, and with the stat surface
    ///      saying it was paid. Drain-and-refund is a SUPPORTED cycle; the suite already exercises it in
    ///      `test_drainToASliver_repeatedly_doesNotBrickIntake`.
    ///
    ///      This test pins the defect as it stands today so the shape of it is on the record. It is
    ///      expected to go red when noesis-452 is fixed, and the assertions name what a fix must change.
    function test_split_creatorLegIsSwallowedWholeByTheAccumulatorOnADrainedAndRefundedPool() public {
        _pinSink(communityMultisig);
        _contribute(address(benefactor), 1 ether);

        // Drain to exactly the share-price floor: 1e9 wei of basis behind 1e18 shares.
        vm.prank(ambassador);
        vault.execute(makeAddr("elsewhere"), 1 ether - MIN_SHARE_PRICE_INVERSE, "");
        assertEq(vault.totalPrincipal(), MIN_SHARE_PRICE_INVERSE, "parked exactly at the floor");
        assertEq(vault.totalPrincipalShares(), 1e18, "shares are untouched by a withdrawal");

        // Refund it. The deposit prices at `amount · shares / basis` — 1e18 · 1e18 / 1e9 — so the pool now
        // carries ~1e27 shares, which is the bound the floor exists to allow.
        _contribute(address(benefactor), 1 ether);
        uint256 shares = vault.totalPrincipalShares();
        assertGt(shares, 1e27, "the floor admits ~1e27 shares per ETH, by design");

        uint256 accBefore = vault.accCreatorYieldPerShare();
        uint256 routedBefore = vault.totalYieldToCreators();
        uint256 claimableBefore = vault.pendingYieldOf(address(benefactor));
        uint256 vaultBalanceBefore = address(vault).balance;

        // One second of 3% APR on a 1 ETH pool, near enough: 1 gwei.
        uint256 y = 1 gwei;
        uint256 creatorLeg = y - (y * TARGET_BPS) / BPS - (y * PROTOCOL_BPS) / BPS;
        assertLt(creatorLeg * ACC_PRECISION, shares, "the leg is below one unit of the accumulator");

        _simulateYield(y);
        vault.harvest();

        assertEq(vault.accCreatorYieldPerShare(), accBefore, "DEFECT: the accumulator does not move");
        assertEq(vault.pendingYieldOf(address(benefactor)), claimableBefore, "DEFECT: nobody can claim the leg");
        assertEq(
            vault.totalYieldToCreators() - routedBefore,
            creatorLeg,
            "DEFECT: the stat surface reports the whole leg as routed to creators"
        );
        assertEq(
            address(vault).balance - vaultBalanceBefore,
            creatorLeg,
            "DEFECT: the leg is redeemed out of Aave and stranded as untracked vault balance"
        );

        // The other two legs are unaffected, which is what makes this a creator-side loss and not a
        // harvest failure anyone would notice.
        assertEq(communityMultisig.balance, (y * TARGET_BPS) / BPS, "the 19% leg still lands");
        assertEq(treasury.balance, (y * PROTOCOL_BPS) / BPS, "the 1% leg still lands");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 3. Re-entrancy on the creator payout
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev `claimYieldPurse` zeroes the purse before it force-sends (CEI) and is `nonReentrant`. The
    ///      suite proves the force-send survives a creator that REJECTS ETH; it does not prove anything
    ///      about a creator that ACCEPTS it and calls back. The stipend on the force-send is ~100k gas,
    ///      which is plenty to re-enter, so this drives all three re-entries a paid creator could make —
    ///      the same claim again, a harvest, and a fee flush — and pins that each is refused while the
    ///      outer claim still settles in full. Paid exactly once, not "the whole thing reverted".
    function test_claimYieldPurse_reentrantCreatorIsRefusedAndTheClaimStillSettlesOnce() public {
        _pinSink(communityMultisig);

        ReentrantCreator creator = new ReentrantCreator();
        MockOwnable b = new MockOwnable(address(creator));
        _contribute(address(b), 4 ether);

        for (uint256 mode = 1; mode <= 3; ++mode) {
            _simulateYield(1 ether);
            vault.harvest();

            creator.arm(vault, address(b), mode);
            uint256 owed = vault.pendingYieldOf(address(b));
            assertEq(owed, 0.8 ether, "the creator leg is the whole 80%");
            uint256 balanceBefore = address(creator).balance;

            vm.prank(address(creator));
            uint256 paid = vault.claimYieldPurse(address(b));

            assertTrue(creator.tried(), "the creator actually attempted the re-entry");
            assertFalse(creator.succeeded(), "the re-entry is refused by the guard");
            assertEq(paid, owed, "the outer claim settles in full");
            assertEq(address(creator).balance - balanceBefore, owed, "paid exactly once, not twice");
            assertEq(vault.pendingYieldOf(address(b)), 0, "and the purse is empty afterwards");
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 4. Where the target leg lands  (FINDING — see noesis-453)
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev FINDING (noesis-453), half one. `AlignmentRegistryV1.setCommunityPayout` (line 369) accepts any
    ///      non-zero address and pins it write-once. Nothing stops that address being an alignment vault —
    ///      including the very vault whose target leg it decides. When it is, `_targetSink()` returns the
    ///      vault, the 19% leg is force-sent from the vault to itself on every harvest, and
    ///      `_totalYieldToTarget` books it as delivered: `totalYieldToTarget()` reports a community
    ///      payment that never left the building, `accumulatedTargetFees` stays at zero because a sink
    ///      WAS resolved, and the ETH joins the vault's untracked native balance where no counter reaches
    ///      it. The pin is write-once and the community never held the sink, so it can never rotate away.
    function test_targetSink_aVaultPinnedAsItsOwnSinkAbsorbsTheCommunityLegWhileTheCounterSaysDelivered() public {
        _pinSink(address(vault)); // the registry accepts this today
        assertEq(registry.getCommunityPayout(targetId), address(vault), "the sink is the vault itself");

        _contribute(address(benefactor), 10 ether);
        uint256 vaultBalanceBefore = address(vault).balance;

        _simulateYield(1 ether);
        vault.harvest();

        uint256 targetLeg = (1 ether * TARGET_BPS) / BPS;
        assertEq(vault.totalYieldToTarget(), targetLeg, "DEFECT: the counter reports the 19% leg delivered");
        assertEq(vault.accumulatedTargetFees(), 0, "DEFECT: nothing is held for a later flush: a sink resolved");
        assertEq(
            address(vault).balance - vaultBalanceBefore,
            targetLeg + (1 ether - targetLeg - (1 ether * PROTOCOL_BPS) / BPS),
            "DEFECT: the community leg lands back in the vault beside the creator leg"
        );
        assertEq(communityMultisig.balance, 0, "and no community address is any richer");
    }

    /// @dev FINDING (noesis-453), half two — the part that turns a misconfiguration into an escalation.
    ///      `AlignmentEndowmentVault.execute` denies three targets (line 877: the stataToken, the WETH and
    ///      the vault itself) and the comment above it rests on an invariant stated as already true:
    ///      "(c) no registry or factory ever trusts msg.sender-is-a-vault". `AlignmentRegistryV1
    ///      .rotateCommunityPayout` (line 392) trusts exactly that — its whole auth is
    ///      `msg.sender == communityPayout[targetId]`. So with the sink pinned to the vault, ANY seated
    ///      ambassador can spend a zero-value `execute` at the registry and move the community's payout to
    ///      an address of their choosing, permanently: the community never held the sink, so it never had
    ///      the rotation lever this steals.
    ///
    ///      This is the #370 redirect reopened by a different door. #370 closed the owner's ability to
    ///      point a community's money somewhere; this points it somewhere on an ambassador's say-so, off
    ///      one owner keystroke that the registry does not refuse.
    function test_execute_anAmbassadorRotatesTheCommunityPayoutWhenTheSinkIsPinnedToTheVault() public {
        _pinSink(address(vault));
        _contribute(address(benefactor), 10 ether);

        // The ambassador spends nothing: `value = 0` is trivially within `deployableCorpus()`, the
        // registry is not on the denylist, and the vault is the current payee.
        bytes memory rotate = abi.encodeWithSelector(registry.rotateCommunityPayout.selector, targetId, attackerSink);
        vm.prank(ambassador);
        vault.execute(address(registry), 0, rotate);

        assertEq(
            registry.getCommunityPayout(targetId),
            attackerSink,
            "DEFECT: an ambassador moved the community's payout through the vault's own identity"
        );

        // And the redirect is live on the next harvest: the 19% leg now pays the attacker.
        _simulateYield(1 ether);
        vault.harvest();
        assertEq(attackerSink.balance, (1 ether * TARGET_BPS) / BPS, "DEFECT: the community's leg follows the theft");
    }

    /// @dev The same identity survives decommissioning. `migrated` closes intake and nothing else —
    ///      `execute` has no `migrated` check — so an ambassador of a still-curated target keeps the
    ///      vault's zero-value call surface after the position has been migrated out. On its own that is a
    ///      dormant capability; with noesis-453 it is the same theft, available forever.
    function test_execute_theAmbassadorKeepsTheVaultsCallSurfaceAfterMigration() public {
        _pinSink(communityMultisig);
        _contribute(address(benefactor), 1 ether);

        vm.prank(vaultOwner);
        vault.migratePosition(makeAddr("recovery"));
        assertTrue(vault.migrated(), "the vault is decommissioned");
        assertEq(vault.deployableCorpus(), 0, "and there is no corpus left to deploy");

        // A value-bearing deploy is bounded to nothing, but a zero-value call still lands.
        vm.prank(ambassador);
        vm.expectRevert(); // ExceedsDeployableCorpus
        vault.execute(makeAddr("anywhere"), 1, "");

        vm.prank(ambassador);
        vault.execute(address(registry), 0, abi.encodeWithSelector(registry.getCommunityPayout.selector, targetId));
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 5. Migrate / round-close ordering
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev `migratePosition` answers an Aave reserve deprecation and takes the POSITION. It deliberately
    ///      does not sweep `roundResidue`, which is corpus already redeemed out of Aave — and the contract
    ///      states that the `NoPrincipal` guard does not strand that residue, because both of its doors
    ///      read neither `totalPrincipal` nor `migrated`. That claim had no test. Drive it: close a round
    ///      so the residue is all that is left, watch migrate refuse, and watch the residue still leave by
    ///      the curated door.
    function test_migrate_withOnlyResidueLeftRefusesAndLeavesTheResidueReachable() public {
        _pinSink(communityMultisig);
        _contribute(address(benefactor), 1 ether);

        // Withdraw all but a wei: the pool crosses the share-price floor, the round closes, and the
        // residual principal is redeemed out into `roundResidue`.
        vm.prank(ambassador);
        vault.execute(makeAddr("elsewhere"), 1 ether - 1, "");
        assertEq(vault.totalPrincipal(), 0, "the close zeroed the basis");
        assertEq(vault.roundResidue(), 1, "and moved the residual principal out as corpus");

        vm.prank(vaultOwner);
        vm.expectRevert(AlignmentEndowmentVault.NoPrincipal.selector);
        vault.migratePosition(makeAddr("recovery"));

        assertEq(vault.roundResidue(), 1, "the refusal leaves the residue untouched");
        assertFalse(vault.migrated(), "and does not decommission the vault");

        uint256 sinkBefore = communityMultisig.balance;
        assertEq(vault.flushRoundResidue(), 1, "the curated door still reaches it");
        assertEq(communityMultisig.balance - sinkBefore, 1, "and delivers it to the registry's sink");
    }

    /// @dev Migrate does not run the round close, and does not have to: it takes the WHOLE basis, so it
    ///      leaves nothing behind to be read as yield. Drive it from the one state where the ordering
    ///      could matter — a pool already under the share-price floor after a liquidity-shortened release,
    ///      where a close is owed and has not run. Migrate takes all of it, zeroes the basis, empties the
    ///      position and closes intake permanently, so the outstanding share count can never price another
    ///      deposit.
    function test_migrate_underTheShareFloorTakesTheWholeBasisAndClosesIntakeForGood() public {
        _pinSink(communityMultisig);
        _contribute(address(benefactor), 1 ether);

        // De-curate and release under a crunch: the release is partial, so the close is deferred and the
        // pool is left under the floor with live basis behind the old share count.
        vm.prank(protocolOwner);
        registry.deactivateAlignmentTarget(targetId);
        stata.setMaxWithdrawCap(1 ether - 2e6);
        vault.releaseCorpusToCommunity();
        assertEq(vault.totalPrincipal(), 2e6, "a real basis is left behind");
        assertLt(vault.totalPrincipal() * MIN_SHARE_PRICE_INVERSE, vault.totalPrincipalShares(), "under the floor");

        stata.setMaxWithdrawCap(0); // the crunch clears
        address recovery = makeAddr("recovery");
        vm.prank(vaultOwner);
        vault.migratePosition(recovery);

        assertEq(recovery.balance, 2e6, "migrate relocated the whole remaining basis");
        assertEq(vault.totalPrincipal(), 0, "the basis is zeroed");
        assertEq(vault.currentPositionValue(), 0, "and the position is empty behind it");
        assertEq(vault.roundResidue(), 0, "migrate creates no residue: it takes the principal, it does not park it");
        assertTrue(vault.migrated(), "intake is closed permanently");

        // The outstanding shares survive the migrate, and can never price a deposit again.
        assertGt(vault.totalPrincipalShares(), 0, "the share count is frozen in place, not cleared");
        vm.deal(alice, alice.balance + 1 ether);
        vm.prank(alice);
        vm.expectRevert(AlignmentEndowmentVault.VaultMigrated.selector);
        vault.receiveContribution{ value: 1 ether }(nativeCurrency, 1 ether, address(benefactor));
    }

    /// @dev A closed round's residue is corpus, and the vault must never let it be read as harvestable
    ///      yield. `accumulatedFees()` is the preview the outside world reads, and it is
    ///      position-value-above-basis — so the close redeeming the residue OUT before zeroing the basis
    ///      is exactly what keeps that preview honest. Pin the preview itself, which the suite pins
    ///      nowhere else after a close.
    function test_residue_isNeverPreviewedAsHarvestableYieldAfterAClose() public {
        _pinSink(communityMultisig);
        _contribute(address(benefactor), 1 ether);

        vm.prank(ambassador);
        vault.execute(makeAddr("elsewhere"), 1 ether - 1, "");

        assertEq(vault.roundResidue(), 1, "the residue is held as corpus");
        assertEq(vault.totalPrincipal(), 0, "the basis is zeroed");
        assertEq(vault.currentPositionValue(), 0, "the position is empty, so there is no value above basis");
        assertEq(vault.accumulatedFees(), 0, "and nothing previews as harvestable yield");

        // A harvest in that state credits nobody, and leaves the residue where it is.
        vault.harvest();
        assertEq(vault.totalYieldToCreators(), 0, "no creator leg was invented");
        assertEq(vault.totalYieldToTarget(), 0, "no target leg was invented");
        assertEq(vault.roundResidue(), 1, "and the residue is still corpus awaiting its door");
    }
}
