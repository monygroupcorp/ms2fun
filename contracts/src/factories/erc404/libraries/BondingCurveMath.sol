// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FixedPointMathLib } from "solady/utils/FixedPointMathLib.sol";

/**
 * @title BondingCurveMath
 * @notice Library for calculating bonding curve costs and refunds
 * @dev Hyperbolic price family: P(s) = kCoeff / (poleWad - s), integrated in closed form as
 *      I(s) = -kCoeff * ln(1 - s / poleWad), where `s` is the WAD-normalized supply
 *      `supply / normalizationFactor` and `poleWad` is the vertical asymptote, which sits strictly
 *      beyond the top of the bonding range (s reaches ~1e18 at the bonding cap).
 *      See docs/spec/BONDING_CURVE_ARITHMETIC.md for the derivation, the parity target the shape
 *      is solved against, and the precision analysis.
 */
library BondingCurveMath {
    using FixedPointMathLib for uint256;

    error InvalidBounds();
    error NormalizationFactorZero();
    error AmountExceedsSupply();
    error SupplyAtOrBeyondPole();

    /**
     * @notice Bonding curve parameters
     * @param kCoeff Amplitude of the price function, in wei. Scaled at create so the integral over
     *        the whole bonding range equals the preset's targetETH.
     * @param poleWad Vertical asymptote in normalized-supply space, WAD. Strictly greater than the
     *        normalized bonding cap (~1e18); the gap `poleWad - 1e18` is the shape parameter and is
     *        solved from `liquidityReserveBps` at create (CurveParamsComputer).
     * @param normalizationFactor Supply normalization factor: `s = supply / normalizationFactor`
     */
    struct Params {
        uint256 kCoeff;
        uint256 poleWad;
        uint256 normalizationFactor;
    }

    /**
     * @notice Calculates the integral of the bonding curve price function
     * @param params Bonding curve parameters
     * @param lowerBound The lower bound of the supply range to integrate
     * @param upperBound The upper bound of the supply range to integrate
     * @return integral The calculated integral value in ETH
     */
    function calculateIntegral(Params memory params, uint256 lowerBound, uint256 upperBound)
        internal
        pure
        returns (uint256)
    {
        if (upperBound < lowerBound) revert InvalidBounds();
        return _calculateIntegralFromZero(params, upperBound) - _calculateIntegralFromZero(params, lowerBound);
    }

    /**
     * @notice Calculates the integral of the bonding curve price function from zero to a given supply
     * @param params Bonding curve parameters
     * @param supply The upper bound of the supply range to integrate
     * @return integral The calculated integral value in ETH
     */
    function _calculateIntegralFromZero(Params memory params, uint256 supply) private pure returns (uint256) {
        if (params.normalizationFactor == 0) revert NormalizationFactorZero();
        // Scale down by normalization factor — rounds down (floor), loses sub-normFactor
        // base units. Consequence: purchases smaller than `normalizationFactor` BASE UNITS
        // cost 0, which is guarded by ERC404BondingInstance (revert PurchaseTooSmall).
        uint256 scaledSupplyWad = supply / params.normalizationFactor;

        // The price function has a vertical asymptote at `poleWad`. On the shipped call path the
        // buy cap keeps the supply at or below the bonding cap, which is strictly inside the pole,
        // so this branch is unreachable there; the library still refuses to evaluate outside its
        // domain rather than underflow.
        if (scaledSupplyWad >= params.poleWad) revert SupplyAtOrBeyondPole();

        // Cancellation form: 1 - s/poleWad, evaluated once.
        // `divWad` floors, so `arg` rounds UP, so ln(arg) rounds up (toward zero), so the integral
        // rounds DOWN. Net effect, as before: buyers pay slightly less than the theoretical curve,
        // which keeps the reserve on the safe side.
        // `scaledSupplyWad < poleWad` above puts `arg` in [1, 1e18] — always strictly positive, so
        // `lnWad` is never called in its revert domain.
        uint256 arg = 1e18 - scaledSupplyWad.divWad(params.poleWad);

        // ln(arg) <= 0 over [1, 1e18]; the integral is its negation, scaled by kCoeff.
        uint256 negLn = uint256(-FixedPointMathLib.lnWad(int256(arg)));

        return params.kCoeff.mulWad(negLn);
    }

    /**
     * @notice Calculates the cost to buy a given amount of tokens
     * @param params Bonding curve parameters
     * @param currentSupply Current total bonding supply
     * @param amount Amount of tokens to buy
     * @return cost The ETH cost to buy the tokens
     */
    function calculateCost(Params memory params, uint256 currentSupply, uint256 amount)
        internal
        pure
        returns (uint256)
    {
        return calculateIntegral(params, currentSupply, currentSupply + amount);
    }

    /**
     * @notice Calculates the refund for selling a given amount of tokens
     * @param params Bonding curve parameters
     * @param currentSupply Current total bonding supply
     * @param amount Amount of tokens to sell
     * @return refund The ETH refund for selling the tokens
     */
    function calculateRefund(Params memory params, uint256 currentSupply, uint256 amount)
        internal
        pure
        returns (uint256)
    {
        if (amount > currentSupply) revert AmountExceedsSupply();
        return calculateIntegral(params, currentSupply - amount, currentSupply);
    }
}
