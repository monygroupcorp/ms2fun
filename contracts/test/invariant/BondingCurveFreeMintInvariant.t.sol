// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { StdInvariant } from "forge-std/StdInvariant.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { DN404Mirror } from "dn404/src/DN404Mirror.sol";
import { ERC404BondingInstance } from "../../src/factories/erc404/ERC404BondingInstance.sol";
import { ERC404BondingOps } from "../../src/factories/erc404/ERC404BondingOps.sol";
import { BondingCurveMath } from "../../src/factories/erc404/libraries/BondingCurveMath.sol";
import { CurveParamsComputer } from "../../src/factories/erc404/CurveParamsComputer.sol";
import { ILiquidityDeployerModule } from "../../src/interfaces/ILiquidityDeployerModule.sol";
import { GatingScope } from "../../src/gating/IGatingModule.sol";
import { FreeMintCurveHandler } from "./handlers/FreeMintCurveHandler.sol";

contract MockFreeMintLiqDeployer is ILiquidityDeployerModule {
    function deployLiquidity(ILiquidityDeployerModule.DeployParams calldata) external payable override { }

    function metadataURI() external view override returns (string memory) {
        return "";
    }
    function setMetadataURI(string calldata) external override { }
}

/**
 * @title BondingCurveFreeMintInvariantTest
 * @notice The curve's SOLVENCY invariants, evaluated with a free-mint allocation ON.
 *
 * @dev WHY THIS FIXTURE EXISTS. A free mint is the one event that moves coin into circulation WITHOUT
 *      paying the curve: `claimFreeMint` does a bare `_transfer` from the instance and touches neither
 *      `reserve` nor `totalBondingSupply`, while `sellBonding` then debits the reserve for the full
 *      integral at the seller's supply whatever their coin cost them. That asymmetry is the design, not
 *      a defect, and the drain it produces is measured in
 *      `test/factories/erc404/FreeMintReserveDrain.t.sol`. What had never been run is whether the
 *      ACCOUNTING survives it — `BondingCurveInvariant.t.sol` configured the allocation to 0, so the
 *      repo's two strongest solvency claims had only ever been evaluated on a curve without one.
 *      That fixture now carries a small allocation too, alongside its sealed tier ladder. This one is
 *      the allocation's OWN fixture: production curve params, an allocation the size the spec quotes,
 *      and wallets that only ever claim and sell, so the drain is driven rather than merely present.
 *
 *      WHAT HOLDS, and it is worth stating because it is not obvious from the drain figure: both
 *      solvency invariants hold EXACTLY, with zero tolerance, under fuzzer-driven interleavings of
 *      paid buys, paid sells, free claims and free-coin sells. The reason is that the reserve and the
 *      supply move together on the only paths that move either. A claim moves coin and nothing else;
 *      a sell debits `F(S) - F(S - a)` and decrements `S` by `a` in the same statement, so the
 *      telescoping identity `reserve == F(totalBondingSupply)` closes over the sale of free coin
 *      exactly as it does over the sale of bought coin. The allocation redistributes the reserve
 *      between cohorts; it does not unbalance the books, and it cannot make the contract owe ETH it
 *      does not hold.
 *
 *      WHAT DOES NOT HOLD is asserted here too, and is the more consequential half:
 *      `invariant_circulationExceedsTrackedSupplyByTheClaimedAllocation` pins that coin in circulation
 *      exceeds the supply the curve tracks by exactly the claimed allocation, so that much coin cannot
 *      be sold at any price and the curve's refusal to pay for it is precisely how the two invariants
 *      above stay true. Solvency and universal exit are different promises; only the first is kept.
 *
 *      THE SHAPE IS THE PRODUCTION ONE. `curveParams` comes from `CurveParamsComputer` against the
 *      SAME span the factory passes (`ERC404Factory`: full supply, less the liquidity reserve, less
 *      the allocation), so the curve is scaled to raise `TARGET_ETH` over exactly the cap this
 *      instance enforces, and `G = 7.2` — the operating point the spec's distribution table and drain
 *      figure are both stated at. A hand-written `poleWad` with the span normalized to full supply
 *      would put the curve at a different point than anything shipped.
 *
 *      NO TIER LADDER, deliberately. Tier interleavings — including their interleaving with free coin
 *      — are the sibling suite's subject; sealing a ladder here would blend a finding about a
 *      spec-sized allocation into a tier diff. The variables this fixture holds still are everything
 *      except the allocation's size and the curve's shape.
 */
