// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {LiquidityAmounts} from "../../libraries/v4/LiquidityAmounts.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {CurrencySettler} from "../../libraries/v4/CurrencySettler.sol";
import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";
import {RevenueSplitLib} from "../../shared/libraries/RevenueSplitLib.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {IAlignmentVault} from "../../interfaces/IAlignmentVault.sol";
import {ILiquidityDeployerModule} from "../../interfaces/ILiquidityDeployerModule.sol";
import {Ownable} from "solady/auth/Ownable.sol";

/**
 * @title LiquidityDeployerModule
 * @notice Singleton contract that handles all Uniswap V4 liquidity deployment.
 *         Called externally by ERC404BondingInstance at graduation time.
 *         Owns the unlockCallback so V4 bytecode is not embedded in the instance.
 *         Pool fee and tick spacing are fixed at construction time.
 *         Graduated tokens are paired against native ETH (V4 currency address(0)).
 */
contract LiquidityDeployerModule is IUnlockCallback, ILiquidityDeployerModule, Ownable {
    using CurrencyLibrary for Currency;
    using StateLibrary for IPoolManager;
    using CurrencySettler for Currency;
    using FixedPointMathLib for uint256;

    error ETHMismatch();
    error NoETHForPool();
    error NoTokensForPool();
    error NotPoolManager();

    address public immutable weth;
    IPoolManager public immutable v4PoolManager;
    uint24 public immutable poolFee;
    int24 public immutable tickSpacing;

    string private _metadataURI;

    // slither-disable-next-line missing-zero-check
    constructor(address _v4PoolManager, address _weth, uint24 _poolFee, int24 _tickSpacing) {
        v4PoolManager = IPoolManager(_v4PoolManager);
        weth = _weth;
        poolFee = _poolFee;
        tickSpacing = _tickSpacing;
        _initializeOwner(msg.sender);
    }

    struct AmountsResult {
        uint256 protocolFee;  // 1% of raise + 1% of carve → protocol treasury
        uint256 vaultCut;     // 19% of raise + 19% of carve → alignment vault
        uint256 creatorCut;   // 80% of carve → creator
        uint256 carvePaid;    // effective gross carve (for CreatorCarvePaid)
        uint256 ethForPool;   // remainder of the raise → LP
        uint256 tokensForPool;
    }

    struct CallbackContext {
        PoolKey poolKey;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0;
        uint256 amount1;
        address instance;
        IPoolManager poolManager;
    }

    struct PoolSetupResult {
        PoolKey poolKey;
        int24 tickLower;
        int24 tickUpper;
        bool token0IsThis;
        uint128 liquidity;
    }

    CallbackContext private _ctx;

    event LiquidityDeployed(address indexed pool, uint256 amountToken, uint256 amountETH);
    event GraduationFeePaid(address indexed treasury, uint256 amount);
    event GraduationVaultContribution(address indexed vault, uint256 amount);
    event CreatorCarvePaid(address indexed instance, address indexed creator, uint256 requested, uint256 paid);

    /**
     * @notice Deploy V4 liquidity on behalf of an ERC404BondingInstance.
     * @dev Caller must have transferred liquidityReserve tokens to this contract before calling.
     *      ETH is sent as msg.value.
     * @param p Deployment parameters
     */
    // slither-disable-next-line reentrancy-events
    function deployLiquidity(DeployParams calldata p) external payable override {
        if (msg.value != p.ethReserve) revert ETHMismatch();
        AmountsResult memory r = _computeAmounts(p);
        _setupPoolAndUnlock(p, r);
        _postUnlock(p, r);
    }

    /// @dev Sets up pool, stores callback context, performs unlock, clears context, returns liquidity.
    // slither-disable-next-line reentrancy-benign,unused-return
    function _setupPoolAndUnlock(
        ILiquidityDeployerModule.DeployParams calldata p,
        AmountsResult memory r
    ) private returns (PoolSetupResult memory setup) {
        // Pair the graduated token against NATIVE ETH (currency address(0)), matching the pools that
        // zRouter.swapV4 (tokenIn=address(0)) and UniAlignmentVault trade — NOT a WETH-keyed pool,
        // which would leave the token untradeable through the standard native-ETH path. address(0) is
        // numerically smaller than any token, so ETH is always currency0.
        Currency currencyToken = Currency.wrap(p.token);
        Currency currencyETH   = Currency.wrap(address(0));
        setup.token0IsThis = currencyToken < currencyETH; // false: address(0) < token

        Currency currency0 = setup.token0IsThis ? currencyToken : currencyETH;
        Currency currency1 = setup.token0IsThis ? currencyETH   : currencyToken;

        uint160 sqrtPriceX96 = _computeSqrtPrice(r.ethForPool, r.tokensForPool, setup.token0IsThis);

        setup.tickLower = TickMath.minUsableTick(tickSpacing);
        setup.tickUpper = TickMath.maxUsableTick(tickSpacing);

        setup.poolKey = PoolKey({
            currency0:   currency0,
            currency1:   currency1,
            fee:         poolFee,
            tickSpacing: tickSpacing,
            hooks:       IHooks(address(0))
        });

        // No WETH wrap/approve: the module holds native ETH (from msg.value) and settles the ETH leg
        // natively (CurrencySettler routes isAddressZero() → manager.settle{value: amount}()).
        // Initialize pool
        v4PoolManager.initialize(setup.poolKey, sqrtPriceX96);

        uint256 amount0 = setup.token0IsThis ? r.tokensForPool : r.ethForPool;
        uint256 amount1 = setup.token0IsThis ? r.ethForPool   : r.tokensForPool;

        _ctx = CallbackContext({
            poolKey:     setup.poolKey,
            tickLower:   setup.tickLower,
            tickUpper:   setup.tickUpper,
            amount0:     amount0,
            amount1:     amount1,
            instance:    p.instance,
            poolManager: v4PoolManager
        });

        bytes memory result = v4PoolManager.unlock(abi.encode(uint8(0)));
        delete _ctx;

        setup.liquidity = abi.decode(result, (uint128));
    }

    /// @dev Dispatches graduation fees, emits final event.
    // slither-disable-next-line arbitrary-send-eth,reentrancy-events
    function _postUnlock(
        ILiquidityDeployerModule.DeployParams calldata p,
        AmountsResult memory r
    ) private {
        // 1% of raise (+ 1% of carve) → protocol treasury
        if (r.protocolFee > 0 && p.protocolTreasury != address(0)) {
            SafeTransferLib.safeTransferETH(p.protocolTreasury, r.protocolFee);
            emit GraduationFeePaid(p.protocolTreasury, r.protocolFee);
        }
        // 19% of raise (+ 19% of carve) → alignment vault
        if (r.vaultCut > 0 && p.vault != address(0)) {
            IAlignmentVault(payable(p.vault)).receiveContribution{value: r.vaultCut}(
                Currency.wrap(address(0)), r.vaultCut, p.instance
            );
            emit GraduationVaultContribution(p.vault, r.vaultCut);
        }
        // 80% of carve → creator
        if (r.creatorCut > 0) {
            SafeTransferLib.safeTransferETH(p.creator, r.creatorCut);
        }
        if (p.carveEth > 0) {
            emit CreatorCarvePaid(p.instance, p.creator, p.carveEth, r.carvePaid);
        }

        emit LiquidityDeployed(address(v4PoolManager), r.tokensForPool, r.ethForPool);
    }

    /**
     * @notice V4 unlock callback — only callable by the pool manager stored in context.
     */
    // slither-disable-next-line timestamp,unused-return
    function unlockCallback(bytes calldata) external returns (bytes memory) {
        CallbackContext memory ctx = _ctx;
        if (msg.sender != address(ctx.poolManager)) revert NotPoolManager();

        PoolId poolId = ctx.poolKey.toId();
        (uint160 sqrtPriceX96,,,) = ctx.poolManager.getSlot0(poolId);
        uint160 sqrtPriceAX96 = TickMath.getSqrtPriceAtTick(ctx.tickLower);
        uint160 sqrtPriceBX96 = TickMath.getSqrtPriceAtTick(ctx.tickUpper);

        uint128 liq = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96, sqrtPriceAX96, sqrtPriceBX96, ctx.amount0, ctx.amount1
        );

        IPoolManager.ModifyLiquidityParams memory modifyParams = IPoolManager.ModifyLiquidityParams({
            tickLower: ctx.tickLower,
            tickUpper: ctx.tickUpper,
            liquidityDelta: int256(uint256(liq)),
            salt: keccak256(abi.encodePacked(block.timestamp, block.prevrandao))
        });

        (BalanceDelta delta,) = ctx.poolManager.modifyLiquidity(ctx.poolKey, modifyParams, "");

        int256 delta0 = delta.amount0();
        int256 delta1 = delta.amount1();

        // Settle/take against THIS module: the instance transfers the LP tokens to the module
        // (ERC404BondingInstance.deployLiquidity) and the ETH is wrapped to WETH into the module
        // (_setupPoolAndUnlock) before the unlock, so the module — not ctx.instance — holds both
        // currencies. Using address(this) makes CurrencySettler.settle pay via ERC20 `transfer`
        // (the payer==address(this) branch) instead of a `transferFrom` from an instance that no
        // longer holds the funds. Mirrors the fork-verified UniAlignmentVault._settleLPDelta.
        // Settle debts (negative delta = we owe tokens)
        if (delta0 < 0) ctx.poolKey.currency0.settle(ctx.poolManager, address(this), uint256(-delta0), false);
        if (delta1 < 0) ctx.poolKey.currency1.settle(ctx.poolManager, address(this), uint256(-delta1), false);
        // Take credits (positive delta = pool owes us dust)
        if (delta0 > 0) ctx.poolKey.currency0.take(ctx.poolManager, address(this), uint256(delta0), false);
        if (delta1 > 0) ctx.poolKey.currency1.take(ctx.poolManager, address(this), uint256(delta1), false);

        return abi.encode(liq);
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    function _computeAmounts(ILiquidityDeployerModule.DeployParams calldata p) internal pure returns (AmountsResult memory r) {
        // 1/19/80 split of the raise + optional tithed creator carve (80/19/1) out of the LP 80.
        // The instance resolves the effective carve (allowance × declaredMax, pool-floor clamp);
        // splitGraduation defensively re-clamps to the LP share (minPoolEth = 0 here — the floor
        // is instance policy, the module only guarantees the pool never goes negative).
        uint256 carve = p.creator == address(0) ? 0 : p.carveEth;
        RevenueSplitLib.GraduationSplit memory g = RevenueSplitLib.splitGraduation(p.ethReserve, carve, 0);
        r.protocolFee = g.protocolCut;
        r.vaultCut    = g.vaultCut;
        r.creatorCut  = g.creatorCut;
        r.carvePaid   = g.carveApplied;
        r.ethForPool  = g.ethForPool;
        r.tokensForPool = p.tokenReserve;

        if (r.ethForPool == 0) revert NoETHForPool();
        if (r.tokensForPool == 0) revert NoTokensForPool();
    }

    function _computeSqrtPrice(
        uint256 ethForPool,
        uint256 tokensForPool,
        bool token0IsThis
    ) internal pure returns (uint160 sqrtPriceX96) {
        uint256 numerator = token0IsThis ? ethForPool : tokensForPool;
        uint256 denominator = token0IsThis ? tokensForPool : ethForPool;
        uint256 priceX192 = FixedPointMathLib.fullMulDiv(numerator, 1 << 192, denominator);
        uint256 sqrtRaw = FixedPointMathLib.sqrt(priceX192);
        if (sqrtRaw > type(uint160).max) sqrtRaw = type(uint160).max;
        sqrtPriceX96 = uint160(sqrtRaw);
        if (sqrtPriceX96 < TickMath.MIN_SQRT_PRICE + 1) sqrtPriceX96 = TickMath.MIN_SQRT_PRICE + 1;
        if (sqrtPriceX96 > TickMath.MAX_SQRT_PRICE - 1) sqrtPriceX96 = TickMath.MAX_SQRT_PRICE - 1;
    }

    /// @notice Accept ETH (needed for WETH deposits returning change, etc.)
    receive() external payable {}

    // ── IComponentModule ───────────────────────────────────────────────────────

    function metadataURI() external view override returns (string memory) {
        return _metadataURI;
    }

    function setMetadataURI(string calldata uri) external override onlyOwner {
        _metadataURI = uri;
        emit MetadataURIUpdated(uri);
    }
}
