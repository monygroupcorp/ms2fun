// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IUnlockCallback } from "v4-core/interfaces/callback/IUnlockCallback.sol";
import { IPoolManager } from "v4-core/interfaces/IPoolManager.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { BalanceDelta } from "v4-core/types/BalanceDelta.sol";
import { TickMath } from "v4-core/libraries/TickMath.sol";
import { CurrencySettler } from "../libraries/v4/CurrencySettler.sol";
import { SafeTransferLib } from "solady/utils/SafeTransferLib.sol";

/**
 * @title AlignmentHookSwapRouter
 * @notice Trades a graduated Uniswap-V4 pool whose key carries an alignment hook.
 *
 * @dev WHY THIS CONTRACT EXISTS.
 *      `LiquidityDeployerModule` graduates a collection into an ETH/token V4 pool. While
 *      `alignmentHookFactory` is unset that pool is hookless and static-fee, and the aggregator the
 *      app already routes through trades it. The moment the factory is set, the same graduation
 *      produces a DIFFERENT pool: the key carries the freshly-mined hook and its `fee` becomes
 *      `LPFeeLibrary.DYNAMIC_FEE_FLAG`, because the hook's `beforeSwap` returns an LP-fee override
 *      that V4 honors on dynamic-fee pools only. A `PoolKey` is identified by all five of its
 *      members, so a router that cannot name the hook and the dynamic fee names a different pool —
 *      one that was never initialized — and the trade cannot settle.
 *
 *      The aggregator cannot be taught to name it. Its V4 entry point takes a fee and a tick
 *      spacing and builds its key with `hooks: address(0)`; there is no hook argument to pass, and
 *      on mainnet that contract is a third party's deployment which this project does not own and
 *      cannot redeploy. Patching this repo's vendored copy would light the path on the network that
 *      self-deploys it and leave it dark on the network that does not — the inverse of what a
 *      rehearsal is for. This router is therefore deployed from this repo's own source on EVERY
 *      network, next to the hook factory and the deployer module that are already deployed that
 *      way, so the path the testnet exercises is the path mainnet runs.
 *
 *      SCOPE IS DELIBERATELY NARROW. It trades one pool per call, holds no approvals of its own
 *      beyond the transfer it makes inside the callback, keeps no balance between calls, and serves
 *      only the pool shape the alignment hook binds itself to: `currency0` native ETH, `currency1`
 *      the graduated token. That shape is enforced here rather than assumed, so a key the hook
 *      would reject is refused before any value moves. Hookless pools are not this contract's
 *      business and keep using the aggregator.
 *
 *      SETTLEMENT IS DELTA-DRIVEN, and that is the substantive difference from a hookless router.
 *      A hookless swap owes exactly the amount it specified, so a router may settle the number it
 *      was given. This hook carries `beforeSwapReturnDelta` and `afterSwapReturnDelta`: it takes
 *      its tithe by moving the caller's own deltas, so on an exact-output buy the ETH actually owed
 *      is MORE than the swap's own input, and on an exact-input buy part of the input never reaches
 *      the pool. `IPoolManager.swap` returns the caller's total delta with those hook deltas
 *      already folded in, so this contract settles what the delta says and nothing else. Settling
 *      the requested amount instead would leave the unlock unbalanced and revert the trade.
 *
 *      THE PRICE LIMIT IS NOT THE CALLER'S TO CHOOSE, and anything that builds its own `SwapParams`
 *      against one of these pools has to know why. Every swap this router sends names the extreme
 *      sentinel for its direction — `TickMath.MIN_SQRT_PRICE + 1` when `zeroForOne`,
 *      `TickMath.MAX_SQRT_PRICE - 1` otherwise — so that nothing but exhausted liquidity can stop
 *      it short. That is the pool's requirement, not this contract's preference. On the two shapes
 *      the hook charges in `beforeSwap` — an exact-input ETH buy and an exact-output ETH sell — the
 *      tithe is priced on the ETH the caller NAMED, because V4 fixes a hook's credit on the
 *      specified currency before the swap runs. A binding `sqrtPriceLimitX96`, or one order split
 *      across several pools, would therefore leave the caller paying a fee priced on ETH the pool
 *      never moved, and no later callback can hand that ETH back. The hook refuses the trade
 *      instead: it reverts `NamedEthLegNotFilled` RATHER THAN FILLING IN PART. That is a deliberate
 *      difference from an unhooked V4 pool, where the very same swap comes back part-filled and the
 *      caller keeps whatever did not trade. To cap price impact here, use `amountLimit`: it is
 *      denominated in a currency the caller can reason about and is checked against the tithed
 *      result. The two shapes charged in `afterSwap` are priced on the realised delta and part-fill
 *      as usual, as does any swap the hook takes no fee on.
 */
