// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { console } from "forge-std/Script.sol";
import {
    SeedSepoliaShared,
    IShowcaseCurveState,
    IMerkleGatingView,
    IShowcaseTierState,
    IShowcaseStakingState,
    IShowcaseCarveParams,
    IAlignmentRouteAdmin,
    IVenueVaultView,
    IVenueVaultConvert,
    IZammVaultConvert
} from "./SeedSepoliaShared.sol";
import { IAlignmentRegistry } from "../src/master/interfaces/IAlignmentRegistry.sol";
import { IZAMM } from "../src/vaults/zamm/ZAMMAlignmentVault.sol";
import { ERC404BondingInstance } from "../src/factories/erc404/ERC404BondingInstance.sol";
import { ERC1155Instance } from "../src/factories/erc1155/ERC1155Instance.sol";
import { IDynamicPricingModule } from "../src/factories/erc1155/interfaces/IDynamicPricingModule.sol";
import { ERC721AuctionInstance } from "../src/factories/erc721/ERC721AuctionInstance.sol";
import { MetadataOverlayModule } from "../src/metadata/MetadataOverlayModule.sol";
import { MerkleProofLib } from "solady/utils/MerkleProofLib.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { PoolId, PoolIdLibrary } from "v4-core/types/PoolId.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { IPoolManager } from "v4-core/interfaces/IPoolManager.sol";
import { IHooks } from "v4-core/interfaces/IHooks.sol";
import { StateLibrary } from "v4-core/libraries/StateLibrary.sol";

/// @dev The one router leg phase 2 drives directly: the demo swap that makes the alignment pool carry
///      a trade, so the vault's own position earns the LP fee the staking stream is funded from.
interface IzRouterV4Swap {
    function swapV4(
        address to,
        bool exactOut,
        uint24 swapFee,
        int24 tickSpace,
        address tokenIn,
        address tokenOut,
        uint256 swapAmount,
        uint256 amountLimit,
        uint256 deadline
    ) external payable returns (uint256 amountIn, uint256 amountOut);
}

/// @dev The two pool parameters the graduation pool is opened with. Read off the deployed module so
///      the liquidity check below names the pool graduation actually created, not a guess at it.
interface IUniV4DeployerParams {
    function poolFee() external view returns (uint24);
    function tickSpacing() external view returns (int24);
    function alignmentHookFactory() external view returns (address);
}

