// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IUnlockCallback } from "v4-core/interfaces/callback/IUnlockCallback.sol";
import { IPoolManager } from "v4-core/interfaces/IPoolManager.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { Currency, CurrencyLibrary } from "v4-core/types/Currency.sol";
import { IHooks } from "v4-core/interfaces/IHooks.sol";
import { BalanceDelta } from "v4-core/types/BalanceDelta.sol";
import { LiquidityAmounts } from "../../libraries/v4/LiquidityAmounts.sol";
import { TickMath } from "v4-core/libraries/TickMath.sol";
import { StateLibrary } from "v4-core/libraries/StateLibrary.sol";
import { PoolId } from "v4-core/types/PoolId.sol";
import { CurrencySettler } from "../../libraries/v4/CurrencySettler.sol";
import { FixedPointMathLib } from "solady/utils/FixedPointMathLib.sol";
import { RevenueSplitLib } from "../../shared/libraries/RevenueSplitLib.sol";
import { SafeTransferLib } from "solady/utils/SafeTransferLib.sol";
import { IAlignmentVault } from "../../interfaces/IAlignmentVault.sol";
import { ILiquidityDeployerModule } from "../../interfaces/ILiquidityDeployerModule.sol";
import { IFactoryInstance } from "../../interfaces/IFactoryInstance.sol";
import { IMasterRegistry } from "../../master/interfaces/IMasterRegistry.sol";
import { Ownable } from "solady/auth/Ownable.sol";
import { IAlignmentHookFactory } from "./hooks/IAlignmentHookFactory.sol";
import { LPFeeLibrary } from "v4-core/libraries/LPFeeLibrary.sol";

