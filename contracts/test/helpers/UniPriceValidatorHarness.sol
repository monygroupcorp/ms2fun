// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { UniswapVaultPriceValidator } from "../../src/peripherals/UniswapVaultPriceValidator.sol";

/// @notice Test-only harness exposing the validator's internal, pool-independent pure math so the
///         swap-proportion theorems (noesis-034) can be asserted directly, without mocking a V4
///         PoolManager or a V3 TWAP pool. Immutables are irrelevant here — the exposed functions are
///         pure and read no state — so the constructor passes dummy addresses.
contract UniPriceValidatorHarness is UniswapVaultPriceValidator {
    constructor() UniswapVaultPriceValidator(address(0), address(0), address(0), address(0), 1000, 1800) { }

    function computeProportion(uint160 sqrtPriceX96, address token, int24 tickLower, int24 tickUpper)
        external
        pure
        returns (bool valid, uint256 proportion)
    {
        // These tests model the V4 native-ETH pool (ETH = address(0) sorts first), so any nonzero token
        // means ETH is currency0; forward that ordering to the core's explicit `ethIsCurrency0` param.
        return _computeProportionFromSqrtPrice(sqrtPriceX96, address(0) < token, tickLower, tickUpper);
    }

    /// @notice Exposes the core with an EXPLICIT numeraire ordering, so tests can model an Algebra/Cypher
    ///         pool where the WETH leg is currency1 (`ethIsCurrency0 == false` — the token0-alignment case).
    function computeProportionOrdered(uint160 sqrtPriceX96, bool ethIsCurrency0, int24 tickLower, int24 tickUpper)
        external
        pure
        returns (bool valid, uint256 proportion)
    {
        return _computeProportionFromSqrtPrice(sqrtPriceX96, ethIsCurrency0, tickLower, tickUpper);
    }

    function applyGuards(uint256 spotProportion, bool twapValid, uint256 twapProportion)
        external
        pure
        returns (uint256)
    {
        return _applyProportionGuards(spotProportion, twapValid, twapProportion);
    }
}