/// @notice Sepolia showcase seed, phase 2: the buys that produce the mid-curve, ready-to-graduate and
///         graduated states, and the graduation itself.
///
///         Runs after phase 1 and after the arm window has elapsed in wall-clock time. `buyBonding`
///         reverts `TooEarly` on an unopened curve, and because forge simulates a script before
///         broadcasting any of it, that revert kills the whole run at simulation and names the buy
///         rather than the missing wait. A guard in `run` fails earlier, with the seconds remaining.
///
///         Rows are resolved by name from `deployments/sepolia-seed.json`, which phase 1 writes.
///
///         Run with:
///           forge script script/SeedSepoliaBuys.s.sol --account <keystore> --sender <deployer> \
///             --rpc-url <sepolia-rpc> --broadcast
contract SeedSepoliaBuys is SeedSepoliaShared {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    function run() public {
        deployer = msg.sender;

        Deployed memory d = _readDeployed();
        ShowcaseLeg[] memory legs = _showcaseRoster();
        (address[] memory instances, SeedHandoff memory h) = _readSeedState(legs);

        // An `if`/`revert` rather than a `require`, because Solidity evaluates a require's message
        // eagerly: the subtraction that reports the remaining wait would underflow on the runs that
        // pass.
        if (block.timestamp < h.phase2NotBefore) {
            revert(
                string.concat(
                    "phase 2: the arm window has not elapsed yet - wait ",
                    vm.toString(h.phase2NotBefore - block.timestamp),
                    " more seconds"
                )
            );
        }

        // ── The price authorities, pinned once they can answer ──
        //
        // Phase 1 created these pools but cannot pin them: `setReferencePool` probes
        // `observe([window, 0])` and refuses a pool with no observation that old. The pin is the
        // first thing phase 2 does, before anything that needs a floor.
        _pinReferencePools(d, h);

        // ── The projection, printed before anything is broadcast ──
        //
        // Every buy's cost is computed against the supply the curve will be at when that buy lands,
        // walking the rows in the order they are bought. On a public testnet this ETH is a human's
        // faucet balance, so the total is visible at simulation time, before `--broadcast` sends
        // the first transaction.
        uint256[] memory amounts = new uint256[](legs.length);
        uint256 projected;
        for (uint256 i = 0; i < legs.length; i++) {
            if (legs[i].fillBps == 0) continue;
            ERC404BondingInstance b = ERC404BondingInstance(payable(instances[i]));
            amounts[i] = _rosterFillAmount(b, legs[i]);
            projected += _buyCost(b, amounts[i]);
            // The metadata row pays its own commission to prove the pay-and-pin path settles. Not
            // curve spend, but it leaves the same balance, so it belongs in the projected number.
            if (legs[i].metadataOverlay) projected += _commissionPrice();
        }
        // The breadth rows' curve spend, projected the same way and against the same balance, so
        // the operator sees one number for the phase.
        uint256 breadthProjected = _projectBreadth(h);
        // Featured placement is rented once, in phase 1; the zero keeps the two phases' summaries
        // the same shape.
        _reportSpend("phase 2 (buys + graduation)", projected + breadthProjected, 0, deployer.balance);
        console.log("  of which the breadth rows (wei):", breadthProjected);
        require(
            deployer.balance > projected + breadthProjected,
            "phase 2: deployer balance does not cover the projected curve spend"
        );

        // ── The buys ──
        uint256 spent;
        for (uint256 i = 0; i < legs.length; i++) {
            if (amounts[i] == 0) continue;
            ERC404BondingInstance b = ERC404BondingInstance(payable(instances[i]));
            // mintNFT: a showcase row with an empty gallery demonstrates the coin only. The fill is
            // sized in whole units so this mints a countable number of ids.
            uint256 cost = _buyBondingMint(b, amounts[i]);
            spent += cost;
            console.log(string.concat("BOUGHT ", legs[i].slug), amounts[i], cost);
        }

        // ── The artist-metadata demonstration, on the row that holds pieces ──
        //
        // After the buys: `select` and `unlock` are holder writes, and until the loop above lands
        // there is no holder on this row.
        spent += _seedMetadataDemo(d, legs, instances);

        // ── The graduation ──
        uint128 poolLiquidity = _graduate(d, legs, instances);

        _assertShowcaseStates(_states(instances), legs, block.timestamp, poolLiquidity);

        // ── The breadth rows: fill them, cross them, then assert every claim ──
        (uint256 breadthSpent, uint256 carveRaise) = _fillBreadth(d, h);
        spent += breadthSpent;
        _assertBreadth(d, h, carveRaise);

        // ── The venues execute ──
        //
        // The tithes the steps above put into the vaults become liquidity on the venue each target
        // is curated for. The stream is funded last, because it is funded by a fee that exists only
        // once a position exists and something has traded against it.
        spent += _crossVenues(d, h);
        _assertVenues(d, h);

        // ── The activity wave ──
        //
        // Last, because every channel has to exist first and because the home page's activity
        // preview reads backward from the chain tip and stops after a couple of windows: messages
        // posted before the buys and graduations could sit behind more blocks than the preview
        // reads. Posted here, they are the newest thing on the chain when a visitor arrives.
        //
        // Zero ETH is attached, so this wave changes neither the projection nor `spent`; it costs
        // gas only.
        uint256 messagesPosted = _seedActivity(d, legs, instances, h);

        console.log("=== SeedSepoliaBuys (phase 2: buys + graduation) complete ===");
        console.log("  curve + venue ETH spent (wei):", spent);
        console.log("  activity messages posted (0 wei attached, gas only):", messagesPosted);
        console.log("  graduated pool liquidity:", poolLiquidity);
        console.log("  block.timestamp now:", block.timestamp);
        console.log("POST-CONDITIONS OK: pre-open / mid-curve / ready-to-graduate / graduated / activity");
    }

    // ══════════════════════════════════════════════════════════════════════════════════════════
    //                             THE VENUES, EXECUTING
    // ══════════════════════════════════════════════════════════════════════════════════════════

    /// @dev What each venue leg reported, kept so the post-conditions read outcomes rather than
    ///      re-deriving them from state the convert changed.
    struct VenueOutcome {
        uint256 pendingBefore;
        uint256 pendingAfter;
        uint256 lpPositionValue;
    }

    VenueOutcome internal _uniOutcome;
    VenueOutcome internal _zammOutcome;
    StreamFacts internal _streamFacts;

    /// @dev Pin the price authority for every (target, token) this seed curates.
    ///
    ///      Every target reads a Uniswap V3 pool (`kind` 0), created a TWAP window ago by phase 1.
    ///      The window passed to the setter is the deployment's own, read off the validator, so the
    ///      window the registry probes with and the window the floor prices with cannot drift apart.
    ///
    ///      The readiness instant is taken from the pools, not from the number phase 1 recorded:
    ///      phase 1 records its simulation clock and the pools are written a broadcast later (see
    ///      `_v3ReferenceReadyAt`). `h.referenceReadyAt` is the orchestrator's approximate wait; this
    ///      check is exact and names the remaining seconds, so an early run reports a wait rather
    ///      than an `OLD` revert from inside the registry's probe.
    function _pinReferencePools(Deployed memory d, SeedHandoff memory h) internal {
        uint256 readyAt = _referencePoolsReadyAt(d, h);
        if (block.timestamp < readyAt) {
            revert(
                string.concat(
                    "phase 2: the seeded reference pools cannot serve a TWAP yet - wait ",
                    vm.toString(readyAt - block.timestamp),
                    " more seconds"
                )
            );
        }
        uint32 window = _twapWindow(d);
        IAlignmentRouteAdmin reg = IAlignmentRouteAdmin(d.alignmentRegistry);

        vm.startBroadcast();
        reg.setReferencePool(
            h.ms2TargetId,
            h.ms2Token,
            IAlignmentRegistry.ReferencePool({ pool: h.ms2ReferencePool, kind: 0, twapWindow: window })
        );
        reg.setReferencePool(
            h.cultTargetId,
            h.cultToken,
            IAlignmentRegistry.ReferencePool({ pool: h.cultReferencePool, kind: 0, twapWindow: window })
        );
        if (h.ms2ZammVault != address(0)) {
            // The ZAMM target's asset is the same MS2, so its price authority is the same pool; the
            // two targets differ in venue, not in the asset's price.
            reg.setReferencePool(
                h.ms2ZammTargetId,
                h.ms2Token,
                IAlignmentRegistry.ReferencePool({ pool: h.ms2ReferencePool, kind: 0, twapWindow: window })
            );
        }
        vm.stopBroadcast();

        console.log("REFERENCE pinned - ms2 / cult (uniswap v3):", h.ms2ReferencePool, h.cultReferencePool);
    }

    /// @dev Put every wired venue through the call it exists for.
    /// @return spent the ETH this leg moved that is not recoverable from a curve — the ZAMM tithe and
    ///         the demo swap. Reported with the curve spend because it leaves the same balance.
    function _crossVenues(Deployed memory d, SeedHandoff memory h) internal returns (uint256 spent) {
        // UNI: the tithe is earned; two collections graduated into this vault above.
        _uniOutcome = _convert(h.ms2Vault, "uni-v4 (MS2)");

        // ZAMM: no collection in this showcase graduates onto the ZAMM venue, so the vault's pending
        // balance is a plain contribution from the seed's own account rather than a raise. It is
        // real ETH, credited to a real benefactor, converted by the same call the product uses.
        if (h.ms2ZammVault != address(0)) {
            uint256 tithe = _zammVaultTitheWei();
            vm.startBroadcast();
            (bool ok,) = payable(h.ms2ZammVault).call{ value: tithe }("");
            vm.stopBroadcast();
            require(ok, "venue: the ZAMM vault refused a direct contribution");
            spent += tithe;
            _zammOutcome = _convertZamm(h.ms2ZammVault, "zamm (MS2)");
        }

        spent += _activateStakingStream(d, h);
    }

    /// @dev One vault's convert, with what it held before and after.
    ///
    ///      `minOutTarget` is 1 rather than a computed bound: the vault floors every caller's minimum
    ///      to an oracle-derived one from the pinned reference pool, and a looser number cannot
    ///      loosen that. A number the seed computed would be a second copy of the floor, free to
    ///      drift from the one enforced.
    function _convert(address vault, string memory label) internal returns (VenueOutcome memory o) {
        o.pendingBefore = _pendingTithe(vault);
        require(o.pendingBefore > 0, string.concat("venue: ", label, " vault holds no tithe to convert"));

        vm.startBroadcast();
        o.lpPositionValue = IVenueVaultConvert(vault).convertAndAddLiquidity(1);
        vm.stopBroadcast();

        o.pendingAfter = _pendingTithe(vault);
        _reportConvert(label, o);
    }

    /// @dev The ZAMM family's convert. Same three facts recorded, one different call: its LP add is a
    ///      paired deposit rather than a range position, so it carries two further deposit minimums.
    ///      Those are 1 for the same reason as the swap bound: the vault floors the swap leg against
    ///      the pinned reference itself, and the deposit legs are its own accounting.
    function _convertZamm(address vault, string memory label) internal returns (VenueOutcome memory o) {
        o.pendingBefore = _pendingTithe(vault);
        require(o.pendingBefore > 0, string.concat("venue: ", label, " vault holds no tithe to convert"));

        vm.startBroadcast();
        o.lpPositionValue = IZammVaultConvert(vault).convertAndAddLiquidity(1, 1, 1);
        vm.stopBroadcast();

        o.pendingAfter = _pendingTithe(vault);
        _reportConvert(label, o);
    }

    function _reportConvert(string memory label, VenueOutcome memory o) internal pure {
        console.log(string.concat("CONVERTED ", label, " - tithe before / LP position value (wei):"));
        console.log("  ", o.pendingBefore, o.lpPositionValue);
    }

    /// @dev Start the staking row's reward stream, on a fee it earned.
    ///
    ///      The module's only funding path is a fee delta arriving through `claimAllFees`, and
    ///      pushing ETH at it from a fixture would fabricate the reward. The sequence, each step a
    ///      real transaction:
    ///
    ///        1. the row graduated, so it is a benefactor of its alignment vault with real shares;
    ///        2. the vault converted, so it holds a real LP position in the alignment pool;
    ///        3. one demo swap trades against that pool, so the position earns a real LP fee;
    ///        4. the row claims, which pulls its share of that fee and starts the 7-day stream.
    ///
    ///      The swap's cost is its fee and its price impact, not its notional: it comes back as the
    ///      alignment asset. The stream runs for `rewardsDuration` from the claim.
    ///
    /// @return spent the ETH the demo swap sent (returned as tokens, less fee and impact).
    function _activateStakingStream(Deployed memory d, SeedHandoff memory h) internal returns (uint256 spent) {
        ERC404BondingInstance quarry = ERC404BondingInstance(payable(h.staking404));
        spent = _demoSwapWei();

        vm.startBroadcast();
        IzRouterV4Swap(d.zRouter).swapV4{ value: spent }(
            deployer,
            false, // exact input
            POOL_FEE,
            POOL_TICK_SPACING,
            address(0), // native ETH in
            h.ms2Token,
            spent,
            0, // the seed is its own counterparty on a pool it just seeded
            block.timestamp + 1 hours
        );
        vm.stopBroadcast();

        uint256 balanceBefore = h.staking404.balance;
        vm.startBroadcast();
        quarry.claimAllFees();
        vm.stopBroadcast();

        IShowcaseStakingState sm = IShowcaseStakingState(d.stakingModule);
        _streamFacts = StreamFacts({
            feeDelta: h.staking404.balance - balanceBefore,
            rewardRate: sm.rewardRate(h.staking404),
            periodFinish: sm.periodFinish(h.staking404),
            totalStaked: sm.totalStaked(h.staking404),
            nowTs: block.timestamp
        });

        console.log("STREAM demo swap (wei) / fee delta claimed (wei):", spent, _streamFacts.feeDelta);
        console.log(
            "  reward rate (wei/sec) / period finish (unix):", _streamFacts.rewardRate, _streamFacts.periodFinish
        );
    }

    // ─────────────────────── Venue post-conditions ───────────────────────

    /// @dev Every venue this deployment carries is live, and the stream is running on an earned fee.
    ///      An unwired rail is reported rather than asserted: a network without a venue is not one
    ///      this seed claims the venue on.
    function _assertVenues(Deployed memory d, SeedHandoff memory h) internal view {
        IAlignmentRouteAdmin reg = IAlignmentRouteAdmin(d.alignmentRegistry);

        _assertVenueShowcase(
            _venueFacts(
                d,
                reg,
                "uni-v4 (MS2)",
                uint8(IAlignmentRegistry.Venue.UNI_V4),
                h.ms2TargetId,
                h.ms2Token,
                h.ms2Vault,
                uint256(IPoolManager(d.v4PoolManager).getLiquidity(_uniVenueKey(h.ms2Token).toId())),
                _uniOutcome
            )
        );

        if (h.ms2ZammVault != address(0)) {
            IZAMM.Pool memory pool = IZAMM(d.zamm).pools(_zammPoolId(_zammVenueKey(h.ms2Token, d.zammFeeOrHook)));
            _assertVenueShowcase(
                _venueFacts(
                    d,
                    reg,
                    "zamm (MS2)",
                    uint8(IAlignmentRegistry.Venue.ZAMM),
                    h.ms2ZammTargetId,
                    h.ms2Token,
                    h.ms2ZammVault,
                    uint256(pool.reserve0),
                    _zammOutcome
                )
            );
        } else {
            console.log("VENUE zamm: not available on this network - not asserted, not claimed");
        }

        _assertStakingStream(_streamFacts);

        console.log("VENUE POST-CONDITIONS OK:");
        console.log("  each wired venue: curated route, pinned reference, seeded depth, executed convert");
        console.log("  staking stream running on a claimed LP-fee delta");
    }

    function _venueFacts(
        Deployed memory d,
        IAlignmentRouteAdmin reg,
        string memory label,
        uint8 expectedVenue,
        uint256 targetId,
        address token,
        address vault,
        uint256 venueLiquidity,
        VenueOutcome memory o
    ) internal view returns (VenueFacts memory f) {
        IAlignmentRegistry.ReferencePool memory ref = reg.getReferencePool(targetId, token);
        IVenueVaultView v = IVenueVaultView(vault);
        f = VenueFacts({
            label: label,
            routeVenue: uint8(reg.getAcquireRoute(targetId, token).venue),
            expectedVenue: expectedVenue,
            referencePool: ref.pool,
            referenceWindow: ref.twapWindow,
            expectedWindow: _twapWindow(d),
            vaultToken: v.alignmentToken(),
            expectedToken: token,
            vaultTargetId: v.alignmentTargetId(),
            expectedTargetId: targetId,
            vaultPriceValidator: v.priceValidator(),
            venueLiquidity: venueLiquidity,
            minVenueLiquidity: MIN_VENUE_ACTIVE_LIQUIDITY,
            pendingBefore: o.pendingBefore,
            pendingAfter: o.pendingAfter,
            lpPositionValue: o.lpPositionValue
        });
    }

    // ─────────────────────── Fills ───────────────────────

    /// @dev The tokens to buy for a given fill, rounded down to a whole DN404 unit. Whole units mint
    ///      pieces; a fill that is not a unit multiple buys coin that shows up in no gallery.
    function _fillAmount(ERC404BondingInstance b, uint256 fillBps) internal view returns (uint256 amount) {
        uint256 unit = b.unit();
        uint256 target = (_bondableRemaining(b) * fillBps) / 10_000;
        amount = (target / unit) * unit;
        require(amount >= unit, "fill: rounds below one whole unit (raise the fill bps)");
    }

    /// @dev What a roster row buys in phase 2.
    ///
    ///      Ordinarily its bps share of what the curve has left to sell. The metadata row is the
    ///      exception, as the tier row buys in whole units rather than bps: its demonstration is
    ///      denominated in pieces. It authors the artist's wave on one piece, a paid commission on a
    ///      second and an unpaid commission on a third, so a bps fill that rounds to fewer whole
    ///      units than that cannot show what the row exists to show (400 bps of this curve's 50
    ///      units rounds to 2 whole units, one short). The row's mid-curve state is unaffected: a
    ///      slightly larger partial fill is still partial, and the row opens and does not graduate.
    function _rosterFillAmount(ERC404BondingInstance b, ShowcaseLeg memory leg) internal view returns (uint256 amount) {
        amount = _fillAmount(b, leg.fillBps);
        if (!leg.metadataOverlay) return amount;

        uint256 demonstration = METADATA_DEMO_PIECES * b.unit();
        if (demonstration > amount) amount = demonstration;
        require(
            amount <= _bondableRemaining(b), "metadata: the curve has less left to sell than the demonstration needs"
        );
    }

    // ─────────────────────── Graduation ───────────────────────

    /// @dev Graduate the row that claims the graduated state and read back the venue pool's liquidity.
    ///
    ///      `deployLiquidity(0)` takes no carve. The carve is its own surface with its own disclosure,
    ///      and the row that carries a declared allowance is the ready row, left uncrossed so a
    ///      visitor can perform the graduation and the carve themselves.
    function _graduate(Deployed memory d, ShowcaseLeg[] memory legs, address[] memory instances)
        internal
        returns (uint128 liquidity)
    {
        for (uint256 i = 0; i < legs.length; i++) {
            if (legs[i].state != STATE_GRADUATED) continue;
            ERC404BondingInstance b = ERC404BondingInstance(payable(instances[i]));
            require(b.reserve() > 0, string.concat("graduate: ", legs[i].slug, " holds no raise"));

            vm.startBroadcast();
            b.deployLiquidity(0);
            vm.stopBroadcast();

            liquidity = _poolLiquidity(d, instances[i]);
            console.log(string.concat("GRADUATED ", legs[i].slug), instances[i], liquidity);
        }
    }

    /// @dev Live liquidity in the pool graduation opened. The key is rebuilt from the deployer
    ///      module's own immutables: the fee tier, the tick spacing and the hook selection are the
    ///      module's, so reading them back names the same pool it created.
    function _poolLiquidity(Deployed memory d, address instance) internal view returns (uint128) {
        IUniV4DeployerParams mod = IUniV4DeployerParams(d.uniDeployer);
        // The hook is non-zero only when an alignment-hook factory is selected on the module; the
        // key built below assumes none is.
        require(mod.alignmentHookFactory() == address(0), "pool: an alignment hook is wired - key unknown to the seed");
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(0)), // native ETH sorts below every token
            currency1: Currency.wrap(instance),
            fee: mod.poolFee(),
            tickSpacing: mod.tickSpacing(),
            hooks: IHooks(address(0))
        });
        return IPoolManager(d.v4PoolManager).getLiquidity(key.toId());
    }

    function _states(address[] memory instances) internal pure returns (IShowcaseCurveState[] memory states) {
        states = new IShowcaseCurveState[](instances.length);
        for (uint256 i = 0; i < instances.length; i++) {
            states[i] = IShowcaseCurveState(instances[i]);
        }
    }

    // ══════════════════════════════════════════════════════════════════════════════════════════
    //                        CROSSING THE BREADTH ROWS INTO THEIR STATES
    // ══════════════════════════════════════════════════════════════════════════════════════════
    //
    // Everything here needs the wall-clock wait phase 1 recorded: a curve rejects a buy before its
    // open time, and an auction lot rejects a settle before its end. Neither can be fast-forwarded
    // on a public testnet.

    /// @dev The breadth rows' curve spend, walked in the order the buys land, so the projection is the
    ///      cost the chain will charge rather than a sum of independent quotes.
    function _projectBreadth(SeedHandoff memory h) internal view returns (uint256 projected) {
        ERC404BondingInstance quarry = ERC404BondingInstance(payable(h.staking404));
        projected += _buyCost(quarry, _fillAmount(quarry, _stakingFillBps()));

        ERC404BondingInstance prism = ERC404BondingInstance(payable(h.tiers404));
        projected += _buyCost(prism, _tierBuyAmount(prism));

        ERC404BondingInstance carve = ERC404BondingInstance(payable(h.carve404));
        projected += _buyCost(carve, _fillAmount(carve, _carveFillBps()));

        // The venue legs: the ZAMM vault's contribution and the demo swap. Both leave the same
        // balance the rows above do, so they are projected with them.
        if (h.ms2ZammVault != address(0)) projected += _zammVaultTitheWei();
        projected += _demoSwapWei();
    }

    /// @dev The tier row is bought in whole units rather than in bps: every tier operation is
    ///      denominated in units, and a fill that is not a unit multiple buys coin that can never be
    ///      folded into a band.
    function _tierBuyAmount(ERC404BondingInstance b) internal view returns (uint256 amount) {
        amount = _tierUnits() * b.unit();
        require(
            amount <= _bondableRemaining(b), "tiers: the tier walk needs more units than the curve has left to sell"
        );
    }

    /// @return spent      the ETH the breadth rows put into their curves
    /// @return carveRaise the raise the carve row graduated on, captured before `deployLiquidity`
    ///         zeroes it: the figure the carve was judged against.
    function _fillBreadth(Deployed memory d, SeedHandoff memory h)
        internal
        returns (uint256 spent, uint256 carveRaise)
    {
        spent += _fillStakingRow(h);
        spent += _fillTierRow(d, h);
        uint256 carveCost;
        (carveCost, carveRaise) = _fillCarveRow(d, h);
        spent += carveCost;
        _crossAuctions(h);
    }

    // ─────────────────────── 3. Staking: buy, then stake part of it ───────────────────────

    /// @dev Only part of the bought position is staked: a row whose entire float is locked cannot
    ///      demonstrate the stake action a second time, and the unstake action needs something to
    ///      leave behind. The split defaults to half.
    ///
    ///      The row also graduates here, which makes the stream fundable: `claimFees` pays a vault's
    ///      benefactors, and a collection becomes one by tithing 19% of a real raise at graduation.
    ///      A row that never graduated could claim nothing however much its vault earned. The stake
    ///      is placed before the graduation so the staked position accrues when the first fee
    ///      arrives.
    function _fillStakingRow(SeedHandoff memory h) internal returns (uint256 cost) {
        ERC404BondingInstance b = ERC404BondingInstance(payable(h.staking404));
        uint256 amount = _fillAmount(b, _stakingFillBps());
        cost = _buyBondingMint(b, amount);

        uint256 toStake = (amount * _stakeShareBps()) / 10_000;
        require(toStake > 0, "staking: the stake share rounds to nothing");
        vm.startBroadcast();
        b.stake(toStake);
        b.deployLiquidity(0); // no carve — the carve is its own row's demonstration
        vm.stopBroadcast();

        require(b.graduated(), "staking: the row did not graduate (its stream would have no fee source)");
        console.log("STAKED quarry-staking (amount, cost wei):", toStake, cost);
    }

    // ─────────────────────── 4/5. Tiers + the metadata stack ───────────────────────

    /// @dev The tier walk, in the only order that works.
    ///
    ///      The scarce rung is taken first. `mintUp` pays its escrow by transferring coin out, and
    ///      DN404 reconciles that by burning the caller's NFTs LIFO off the tail of their owned array,
    ///      so the id being folded must sit near the front or the escrow leg burns it and reverts the
    ///      whole call. Taking the expensive rung first, off index 0, keeps every later burn away
    ///      from the id it is about to consume.
    ///
    ///      The open rung is then taken and immediately given back, which shows the reversible half
    ///      of Token Tiers: after the mint-down the rung has room again, its escrow has returned as
    ///      spendable coin, and the freed band id is at the front of the queue for the next holder.
    function _fillTierRow(Deployed memory d, SeedHandoff memory h) internal returns (uint256 cost) {
        ERC404BondingInstance b = ERC404BondingInstance(payable(h.tiers404));
        cost = _buyBondingMint(b, _tierBuyAmount(b));

        uint256 idLimit = b.maxSupply() / b.unit();

        vm.startBroadcast();
        b.mintUp(TIER_N_SCARCE, _lowestOrdinaryId(b, idLimit));
        b.mintUp(TIER_N_OPEN, _lowestOrdinaryId(b, idLimit));
        b.mintDown(_lowestBandIdOfTier(b, idLimit, TIER_N_OPEN));
        vm.stopBroadcast();

        console.log("TIERS prism-tiers walked (cost wei):", cost);
    }

    /// @dev The caller's lowest ordinary id: one in `[1..idLimit]`, never a band id. The owned array
    ///      is filled in mint order, so the lowest id is furthest from the tail the escrow leg burns
    ///      from.
    function _lowestOrdinaryId(ERC404BondingInstance b, uint256 idLimit) internal view returns (uint256 id) {
        uint256[] memory ids = b.ownedIdsOf(deployer);
        for (uint256 i = 0; i < ids.length; i++) {
            if (ids[i] != 0 && ids[i] <= idLimit && (id == 0 || ids[i] < id)) id = ids[i];
        }
        require(id != 0, "tiers: no ordinary id held (nothing to fold into a band)");
    }

    /// @dev The caller's lowest id inside tier `tierN`'s sealed band range.
    function _lowestBandIdOfTier(ERC404BondingInstance b, uint256 idLimit, uint8 tierN)
        internal
        view
        returns (uint256 id)
    {
        (uint32 idStart, uint32 idEnd,) = IShowcaseTierState(address(b)).tierBands(uint256(tierN) - 1);
        require(idStart > idLimit, "tiers: a band range overlaps the ordinary id space");
        uint256[] memory ids = b.ownedIdsOf(deployer);
        for (uint256 i = 0; i < ids.length; i++) {
            if (ids[i] >= idStart && ids[i] <= idEnd && (id == 0 || ids[i] < id)) id = ids[i];
        }
        require(id != 0, "tiers: the mint-up left no band id to mint back down");
    }

    function _ordinaryIds(ERC404BondingInstance b, uint256 idLimit) internal view returns (uint256[] memory out) {
        uint256[] memory ids = b.ownedIdsOf(deployer);
        uint256 n;
        for (uint256 i = 0; i < ids.length; i++) {
            if (ids[i] != 0 && ids[i] <= idLimit) n++;
        }
        out = new uint256[](n);
        uint256 k;
        for (uint256 i = 0; i < ids.length; i++) {
            if (ids[i] != 0 && ids[i] <= idLimit) out[k++] = ids[i];
        }
    }

    // ─────────────────────── 6. The artist-metadata demonstration ───────────────────────

    /// @dev Author the layers a holder can choose between on the metadata row: the collection base,
    ///      the artist's wave, and a paid commission. One piece wears each, so the row shows all
    ///      three at once.
    ///
    ///      A further piece carries an unpaid commission. `setCommission` without `unlock` leaves the
    ///      pay-and-pin path as a live action a visitor can take, and it resolves to the base until
    ///      somebody pays for it.
    ///
    ///      `selection` is per id and the row is created `autoLatest: false`, so every id the seed
    ///      does not touch resolves through the router to the collection base. The layers are opt-in:
    ///      nothing switches under a holder who never asked for it.
    ///
    ///      Every claim here is a `require` on what the overlay resolves, not on what was written, so
    ///      a selection that points elsewhere, or a commission visible before it is paid, fails the
    ///      run.
    function _seedMetadataDemo(Deployed memory d, ShowcaseLeg[] memory legs, address[] memory instances)
        internal
        returns (uint256 spent)
    {
        for (uint256 i = 0; i < legs.length; i++) {
            if (!legs[i].metadataOverlay) continue;

            address inst = instances[i];
            ERC404BondingInstance b = ERC404BondingInstance(payable(inst));
            uint256[] memory ids = _ordinaryIds(b, b.maxSupply() / b.unit());
            require(
                ids.length >= METADATA_DEMO_PIECES,
                "metadata: the row holds too few pieces to show base, wave and commission"
            );

            // The wave rides the fully-recovered edition, so any held id can carry it.
            uint256 waveId = _lowestId(ids);
            // The commission rides the scarcer set, so its id must be one whose art is recovered.
            uint256 paidId = _lowestCommissionableId(ids, waveId);
            uint256 price = _commissionPrice();
            MetadataOverlayModule ov = MetadataOverlayModule(d.overlay);

            vm.startBroadcast();
            // The wave: the opt-in a holder performs on the expansion phase 1 published.
            ov.select(inst, waveId, OVERLAY_WAVE_0);
            // The paid commission. `unlock` pins the selection in the same transaction that pays for
            // it, so the settled state and the visible state cannot disagree.
            ov.setCommission(
                inst,
                paidId,
                string.concat(ART_BASE_WOTLK, vm.toString(paidId)),
                MetadataOverlayModule.CommCond.PAY,
                price,
                MetadataOverlayModule.Payout.ARTIST
            );
            // The buyer commits to the art as well as the price: same string authored just above.
            ov.unlock{ value: price }(
                inst, paidId, keccak256(bytes(string.concat(ART_BASE_WOTLK, vm.toString(paidId))))
            );

            // The offers a visitor can take, authored on ids above the pieces the seed keeps, so the
            // next buyer into this row is minted a piece that already carries one and can pay it as
            // its holder. An offer on a piece the seed holds could only be paid by the seed.
            uint256[] memory offers = _commissionOfferIds();
            for (uint256 k = 0; k < offers.length; k++) {
                ov.setCommission(
                    inst,
                    offers[k],
                    string.concat(ART_BASE_WOTLK, vm.toString(offers[k])),
                    MetadataOverlayModule.CommCond.PAY,
                    price,
                    MetadataOverlayModule.Payout.ARTIST
                );
            }
            vm.stopBroadcast();
            spent += price;

            require(
                keccak256(bytes(ov.resolve(inst, waveId, deployer)))
                    == keccak256(bytes(string.concat(ART_BASE_PIXELADYBC, vm.toString(waveId)))),
                "metadata: the wave selection does not resolve to the wave art"
            );
            require(
                keccak256(bytes(ov.resolve(inst, paidId, deployer)))
                    == keccak256(bytes(string.concat(ART_BASE_WOTLK, vm.toString(paidId)))),
                "metadata: the paid commission does not resolve to its art"
            );
            // An authored-but-unpaid offer stays invisible: it resolves to the base until the holder
            // pays, so paying is a change a visitor can see.
            require(
                bytes(ov.resolve(inst, offers[0], deployer)).length == 0,
                "metadata: an unpaid commission offer is visible before anybody paid for it"
            );
            require(ov.waveCount(inst) == 1, "metadata: the row does not carry exactly the one published wave");

            console.log(string.concat("METADATA ", legs[i].slug), inst);
            console.log("  wave id / paid commission id:", waveId, paidId);
            console.log("  commission offers authored for the next buyers on ids:", offers.length);
        }
    }

    /// @dev The lowest id the caller holds — the piece a visitor meets first.
    function _lowestId(uint256[] memory ids) internal pure returns (uint256 id) {
        for (uint256 i = 0; i < ids.length; i++) {
            if (id == 0 || ids[i] < id) id = ids[i];
        }
        require(id != 0, "metadata: the row holds no pieces");
    }

    /// @dev The lowest held id, other than `skip`, whose commission art is recovered.
    function _lowestCommissionableId(uint256[] memory ids, uint256 skip) internal pure returns (uint256 id) {
        for (uint256 i = 0; i < ids.length; i++) {
            if (ids[i] == skip || _commissionArtMissing(ids[i])) continue;
            if (id == 0 || ids[i] < id) id = ids[i];
        }
        require(id != 0, "metadata: the row holds no id whose commission art survived the rescue");
    }

    // ─────────────────────── 7. The carve ───────────────────────

    /// @dev Buy the carve row, then graduate it with the carve requested at the declared maximum.
    ///
    ///      The effective carve is the minimum of the request, the bracket allowance on the raise,
    ///      and the headroom the LP share has above the pool floor. A faucet-sized raise does not
    ///      clear that floor, so the protocol clamps the carve to zero; the graduation still
    ///      completes (the floor is a clamp, never a gate) and the row still carries its
    ///      declaration. The seed reads the protocol's own figure rather than recomputing it, and
    ///      prints the raise the row would need for the carve to pay; the fill is set by an
    ///      environment variable.
    function _fillCarveRow(Deployed memory d, SeedHandoff memory h) internal returns (uint256 cost, uint256 raise) {
        ERC404BondingInstance b = ERC404BondingInstance(payable(h.carve404));
        cost = _buyBondingMint(b, _fillAmount(b, _carveFillBps()));

        IShowcaseCarveParams factory_ = IShowcaseCarveParams(address(d.erc404));
        raise = b.reserve();
        uint256 minPoolEth = factory_.minPoolEth();
        uint256 carveEth = factory_.effectiveCarveEth(raise, CARVE_DECLARED_MAX_BPS, CARVE_REQUEST_BPS);

        console.log("CARVE carve-demo raise (wei):", raise);
        console.log("  pool floor (wei):", minPoolEth);
        console.log("  effective carve at this raise (wei):", carveEth);
        console.log("  raise at which the carve stops clamping to zero (wei):", _carveThresholdRaise(minPoolEth));

        vm.startBroadcast();
        b.deployLiquidity(CARVE_REQUEST_BPS);
        vm.stopBroadcast();
    }

    // ─────────────────────── 6. The auctions ───────────────────────

    /// @dev Cross the timed house's two lots into their terminal states. Both are permissionless after
    ///      the end time and both advance their line, so no settled lot blocks the queue.
    function _crossAuctions(SeedHandoff memory h) internal {
        ERC721AuctionInstance t = ERC721AuctionInstance(payable(h.auctionTimed));
        require(
            block.timestamp >= t.getAuction(uint24(h.soldLotId)).endTime,
            "auctions: the timed lots have not ended yet (the wait was too short)"
        );

        vm.startBroadcast();
        t.settleAuction(uint24(h.soldLotId));
        t.reclaimUnsold(uint24(h.unsoldLotId));
        vm.stopBroadcast();

        console.log("AUCTION settled lot / reclaimed lot:", h.soldLotId, h.unsoldLotId);
    }

    // ─────────────────────── Breadth post-conditions ───────────────────────

    /// @dev Every claim the breadth rows make, asserted against the chain after phase 2 has crossed
    ///      them. `require`s, not logs: forge simulates the whole script first, so a failure leaves
    ///      no partial seed and names the mechanism that did not reach its state.
    function _assertBreadth(Deployed memory d, SeedHandoff memory h, uint256 carveRaise) internal view {
        _assertEditionShowcase(_readEditionFacts(h.editions));
        _assertGatingShowcase(_readGatingFacts(d, h.gatedEditions), block.timestamp);
        _assertStakingShowcase(_readStakingFacts(d, h.staking404));
        _assertTierShowcase(_readTierFacts(d, h.tiers404));
        _assertCarveShowcase(_readCarveFacts(d, h.carve404, carveRaise));
        (AuctionLotFacts memory live, AuctionLotFacts memory sold, AuctionLotFacts memory reclaimed) =
            _readAuctionFacts(h);
        _assertAuctionShowcase(live, sold, reclaimed, block.timestamp);

        console.log("BREADTH POST-CONDITIONS OK:");
        console.log("  editions (fixed / dynamic / free claim), allowlist gating");
        console.log("  staking surface + seeded position, tiers (up, down, exhausted band), metadata stack");
        console.log("  auctions (live / settled / reclaimed), carve declared + requested");
    }

    function _readEditionFacts(address instance) internal view returns (EditionFacts memory f) {
        ERC1155Instance ed = ERC1155Instance(payable(instance));
        f.nextEditionId = ed.nextEditionId();

        (,, uint256 fixedPrice, uint256 fixedSupply,,, ERC1155Instance.PricingModel fixedModel,,) =
            ed.editions(EDITION_FIXED);
        f.fixedModel = uint8(fixedModel);
        f.fixedPrice = fixedPrice;
        f.fixedSupply = fixedSupply;

        (,, uint256 dynBase,,,, ERC1155Instance.PricingModel dynModel, uint256 dynRate,) = ed.editions(EDITION_DYNAMIC);
        f.dynamicModel = uint8(dynModel);
        f.dynamicBasePrice = dynBase;
        f.dynamicRate = dynRate;
        f.dynamicModule = address(ed.dynamicPricingModule());
        if (f.dynamicModule != address(0)) {
            f.dynamicPriceAfterProbe =
                IDynamicPricingModule(f.dynamicModule).calculatePrice(dynBase, dynRate, DYNAMIC_PROBE_MINTS);
        }

        (,,, uint256 freeSupply, uint256 freeMinted,,,,) = ed.editions(EDITION_FREE_CLAIM);
        f.freeClaimSupply = freeSupply;
        f.freeClaimMinted = freeMinted;
        f.freeClaimAllocation = ed.freeMintAllocation(EDITION_FREE_CLAIM);
    }

    function _readGatingFacts(Deployed memory d, address instance) internal view returns (GatingFacts memory f) {
        ERC1155Instance veil = ERC1155Instance(payable(instance));
        f.attachedModule = address(veil.gatingModule());
        f.expectedModule = d.merkleGating;
        f.scope = uint8(veil.gatingScope());
        f.freeClaimAllocation = veil.freeMintAllocation(GATED_EDITION);

        bytes32[] memory installed = IMerkleGatingView(d.merkleGating).getRoots(instance, GATED_EDITION);
        uint256[] memory opens = IMerkleGatingView(d.merkleGating).getTierOpenTimes(instance, GATED_EDITION);
        f.installedTierCount = installed.length;
        if (installed.length > 0) f.installedRoot = installed[0];
        if (opens.length > 0) f.tierOpenTime = opens[0];

        address stranger = _allowlistStranger();
        (bytes32 root, bytes32[] memory proofOperator,) =
            _buildAllowlistTier(deployer, GATED_OPERATOR_QTY, _allowlistFixtureMember(), GATED_MEMBER_QTY, stranger);
        f.provenRoot = root;
        f.listedMemberVerifies =
            MerkleProofLib.verify(proofOperator, f.installedRoot, _leaf(deployer, GATED_OPERATOR_QTY));
        f.unlistedAddressRejected =
            !MerkleProofLib.verify(proofOperator, f.installedRoot, _leaf(stranger, GATED_OPERATOR_QTY));
    }

    function _readStakingFacts(Deployed memory d, address instance) internal view returns (StakingFacts memory f) {
        ERC404BondingInstance b = ERC404BondingInstance(payable(instance));
        IShowcaseStakingState sm = IShowcaseStakingState(d.stakingModule);
        f.module = address(b.stakingModule());
        f.expectedModule = d.stakingModule;
        f.active = b.stakingActive();
        f.userStaked = sm.stakedBalance(instance, deployer);
        f.totalStaked = sm.totalStaked(instance);
        f.liquidBalance = b.balanceOf(deployer);
    }

    function _readTierFacts(Deployed memory d, address instance) internal view returns (TierFacts memory f) {
        ERC404BondingInstance b = ERC404BondingInstance(payable(instance));
        IShowcaseTierState t = IShowcaseTierState(instance);

        (uint32 openStart, uint32 openEnd,) = t.tierBands(uint256(TIER_N_OPEN) - 1);
        (uint32 scarceStart, uint32 scarceEnd,) = t.tierBands(uint256(TIER_N_SCARCE) - 1);
        f.openCapacity = uint256(openEnd - openStart) + 1;
        f.scarceCapacity = uint256(scarceEnd - scarceStart) + 1;
        f.openOutstanding = b.bandOutstanding(TIER_N_OPEN);
        f.scarceOutstanding = b.bandOutstanding(TIER_N_SCARCE);
        f.totalTierEscrow = t.totalTierEscrow();

        // Read the overlay only to prove this row does not use it: waves and commissions belong to
        // the artist-metadata row, so a count above zero here is a wiring error.
        f.waveCount = MetadataOverlayModule(d.overlay).waveCount(instance);
        f.baseArt = ART_BASE_SONORA;
        f.bandArt = ART_BASE_SONORA222;
    }

    /// @param raise the reserve the row held immediately before `deployLiquidity`. Passed in
    ///        because graduation zeroes `reserve`, so the number the carve was judged against does
    ///        not exist on the instance afterwards.
    function _readCarveFacts(Deployed memory d, address instance, uint256 raise)
        internal
        view
        returns (CarveFacts memory f)
    {
        ERC404BondingInstance b = ERC404BondingInstance(payable(instance));
        IShowcaseCarveParams factory_ = IShowcaseCarveParams(address(d.erc404));
        f.declaredMaxBps = b.declaredMaxAllowanceBps();
        f.requestBps = CARVE_REQUEST_BPS;
        f.graduated = b.graduated();
        f.raise = raise;
        f.minPoolEth = factory_.minPoolEth();
        f.effectiveCarveEth = factory_.effectiveCarveEth(f.raise, f.declaredMaxBps, f.requestBps);
    }

    function _readAuctionFacts(SeedHandoff memory h)
        internal
        view
        returns (AuctionLotFacts memory live, AuctionLotFacts memory sold, AuctionLotFacts memory reclaimed)
    {
        live = _readLot(h.auctionLive, h.liveLotId, "salon-line live lot");
        sold = _readLot(h.auctionTimed, h.soldLotId, "relic-line settled lot");
        reclaimed = _readLot(h.auctionTimed, h.unsoldLotId, "relic-line reclaimed lot");
    }

    function _readLot(address house, uint256 lotId, string memory label)
        internal
        view
        returns (AuctionLotFacts memory f)
    {
        ERC721AuctionInstance a = ERC721AuctionInstance(payable(house));
        ERC721AuctionInstance.Auction memory lot = a.getAuction(uint24(lotId));
        f.label = label;
        f.settled = lot.settled;
        f.highBidder = lot.highBidder;
        f.highBid = lot.highBid;
        f.endTime = lot.endTime;
        // Whether the piece exists separates a settled lot from a reclaimed one: `settled` is set by
        // both terminal paths, and only `settleAuction` mints. `ownerOf` reverts on a token that was
        // never minted (the reclaimed case), so the revert is the answer.
        try a.ownerOf(lotId) returns (address owner_) {
            f.minted = true;
            f.tokenOwner = owner_;
        } catch {
            f.minted = false;
        }
    }
}