contract BondingCurveFreeMintInvariantTest is StdInvariant, Test {
    ERC404BondingInstance public instance;
    FreeMintCurveHandler public handler;
    CurveParamsComputer public computer;
    BondingCurveMath.Params curveParams;

    address public owner = address(0x1);
    address public protocolTreasury = address(0xFEE);
    address public mockVault = address(0xBEEF);
    address public mockMasterRegistry = address(0x400);
    address public mockGlobalMsgRegistry = address(0x700);
    address public mockLiquidityDeployer;

    address[] public traders;
    address[] public claimants;

    // ── Fixture geometry ─────────────────────────────────────────────────────────────────────────
    // Sized so the allocation is exactly the one the spec's drain figure is stated for — 10% of FULL
    // supply — and so the number of wallets needed to spend it is small enough to enumerate:
    //
    //   maxSupply           10,000,000 tokens = 100 NFTs at UNIT
    //   liquidityReserve    10% =  10 NFTs
    //   freeMintAllocation  10% =  10 NFTs  (one NFT per claiming wallet, so 10 wallets spend it)
    //   bonding cap         80% =  80 NFTs  <- the curve's whole span
    //
    // `FREE_MINT_ALLOCATION` is in NFTs because the contract's counter is (`freeMintAllocation` is an
    // NFT count and `freeMintsClaimed` counts NFTs, not tokens).
    uint256 constant MAX_SUPPLY = 10_000_000 * 1e18;
    uint256 constant UNIT = 100_000 ether; // 100k tokens = 1 NFT  =>  ID_LIMIT = 100
    uint256 constant LIQUIDITY_RESERVE_BPS = 1000; // => G = 0.8 * (1 - r) / r = 7.2
    uint256 constant FREE_MINT_ALLOCATION = 10; // NFTs
    uint256 constant TARGET_ETH = 25 ether; // the STANDARD preset
    uint256 constant BONDING_FEE_BPS = 100; // 1%, taken on exit only

    /// @dev More claimant wallets than the allocation can serve, so `FreeMintExhausted` is REACHED by a
    ///      run rather than assumed to be reachable. Two of the twelve must always be refused.
    uint256 constant CLAIMANT_COUNT = 12;
    uint256 constant TRADER_COUNT = 4;

    /// @dev NFTs each trader is given from the curve in `setUp`, through the HANDLER's own buy leg so
    ///      its curve ghosts stay authoritative. This is what makes the free-coin sell leg affordable
    ///      from call one: a claimant can only sell into supply that exists, so with an empty curve
    ///      whether a run ever exercises the drain at all would be seed-luck.
    uint256 constant SEED_NFTS_PER_TRADER = 5;

    /// @dev Handler calls a run must have made before the non-vacuity gate judges it. Well under the
    ///      configured `invariant.depth` (500) so any real run is judged, and above the length of a
    ///      minimized replay sequence — see `afterInvariant` for why that distinction is load-bearing.
    uint256 constant NONVACUITY_MIN_CALLS = 50;

    /// @dev `ghost_buyCount` after seeding, so the gate measures the RUN's own work.
    uint256 public seedBuyCount;

    function setUp() public {
        mockLiquidityDeployer = address(new MockFreeMintLiqDeployer());
        computer = new CurveParamsComputer(address(this));

        uint256 liquidityReserve = (MAX_SUPPLY * LIQUIDITY_RESERVE_BPS) / 10000;
        uint256 allocationTokens = FREE_MINT_ALLOCATION * UNIT;
        uint256 maxBondingSupply = MAX_SUPPLY - liquidityReserve - allocationTokens;
        // The factory's own span expression, reproduced so the curve is designed against the identical
        // cap `buyBonding`/`sellBonding` enforce (ERC404Factory: one bonding cap, defined once).
        curveParams = computer.computeCurveParamsFromBondingSupply(maxBondingSupply, TARGET_ETH, LIQUIDITY_RESERVE_BPS);

        vm.startPrank(owner);

        // A REAL Ops address is load-bearing: `initializeProtocol`, `initializeFreeMint`,
        // `setBondingOpenTime` and `setBondingActive` are all `_ops.delegatecall(msg.data)` trampolines,
        // and a delegatecall to a CODE-LESS address returns SUCCESS while writing nothing. With
        // `address(0)` this whole setUp silently no-ops and every invariant below holds vacuously on a
        // permanently empty curve with no allocation — which is the exact blind spot this suite exists
        // to close. The assertions at the end of setUp pin it.
        ERC404BondingInstance impl = new ERC404BondingInstance(address(new ERC404BondingOps()));
        instance = ERC404BondingInstance(payable(LibClone.clone(address(impl))));

        ERC404BondingInstance.BondingParams memory bp = ERC404BondingInstance.BondingParams({
            maxSupply: MAX_SUPPLY,
            unit: UNIT,
            liquidityReserveBps: LIQUIDITY_RESERVE_BPS,
            declaredMaxAllowanceBps: 0,
            curve: curveParams
        });

        instance.initialize(owner, mockVault, bp, mockLiquidityDeployer, address(0), address(new DN404Mirror(owner)));

        ERC404BondingInstance.ProtocolParams memory pp = ERC404BondingInstance.ProtocolParams({
            globalMessageRegistry: mockGlobalMsgRegistry,
            protocolTreasury: protocolTreasury,
            masterRegistry: mockMasterRegistry,
            bondingFeeBps: BONDING_FEE_BPS,
            weth: address(0xBEEF)
        });
        instance.initializeProtocol(pp);
        instance.initializeMetadata("Free Mint Token", "FREE", "", "", "");

        // THE ONE LINE THIS SUITE IS ABOUT. `initializeFreeMint` is FACTORY-ONLY, and this fixture's
        // `factory` is whoever called `initialize` (which sets `factory = msg.sender`) — i.e. `owner`,
        // because that call sits inside this prank. The scope is economically inert here: no gating
        // module is wired, so `claimFreeMint`'s gating branch is not entered whatever the scope says.
        instance.initializeFreeMint(FREE_MINT_ALLOCATION, GatingScope.BOTH);

        instance.setBondingOpenTime(block.timestamp + 1);
        vm.warp(block.timestamp + 2);
        instance.setBondingActive(true);

        vm.stopPrank();

        // Non-vacuity gate on the CONFIG. Each of these is a way the fixture could silently become the
        // one that already ships (no allocation, or no buyable curve) while still printing PASS.
        assertTrue(instance.bondingActive(), "setUp is vacuous: bonding never went active");
        assertEq(instance.bondingFeeBps(), BONDING_FEE_BPS, "setUp is vacuous: protocol params never landed");
        assertEq(instance.protocolTreasury(), protocolTreasury, "setUp is vacuous: no treasury to take exit fees");
        assertEq(
            instance.freeMintAllocation(),
            FREE_MINT_ALLOCATION,
            "setUp is vacuous: the allocation never landed, so this is the sibling suite again"
        );
        assertEq(instance.freeMintsClaimed(), 0, "setUp must not claim: the run has to spend the allocation itself");
        assertFalse(instance.graduated(), "graduated before the campaign started");

        // The shape is the spec's operating point, asserted rather than assumed: every figure the drain
        // test states, and the distribution table §7 quotes, are stated at G = 7.20.
        assertEq(computer.graduationMultipleAt(curveParams.poleWad) / 1e16, 720, "fixture is not at G = 7.20");
        // The curve's span and the instance's cap are ONE value (the factory's guarantee, reproduced).
        assertEq(
            instance.maxSupply() - instance.liquidityReserve() - (instance.freeMintAllocation() * instance.unit()),
            maxBondingSupply,
            "the curve was designed against a span the instance does not enforce"
        );

        // Staking is never wired (`initializeStaking` is not called), so `stake`/`unstake` — the only
        // other paths that move coin INTO the instance — revert `StakingModuleNotSet`. Asserted because
        // the coin-conservation invariant below enumerates holders.
        assertEq(address(instance.stakingModule()), address(0), "staking wired: a coin bucket is unaccounted for");
        assertFalse(instance.stakingActive(), "staking active: a coin bucket is unaccounted for");

        for (uint256 i = 0; i < TRADER_COUNT; i++) {
            traders.push(address(uint160(0x7000 + i)));
        }
        for (uint256 i = 0; i < CLAIMANT_COUNT; i++) {
            claimants.push(address(uint160(0xC000 + i)));
        }

        handler = new FreeMintCurveHandler(instance, curveParams, traders, claimants);

        // Seed the curve through the handler's own buy leg, so its ghosts account for it exactly as
        // they would mid-run. A claimant can only sell into supply that exists, so without this
        // whether a run ever reaches the drain at all is seed-luck.
        for (uint256 i = 0; i < traders.length; i++) {
            handler.buy(i, SEED_NFTS_PER_TRADER * UNIT);
        }
        assertGt(instance.totalBondingSupply(), 0, "seeding bought nothing: the free-coin sell leg is unreachable");
        seedBuyCount = handler.ghost_buyCount();

        targetContract(address(handler));
    }

    // ┌──────────────────────────────────────────────────────────────────────────────────────────┐
    // │  The two SOLVENCY invariants, now with the allocation on. Both are the sibling suite's   │
    // │  claims, UNCHANGED — the point is the fixture, not a new assertion.                      │
    // └──────────────────────────────────────────────────────────────────────────────────────────┘

    /// @notice SOLVENCY 1: `reserve == address(instance).balance` during active bonding.
    /// @dev Exit fees leave immediately, so the tracked reserve is the contract's whole ETH balance.
    ///      A free claim brings in no ETH and a free-coin sell takes the gross refund out of the same
    ///      reserve it is debited from, so this survives; if it did not, the contract would be tracking
    ///      ETH it does not have and the last seller out would find the refund unfunded.
    /// @dev BREAKING IT MEANS: the reserve is a fiction and some holder's sell cannot be paid.
    function invariant_reserveEqualsBalance() public view {
        if (instance.graduated()) return;
        assertEq(
            instance.reserve(), address(instance).balance, "reserve != address(this).balance during active bonding"
        );
    }

    /// @notice SOLVENCY 2: `reserve == calculateCost(0, totalBondingSupply)` — the telescoping integral.
    /// @dev The strong one, and the one a free mint could plausibly break. Each buy adds
    ///      `F(s + a) - F(s)`; each sell subtracts `F(s) - F(s - a)`; a free claim adds neither and
    ///      moves no supply. So the sum still collapses to `F(totalBondingSupply) - F(0)` over ANY
    ///      interleaving that includes free claims and sales of free coin — with zero cumulative
    ///      rounding drift, because every intermediate `F(s)` is evaluated identically on the way up
    ///      and down. Asserted exactly, with no tolerance: a tolerance here would delete the reason
    ///      this fixture was built.
    /// @dev BREAKING IT MEANS: free coin is being priced against a reserve that no longer matches the
    ///      curve, i.e. the drain is not a transfer between cohorts but an accounting hole.
    function invariant_reserveEqualsCurveIntegral() public view {
        if (instance.graduated()) return;
        assertEq(
            instance.reserve(),
            BondingCurveMath.calculateCost(curveParams, 0, instance.totalBondingSupply()),
            "reserve != F(totalBondingSupply) - cumulative curve-integral drift"
        );
    }

    // ┌──────────────────────────────────────────────────────────────────────────────────────────┐
    // │  What the allocation itself must never do                                                │
    // └──────────────────────────────────────────────────────────────────────────────────────────┘

    /// @notice The allocation stays held back: paid supply never reaches into it.
    /// @dev The sibling suite asserts this expression too, but with `freeMintAllocation == 0` the
    ///      subtracted term is zero and the claim is untested. This is the on-chain half of the
    ///      "genuinely held back" promise the app's learn copy makes for ERC-404.
    /// @dev BREAKING IT MEANS: paid buyers ate the free allocation and the last claimants find nothing.
    function invariant_bondingSupplyWithinCapNetOfAllocation() public view {
        uint256 cap =
            instance.maxSupply() - instance.liquidityReserve() - (instance.freeMintAllocation() * instance.unit());
        assertLe(instance.totalBondingSupply(), cap, "totalBondingSupply exceeds the cap net of the allocation");
    }

    /// @notice A free claim is not a curve event.
    /// @dev The ghosts are accumulated by the handler from its OWN pre-computed cost/refund on the
    ///      buy/sell legs only, so this is independent of the code under test rather than a
    ///      re-derivation of it. `claimFree` contributes to neither.
    /// @dev BREAKING IT MEANS: `claimFreeMint` reached the curve — it either credited a reserve nobody
    ///      funded or counted free coin as bonded supply, which would make the cap and the raise lie.
    function invariant_freeClaimsNeverMoveTheCurve() public view {
        assertEq(instance.reserve(), handler.ghost_expectedReserve(), "reserve drifted from the buy/sell legs alone");
        assertEq(
            instance.totalBondingSupply(),
            handler.ghost_expectedBondingSupply(),
            "totalBondingSupply drifted from the buy/sell legs alone"
        );
    }

    /// @notice The allocation is never oversubscribed, and the contract's counter agrees with the
    ///         handler's independent count of landed claims.
    /// @dev BREAKING IT MEANS: more free coin left the instance than the creator allocated — supply
    ///      handed out that the cap arithmetic already spent.
    function invariant_allocationIsNeverOversubscribed() public view {
        assertLe(instance.freeMintsClaimed(), instance.freeMintAllocation(), "more free mints claimed than allocated");
        assertEq(
            instance.freeMintsClaimed(), handler.ghost_claimCount(), "the claim counter and the landed claims disagree"
        );
        assertEq(
            handler.ghost_freeTokensClaimed(),
            instance.freeMintsClaimed() * instance.unit(),
            "free tokens handed out do not match the claim count at one unit each"
        );
    }

    /// @notice An eligible wallet can always take its free mint.
    /// @dev The handler counts a failure only AFTER reading every precondition live off the instance,
    ///      and it never reenters, so no legitimate rejection is left in the count. Counted rather than
    ///      asserted in-call because the runner discards reverting handler calls
    ///      (`fail_on_revert = false`), which would swallow the assertion.
    /// @dev BREAKING IT MEANS: the community round is unclaimable for someone it was promised to — or,
    ///      in the other direction, a claim landed PAST the allocation.
    function invariant_eligibleWalletCanAlwaysClaim() public view {
        assertEq(handler.ghost_claimFailures(), 0, "an eligible wallet could not claim, or claimed past the allocation");
    }

    /// @notice Free claims are a TRANSFER of instance-held coin, never a mint.
    /// @dev Cheap per-call skeleton of coin conservation over every bucket this fixture has. No tier
    ///      ladder is sealed and staking is not wired, so the instance, the deployer, the handler and
    ///      the two wallet sets are the complete list.
    /// @dev BREAKING IT MEANS: `claimFreeMint` minted coin rather than moving it, so the allocation is
    ///      inflation on top of `maxSupply` instead of a slice of it.
    function invariant_freeMintsAreATransferNotAMint() public view {
        uint256 sum = instance.balanceOf(address(instance)) + instance.balanceOf(mockLiquidityDeployer)
            + instance.balanceOf(address(handler));
        for (uint256 i = 0; i < traders.length; i++) {
            sum += instance.balanceOf(traders[i]);
        }
        for (uint256 i = 0; i < claimants.length; i++) {
            sum += instance.balanceOf(claimants[i]);
        }
        assertEq(sum, instance.totalSupply(), "ERC20 supply escaped the fixture's known buckets");
    }

    /// @notice WHAT DOES NOT HOLD, stated exactly. Coin in circulation exceeds the supply the curve
    ///         tracks by precisely the allocation that has been claimed:
    ///
    ///             Sum(holder balances)  ==  totalBondingSupply + freeMintsClaimed * unit
    ///
    /// @dev This is the identity behind the drain, and it is the one claim in this file that is NOT a
    ///      reassurance. Every transfer out of the instance is a buy (which raises
    ///      `totalBondingSupply` by the amount) or a free claim (which raises nothing); every transfer
    ///      back in is a sell (which lowers it by the amount). So the gap between what holders hold and
    ///      what the curve counts is exactly the claimed allocation, at all times.
    ///
    ///      The consequence is the part a creator needs: `calculateRefund` reverts
    ///      `AmountExceedsSupply` above `totalBondingSupply`, so of the coin in circulation only
    ///      `totalBondingSupply` can ever be sold back, and `freeMintsClaimed * unit` of it cannot be
    ///      sold at ANY price. That shortfall is not shared pro rata — it falls in reverse exit order,
    ///      on whoever is still holding when the counter runs out, which can be a PAID buyer. The
    ///      reserve stays solvent (the two invariants above) precisely BECAUSE the curve refuses those
    ///      sells. Solvency and universal exit are different promises and only the first one is kept.
    /// @dev BREAKING IT MEANS: the gap is no longer the allocation — either coin reached circulation
    ///      by some third path, or a sell moved supply and balance by different amounts. Either way the
    ///      figure a creator is given for what an allocation costs is no longer derivable.
    function invariant_circulationExceedsTrackedSupplyByTheClaimedAllocation() public view {
        uint256 circulating;
        for (uint256 i = 0; i < traders.length; i++) {
            circulating += instance.balanceOf(traders[i]);
        }
        for (uint256 i = 0; i < claimants.length; i++) {
            circulating += instance.balanceOf(claimants[i]);
        }
        assertEq(
            circulating,
            instance.totalBondingSupply() + instance.freeMintsClaimed() * instance.unit(),
            "circulating coin is not tracked supply plus the claimed allocation"
        );
    }

    /// @notice Selling never yields more than buying the same range would cost.
    /// @dev Shape-only, and it holds for free coin for the same reason it holds for bought coin: the
    ///      seller's cost basis is not an input to `calculateRefund`. Asserted here so this fixture
    ///      cannot be read as leaving the arbitrage question open with the allocation on.
    /// @dev BREAKING IT MEANS: a round-trip mints ETH out of rounding.
    function invariant_noRoundingArbitrage() public view {
        uint256 supply = instance.totalBondingSupply();
        uint256 unit_ = instance.unit();
        if (supply < unit_) return;
        assertLe(
            BondingCurveMath.calculateRefund(curveParams, supply, unit_),
            BondingCurveMath.calculateCost(curveParams, supply - unit_, unit_),
            "refund exceeds cost at same supply range - rounding arbitrage possible"
        );
    }

    // ┌──────────────────────────────────────────────────────────────────────────────────────────┐
    // │  End of run: non-vacuity                                                                 │
    // └──────────────────────────────────────────────────────────────────────────────────────────┘

    /// @dev Runs once at the end of EVERY fuzz run, after the whole call sequence. Without it, every
    ///      invariant above passes vacuously the moment a handler guard silently rejects every free
    ///      leg — which is the single most likely way this work ships green and worthless, because a
    ///      fixture with an allocation nobody ever claims is exactly the fixture that already exists.
    ///
    ///      The gate is conditional on the run BEING a sequence, and that condition is load-bearing
    ///      rather than a hedge: when an invariant fails, forge persists the MINIMIZED sequence and
    ///      replays it ahead of fuzzing on every later run — frequently a single call. An
    ///      unconditional gate would then fire on that replay and REPORT ITSELF INSTEAD OF THE
    ///      INVARIANT THAT ACTUALLY BROKE, hiding a money-code finding behind a vacuity message.
    function afterInvariant() public view {
        if (handler.ghost_calls() < NONVACUITY_MIN_CALLS) return;
        assertGt(handler.ghost_buyCount(), seedBuyCount, "vacuous run: the run itself never bought the curve");
        assertGt(handler.ghost_claimCount(), 0, "vacuous run: the allocation was never claimed");
        assertGt(
            handler.ghost_freeCoinSellCount(),
            0,
            "vacuous run: free coin was never sold back into the curve, so the drain was never exercised"
        );
        // The allocation is finite and twelve wallets are chasing ten claims, so a completed run spends
        // it and then gets refused. Gating on this rather than only on `ghost_claimCount > 0` is what
        // makes `FreeMintExhausted` a path a run WALKED, not one the fixture merely makes available.
        assertGt(
            handler.ghost_exhaustedRefusals(),
            0,
            "vacuous run: the allocation was never spent, so the exhaustion refusal was never reached"
        );
    }
}
