// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ReentrancyGuard } from "solady/utils/ReentrancyGuard.sol";
import { Ownable } from "solady/auth/Ownable.sol";
import { Hooks } from "v4-core/libraries/Hooks.sol";
import { SafeCast } from "v4-core/libraries/SafeCast.sol";
import { LPFeeLibrary } from "v4-core/libraries/LPFeeLibrary.sol";
import { IHooks } from "v4-core/interfaces/IHooks.sol";
import { IPoolManager } from "v4-core/interfaces/IPoolManager.sol";
import { BalanceDelta } from "v4-core/types/BalanceDelta.sol";
import { BeforeSwapDelta, BeforeSwapDeltaLibrary, toBeforeSwapDelta } from "v4-core/types/BeforeSwapDelta.sol";
import { Currency, CurrencyLibrary } from "v4-core/types/Currency.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { IAlignmentVault } from "../../../interfaces/IAlignmentVault.sol";
import { IMasterRegistry } from "../../../master/interfaces/IMasterRegistry.sol";
import { IAlignmentHook } from "./IAlignmentHook.sol";

/**
 * @title UniAlignmentV4Hook
 * @notice Uniswap v4 hook that collects alignment fees on swaps and sends them to the vault
 * @dev Fees are sent directly to vault with project instance tracking for contribution metrics.
 *      The fee is always taken in ETH, on all four swap shapes, and which callback can take it is decided
 *      by v4: a beforeSwap return delta acts on the SPECIFIED currency and an afterSwap return delta on
 *      the UNSPECIFIED one. So beforeSwap carries the dynamic LP fee override plus the tithe on the two
 *      ETH-specified shapes (exact-input ETH buy, exact-output ETH-out sell), and afterSwap carries the
 *      tithe on the two ETH-unspecified shapes (exact-output ETH buy, exact-input token sell).
 *
 *      On every shape the tithe is priced on ETH the swap actually moved. The two shapes afterSwap taxes
 *      get that directly: `hookFeeBips` of the realised `BalanceDelta`. The two shapes beforeSwap taxes
 *      cannot, because v4 fixes a hook's credit on the SPECIFIED currency before the swap runs and the
 *      pool may then fill only part of the leg (`Pool.swap` stops at `sqrtPriceLimitX96`). Those take
 *      `hookFeeBips` of the leg the swapper NAMED, and afterSwap re-reads the realised delta and reverts
 *      unless the pool moved that leg whole. The two bases differ by the fee itself: shapes 2 and 3
 *      tithe `hookFeeBips` of the pool's ETH leg, shapes 1 and 4 of the swapper's, which is the pool's
 *      leg plus or minus the fee. A part-filled ETH-out sell charged on its name would take a large
 *      share of the swapper's proceeds, or turn the sale into a net ETH outflow for the seller. See
 *      `afterSwap` for why a refund is not available instead.
 *      Hook fee (hookFeeBips) is immutable, set once at deploy.
 *      LP fee (lpFeeRate) is owner-adjustable via setLpFeeRate(), and is capped by the contract itself
 *      at {MAX_CONFIGURABLE_LP_FEE} rather than at v4's 100% ceiling, so no key can price the pool shut.
 */
