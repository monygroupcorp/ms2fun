// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Ownable } from "solady/auth/Ownable.sol";
import { FixedPointMathLib } from "solady/utils/FixedPointMathLib.sol";
import { BondingCurveMath } from "./libraries/BondingCurveMath.sol";
import { ICurveComputer } from "../../interfaces/ICurveComputer.sol";

/**
 * @title CurveParamsComputer
 * @notice Computes bonding curve parameters from a graduation profile and NFT count
 * @dev Extracted from ERC404Factory to reduce bytecode size. Owns all curve weight state and computation.
 *      The factory looks up the profile and passes it in; this contract has no storage dependency on the factory.
 *
 *      The curve shape is the pole gap `poleWad - 1e18`. It is SOLVED per collection from that
 *      collection's `liquidityReserveBps`, not taken from storage: the pool opens at
 *      `0.8 * (1 - r) / r` times the curve's average price (r = liquidityReserveBps / 1e4), so the
 *      shape that makes the curve end where the pool opens moves with the reserve, which is a
 *      DAO-settable preset field. `poleWad` below is the owner-settable starting probe for that
 *      solve; the post-solve parity assertion, not the stored value, is what governs the result.
 *      See docs/spec/BONDING_CURVE_ARITHMETIC.md.
 */
contract CurveParamsComputer is Ownable, ICurveComputer {
    using FixedPointMathLib for uint256;

    error InvalidAddress();
    error ReferenceAreaZero();
    error PoleOutOfBand();
    error KWeightZero();
    error ParityTargetUnreachable();
    error ParityToleranceExceeded();

    /// @notice LP share of the raise (`RevenueSplitLib`: 1% protocol / 19% vault / 80% LP), WAD.
    uint256 internal constant LP_SHARE_WAD = 0.8e18;

    /// @notice Hard band on the pole. A bare `> 1e18` check is not sufficient: at `1e18 + 1e6` the
    ///         library is still numerically well-behaved and nothing reverts, while the graduation
    ///         price is six orders of magnitude above anything reachable, so the bond can never
    ///         complete. The band, not the library, is what refuses such a value.
    uint256 public constant MIN_POLE_WAD = 1.02e18;
    uint256 public constant MAX_POLE_WAD = 2e18;

    /// @notice Maximum relative deviation of the achieved graduation multiple from the target, WAD.
    uint256 public constant PARITY_TOLERANCE_WAD = 1e12; // 1e-6 relative

    /// @notice Maximum bisection steps. Bounded by construction — never an unbounded loop.
    uint256 internal constant MAX_SOLVE_ITERATIONS = 128;

    /// @notice Amplitude weight. Cancels out of the result (the params are rescaled to hit
    ///         `targetETH`); kept non-zero so the reference area is well defined.
    uint256 public kWeight = 0.025 ether;

    /// @notice Starting probe for the pole solve, and the value the solve is checked against first.
    ///         Band-enforced on write. Economically inert: whatever it holds, `computeCurveParams`
    ///         only returns a pole whose graduation multiple matches the reserve-derived target
    ///         within `PARITY_TOLERANCE_WAD`.
    uint256 public poleWad = 1.0438e18;

    event CurveWeightsUpdated();

    constructor(address _protocol) {
        if (_protocol == address(0)) revert InvalidAddress();
        _initializeOwner(_protocol);
    }

    /**
     * @notice Update curve shape weights (owner only)
     * @param _kWeight Amplitude weight, must be non-zero
     * @param _poleWad Pole probe, must lie inside [MIN_POLE_WAD, MAX_POLE_WAD]
     */
    function setCurveWeights(uint256 _kWeight, uint256 _poleWad) external onlyOwner {
        if (_kWeight == 0) revert KWeightZero();
        if (_poleWad < MIN_POLE_WAD || _poleWad > MAX_POLE_WAD) revert PoleOutOfBand();
        kWeight = _kWeight;
        poleWad = _poleWad;
        emit CurveWeightsUpdated();
    }

    /**
     * @notice Calculate cost to buy `amount` tokens given current supply
     */
    function calculateCost(BondingCurveMath.Params calldata params, uint256 currentSupply, uint256 amount)
        external
        pure
        returns (uint256)
    {
        return BondingCurveMath.calculateCost(params, currentSupply, amount);
    }

    /**
     * @notice Calculate refund for selling `amount` tokens given current supply
     */
    function calculateRefund(BondingCurveMath.Params calldata params, uint256 currentSupply, uint256 amount)
        external
        pure
        returns (uint256)
    {
        return BondingCurveMath.calculateRefund(params, currentSupply, amount);
    }

    /**
     * @notice The graduation multiple the pool parity target implies for a given LP reserve
     * @dev `G = 0.8 * (1 - r) / r` with `r = liquidityReserveBps / 1e4`. The curve sells `1 - r` of
     *      supply for 100% of the raise; the pool receives `r` of supply and 80% of the raise, so
     *      the pool opens at G times the curve's average price. A creator carve is taken out of the
     *      LP 80 and can only lower the realized multiple, i.e. only opens the pool below the
     *      curve's end price.
     * @param liquidityReserveBps Bps of total supply reserved for liquidity
     * @return targetG Required (final price / average price), WAD
     */
    function targetGraduationMultiple(uint256 liquidityReserveBps) public pure returns (uint256 targetG) {
        targetG = (LP_SHARE_WAD * (10000 - liquidityReserveBps)) / liquidityReserveBps;
    }

    /**
     * @notice Graduation multiple achieved by a pole, in closed form
     * @dev With `eps = poleWad - 1e18` and `R = poleWad / eps` (the last/first price ratio),
     *      `G = (R - 1) / ln R`. Strictly decreasing in `poleWad` over the band.
     * @param poleWad_ Pole, WAD, strictly greater than 1e18
     * @return g Achieved (final price / average price), WAD
     */
    function graduationMultipleAt(uint256 poleWad_) public pure returns (uint256 g) {
        uint256 eps = poleWad_ - 1e18;
        uint256 r = poleWad_.divWad(eps);
        uint256 lnR = uint256(FixedPointMathLib.lnWad(int256(r)));
        g = (r - 1e18).divWad(lnR);
    }

    /**
     * @notice Solve the pole that puts the curve's end price at the pool's opening price
     * @dev Bisection over the band. `graduationMultipleAt` is monotone decreasing there, so the
     *      bracket is [MIN_POLE_WAD, MAX_POLE_WAD] and a target outside the endpoints' multiples is
     *      unreachable and reverts rather than silently clamping. Runs once per collection at
     *      create; not hot-path gas.
     * @param targetG Required graduation multiple, WAD
     * @return pole Solved pole, WAD
     */
    function solvePole(uint256 targetG) public view returns (uint256 pole) {
        uint256 lo = MIN_POLE_WAD;
        uint256 hi = MAX_POLE_WAD;

        // Monotone decreasing: G(lo) is the largest reachable multiple, G(hi) the smallest.
        if (targetG > graduationMultipleAt(lo) || targetG < graduationMultipleAt(hi)) {
            revert ParityTargetUnreachable();
        }

        // The owner-set probe is tried first; it is accepted only if it already satisfies the
        // parity assertion below, so it can shorten the solve but cannot change what the solve
        // is allowed to return.
        uint256 probe = poleWad;
        if (probe >= lo && probe <= hi && _withinTolerance(graduationMultipleAt(probe), targetG)) {
            return probe;
        }

        for (uint256 i = 0; i < MAX_SOLVE_ITERATIONS; i++) {
            if (hi - lo <= 1) break;
            uint256 mid = (lo + hi) / 2;
            if (graduationMultipleAt(mid) > targetG) {
                lo = mid;
            } else {
                hi = mid;
            }
        }

        pole = _withinTolerance(graduationMultipleAt(lo), targetG) ? lo : hi;
    }

    /**
     * @notice Compute bonding curve parameters from profile data and NFT count
     * @dev Solved shape, scaled amplitude. Computes normalizationFactor dynamically so the bonding
     *      cap lands at ~1e18 in normalized-supply space, solves the pole from
     *      `liquidityReserveBps`, then scales `kCoeff` to hit targetETH.
     * @param nftCount Number of NFTs in the collection
     * @param targetETH Target ETH to raise through the bonding curve
     * @param unitPerNFT Token units per NFT (e.g. 1e6 means 1M tokens/NFT)
     * @param liquidityReserveBps Bps of total supply reserved for liquidity (e.g. 2000 = 20%)
     * @return params Computed BondingCurveMath.Params
     */
    function computeCurveParams(uint256 nftCount, uint256 targetETH, uint256 unitPerNFT, uint256 liquidityReserveBps)
        public
        view
        returns (BondingCurveMath.Params memory params)
    {
        uint256 totalSupply = nftCount * unitPerNFT * 1e18;
        uint256 liquidityReserve = (totalSupply * liquidityReserveBps) / 10000; // round down: slightly more for bonding
        uint256 maxBondingSupply = totalSupply - liquidityReserve;
        return _paramsForBondingSupply(maxBondingSupply, targetETH, liquidityReserveBps);
    }

    /**
     * @notice Compute bonding curve parameters scaled directly to a caller-supplied bonding span.
     * @dev Same shape solve and targetETH scaling as `computeCurveParams`, but the span the curve is
     *      integrated over is taken verbatim rather than derived as `nftCount·unit·(1 − r)`. The caller
     *      (ERC404Factory) owns the definition of the bonding cap — full supply, less the liquidity
     *      reserve, less the free-mint allocation — and passes exactly that value here, so the curve's
     *      designed endpoint is byte-identical to the cap the instance enforces at buy/sell. The pole is
     *      still solved from `liquidityReserveBps` (the reserve fraction sets the graduation multiple),
     *      which is why that argument is retained even though the span is now explicit.
     * @param maxBondingSupply Token span (wei) the curve must raise `targetETH` over.
     * @param targetETH Target ETH to raise through the bonding curve.
     * @param liquidityReserveBps Bps of total supply reserved for liquidity (sets the graduation multiple).
     * @return params Computed BondingCurveMath.Params.
     */
    function computeCurveParamsFromBondingSupply(
        uint256 maxBondingSupply,
        uint256 targetETH,
        uint256 liquidityReserveBps
    ) public view returns (BondingCurveMath.Params memory params) {
        return _paramsForBondingSupply(maxBondingSupply, targetETH, liquidityReserveBps);
    }

    /// @dev Shape solve + amplitude scaling over an explicit bonding span. Both public entry points route
    ///      here so the scaling math has one definition; `computeCurveParams` derives the span from an NFT
    ///      count first, `computeCurveParamsFromBondingSupply` supplies it directly.
    function _paramsForBondingSupply(uint256 maxBondingSupply, uint256 targetETH, uint256 liquidityReserveBps)
        internal
        view
        returns (BondingCurveMath.Params memory params)
    {
        // Normalization: the bonding cap maps to ~1e18 (one WAD) of normalized supply.
        uint256 normFactor = maxBondingSupply / 1e18; // round down, guarded by != 0 below
        if (normFactor == 0) normFactor = 1;

        // Shape: solved from this collection's own LP reserve, then asserted. A reserve retune
        // (setPreset) moves the target and therefore the pole; nothing here is pinned to one bps.
        uint256 targetG = targetGraduationMultiple(liquidityReserveBps);
        uint256 solvedPole = solvePole(targetG);
        if (solvedPole < MIN_POLE_WAD || solvedPole > MAX_POLE_WAD) revert PoleOutOfBand();
        if (!_withinTolerance(graduationMultipleAt(solvedPole), targetG)) revert ParityToleranceExceeded();

        // Compute reference integral with the unit amplitude weight
        BondingCurveMath.Params memory refParams =
            BondingCurveMath.Params({ kCoeff: kWeight, poleWad: solvedPole, normalizationFactor: normFactor });

        uint256 referenceArea = BondingCurveMath.calculateCost(refParams, 0, maxBondingSupply);
        if (referenceArea == 0) revert ReferenceAreaZero();

        // Scale factor: targetETH / referenceArea (in wad)
        uint256 scaleFactor = targetETH.divWad(referenceArea);

        params = BondingCurveMath.Params({
            kCoeff: kWeight.mulWad(scaleFactor), poleWad: solvedPole, normalizationFactor: normFactor
        });
    }

    /// @dev |achieved - target| <= target * PARITY_TOLERANCE_WAD / 1e18
    function _withinTolerance(uint256 achieved, uint256 target) internal pure returns (bool) {
        uint256 diff = achieved > target ? achieved - target : target - achieved;
        return diff <= target.mulWad(PARITY_TOLERANCE_WAD);
    }
}
