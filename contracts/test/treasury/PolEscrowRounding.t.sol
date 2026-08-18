// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { TickMath } from "v4-core/libraries/TickMath.sol";
import { SqrtPriceMath } from "v4-core/libraries/SqrtPriceMath.sol";
import { LiquidityAmounts } from "../../src/libraries/v4/LiquidityAmounts.sol";

/// @title PolEscrowRoundingTest
/// @notice Pins the rounding property that `ProtocolOwnedLiquidityV1.receivePOL`'s escrow accounting
///         rests on, against the REAL v4-core charging math rather than against the test mock.
///
/// @dev Why this test exists. `receivePOL` documents (`ProtocolOwnedLiquidityV1.sol:151-157`) that a
///      POL position is funded "strictly from that escrow — never from this contract's shared balance",
///      and `_refundUnusedEscrow` encodes the same assumption in code: it early-returns when
///      `provided <= used`, i.e. it assumes the position can never charge MORE than the caller escrowed.
///      If that assumption ever failed, the shortfall would be settled out of `address(this).balance` —
///      other instances' pooled fees — because `CurrencySettler.settle` pays the native leg with
///      `manager.settle{value: amount}()` from this contract's own balance.
///
///      The existing `ProtocolOwnedLiquidity.t.sol` suite cannot prove that assumption, because its
///      `MockPoolManagerV4.modifyLiquidity` computes the debt with
///      `LiquidityAmounts.getAmountsForLiquidity`, which rounds DOWN — the mock's own NatSpec states
///      "`used <= provided`, rounding down". Real v4-core does not: `Pool.modifyLiquidity`
///      (`Pool.sol:209-235`) charges an ADD via the signed `SqrtPriceMath.getAmount{0,1}Delta`
///      overloads, which round the debt UP for a positive `liquidityDelta`. So the suite asserts the
///      invariant against a mock that assumes it.
///
///      This test closes that gap by driving the SAME round-trip the production path performs —
///      `getLiquidityForAmounts` (liquidity rounded DOWN) followed by v4-core's own round-UP debt
///      computation — and asserting `used <= provided` on both legs.
contract PolEscrowRoundingTest is Test {
    /// @dev Mirror of `v4-core/libraries/Pool.sol:209-235`: the amounts a positive `liquidityDelta`
    ///      is charged, by position of the current price relative to the range. Uses the signed
    ///      `getAmount{0,1}Delta` overloads, which are the round-UP ones for an add.
    function _charged(uint160 sqrtP, int24 tickLower, int24 tickUpper, uint128 liquidity)
        internal
        pure
        returns (uint256 used0, uint256 used1)
    {
        if (liquidity == 0) return (0, 0);
        uint160 sqrtA = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtB = TickMath.getSqrtPriceAtTick(tickUpper);
        int128 signedLiquidity = int128(liquidity);

        int256 delta0;
        int256 delta1;
        if (sqrtP <= sqrtA) {
            delta0 = SqrtPriceMath.getAmount0Delta(sqrtA, sqrtB, signedLiquidity);
        } else if (sqrtP < sqrtB) {
            delta0 = SqrtPriceMath.getAmount0Delta(sqrtP, sqrtB, signedLiquidity);
            delta1 = SqrtPriceMath.getAmount1Delta(sqrtA, sqrtP, signedLiquidity);
        } else {
            delta1 = SqrtPriceMath.getAmount1Delta(sqrtA, sqrtB, signedLiquidity);
        }
        used0 = delta0 < 0 ? uint256(-delta0) : 0;
        used1 = delta1 < 0 ? uint256(-delta1) : 0;
    }

    /// @notice The escrow can never be under-collected: what v4 charges for the sized position is
    ///         always within what `receivePOL` collected, on both legs, at every price/range position.
    function testFuzz_v4ChargeNeverExceedsEscrow(
        int24 tickLower,
        int24 tickUpper,
        int24 currentTick,
        uint128 amount0,
        uint128 amount1
    ) public pure {
        // Ranges and amounts are bounded to the region `getLiquidityForAmounts` can size without
        // its own `toUint128` overflow revert — outside it the production call reverts, which is a
        // closed failure and not what this test is about.
        tickLower = int24(bound(int256(tickLower), -200_000, 199_000));
        tickUpper = int24(bound(int256(tickUpper), int256(tickLower) + 1, 200_000));
        currentTick = int24(bound(int256(currentTick), -200_000, 200_000));
        amount0 = uint128(bound(uint256(amount0), 1, 1e24));
        amount1 = uint128(bound(uint256(amount1), 1, 1e24));

        uint160 sqrtP = TickMath.getSqrtPriceAtTick(currentTick);
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtP, TickMath.getSqrtPriceAtTick(tickLower), TickMath.getSqrtPriceAtTick(tickUpper), amount0, amount1
        );

        (uint256 used0, uint256 used1) = _charged(sqrtP, tickLower, tickUpper, liquidity);

        assertLe(
            used0, uint256(amount0), "currency0: v4 charge exceeds escrow, shortfall would come from shared balance"
        );
        assertLe(
            used1, uint256(amount1), "currency1: v4 charge exceeds escrow, shortfall would come from shared balance"
        );
    }

    /// @notice The same property at the exact boundary shapes the fuzzer is least likely to hit:
    ///         price on the lower tick, on the upper tick, and one wei of escrow.
    function test_chargeNeverExceedsEscrow_boundaryShapes() public pure {
        int24[3] memory lowers = [int24(-887_220), int24(-60), int24(0)];
        int24[3] memory uppers = [int24(887_220), int24(60), int24(60)];

        for (uint256 i = 0; i < 3; i++) {
            int24 tickLower = lowers[i];
            int24 tickUpper = uppers[i];
            int24[3] memory prices = [tickLower, tickUpper, int24((int256(tickLower) + int256(tickUpper)) / 2)];

            for (uint256 j = 0; j < 3; j++) {
                for (uint256 k = 0; k < 3; k++) {
                    uint256 amount = k == 0 ? 1 : (k == 1 ? 1e18 : 1e24);
                    uint160 sqrtP = TickMath.getSqrtPriceAtTick(prices[j]);
                    uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
                        sqrtP,
                        TickMath.getSqrtPriceAtTick(tickLower),
                        TickMath.getSqrtPriceAtTick(tickUpper),
                        amount,
                        amount
                    );
                    (uint256 used0, uint256 used1) = _charged(sqrtP, tickLower, tickUpper, liquidity);
                    assertLe(used0, amount, "boundary currency0 charge exceeds escrow");
                    assertLe(used1, amount, "boundary currency1 charge exceeds escrow");
                }
            }
        }
    }
}