contract UniAlignmentV4Hook is IAlignmentHook, ReentrancyGuard, Ownable {
    using Hooks for IHooks;
    using SafeCast for uint256;
    using SafeCast for int128;

    error InvalidAddress();
    error HookFeeTooHigh();
    /// @notice The constructor's `_initialLpFeeRate` is above {MAX_CONFIGURABLE_LP_FEE}.
    error LpFeeTooHigh();
    error PoolCurrency0MustBeNativeETH();
    /// @notice The `PoolKey` this hook was called for is not the pool it was deployed to serve.
    /// @dev The hook address is the only field of a v4 `PoolKey` that cannot be chosen freely, so every
    ///      other field has to be bound by the hook itself or anyone may `initialize` a SECOND pool on
    ///      this launch's hook and have its swaps taxed and credited here.
    error PoolNotBound();
    error InvalidTickSpacing();
    /// @notice `setLpFeeRate` was given a rate above {MAX_CONFIGURABLE_LP_FEE}.
    error RateTooHigh();
    error NoQueuedFees();
    error VaultStillRegistered();
    error VaultNotRegistered();
    error TitheNotHalted();
    /// @notice The pool did not move the whole ETH leg the swapper named, so the tithe `beforeSwap`
    ///         charged against that name is worth more than `hookFeeBips` of the ETH that moved.
    /// @dev Reachable only on the two shapes where ETH is the SPECIFIED currency; see `afterSwap`.
    error NamedEthLegNotFilled();

    /// @notice The highest LP fee this hook will ever charge, in v4 fee units (hundredths of a basis
    ///         point, so 1_000_000 = 100%). 10_000 = 1%.
    ///
    /// @dev `beforeSwap` returns `lpFeeRate | OVERRIDE_FEE_FLAG`, so whoever holds `setLpFeeRate`
    ///      decides what the next swap in this pool costs. v4's own bound, `LPFeeLibrary.MAX_LP_FEE`
    ///      (100%), is a pool nobody can trade. The ceiling makes "this pool stays tradeable" a
    ///      property of the contract rather than of who holds the key.
    ///
    ///      Why 10_000:
    ///        * The pool trades at 3000 (0.3%): `zrouterFee` in every network config, the static pool
    ///          fee the graduation module is constructed with, and the hook's initial `lpFeeRate`, so
    ///          switching the tithe on changes what the pool takes and not what it charges.
    ///        * 10_000 is the top of Uniswap's standard fee ladder (100 / 500 / 3000 / 10_000, in
    ///          these units), leaving the whole ladder open as a retune.
    ///        * It bounds the total a swapper can be charged here. `hookFeeBips` is the separate,
    ///          immutable tithe on the ETH leg, quoted in bips out of 10_000 while this is quoted out
    ///          of 1_000_000; the two must not be conflated. With both at their maximum a swap costs
    ///          roughly 2%.
    ///        * `lpFeeRate` is a stored value moved only by an owner call, not a per-swap computation,
    ///          so no headroom is needed for a volatility response.
    ///
    ///      A constant, not a constructor bound: the hook factory mines each hook's address from an
    ///      init-code hash over every constructor argument, and a per-hook bound would hand the
    ///      ceiling to whoever calls the factory. As a constant it is identical on every hook and
    ///      readable from source.
    ///
    ///      Not an emergency stop: a punitive fee is a trading halt in all but name, and this protocol
    ///      holds none (`MasterRegistryV1.revokeInstance`: a revocation "is not a trading halt, and
    ///      this contract has no mechanism that is"). The emergency this hook has is a vault that can
    ///      no longer accept, handled by `haltTithe` / `resumeTithe` (permissionless, gated on the
    ///      registry, so they follow `deactivateVault`) and `rescueQueuedFees`.
    uint24 public constant MAX_CONFIGURABLE_LP_FEE = 10_000;

    IPoolManager public immutable poolManager;
    IAlignmentVault public immutable vault;
    address public immutable weth;

    /// @notice The registry that says whether `vault` is still a vault the protocol curates.
    /// @dev The hook's only oracle for "this vault is gone for good". `vault` is immutable and the
    ///      vault flavors have no shared "can you still accept?" call, so a failed forward cannot tell
    ///      a transient revert from a permanent one. `deactivateVault` is the protocol owner's lever
    ///      for retiring a vault, and the same signal `LiquidityDeployerModule.flushPendingVaultCut`
    ///      reads before returning a stashed graduation cut.
    IMasterRegistry public immutable masterRegistry;

    /// @notice The project instance credited for this pool's swap-fee contributions; immutable. Not the
    ///         per-swap `sender`: in Uniswap v4 `afterSwap`'s `sender` is whoever called
    ///         `poolManager.swap()` inside the unlock callback (the router/periphery locker), never
    ///         the end trader. Attributing fees to that address would misroute the vault yield and let
    ///         a self-routing swapper farm benefactor credit. A hook serves one pool, so its
    ///         benefactor is a fixed identity.
    address public immutable benefactor;

    /// @notice Hook fee in basis points; immutable (100 = 1%)
    uint256 public immutable hookFeeBips;

    /// @notice The alignment token that must be `currency1` of the pool this hook serves.
    /// @dev Together with the native-ETH `currency0` check, `poolTickSpacing`, the dynamic-fee
    ///      requirement and this hook's own address (which v4 reads out of the key to route the call at
    ///      all), this pins every field of the `PoolKey`. Supplied by the graduation that deploys the
    ///      hook, and part of the hook's init-code hash, so a hook bound to a different pool is a
    ///      different hook at a different address.
    address public immutable poolToken;

    /// @notice The tick spacing of the pool this hook serves. See {poolToken}.
    int24 public immutable poolTickSpacing;

    /// @notice LP fee rate; owner-configurable, overrides the pool's fee via beforeSwap
    uint24 public lpFeeRate;

    event AlignmentFeeCollected(uint256 ethAmount, address indexed benefactor);
    event AlignmentFeeQueued(uint256 ethAmount, address indexed benefactor);
    event QueuedFeesForwarded(uint256 ethAmount);
    event TitheHalted(address indexed vault);
    event TitheResumed(address indexed vault);
    event QueuedFeesRescued(address indexed fromVault, address indexed toVault, uint256 ethAmount);
    event LpFeeRateUpdated(uint24 newRate);

    /// @notice ETH held in hook pending retry after a failed vault.receiveContribution call
    uint256 public queuedFees;

    /// @notice While true the swap tithe is not charged at all: no take, no fee delta, nothing queued.
    /// @dev Set only while the registry says `vault` is no longer registered, and cleared only while it
    ///      says it is. It is a stored bool rather than a registry call so the swap hot path costs one
    ///      warm SLOAD instead of a cross-contract read.
    bool public titheHalted;

    constructor(
        IPoolManager _poolManager,
        IAlignmentVault _vault,
        address _weth,
        address _owner,
        address _benefactor,
        uint256 _hookFeeBips,
        uint24 _initialLpFeeRate,
        IMasterRegistry _masterRegistry,
        address _poolToken,
        int24 _poolTickSpacing
    ) {
        if (address(_poolManager) == address(0)) revert InvalidAddress();
        if (address(_vault) == address(0)) revert InvalidAddress();
        if (_weth == address(0)) revert InvalidAddress();
        if (_owner == address(0)) revert InvalidAddress();
        if (_benefactor == address(0)) revert InvalidAddress();
        if (address(_masterRegistry) == address(0)) revert InvalidAddress();
        // `currency0` is native ETH, so the alignment token is `currency1` and must sort above
        // `address(0)`. A zero here would name a pool whose two currencies are the same, and leave
        // `_requireBoundPool` binding nothing.
        if (_poolToken == address(0)) revert InvalidAddress();
        // v4 requires 1 <= tickSpacing <= 32767; a hook bound to a key outside that could never serve
        // any pool.
        if (_poolTickSpacing <= 0 || _poolTickSpacing > 32767) revert InvalidTickSpacing();
        if (_hookFeeBips > 10000) revert HookFeeTooHigh();
        // The same ceiling `setLpFeeRate` enforces. The constructed rate is chosen by whoever
        // configures the graduation module, so an uncapped constructor could mint a pool untradeable
        // from its first block.
        if (_initialLpFeeRate > MAX_CONFIGURABLE_LP_FEE) revert LpFeeTooHigh();

        _initializeOwner(_owner);
        poolManager = _poolManager;
        vault = _vault;
        weth = _weth;
        benefactor = _benefactor;
        hookFeeBips = _hookFeeBips;
        lpFeeRate = _initialLpFeeRate;
        masterRegistry = _masterRegistry;
        poolToken = _poolToken;
        poolTickSpacing = _poolTickSpacing;

        // Validate hook permissions — beforeSwap + afterSwap with return delta
        Hooks.validateHookPermissions(
            IHooks(address(this)),
            Hooks.Permissions({
                beforeInitialize: false,
                afterInitialize: false,
                beforeAddLiquidity: false,
                afterAddLiquidity: false,
                beforeRemoveLiquidity: false,
                afterRemoveLiquidity: false,
                beforeSwap: true,
                afterSwap: true,
                beforeDonate: false,
                afterDonate: false,
                beforeSwapReturnDelta: true,
                afterSwapReturnDelta: true,
                afterAddLiquidityReturnDelta: false,
                afterRemoveLiquidityReturnDelta: false
            })
        );
    }

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert Unauthorized();
        _;
    }

    /// @dev Binds every field of the `PoolKey` to the pool this hook was deployed to serve.
    ///
    ///      A v4 hook is reached through the key it is named in, and the caller of `initialize` chooses
    ///      that key. Without the binding anyone could stand up a second pool (a worthless token
    ///      against ETH) on this launch's hook, with its swaps taxed here and credited to this launch's
    ///      benefactor. That drains nothing, since the `take` is charged back to that pool's own
    ///      swapper through the returned delta, but an unbound hook is a surface with no reason to
    ///      exist.
    ///
    ///      The five fields, and how each is pinned:
    ///        * `hooks`   — by v4 itself: the PoolManager only calls the hook the key names.
    ///        * `currency0` — native ETH, the invariant the fee maths depends on.
    ///        * `currency1` — `poolToken`, the graduating launch's own coin.
    ///        * `fee`       — the dynamic-fee flag. `beforeSwap` returns an LP-fee override, which v4
    ///                      honors only on a dynamic-fee pool; a static-fee key would discard it.
    ///        * `tickSpacing` — `poolTickSpacing`, the graduation module's own immutable.
    ///
    ///      The last two immutables are constructor arguments, so they are part of the init-code hash the
    ///      factory mines and keys adoption on. A hook for a different pool is a different hook at a
    ///      different address, so no rogue pool can bind first.
    function _requireBoundPool(PoolKey calldata key) private view {
        if (Currency.unwrap(key.currency0) != address(0)) revert PoolCurrency0MustBeNativeETH();
        if (Currency.unwrap(key.currency1) != poolToken) revert PoolNotBound();
        if (key.fee != LPFeeLibrary.DYNAMIC_FEE_FLAG) revert PoolNotBound();
        if (key.tickSpacing != poolTickSpacing) revert PoolNotBound();
    }

    /**
     * @notice Dynamic LP fee override + alignment fee collection on the ETH-SPECIFIED swap shapes
     * @dev Two jobs, on every swap:
     *      1. Return the owner-configurable `lpFeeRate` as the dynamic LP-fee override.
     *      2. Tax the ETH side here, and only here, when ETH (currency0) is the SPECIFIED currency.
     *         In v4 that is exactly `(amountSpecified < 0) == zeroForOne`: the exact-input ETH->token buy
     *         (shape 1) and the exact-output token->ETH sell (shape 4). An `afterSwap` return delta is
     *         applied to the UNSPECIFIED currency (`Hooks.afterSwap` adds it to `hookDeltaUnspecified`),
     *         so for these shapes it would land on the token and fail to settle against a
     *         `take(currency0)`. `beforeSwap` can act on the SPECIFIED currency, so the fee is taken up
     *         front in ETH and returned as a positive BeforeSwapDelta on the specified side, which v4
     *         credits back to the hook on currency0, cancelling the take's debt.
     *
     *         The base is `|amountSpecified|`, the ETH leg the swapper named, at the same `hookFeeBips`
     *         the ETH-unspecified shapes pay. The sign of the adjustment follows v4's
     *         `amountToSwap += hookDeltaSpecified`, so one branch serves both shapes:
     *           * shape 1 (`amountSpecified < 0`): the swapped-in amount shrinks by `feeAmount`. The
     *             swapper pays exactly the ETH they specified and receives proportionally fewer tokens.
     *           * shape 4 (`amountSpecified > 0`): the swapped-out amount grows by `feeAmount`. The
     *             swapper receives exactly the ETH they specified and pays the extra tokens the larger
     *             output costs, as the exact-output buyer of shape 2 pays the tithe on top.
     *
     *         Neither adjustment can flip the swap's exact-input/exact-output type, so v4's
     *         `HookDeltaExceedsSwapAmount` guard cannot trip: a positive specified delta moves an
     *         exact-input amount toward zero from below and an exact-output amount further above it.
     *         At exactly 10000 bips the fee equals the named amount and an exact-input swap degenerates to
     *         zero swapped, but the guard still holds: the delta lands on zero, never past it.
     *
     *         A name is not a fill: `Pool.swap` stops at `sqrtPriceLimitX96` and returns what it moved,
     *         so the named leg may be filled only in part after this fee is spent. `afterSwap` catches
     *         that by reading the realised delta and reverting.
     */
    // slither-disable-next-line reentrancy-events
    function beforeSwap(address, PoolKey calldata key, IPoolManager.SwapParams calldata params, bytes calldata)
        external
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        // Must be the pool this hook was deployed for, whole key (afterSwap makes the same check).
        _requireBoundPool(key);

        uint24 feeOverride = lpFeeRate | LPFeeLibrary.OVERRIDE_FEE_FLAG;

        // ETH (currency0) is the specified currency exactly when (amountSpecified < 0) == zeroForOne,
        // shapes 1 and 4. Shapes 2 and 3 are taxed in afterSwap, so there is no double-tax.
        // `titheHalted` skips the tax rather than taking and queueing it: once the vault is off the
        // registry there is no destination, and charging the swapper would take ETH for nothing.
        if (!titheHalted && (params.amountSpecified < 0) == params.zeroForOne) {
            uint256 ethSpecified =
                params.amountSpecified < 0 ? uint256(-params.amountSpecified) : uint256(params.amountSpecified);
            uint256 feeAmount = (ethSpecified * hookFeeBips) / 10000; // round down: favors swapper
            if (feeAmount > 0) {
                _collectAndForward(key.currency0, feeAmount);
                // Positive specified delta: v4 moves the swapped amount by feeAmount and credits the
                // hook feeAmount on currency0, cancelling the take's debt.
                return (IHooks.beforeSwap.selector, toBeforeSwapDelta(feeAmount.toInt128(), int128(0)), feeOverride);
            }
        }

        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, feeOverride);
    }

    /**
     * @notice Collect the alignment fee on the ETH side when ETH is the UNSPECIFIED currency, and hold
     *         the other two shapes to the fill their tithe was priced against
     * @dev Takes the fee only for the two shapes where ETH (currency0) is unspecified: exact-output ETH
     *      buy (shape 2) and exact-input token->ETH sell (shape 3). The afterSwap return-delta (which
     *      v4 applies to the unspecified currency) then lands on ETH and settles against
     *      `take(currency0)`. Those two are charged on `delta`, the ETH the swap actually moved, so they
     *      are right whether the pool filled the whole swap or stopped short.
     *
     *      When ETH is the SPECIFIED currency (shapes 1 and 4) beforeSwap has already taken the tithe, so
     *      this takes nothing and returns 0, but it re-reads the realised delta and reverts unless the
     *      pool moved the whole ETH leg beforeSwap priced the fee against. `Pool.swap` exits at
     *      `sqrtPriceLimitX96` and returns `amountSpecified` minus whatever it could not fill, so a leg
     *      naming more ETH than the pool holds in range comes back short while the fee charged against
     *      the name does not.
     *
     *      Reverting rather than reconciling, because v4 leaves no room to reconcile. A hook's credit on
     *      the SPECIFIED currency is `beforeSwapDelta`'s, fixed before the swap runs; `Hooks.afterSwap`
     *      adds this callback's return to `hookDeltaUnspecified` only, which on these two shapes is the
     *      token. Nothing here can hand the swapper back ETH: the swapper's `amount0` is already
     *      `realised - feeAmount` whatever this returns. Settling the excess to the manager, or taking
     *      it out to the caller, would credit an address whose router settles the delta `swap()` handed
     *      it and leave the unlock unbalanced. Reverting is right for shape 4 (an exact-output request
     *      that cannot be honoured in full is not the trade asked for) and the lesser evil for shape 1
     *      (as the realised spend falls toward zero the fee stays at `hookFeeBips` of the name, so the
     *      effective rate is bounded only by 100% of what the buyer parted with).
     *
     *      The check is tied to the charge, not the shape: a halted tithe and a fee that rounds to zero
     *      both leave the swap exactly as v4 would have run it.
     */
    // slither-disable-next-line reentrancy-events
    function afterSwap(
        address, /* sender — v4 passes the router/locker, not the trader; we credit the fixed benefactor */
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata
    ) external onlyPoolManager returns (bytes4, int128) {
        _requireBoundPool(key);

        // ETH (currency0) is the specified currency exactly when (amountSpecified < 0) == zeroForOne.
        // For those shapes (1 and 4) beforeSwap has already taken the tithe, so this only holds that
        // tithe to its fill.
        bool ethIsSpecified = (params.amountSpecified < 0) == params.zeroForOne;
        if (ethIsSpecified) {
            if (!titheHalted) _requireNamedEthLegFilled(params, delta);
            return (IHooks.afterSwap.selector, int128(0));
        }
        if (titheHalted) {
            return (IHooks.afterSwap.selector, int128(0));
        }

        int128 amount0 = delta.amount0();
        uint256 ethMoved = amount0 < 0 ? uint256(uint128(-amount0)) : uint256(uint128(amount0));
        uint256 feeAmount = (ethMoved * hookFeeBips) / 10000; // round down: favors swapper

        if (feeAmount > 0) {
            _collectAndForward(key.currency0, feeAmount);
            return (IHooks.afterSwap.selector, feeAmount.toInt128());
        }

        return (IHooks.afterSwap.selector, int128(0));
    }

    /**
     * @notice Require that the pool moved the whole ETH leg `beforeSwap` priced this swap's tithe against
     * @dev Meaningful only on the two ETH-SPECIFIED shapes, and only once a fee has been taken;
     *      `afterSwap` calls it under both conditions. `Hooks.beforeSwap` hands the pool
     *      `amountToSwap = amountSpecified + feeAmount`, which shrinks an exact input and grows an exact
     *      output, so the leg to fill is `|amountSpecified| -/+ feeAmount` on the respective sign. `delta`
     *      is the pool's own realised delta, handed to `afterSwap` before v4 folds the hook's credit into
     *      the swapper's, so `|delta.amount0()|` is what the pool moved, and anything short of the leg
     *      means the swapper carries a fee priced on ETH that never moved.
     * @param params The swap's original parameters, as v4 passes them to both callbacks.
     * @param delta  The pool's realised balance delta for this swap.
     */
    function _requireNamedEthLegFilled(IPoolManager.SwapParams calldata params, BalanceDelta delta) private view {
        uint256 ethNamed =
            params.amountSpecified < 0 ? uint256(-params.amountSpecified) : uint256(params.amountSpecified);
        // Recomputed rather than carried across the two callbacks: the inputs are `params` (the same
        // struct in both) and an immutable, so no transient slot is needed that a nested swap could read.
        uint256 feeAmount = (ethNamed * hookFeeBips) / 10000;
        if (feeAmount == 0) return; // nothing was charged, so nothing can have been over-charged

        uint256 ethLeg = params.amountSpecified < 0 ? ethNamed - feeAmount : ethNamed + feeAmount;
        int128 amount0 = delta.amount0();
        uint256 ethFilled = amount0 < 0 ? uint256(uint128(-amount0)) : uint256(uint128(amount0));
        if (ethFilled < ethLeg) revert NamedEthLegNotFilled();
    }

    /**
     * @notice Take `feeAmount` of ETH (currency0) from the PoolManager and forward it to the vault
     * @dev Shared by beforeSwap (the ETH-specified shapes) and afterSwap (the ETH-unspecified ones), so
     *      every shape's tithe queues, emits and credits the benefactor the same way. The `take` pulls ETH
     *      to this hook (creating a currency0 debt the caller cancels via the returned delta), then the
     *      ETH is forwarded to the vault as a contribution credited to the fixed benefactor. If the vault
     *      call reverts, the ETH is queued in the hook for a flushQueuedFees() retry.
     */
    function _collectAndForward(Currency currency0, uint256 feeAmount) internal {
        poolManager.take(currency0, address(this), feeAmount);
        (bool ok,) = address(vault).call{ value: feeAmount }(
            abi.encodeCall(IAlignmentVault.receiveContribution, (currency0, feeAmount, benefactor))
        );
        if (ok) {
            emit AlignmentFeeCollected(feeAmount, benefactor);
        } else {
            queuedFees += feeAmount;
            emit AlignmentFeeQueued(feeAmount, benefactor);
        }
    }

    /**
     * @notice Retry forwarding accumulated queued fees to the vault
     * @dev Callable by anyone. Reverts if no queued fees or if vault still reverts.
     *
     *      Also refuses once the registry has retired `vault`, which makes this and `rescueQueuedFees`
     *      disjoint: while the vault is curated this is the only exit, and once it is not, the rescue is.
     *      De-curation stops money reaching the vault, as in
     *      `LiquidityDeployerModule.flushPendingVaultCut`.
     */
    function flushQueuedFees() external nonReentrant {
        uint256 amount = queuedFees;
        if (amount == 0) revert NoQueuedFees();
        if (!masterRegistry.isVaultRegistered(address(vault))) revert VaultNotRegistered();
        queuedFees = 0;
        // Credit the same fixed benefactor the live afterSwap path credits, not the hook itself.
        vault.receiveContribution{ value: amount }(Currency.wrap(address(0)), amount, benefactor);
        emit QueuedFeesForwarded(amount);
    }

    /**
     * @notice Stop charging the swap tithe, once the registry says `vault` is no longer registered
     * @dev Permissionless, and gated on the registry: it succeeds only if the protocol owner has
     *      retired `vault` with `deactivateVault`. Otherwise every swap would be taxed into a vault
     *      that can never accept, and the take would fall into `queuedFees`.
     */
    function haltTithe() external {
        if (masterRegistry.isVaultRegistered(address(vault))) revert VaultStillRegistered();
        titheHalted = true;
        emit TitheHalted(address(vault));
    }

    /**
     * @notice Resume the swap tithe once `vault` is a registered vault again
     * @dev The mirror of `haltTithe`, permissionless for the same reason: a reversed de-registration
     *      must not leave the tithe off with only an owner able to turn it back on.
     */
    function resumeTithe() external {
        if (!masterRegistry.isVaultRegistered(address(vault))) revert VaultNotRegistered();
        titheHalted = false;
        emit TitheResumed(address(vault));
    }

    /**
     * @notice Forward queued fees to another registered vault, after `vault` has been retired
     * @dev The exit for fees queued against a dead vault. `vault` is immutable, so ETH queued against
     *      a vault whose intake closed for good (`AlignmentEndowmentVault.migratePosition` is the
     *      documented way) could otherwise only be retried into the same dead address.
     *
     *      Not a sweep. The destination must be a vault the registry currently curates, and the
     *      contribution is credited to the hook's immutable `benefactor`, as on the live path. It
     *      moves the community's ETH between curated vaults and cannot move it to the owner, the
     *      protocol treasury, or anywhere else; the owner chooses which curated vault, never whether
     *      to take it.
     *
     *      Reachable only once the protocol owner has retired `vault` and the tithe is halted, so it
     *      never diverts the tithe of a live vault and never races a `flushQueuedFees` that would work.
     * @param destinationVault The registered vault to credit instead.
     */
    function rescueQueuedFees(address destinationVault) external onlyOwner nonReentrant {
        uint256 amount = queuedFees;
        if (amount == 0) revert NoQueuedFees();
        if (masterRegistry.isVaultRegistered(address(vault))) revert VaultStillRegistered();
        if (!titheHalted) revert TitheNotHalted();
        if (!masterRegistry.isVaultRegistered(destinationVault)) revert VaultNotRegistered();
        queuedFees = 0;
        IAlignmentVault(payable(destinationVault)).receiveContribution{ value: amount }(
            Currency.wrap(address(0)), amount, benefactor
        );
        emit QueuedFeesRescued(address(vault), destinationVault, amount);
    }

    /**
     * @notice Set the dynamic LP fee this hook overrides its pool with (owner only)
     * @dev Bounded by {MAX_CONFIGURABLE_LP_FEE}, not by v4's `LPFeeLibrary.MAX_LP_FEE`; see that
     *      constant for the number and the reasoning.
     * @param _rate New LP fee rate in v4 fee units; at most MAX_CONFIGURABLE_LP_FEE (10_000 = 1%)
     */
    function setLpFeeRate(uint24 _rate) external onlyOwner {
        if (_rate > MAX_CONFIGURABLE_LP_FEE) revert RateTooHigh();
        lpFeeRate = _rate;
        emit LpFeeRateUpdated(_rate);
    }

    // ============================================
    // Unused Hook Implementations (Stub Methods)
    // ============================================

    function beforeInitialize(address, PoolKey calldata, uint160) external pure returns (bytes4) {
        return IHooks.beforeInitialize.selector;
    }

    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure returns (bytes4) {
        return IHooks.afterInitialize.selector;
    }

    function beforeAddLiquidity(address, PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return IHooks.beforeAddLiquidity.selector;
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        return (IHooks.afterAddLiquidity.selector, BalanceDelta.wrap(0));
    }

    function beforeRemoveLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        bytes calldata
    ) external pure returns (bytes4) {
        return IHooks.beforeRemoveLiquidity.selector;
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        return (IHooks.afterRemoveLiquidity.selector, BalanceDelta.wrap(0));
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return IHooks.beforeDonate.selector;
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return IHooks.afterDonate.selector;
    }

    /// @notice Receive ETH from poolManager.take() before forwarding to vault
    receive() external payable { }
}
