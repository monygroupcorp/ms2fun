// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { UniAlignmentVault } from "../../src/vaults/uni/UniAlignmentVault.sol";
import { IVaultPriceValidator } from "../../src/interfaces/IVaultPriceValidator.sol";
import { Currency } from "v4-core/types/Currency.sol";

/// @notice Test-only vault exposing fee-accrual seams, with the production LP path intact.
/// @dev Split out of TestableUniAlignmentVault so the fork suites can reach the accrual seams while
///      keeping the real `_addToLpPosition` against a live V4 PoolManager. Nothing here is deployed:
///      the factory clones a plain UniAlignmentVault.
contract FeeSeamUniAlignmentVault is UniAlignmentVault {
    /// @notice Credit benefactor-side accumulated fees through the production accumulator.
    /// @dev Stands in for live LP-yield collection, which needs a real V4 PoolManager. Routes through
    ///      `_accrueFees` so the per-share accumulator math is the production math.
    function simulateFeeAccrual(uint256 amount) external payable {
        require(msg.value == amount, "Must send exact ETH");
        _accrueFees(amount);
    }

    /// @notice Simulate protocol fee accrual for testing withdrawProtocolFees happy path.
    function simulateProtocolFeeAccrual(uint256 amount) external payable {
        require(msg.value == amount, "Must send exact ETH");
        accumulatedProtocolFees += amount;
    }

    /// @notice Drive the real 80/19/1 split path with a known collected total (the live LP-yield
    ///         collection needs a real V4 PoolManager, so unit tests exercise the split directly).
    function exerciseFeeSplit(uint256 totalCollected) external payable {
        require(msg.value == totalCollected, "Must send exact ETH");
        _splitAndAccrueVaultFees(totalCollected);
    }
}

/// @notice Test-only vault that overrides LP with mock behavior.
/// @dev Swap behavior is handled by MockZRouter injected at initialize().
///      Only _addToLpPosition is overridden here since it requires a real V4 pool.
contract TestableUniAlignmentVault is FeeSeamUniAlignmentVault {
    function _addToLpPosition(uint256 amount0, uint256 amount1, int24 tickLower, int24 tickUpper)
        internal
        override
        returns (uint128 liquidityUnits, uint256 ethDeposited)
    {
        require(amount0 > 0 && amount1 > 0, "Amounts must be positive");
        lastTickLower = tickLower;
        lastTickUpper = tickUpper;
        liquidityUnits = uint128((amount0 + amount1) / 2);
        // The mock has no real pool to pull ETH, so report the full ETH leg as deposited. This keeps
        // ethUnabsorbed == 0 for mock-based tests (behaviorally identical to pre-noesis-034: no
        // residual re-credit, totalEthLocked == ethToAdd); the residual path is exercised in the fork
        // tests against the real V4 PoolManager. ETH is currency0 for these pool keys.
        ethDeposited = Currency.unwrap(v4PoolKey.currency0) == address(0) ? amount0 : amount1;
    }
}
