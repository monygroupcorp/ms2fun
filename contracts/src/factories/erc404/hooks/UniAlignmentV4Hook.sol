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
 *      Uses beforeSwap for the dynamic LP fee override + the ETH-input fee (exact-input ETH buys), and
 *      afterSwap for the ETH-output fee (ETH-unspecified shapes), so the ETH tithe settles on every swap
 *      shape. The fee is always taken in ETH; exact-output ETH-out sells are untaxed by design.
 *      Hook fee (hookFeeBips) is immutable — set once at deploy, no governance risk.
 *      LP fee (lpFeeRate) is owner-adjustable via setLpFeeRate().
 */
contract UniAlignmentV4Hook is IAlignmentHook, ReentrancyGuard, Ownable {
    using Hooks for IHooks;
    using SafeCast for uint256;
    using SafeCast for int128;

    error InvalidAddress();
    error HookFeeTooHigh();
    error LpFeeTooHigh();
    error PoolCurrency0MustBeNativeETH();
    error RateTooHigh();
    error NoQueuedFees();
    error VaultStillRegistered();
    error VaultNotRegistered();
    error TitheNotHalted();

    IPoolManager public immutable poolManager;
    IAlignmentVault public immutable vault;
    address public immutable weth;

    /// @notice The registry that says whether `vault` is still a vault the protocol curates.
    /// @dev The hook's only oracle for "this vault is gone for good". `vault` is immutable and the
    ///      vault flavors have no shared "can you still accept?" call, so a failed forward on its own
    ///      cannot tell a transient revert from a permanent one — which is exactly the ambiguity that
    ///      let `queuedFees` grow without an exit (audit M-4). `deactivateVault` is the protocol
    ///      owner's existing lever for retiring a vault, and it is the same signal
    ///      `LiquidityDeployerModule.flushPendingVaultCut` already reads before returning a stashed
    ///      graduation cut, so the hook now answers to the same runbook step the rest of the system does.
    IMasterRegistry public immutable masterRegistry;

    /// @notice The project instance credited for this pool's swap-fee contributions — immutable, set
    ///         at deploy. NOT the per-swap `sender`: in Uniswap v4 `afterSwap`'s `sender` is whoever
    ///         called `poolManager.swap()` inside the unlock callback (the router/periphery locker),
    ///         never the end trader. Attributing fees to that address misroutes (and can strand) the
    ///         vault yield and would let a self-routing swapper farm benefactor credit. A hook serves
    ///         exactly one pool, so its benefactor is a fixed identity, not a per-swap value.
    address public immutable benefactor;

    /// @notice Hook fee in basis points — immutable, set at deploy (e.g., 100 = 1%)
    uint256 public immutable hookFeeBips;

    /// @notice LP fee rate — owner-configurable, overrides pool's static fee via beforeSwap
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

    /// @notice While true the swap tithe is not charged at all — no take, no fee delta, nothing queued.
    /// @dev Set only while the registry says `vault` is no longer registered, and cleared only while it
    ///      says it is, so this tracks the registry rather than anyone's opinion. It is read on the swap
    ///      hot path, which is why it is a stored bool and not a registry call: one warm SLOAD per swap
    ///      instead of a cross-contract read on every trade in the pool.
    bool public titheHalted;

    constructor(
        IPoolManager _poolManager,
        IAlignmentVault _vault,
        address _weth,
        address _owner,
        address _benefactor,
        uint256 _hookFeeBips,
        uint24 _initialLpFeeRate,
        IMasterRegistry _masterRegistry
    ) {
        if (address(_poolManager) == address(0)) revert InvalidAddress();
        if (address(_vault) == address(0)) revert InvalidAddress();
        if (_weth == address(0)) revert InvalidAddress();
        if (_owner == address(0)) revert InvalidAddress();
        if (_benefactor == address(0)) revert InvalidAddress();
        if (address(_masterRegistry) == address(0)) revert InvalidAddress();
        if (_hookFeeBips > 10000) revert HookFeeTooHigh();
        if (_initialLpFeeRate > LPFeeLibrary.MAX_LP_FEE) revert LpFeeTooHigh();

        _initializeOwner(_owner);
        poolManager = _poolManager;
        vault = _vault;
        weth = _weth;
        benefactor = _benefactor;
        hookFeeBips = _hookFeeBips;
        lpFeeRate = _initialLpFeeRate;
        masterRegistry = _masterRegistry;

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

    /**
     * @notice Dynamic LP fee override + ETH-input alignment fee collection
     * @dev Two jobs, on every swap:
     *      1. Return the owner-configurable `lpFeeRate` as the dynamic LP-fee override.
     *      2. Tax the ETH side HERE — and only here — when ETH (currency0) is the SPECIFIED input,
     *         i.e. an exact-input ETH->token buy (`zeroForOne && amountSpecified < 0`, shape 1). This is
     *         the swap shape whose afterSwap return-delta would land on the token (the unspecified
     *         currency) and fail to settle against a `take(currency0)`. We instead take the fee up front
     *         on the specified ETH input and return it as a positive BeforeSwapDelta on the SPECIFIED
     *         currency, which v4 credits back to the hook on currency0 — cancelling the take so the swap
     *         settles, and shrinking the amount swapped into the pool by `feeAmount`. All other shapes are
     *         a no-op here (afterSwap taxes the ETH-unspecified shapes 2/3; shape 4 is untaxed by design).
     */
    // slither-disable-next-line reentrancy-events
    function beforeSwap(address, PoolKey calldata key, IPoolManager.SwapParams calldata params, bytes calldata)
        external
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        // currency0 must be native ETH (same invariant afterSwap enforces)
        if (Currency.unwrap(key.currency0) != address(0)) revert PoolCurrency0MustBeNativeETH();

        uint24 feeOverride = lpFeeRate | LPFeeLibrary.OVERRIDE_FEE_FLAG;

        // Shape 1 only: exact-input ETH buy — ETH (currency0) is the specified input.
        // `titheHalted` skips the tax entirely rather than taking it and queueing it: once the vault is
        // off the registry there is nothing for a take to settle into, so charging the swapper would be
        // taking their ETH for a destination that no longer exists (audit M-4).
        if (!titheHalted && params.zeroForOne && params.amountSpecified < 0) {
            uint256 ethIn = uint256(-params.amountSpecified); // exact-input magnitude
            uint256 feeAmount = (ethIn * hookFeeBips) / 10000; // round down: favors swapper
            if (feeAmount > 0) {
                _collectAndForward(key.currency0, feeAmount);
                // Positive specified delta: v4 reduces the swapped-in amount by feeAmount and credits the
                // hook feeAmount on the specified currency (currency0 = ETH), cancelling the take's debt so
                // the swap settles. Fee arrives as ETH; no double-tax (afterSwap skips this shape).
                return (IHooks.beforeSwap.selector, toBeforeSwapDelta(feeAmount.toInt128(), int128(0)), feeOverride);
            }
        }

        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, feeOverride);
    }

    /**
     * @notice Collect the alignment fee on the ETH side when ETH is the UNSPECIFIED currency
     * @dev Fires ONLY for the two shapes where ETH (currency0) is unspecified — exact-output ETH buy
     *      (shape 2) and exact-input token->ETH sell (shape 3) — so the afterSwap return-delta (which v4
     *      applies to the unspecified currency) lands on ETH and settles against `take(currency0)`.
     *      When ETH is the SPECIFIED currency (shape 1 exact-in ETH buy, already taxed in beforeSwap;
     *      shape 4 exact-out ETH-out sell, untaxed by design) this is a clean NO-OP — takes nothing and
     *      returns 0 — so the swap settles and there is no double-tax.
     */
    // slither-disable-next-line reentrancy-events
    function afterSwap(
        address, /* sender — v4 passes the router/locker, not the trader; we credit the fixed benefactor */
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata
    ) external onlyPoolManager returns (bytes4, int128) {
        if (Currency.unwrap(key.currency0) != address(0)) revert PoolCurrency0MustBeNativeETH();

        // ETH (currency0) is the specified currency exactly when (amountSpecified < 0) == zeroForOne.
        // For those shapes (1 and 4) afterSwap must cleanly skip — no take, no revert.
        bool ethIsSpecified = (params.amountSpecified < 0) == params.zeroForOne;
        if (ethIsSpecified || titheHalted) {
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
     * @notice Take `feeAmount` of ETH (currency0) from the PoolManager and forward it to the vault
     * @dev Shared by beforeSwap (ETH-input buys) and afterSwap (ETH-output sells). The `take` pulls ETH
     *      to this hook (creating a currency0 debt the caller cancels via the returned delta), then the
     *      ETH is forwarded to the vault as a contribution credited to the fixed benefactor. If the vault
     *      call reverts, the ETH is queued in the hook for a later flushQueuedFees() retry.
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
     *      Without the guard a de-curated-but-healthy vault would still accept a flush, which is exactly
     *      what `LiquidityDeployerModule.flushPendingVaultCut` refuses to do with a stashed graduation
     *      cut — de-curation is supposed to stop the money reaching that vault, not just slow it down.
     */
    function flushQueuedFees() external nonReentrant {
        uint256 amount = queuedFees;
        if (amount == 0) revert NoQueuedFees();
        if (!masterRegistry.isVaultRegistered(address(vault))) revert VaultNotRegistered();
        queuedFees = 0;
        // Credit the same fixed benefactor the live afterSwap path would have — not the hook itself.
        vault.receiveContribution{ value: amount }(Currency.wrap(address(0)), amount, benefactor);
        emit QueuedFeesForwarded(amount);
    }

    /**
     * @notice Stop charging the swap tithe, once the registry says `vault` is no longer registered
     * @dev Permissionless, and gated on the registry rather than on anyone's judgement: the only way
     *      this succeeds is if the protocol owner has already retired `vault` with `deactivateVault`.
     *      Before this existed the hook kept taxing every swap into a vault that could never accept
     *      again, and 100% of the take fell into `queuedFees` with no exit (audit M-4).
     */
    function haltTithe() external {
        if (masterRegistry.isVaultRegistered(address(vault))) revert VaultStillRegistered();
        titheHalted = true;
        emit TitheHalted(address(vault));
    }

    /**
     * @notice Resume the swap tithe once `vault` is a registered vault again
     * @dev The mirror of `haltTithe`, and permissionless for the same reason. A de-registration that is
     *      reversed — a mis-click, or a vault retired and restored — must not leave the tithe off with
     *      only an owner able to turn it back on.
     */
    function resumeTithe() external {
        if (!masterRegistry.isVaultRegistered(address(vault))) revert VaultNotRegistered();
        titheHalted = false;
        emit TitheResumed(address(vault));
    }

    /**
     * @notice Forward queued fees to another registered vault, after `vault` has been retired
     * @dev The exit `queuedFees` never had. `vault` is immutable, so ETH queued against a vault whose
     *      intake closed for good — `AlignmentEndowmentVault.migratePosition` is the documented way that
     *      happens — could only ever be retried into the same dead address.
     *
     *      Deliberately NOT a sweep. The destination is not an address the owner picks freely: it must
     *      be a vault the registry currently curates, and the contribution is credited to the hook's own
     *      immutable `benefactor`, exactly as the live path credits it. So this moves the community's
     *      ETH between curated vaults and cannot move it to the owner, to the protocol treasury, or to
     *      anywhere else — the owner's discretion here is which curated vault, never whether to take it.
     *
     *      Reachable only once the protocol owner has retired `vault` and the tithe is halted, so it can
     *      never divert the tithe of a live vault, and never races a `flushQueuedFees` that would still
     *      have worked.
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
     * @notice Set LP fee rate (owner only)
     * @param _rate New LP fee rate (max LPFeeLibrary.MAX_LP_FEE = 1000000 = 100%)
     */
    function setLpFeeRate(uint24 _rate) external onlyOwner {
        if (_rate > LPFeeLibrary.MAX_LP_FEE) revert RateTooHigh();
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