contract AlignmentHookSwapRouter is IUnlockCallback {
    using CurrencySettler for Currency;

    /// @notice The V4 singleton this router settles against. Fixed at construction.
    IPoolManager public immutable poolManager;

    /// @dev Transient latch proving the callback below belongs to an unlock THIS contract opened.
    ///      `msg.sender == poolManager` already implies that today, because V4 calls back only the
    ///      address that called `unlock`; the latch is the belt to that brace and costs two gas.
    ///      The slot is `uint256(keccak256("AlignmentHookSwapRouter.swapping")) - 1`, written as a
    ///      literal because inline assembly cannot read a computed constant, and namespaced so it
    ///      cannot collide with a transient slot another contract in the same frame reserves.
    uint256 private constant SWAPPING_SLOT = 0x9b3a1f0e2c5d47a8b6e0d31f8c7a25b4e91d6038fa4c72e5d80b1a3c6f9e4d20;

    /// @dev `unlockCallback` reached by anything but the pool manager this router was built against.
    error NotPoolManager();
    /// @dev The callback was reached without this router having opened the unlock.
    error NotSwapping();
    /// @dev `deadline` has passed.
    error Expired();
    /// @dev Exact-in received less than `amountLimit`, or exact-out spent more than it.
    error Slippage();
    /// @dev `amount` was zero — a swap of nothing is a caller mistake, not a no-op worth gas.
    error ZeroAmount();
    /// @dev `amount` does not fit V4's signed `amountSpecified`, so the cast would flip its sign.
    error AmountTooLarge();
    /// @dev The key is not the ETH/token shape the alignment hook binds to.
    error PoolNotNativeEth();
    /// @dev The key names no hook. Those pools belong to the aggregator, not here.
    error PoolHasNoHook();

    /// @dev What `swap` hands the callback. `payer` funds the input leg and receives any ETH
    ///      refund; `to` receives the output. They are separate because the app sells on behalf of
    ///      the connected wallet and may direct proceeds elsewhere.
    struct SwapCallbackData {
        PoolKey key;
        bool zeroForOne;
        int256 amountSpecified;
        address payer;
        address to;
    }

    constructor(address _poolManager) {
        poolManager = IPoolManager(_poolManager);
    }

    /**
     * @notice Swap against a hooked ETH/token V4 pool.
     * @param key         The pool's FULL key, hook and dynamic fee included. The caller reads it
     *                    from the deployer module rather than assembling it from a fee tier.
     * @param zeroForOne  True to spend ETH for the token, false to sell the token for ETH.
     * @param exactOut    False to spend exactly `amount`, true to receive exactly `amount`.
     * @param amount      The exact side's amount, in the input currency when `exactOut` is false
     *                    and in the output currency when it is true.
     * @param amountLimit Exact-in: the minimum output that makes the trade acceptable. Exact-out:
     *                    the maximum input. Zero disables the check, which is how a quote is taken
     *                    by simulation; a live trade should always carry one.
     * @param to          Recipient of the output leg.
     * @param deadline    Latest block timestamp at which this may execute.
     * @return amountIn   Input actually paid, the hook's tithe included.
     * @return amountOut  Output actually delivered to `to`.
     */
    function swap(
        PoolKey calldata key,
        bool zeroForOne,
        bool exactOut,
        uint256 amount,
        uint256 amountLimit,
        address to,
        uint256 deadline
    ) external payable returns (uint256 amountIn, uint256 amountOut) {
        if (block.timestamp > deadline) revert Expired();
        if (amount == 0) revert ZeroAmount();

        // What was already sitting here before this call, so the refund below can be bounded to THIS
        // trade's own change. Nothing this router does leaves ETH here: the manager pays a sell's
        // ETH leg STRAIGHT to `to` (`take` transfers to the recipient, never via this contract), and
        // with no `receive()` an ordinary send here reverts. ETH can still ARRIVE unbidden, though —
        // `selfdestruct` and a block reward reach an address whether it accepts payment or not — so a
        // bare `address(this).balance` refund would hand whoever trades next whatever had collected
        // that way. Same reasoning, and the same fix, as the aggregator's `_restingEth` (audit L-9):
        // a refund is change, not a sweep.
        uint256 resting = address(this).balance - msg.value;
        // The hook refuses any key whose currency0 is not native ETH or whose currency1 is not the
        // token it was mined for, so a key failing the first half here would revert deeper in with
        // a hook error. Checking it up front keeps the failure legible and costs one comparison.
        if (!key.currency0.isAddressZero()) revert PoolNotNativeEth();
        // Only the ZERO hook is refused, deliberately, rather than a whitelist of alignment hooks:
        // `payer` is hardcoded to `msg.sender`, this router holds no balance and no standing
        // approval of anyone else's, and a non-zero `amountLimit` bounds both directions. Naming a
        // hostile hook here can therefore spend only the caller's own funds, within the bound the
        // caller set — the same exposure as naming a hostile pool on any router. A whitelist would
        // buy nothing and would need a registry this periphery deliberately does not carry.
        if (address(key.hooks) == address(0)) revert PoolHasNoHook();

        // `amountSpecified` is V4's sign convention, not this router's: negative is an exact input,
        // positive an exact output. `amount` is unsigned at this surface so callers never have to
        // carry the convention, and `exactOut` says which it is. The range check is not ceremony: an
        // unchecked cast of an `amount` at or above 2**255 wraps NEGATIVE, which silently turns an
        // exact-output request into an exact-input one — a different trade from the one asked for.
        // V4's own SafeCast would reject the result further in, but only after the meaning had
        // already changed, and with an error naming neither this argument nor this contract.
        if (amount > uint256(type(int256).max)) revert AmountTooLarge();
        int256 amountSpecified = exactOut ? int256(amount) : -int256(amount);

        assembly ("memory-safe") {
            tstore(SWAPPING_SLOT, 1)
        }

        (amountIn, amountOut) = abi.decode(
            poolManager.unlock(
                abi.encode(
                    SwapCallbackData({
                        key: key, zeroForOne: zeroForOne, amountSpecified: amountSpecified, payer: msg.sender, to: to
                    })
                )
            ),
            (uint256, uint256)
        );

        assembly ("memory-safe") {
            tstore(SWAPPING_SLOT, 0)
        }

        if (amountLimit != 0) {
            if (exactOut ? amountIn > amountLimit : amountOut < amountLimit) revert Slippage();
        }

        // Whatever ETH the caller sent beyond what the swap owed. On a token sell this is the whole
        // of `msg.value` (which should be zero), and on an exact-output buy it is the overpayment
        // the caller could not size in advance because the hook's cut is priced inside the swap.
        //
        // This subtraction is DELIBERATELY left to revert on underflow, and it is the one place this
        // router is STRICTER than the aggregator: `zRouter._changeOver` clamps the same figure at
        // zero, which lets a trade that drew on resting ETH succeed and simply pay its caller
        // nothing back. Here, a swap that settled more ETH than `msg.value` can only have taken the
        // difference from ETH that was already sitting here — which is somebody else's — so the
        // whole transaction is unwound instead. Do not "fix" this into a clamp: the revert IS the
        // bound, and `test_drawingOnStrandedEthRevertsTheWholeTrade` pins it.
        uint256 change = address(this).balance - resting;
        if (change != 0) SafeTransferLib.safeTransferETH(msg.sender, change);
    }

    /// @inheritdoc IUnlockCallback
    function unlockCallback(bytes calldata rawData) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        uint256 swapping;
        assembly ("memory-safe") {
            swapping := tload(SWAPPING_SLOT)
        }
        if (swapping == 0) revert NotSwapping();

        SwapCallbackData memory data = abi.decode(rawData, (SwapCallbackData));

        // No price limit of its own: the bound this router enforces is `amountLimit`, denominated in
        // tokens the caller can reason about, and a sqrt-price bound on top of it would silently
        // return a PARTIAL fill instead of reverting. The extremes are the "no limit" sentinels.
        BalanceDelta delta = poolManager.swap(
            data.key,
            IPoolManager.SwapParams({
                zeroForOne: data.zeroForOne,
                amountSpecified: data.amountSpecified,
                sqrtPriceLimitX96: data.zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );

        // Each leg is settled on its own sign rather than on which direction was requested. A hook
        // holding both `beforeSwapReturnDelta` and `afterSwapReturnDelta` can move either side, so
        // "the input currency is the one we owe" is an assumption this contract does not make.
        (uint256 paid0, uint256 got0) = _settleLeg(data.key.currency0, delta.amount0(), data.payer, data.to);
        (uint256 paid1, uint256 got1) = _settleLeg(data.key.currency1, delta.amount1(), data.payer, data.to);

        return abi.encode(paid0 + paid1, got0 + got1);
    }

    /**
     * @dev Pay or collect one currency according to the sign of its delta.
     * @return paid Amount owed to the manager and settled, zero if this leg was a credit.
     * @return got  Amount taken from the manager to `to`, zero if this leg was a debt.
     */
    function _settleLeg(Currency currency, int128 amount, address payer, address to)
        private
        returns (uint256 paid, uint256 got)
    {
        if (amount < 0) {
            paid = uint256(uint128(-amount));
            // Native ETH is settled from the value this router is already holding for the caller;
            // the token leg is pulled from the payer, who has approved this router for it.
            currency.settle(poolManager, currency.isAddressZero() ? address(this) : payer, paid, false);
        } else if (amount > 0) {
            got = uint256(uint128(amount));
            currency.take(poolManager, to, got, false);
        }
    }
}
