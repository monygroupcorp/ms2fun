// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { BondingCurveMath } from "../../../src/factories/erc404/libraries/BondingCurveMath.sol";
import { CurveParamsComputer } from "../../../src/factories/erc404/CurveParamsComputer.sol";
import { LaunchPresets } from "../../../script/LaunchPresets.sol";

/**
 * @title FreeMintReserveDrainTest
 * @notice The free-mint reserve drain, MEASURED from the shipped curve library rather than reasoned
 *         about. `docs/spec/BONDING_CURVE_ARITHMETIC.md` §7 states this drain as a figure a creator is
 *         expected to weigh when they size an allocation, so the figure needs a command behind it.
 *
 * @dev WHAT THE DRAIN IS. A free-mint claim moves `unit` tokens out of the instance without touching
 *      `totalBondingSupply` and without paying the curve (`ERC404BondingOps.claimFreeMint`). A sell
 *      debits the reserve for the integral between `totalBondingSupply - amount` and
 *      `totalBondingSupply` whatever the seller's tokens cost them (`ERC404BondingInstance.sellBonding`),
 *      so a claimant sells at the TOP of the curve against ETH that paid buyers put in. The allocation
 *      is deducted from the curve's span at create, so it is not supply the curve was ever going to
 *      sell — the drain is an ETH transfer out of the reserve, not an oversell.
 *
 *      The shape is why the transfer is worth a number. The allocation is a fraction of SUPPLY, but the
 *      reserve it can take is a fraction of the RAISE, and on a steepened curve the top of the span
 *      holds far more of the raise than of the supply.
 *
 *      Nothing here asserts a defect. Both solvency invariants survive the drain exactly — see
 *      `test/invariant/BondingCurveFreeMintInvariant.t.sol`, which runs them with the allocation on.
 */