/**
 * @title LiquidityDeployerModule
 * @notice Singleton contract that handles all Uniswap V4 liquidity deployment.
 *         Called externally by ERC404BondingInstance at graduation time.
 *         Owns the unlockCallback so V4 bytecode is not embedded in the instance.
 *         Pool fee and tick spacing are fixed at construction time.
 *         Graduated tokens are paired against native ETH (V4 currency address(0)).
 * @dev GRADUATION-LP PERMANENCE INVARIANT (Uni V4 venue). The V4 liquidity position minted at
 *      graduation accrues to THIS singleton module (it calls `modifyLiquidity` inside its own
 *      `unlockCallback`, settling against `address(this)`), and the module exposes NO removeLiquidity /
 *      decreaseLiquidity / burn / withdrawal entry point — the only `unlock`-driven path is the add in
 *      `deployLiquidity`. Graduation liquidity is therefore hard-locked by design on the module itself,
 *      independent of any instance. Do NOT add a path that removes or withdraws this position. Pinned by
 *      test (`test/factories/LpLockInvariant.t.sol`).
 *      NOTE: the perpetual post-graduation swap tithe to the alignment vault lives on `UniAlignmentV4Hook`
 *      wired to this venue's pool — Uni is the ONLY venue that levies it (by design); the ZAMM/Cypher
 *      graduated pools are untaxed. See docs/phases/vault-flavors.md.
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
    /// @dev Caller is not the genuine, registered ERC404 instance named in p.instance.
    error UnauthorizedCaller();
    /// @dev An attacker pre-initialized the graduation pool at a price outside tolerance.
    error PoolPriceMismatch();
    /// @dev flushPendingVaultCut called for an instance with no stashed cut.
    error NoPendingVaultCut();

    /// @notice Max deviation (bps) tolerated between an already-initialized pool's sqrtPriceX96 and
    ///         the intended graduation price. 100 bps (1%) mirrors the 99/100 LP-min-slippage
    ///         convention already used across the deployer modules. A larger gap means the pool was
    ///         seeded by a front-runner at a skewed price — we revert (retryable) rather than add
    ///         liquidity into it.
    uint256 public constant MAX_INIT_PRICE_DEVIATION_BPS = 100;

    address public immutable weth;
    IPoolManager public immutable v4PoolManager;
    uint24 public immutable poolFee;
    int24 public immutable tickSpacing;
    IMasterRegistry public immutable masterRegistry;

    string private _metadataURI;

    // ── Alignment-hook TYPE selection (117b) ─────────────────────────────────
    /// @notice The alignment-hook TYPE factory selected for graduation pools. `address(0)` (the default)
    ///         means NO hook: graduation uses the static `poolFee` with `hooks: address(0)` — byte-identical
    ///         to the pre-117b untaxed pool. When set to a factory (a deliberate governed op, NOT set at
    ///         deploy), each graduation calls `deployHook` on it to mint that pool's alignment hook and the
    ///         `PoolKey` switches to a DYNAMIC-fee pool so the hook's `beforeSwap` LP-fee override is honored.
    /// @dev GLOBAL selection — one factory for every graduation on this venue (117 spike; rth: default OFF,
    ///      global selection). Enabling the tithe = owner calls `setAlignmentHookFactory` with a factory
    ///      registered under `FeatureUtils.ALIGNMENT_HOOK`.
    address public alignmentHookFactory;

    /// @notice Hook fee in basis points forwarded to `deployHook` when a hook is wired — the immutable
    ///         ETH-side tithe baked into each graduation hook. Owner-set; inert while `alignmentHookFactory`
    ///         is `address(0)`. The production value is a HUMAN_GATE seeded from `NetworkConfig` at deploy.
    uint256 public hookFeeBips;

    /// @notice Initial dynamic LP-fee rate forwarded to `deployHook` when a hook is wired (the hook then
    ///         overrides the pool's LP fee with this via `beforeSwap`). Owner-set; inert while
    ///         `alignmentHookFactory` is `address(0)`.
    uint24 public lpFeeRate;

    /// @dev hookFeeBips exceeds 100% (mirrors UniAlignmentV4Hook's own ctor guard).
    error HookFeeTooHigh();
    /// @dev lpFeeRate exceeds LPFeeLibrary.MAX_LP_FEE (the v4 dynamic-fee ceiling).
    error LpFeeRateTooHigh();

    /// @notice The alignment-hook TYPE factory selected for graduation pools changed (address(0) = OFF).
    event AlignmentHookFactoryUpdated(address indexed factory);
    /// @notice The hook fee (bips) forwarded to newly-deployed graduation hooks changed.
    event HookFeeBipsUpdated(uint256 hookFeeBips);
    /// @notice The initial dynamic LP-fee rate forwarded to newly-deployed graduation hooks changed.
    event LpFeeRateUpdated(uint24 lpFeeRate);

    // slither-disable-next-line missing-zero-check
    constructor(address _v4PoolManager, address _weth, uint24 _poolFee, int24 _tickSpacing, address _masterRegistry) {
        v4PoolManager = IPoolManager(_v4PoolManager);
        weth = _weth;
        poolFee = _poolFee;
        tickSpacing = _tickSpacing;
        masterRegistry = IMasterRegistry(_masterRegistry);
        _initializeOwner(msg.sender);
    }

    struct AmountsResult {
        uint256 protocolFee; // 1% of raise + 1% of carve → protocol treasury
        uint256 vaultCut; // 19% of raise + 19% of carve → alignment vault
        uint256 creatorCut; // 80% of carve → creator
        uint256 carvePaid; // effective gross carve (for CreatorCarvePaid)
        uint256 ethForPool; // remainder of the raise → LP
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

    /// @dev A graduation vault cut that could not be delivered (the vault reverted on receiveContribution).
    ///      The ETH is retained in this module and re-sendable via flushPendingVaultCut. Keyed by instance
    ///      because this deployer is a singleton shared across every ERC404 graduation; the bound vault is
    ///      stored alongside the amount so a retry can only ever re-send to that same vault (no redirect
    ///      surface). Mirrors the ERC1155/721 pendingVaultCut stash — held here (the module already custodies
    ///      the graduation ETH) rather than on ERC404BondingInstance, which is near the EIP-170 ceiling.
    /// @dev INVARIANT: the sum of every pendingVaultCut[*].amount is <= address(this).balance.
    struct PendingCut {
        address vault;
        uint256 amount;
    }

    mapping(address => PendingCut) public pendingVaultCut;

    event LiquidityDeployed(address indexed pool, uint256 amountToken, uint256 amountETH);
    event GraduationFeePaid(address indexed treasury, uint256 amount);
    event GraduationVaultContribution(address indexed vault, uint256 amount);
    event CreatorCarvePaid(address indexed instance, address indexed creator, uint256 requested, uint256 paid);
    /// @notice A graduation vault cut could not be delivered and was stashed for retry.
    event VaultContributionFailed(address indexed vault, address indexed instance, uint256 amount);
    /// @notice A previously-stashed graduation vault cut was successfully re-delivered.
    event VaultContributionRetried(address indexed vault, address indexed instance, uint256 amount);
    /// @notice The vault's alignment target was revoked (`isVaultRegistered` false); the graduation tithe was
    ///         routed to `protocolTreasury` instead of the de-curated vault (noesis-126).
    event VaultCutRedirected(address indexed vault, address indexed treasury, uint256 amount);

    /**
     * @notice Deploy V4 liquidity on behalf of an ERC404BondingInstance.
     * @dev Caller must have transferred `p.tokenReserve` tokens to this contract before calling.
     *      ETH is sent as msg.value.
     * @dev `p.tokenReserve` is the pool's coin side as the CALLER sized it, and for the ERC404 bonding
     *      instance that is no longer necessarily the collection's create-time `liquidityReserve`: the
     *      instance derives it from the curve's marginal price at the supply the curve actually
     *      reached, so the pool opens at that price whether the curve sold out or stopped early
     *      (noesis-188). This module's job is unchanged — it opens the pool at `ethForPool /
     *      tokensForPool`, whatever those are.
     * @dev `p.carveEth` is every wei the caller is diverting OUT of the LP 80: the creator's requested
     *      carve, plus any LP-share ETH the caller's parity clamp could not place at the pool price.
     *      Both legs are tithed 80/19/1 here, which is the intended treatment of each. The instance
     *      emits `GraduationEthDiverted(ethToPool, excessEth, creatorCarveEth)` so the two stay
     *      separable on-chain; `CreatorCarvePaid` reports the combined figure — all creator-directed
     *      graduation ETH.
     * @param p Deployment parameters
     */
    // slither-disable-next-line reentrancy-events
    function deployLiquidity(DeployParams calldata p) external payable override {
        // Strict caller guard: only a genuine, registered ERC404 instance acting as itself may
        // deploy liquidity. For ERC404, instance == token, and the instance is the msg.sender at
        // graduation. Blocks arbitrary callers passing a crafted DeployParams.
        if (msg.sender != p.instance || !masterRegistry.isRegisteredInstance(msg.sender)) {
            revert UnauthorizedCaller();
        }
        if (msg.value != p.ethReserve) revert ETHMismatch();
        AmountsResult memory r = _computeAmounts(p);
        _setupPoolAndUnlock(p, r);
        _postUnlock(p, r);
    }

    /// @dev Sets up pool, stores callback context, performs unlock, clears context, returns liquidity.
    // slither-disable-next-line reentrancy-benign,unused-return
    function _setupPoolAndUnlock(ILiquidityDeployerModule.DeployParams calldata p, AmountsResult memory r)
        private
        returns (PoolSetupResult memory setup)
    {
        // Pair the graduated token against NATIVE ETH (currency address(0)), matching the pools that
        // zRouter.swapV4 (tokenIn=address(0)) and UniAlignmentVault trade — NOT a WETH-keyed pool,
        // which would leave the token untradeable through the standard native-ETH path. address(0) is
        // numerically smaller than any token, so ETH is always currency0.
        Currency currencyToken = Currency.wrap(p.token);
        Currency currencyETH = Currency.wrap(address(0));
        setup.token0IsThis = currencyToken < currencyETH; // false: address(0) < token

        Currency currency0 = setup.token0IsThis ? currencyToken : currencyETH;
        Currency currency1 = setup.token0IsThis ? currencyETH : currencyToken;

        uint160 sqrtPriceX96 = _computeSqrtPrice(r.ethForPool, r.tokensForPool, setup.token0IsThis);

        setup.tickLower = TickMath.minUsableTick(tickSpacing);
        setup.tickUpper = TickMath.maxUsableTick(tickSpacing);

        // Alignment-hook TYPE selection (117b). DEFAULT (`alignmentHookFactory == address(0)`): NO hook and
        // the static `poolFee` — byte-identical to the pre-117b untaxed graduation pool. When a factory IS
        // set: deploy this graduation's alignment hook and switch the pool to a DYNAMIC fee, because the
        // hook's `beforeSwap` returns `lpFeeRate | OVERRIDE_FEE_FLAG`, which v4 only honors on a dynamic-fee
        // pool (`LPFeeLibrary`). A static-fee pool would silently ignore the override. The hook carries only
        // 0xCC swap-side permission bits (no liquidity hooks), so the `modifyLiquidity` add below is
        // unaffected.
        IHooks hooks = IHooks(address(0));
        uint24 fee = poolFee;
        if (alignmentHookFactory != address(0)) {
            address hookAddr = IAlignmentHookFactory(alignmentHookFactory)
                .deployHook(IAlignmentVault(payable(p.vault)), p.instance, hookFeeBips, lpFeeRate);
            hooks = IHooks(hookAddr);
            fee = LPFeeLibrary.DYNAMIC_FEE_FLAG;
        }

        setup.poolKey =
            PoolKey({ currency0: currency0, currency1: currency1, fee: fee, tickSpacing: tickSpacing, hooks: hooks });

        // No WETH wrap/approve: the module holds native ETH (from msg.value) and settles the ETH leg
        // natively (CurrencySettler routes isAddressZero() → manager.settle{value: amount}()).
        // Idempotent init: initialize a fresh pool, or (if a front-runner pre-initialized it) accept
        // only a price within tolerance — never brick graduation on a benign pre-init, never add LP
        // into an attacker-skewed pool.
        _initOrValidatePool(setup.poolKey, sqrtPriceX96);

        uint256 amount0 = setup.token0IsThis ? r.tokensForPool : r.ethForPool;
        uint256 amount1 = setup.token0IsThis ? r.ethForPool : r.tokensForPool;

        _ctx = CallbackContext({
            poolKey: setup.poolKey,
            tickLower: setup.tickLower,
            tickUpper: setup.tickUpper,
            amount0: amount0,
            amount1: amount1,
            instance: p.instance,
            poolManager: v4PoolManager
        });

        bytes memory result = v4PoolManager.unlock(abi.encode(uint8(0)));
        delete _ctx;

        setup.liquidity = abi.decode(result, (uint128));
    }

    /// @dev Dispatches graduation fees, emits final event.
    // slither-disable-next-line arbitrary-send-eth,reentrancy-events
    function _postUnlock(ILiquidityDeployerModule.DeployParams calldata p, AmountsResult memory r) internal {
        // 1% of raise (+ 1% of carve) → protocol treasury
        if (r.protocolFee > 0 && p.protocolTreasury != address(0)) {
            SafeTransferLib.safeTransferETH(p.protocolTreasury, r.protocolFee);
            emit GraduationFeePaid(p.protocolTreasury, r.protocolFee);
        }
        // 19% of raise (+ 19% of carve) → alignment vault. Isolate the send: a reverting vault (cut below
        // MIN_CONTRIBUTION, vault at MAX_CONVERSION_PARTICIPANTS, a broken upgrade) must NOT brick
        // graduation. On failure the r.vaultCut ETH is retained in this module and stashed as
        // pendingVaultCut[p.instance] for later delivery via flushPendingVaultCut — mirroring the
        // ERC1155/721 try/catch + pending-cut retry. Graduation completes; the tithe is deferred, not lost.
        if (r.vaultCut > 0 && p.vault != address(0)) {
            // Target-revocation gate (noesis-126): if the alignment target was revoked (`isVaultRegistered`
            // false), route the tithe to `protocolTreasury` instead of feeding the de-curated vault —
            // mirroring the ERC1155/721 primary paths. forceSafeTransferETH is brick-proof (a treasury that
            // rejects ETH cannot brick graduation). For an active target, keep the try/catch + stash retry.
            if (!masterRegistry.isVaultRegistered(p.vault)) {
                SafeTransferLib.forceSafeTransferETH(p.protocolTreasury, r.vaultCut);
                emit VaultCutRedirected(p.vault, p.protocolTreasury, r.vaultCut);
            } else {
                try IAlignmentVault(payable(p.vault)).receiveContribution{ value: r.vaultCut }(
                    Currency.wrap(address(0)), r.vaultCut, p.instance
                ) {
                    emit GraduationVaultContribution(p.vault, r.vaultCut);
                } catch {
                    PendingCut storage pc = pendingVaultCut[p.instance];
                    pc.vault = p.vault;
                    pc.amount += r.vaultCut;
                    emit VaultContributionFailed(p.vault, p.instance, r.vaultCut);
                }
            }
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

    function _computeAmounts(ILiquidityDeployerModule.DeployParams calldata p)
        internal
        pure
        returns (AmountsResult memory r)
    {
        // 1/19/80 split of the raise + optional tithed creator carve (80/19/1) out of the LP 80.
        // The instance resolves the effective carve (allowance × declaredMax, pool-floor clamp);
        // splitGraduation defensively re-clamps to the LP share (minPoolEth = 0 here — the floor
        // is instance policy, the module only guarantees the pool never goes negative).
        uint256 carve = p.creator == address(0) ? 0 : p.carveEth;
        RevenueSplitLib.GraduationSplit memory g = RevenueSplitLib.splitGraduation(p.ethReserve, carve, 0);
        r.protocolFee = g.protocolCut;
        r.vaultCut = g.vaultCut;
        r.creatorCut = g.creatorCut;
        r.carvePaid = g.carveApplied;
        r.ethForPool = g.ethForPool;
        r.tokensForPool = p.tokenReserve;

        if (r.ethForPool == 0) revert NoETHForPool();
        if (r.tokensForPool == 0) revert NoTokensForPool();
    }

    function _computeSqrtPrice(uint256 ethForPool, uint256 tokensForPool, bool token0IsThis)
        internal
        pure
        returns (uint160 sqrtPriceX96)
    {
        uint256 numerator = token0IsThis ? ethForPool : tokensForPool;
        uint256 denominator = token0IsThis ? tokensForPool : ethForPool;
        uint256 priceX192 = FixedPointMathLib.fullMulDiv(numerator, 1 << 192, denominator);
        uint256 sqrtRaw = FixedPointMathLib.sqrt(priceX192);
        if (sqrtRaw > type(uint160).max) sqrtRaw = type(uint160).max;
        sqrtPriceX96 = uint160(sqrtRaw);
        if (sqrtPriceX96 < TickMath.MIN_SQRT_PRICE + 1) sqrtPriceX96 = TickMath.MIN_SQRT_PRICE + 1;
        if (sqrtPriceX96 > TickMath.MAX_SQRT_PRICE - 1) sqrtPriceX96 = TickMath.MAX_SQRT_PRICE - 1;
    }

    /// @dev Front-run-safe pool init. A fresh pool (sqrtPriceX96 == 0) is initialized at the intended
    ///      graduation price. A pool already initialized by someone else is accepted only if its price
    ///      is within MAX_INIT_PRICE_DEVIATION_BPS of intended; otherwise revert PoolPriceMismatch so
    ///      we never seed liquidity at an attacker-chosen price. (V4 `initialize` reverts on an
    ///      already-initialized pool, so the unconditional call was a permanent-DoS vector.)
    function _initOrValidatePool(PoolKey memory poolKey, uint160 intendedSqrtPriceX96) internal {
        PoolId poolId = poolKey.toId();
        (uint160 existingSqrtPriceX96,,,) = v4PoolManager.getSlot0(poolId);
        if (existingSqrtPriceX96 == 0) {
            v4PoolManager.initialize(poolKey, intendedSqrtPriceX96);
        } else {
            _requireSqrtPriceWithinTolerance(existingSqrtPriceX96, intendedSqrtPriceX96);
        }
    }

    /// @dev Reverts unless |existing - intended| / intended <= MAX_INIT_PRICE_DEVIATION_BPS / 10000.
    function _requireSqrtPriceWithinTolerance(uint160 existingSqrtPriceX96, uint160 intendedSqrtPriceX96)
        internal
        pure
    {
        uint256 diff = existingSqrtPriceX96 > intendedSqrtPriceX96
            ? existingSqrtPriceX96 - intendedSqrtPriceX96
            : intendedSqrtPriceX96 - existingSqrtPriceX96;
        if (diff * 10_000 > uint256(intendedSqrtPriceX96) * MAX_INIT_PRICE_DEVIATION_BPS) {
            revert PoolPriceMismatch();
        }
    }

    /// @notice Retry delivering a graduation vault cut that a reverting vault previously rejected.
    /// @dev Permissionless (mirrors the ERC721 flushPendingVaultCut authority model): the ETH goes to the
    ///      vault bound at stash time UNLESS that target has since been revoked, in which case the
    ///      target-revocation gate (noesis-126) redirects the tithe to `protocolTreasury` — the retry is not
    ///      a redirect-free surface, it faces the same de-curation risk as the primary graduation send. The
    ///      pending amount is zeroed BEFORE the external call (checks-effects-interactions); if the active
    ///      vault still reverts the whole transaction reverts and the stash is restored — idempotent, no ETH
    ///      is ever lost.
    /// @param instance The graduated instance whose stashed cut should be flushed.
    function flushPendingVaultCut(address instance) external {
        PendingCut memory pc = pendingVaultCut[instance];
        if (pc.amount == 0) revert NoPendingVaultCut();
        delete pendingVaultCut[instance];
        if (!masterRegistry.isVaultRegistered(pc.vault)) {
            // Target revoked while stashed: redirect the tithe to the instance's protocol treasury rather
            // than force-feed the de-curated vault. The instance's `protocolTreasury()` is the same address
            // it passed as DeployParams.protocolTreasury at graduation (MasterRegistry verifies it non-zero
            // at registration), so no per-cut treasury needs to be stashed. forceSafeTransferETH is
            // brick-proof so a non-receiving treasury cannot strand the retry.
            address treasury = IFactoryInstance(instance).protocolTreasury();
            SafeTransferLib.forceSafeTransferETH(treasury, pc.amount);
            emit VaultCutRedirected(pc.vault, treasury, pc.amount);
        } else {
            IAlignmentVault(payable(pc.vault)).receiveContribution{ value: pc.amount }(
                Currency.wrap(address(0)), pc.amount, instance
            );
            emit VaultContributionRetried(pc.vault, instance, pc.amount);
        }
    }

    /// @notice Accept ETH (needed for WETH deposits returning change, etc.)
    receive() external payable { }

    // ── IComponentModule ───────────────────────────────────────────────────────

    function metadataURI() external view override returns (string memory) {
        return _metadataURI;
    }

    function setMetadataURI(string calldata uri) external override onlyOwner {
        _metadataURI = uri;
        emit MetadataURIUpdated(uri);
    }

    // ── Alignment-hook TYPE selection setters (owner-only) ───────────────────

    /// @notice Select the alignment-hook TYPE factory used at graduation. `address(0)` = OFF (the default:
    ///         an untaxed static-fee pool). Setting a non-zero factory turns every SUBSEQUENT graduation
    ///         into a dynamic-fee pool carrying that type's freshly-deployed hook — a deliberate governed op
    ///         (enabling the perpetual swap tithe), never done at deploy.
    /// @param factory A factory registered under `FeatureUtils.ALIGNMENT_HOOK`, or `address(0)` to disable.
    function setAlignmentHookFactory(address factory) external onlyOwner {
        alignmentHookFactory = factory;
        emit AlignmentHookFactoryUpdated(factory);
    }

    /// @notice Set the hook fee (bips) forwarded to newly-deployed graduation hooks. Does not affect hooks
    ///         already deployed (each hook's fee is immutable at deploy). Max 10000 (100%).
    function setHookFeeBips(uint256 bips) external onlyOwner {
        if (bips > 10_000) revert HookFeeTooHigh();
        hookFeeBips = bips;
        emit HookFeeBipsUpdated(bips);
    }

    /// @notice Set the initial dynamic LP-fee rate forwarded to newly-deployed graduation hooks. Bounded by
    ///         the v4 dynamic-fee ceiling `LPFeeLibrary.MAX_LP_FEE`.
    function setLpFeeRate(uint24 rate) external onlyOwner {
        if (rate > LPFeeLibrary.MAX_LP_FEE) revert LpFeeRateTooHigh();
        lpFeeRate = rate;
        emit LpFeeRateUpdated(rate);
    }
}
