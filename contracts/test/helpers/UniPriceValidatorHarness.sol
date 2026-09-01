// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { UniswapVaultPriceValidator } from "../../src/peripherals/UniswapVaultPriceValidator.sol";

/// @notice A real contract (has code) that answers every `getPool` query with `address(0)` — i.e. a
///         genuine, deployed V3 factory that simply has no pool for any pair. Distinct from a
///         codeless address, which the validator now treats as a misconfiguration and reverts on.
contract EmptyV3Factory {
    function getPool(address, address, uint24) external pure returns (address) {
        return address(0);
    }
}

/// @notice Test-only harness exposing the validator's internal, pool-independent pure math so the
///         swap-proportion theorems (noesis-034) can be asserted directly, without mocking a V4
///         PoolManager or a V3 TWAP pool. Immutables are irrelevant here — the exposed functions are
///         pure and read no state — so the constructor passes dummy addresses. `v3Factory` is a real
///         (but pool-less) contract, not `address(0)`: a codeless factory is a config error the
///         validator reverts on, whereas a real factory with no registered pool is the legitimate
///         "no TWAP available yet" case this harness means to exercise deterministically.
contract UniPriceValidatorHarness is UniswapVaultPriceValidator {
    constructor()
        UniswapVaultPriceValidator(address(0), address(new EmptyV3Factory()), address(0), 1000, 1800)
    { }

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