contract FreeMintReserveDrainTest is Test {
    CurveParamsComputer internal computer;

    /// @dev Geometry is inert to the result: the curve is normalized so the span maps to one WAD and
    ///      `kCoeff` is then scaled to `targetETH`, so every figure below is a pure function of the
    ///      reserve bps (which sets the shape) and the allocation's share of the span.
    uint256 constant MAX_SUPPLY = 10_000_000 ether;
    uint256 constant TARGET_ETH = 25 ether;

    /// @dev The LP reserve EVERY shipped preset carries. `targetGraduationMultiple` is
    ///      `0.8 · (1 - r) / r`, so 1000 bps is exactly the `G = 7.2` operating point §7 quotes its
    ///      distribution table at — and because the reserve is the only field of a preset the curve
    ///      shape depends on, the figures below are the figures for every rung of the shipped ladder,
    ///      not for one of them. `test_everyShippedPresetIsAtThisReserve` is what makes that true
    ///      rather than asserted.
    uint256 constant LIQ_BPS = 1000;

    /// @dev The allocation §7's figure is stated for: 10% of FULL supply.
    uint256 constant ALLOC_BPS = 1000;

    function setUp() public {
        computer = new CurveParamsComputer(address(this));
    }

    /// @dev `(spanBps, drainBps)` — the allocation's share of the curve's span, and the share of the
    ///      full raise a claimant selling it at the top of a full curve takes out of the reserve. Both
    ///      in bps, floored, straight off the library.
    function _drain(uint256 liqBps, uint256 allocBps) internal view returns (uint256 spanBps, uint256 drainBps) {
        uint256 alloc = (MAX_SUPPLY * allocBps) / 10000;
        uint256 cap = MAX_SUPPLY - (MAX_SUPPLY * liqBps) / 10000 - alloc;
        BondingCurveMath.Params memory p = computer.computeCurveParamsFromBondingSupply(cap, TARGET_ETH, liqBps);
        spanBps = (alloc * 10000) / cap;
        drainBps = (computer.calculateRefund(p, cap, alloc) * 10000) / computer.calculateCost(p, 0, cap);
    }

    /// @notice §7's headline figure, at the operating point §7 states it for.
    /// @dev BREAKING IT MEANS: the number a creator reads before sizing an allocation no longer
    ///      describes the curve they will get. Fix the doc, not the assertion.
    function test_drainAtShippingPreset() public view {
        // The shape is the one §7's table is drawn at, asserted so a retune cannot quietly move the
        // operating point out from under the figure.
        uint256 cap = MAX_SUPPLY - (MAX_SUPPLY * LIQ_BPS) / 10000 - (MAX_SUPPLY * ALLOC_BPS) / 10000;
        BondingCurveMath.Params memory p = computer.computeCurveParamsFromBondingSupply(cap, TARGET_ETH, LIQ_BPS);
        assertEq(computer.graduationMultipleAt(p.poleWad) / 1e16, 720, "G is no longer 7.20 at 1000 bps");

        (uint256 spanBps, uint256 drainBps) = _drain(LIQ_BPS, ALLOC_BPS);

        // 10% of supply is 12.50% of the SPAN, because the span is supply less the 10% LP reserve and
        // less the allocation itself. This is the "flat shape" comparison in one line: a constant-price
        // curve holds the raise uniformly across the span, so it would drain exactly this.
        assertEq(spanBps, 1250, "the allocation's share of the curve span moved");

        // And on the shipped shape it takes 42.54% of the raise instead.
        assertEq(drainBps, 4254, "the drain at G = 7.20 moved");

        // Amplification over the flat shape: 3.40x. NOT G. `G` is the ratio of the curve's LAST price to
        // its average — the amplification an INFINITESIMAL slice at the very top would see. A finite
        // 12.50% slice reaches down the curve into cheaper supply and averages well below the endpoint,
        // so quoting G here overstates the drain by better than a factor of two.
        assertEq((drainBps * 100) / spanBps, 340, "amplification over the flat shape moved");
    }

    /// @notice How the drain scales with the SIZE of the allocation, at the shipped reserve. This is
    ///         the row a creator actually moves.
    /// @dev The share of the span grows faster than the allocation, because the allocation is
    ///      subtracted from the span as well as added to the free tranche: at 25% of supply the
    ///      tranche is 38.46% of what the curve sells.
    /// @dev BREAKING IT MEANS: §7's sizing table no longer describes the curve, and a creator reading
    ///      it would under- or over-estimate what an allocation costs their paid buyers.
    /// @dev Each figure is the library's, evaluated here rather than carried over from any hand
    ///      calculation: the drain's closed form is `ln((pole - 1 + phi) / (pole - 1)) / ln(pole / (pole - 1))`
    ///      with `phi` the allocation's share of the span, and it is easy to evaluate one row wrong.
    function test_drainScalesWithTheAllocation() public view {
        (uint256 span5, uint256 drain5) = _drain(LIQ_BPS, 500);
        assertEq(span5, 588, "5% allocation's share of the span moved");
        assertEq(drain5, 2685, "the drain at a 5% allocation moved");

        (uint256 span10, uint256 drain10) = _drain(LIQ_BPS, 1000);
        assertEq(span10, 1250, "10% allocation's share of the span moved");
        assertEq(drain10, 4254, "the drain at a 10% allocation moved");

        (uint256 span25, uint256 drain25) = _drain(LIQ_BPS, 2500);
        assertEq(span25, 3846, "25% allocation's share of the span moved");
        assertEq(drain25, 7191, "the drain at a 25% allocation moved");
    }

    /// @notice The figures above are the whole shipped ladder's, because all three rungs share the
    ///         reserve that sets the shape.
    /// @dev `targetETH` and `unitPerNFT` differ per rung and neither reaches the curve's shape: the
    ///      span is normalized to one WAD and `kCoeff` is then scaled to `targetETH`, so a rung moves
    ///      the raise's size and not its distribution.
    /// @dev BREAKING IT MEANS: a preset was retuned to a different reserve, so §7's single figure now
    ///      describes some rungs and not others and the table needs a row per rung.
    function test_everyShippedPresetIsAtThisReserve() public view {
        for (uint256 id = 0; id < LaunchPresets.COUNT; id++) {
            assertEq(
                LaunchPresets.preset(id, address(computer)).liquidityReserveBps,
                LIQ_BPS,
                "a shipped preset left the reserve the drain figure is stated at"
            );
        }
    }

    /// @notice The figure is reserve-specific, across the whole admissible reserve band.
    /// @dev §7 quotes one operating point; this pins what the same allocation does at the band's
    ///      endpoints, so "42.54%" is never read as a property of free mints in general. The drain is
    ///      LARGEST where the reserve is smallest, because a smaller reserve buys a steeper curve.
    /// @dev BREAKING IT MEANS: either the band moved (and §6's "roughly 600 to 3550 bps" is stale) or
    ///      the drain at an endpoint did.
    function test_drainAcrossTheReserveBand() public view {
        assertTrue(computer.isReserveBpsAdmissible(600), "600 bps left the admissible band");
        assertTrue(computer.isReserveBpsAdmissible(3550), "3550 bps left the admissible band");

        (uint256 spanShallow, uint256 drainShallow) = _drain(600, ALLOC_BPS);
        assertEq(spanShallow, 1190, "allocation share of span at 600 bps moved");
        assertEq(drainShallow, 4913, "the drain at 600 bps moved");

        (uint256 spanDeep, uint256 drainDeep) = _drain(3550, ALLOC_BPS);
        assertEq(spanDeep, 1834, "allocation share of span at 3550 bps moved");
        assertEq(drainDeep, 2443, "the drain at 3550 bps moved");

        // Monotone in the reserve across the band, which is what makes the endpoints a bound and not
        // two samples: a steeper curve concentrates more of the raise at the top.
        (, uint256 drainMid) = _drain(2000, ALLOC_BPS);
        assertGt(drainShallow, drainMid, "drain not monotone decreasing in the reserve");
        assertGt(drainMid, drainDeep, "drain not monotone decreasing in the reserve");
    }

    /// @notice The drain as a share of the reserve is unbounded; as ETH it is not.
    /// @dev A claimant does not have to wait for a full curve. Selling the moment the curve has sold as
    ///      much as the claimants hold takes EVERY wei in the reserve — but that is 4.02% of the raise,
    ///      because the bottom of a steepened curve is nearly free. Worst case in ETH is the full curve
    ///      (`test_drainAtShippingPreset`); worst case as a fraction is the empty one, and it is small
    ///      money. Both are needed to size an allocation, and neither alone is the figure.
    /// @dev BREAKING IT MEANS: the early-sale case stopped being cheap, i.e. the bottom of the curve
    ///      now holds real money and the drain has no small-ETH regime.
    function test_earlySaleTakesEverythingButItIsSmallMoney() public {
        uint256 alloc = (MAX_SUPPLY * ALLOC_BPS) / 10000;
        uint256 cap = MAX_SUPPLY - (MAX_SUPPLY * LIQ_BPS) / 10000 - alloc;
        BondingCurveMath.Params memory p = computer.computeCurveParamsFromBondingSupply(cap, TARGET_ETH, LIQ_BPS);

        uint256 full = computer.calculateCost(p, 0, cap);
        uint256 reserveThen = computer.calculateCost(p, 0, alloc);
        uint256 refund = computer.calculateRefund(p, alloc, alloc);

        assertEq((reserveThen * 10000) / full, 402, "the reserve at the earliest full-drain point moved");
        assertEq((refund * 10000) / reserveThen, 10000, "an early sale no longer takes the whole reserve");

        // The floor under it: `calculateRefund` reverts `AmountExceedsSupply` rather than selling into
        // a supply that is not there, so no claimant can sell before paid buyers have funded the span
        // they are selling. This is what keeps the drain a transfer and not a shortfall.
        vm.expectRevert(BondingCurveMath.AmountExceedsSupply.selector);
        computer.calculateRefund(p, alloc - 1, alloc);
    }
}
