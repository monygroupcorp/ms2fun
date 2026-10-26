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
import { ILiquidityDeployerModule, IGraduationSkipNFTTarget } from "../../interfaces/ILiquidityDeployerModule.sol";
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
 *      The perpetual post-graduation swap tithe to the alignment vault lives on `UniAlignmentV4Hook`
 *      wired to this venue's pool. Uni is the only venue that levies it; a ZAMM graduated pool is
 *      untaxed. See docs/phases/vault-flavors.md.
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
    /// @dev The pool took less than MIN_LP_CONSUMED_BPS of one side of the LP leg.
    error InsufficientLiquidityConsumed();
    /// @dev sweepUnconsumedCoin called for an instance holding no stray coin here.
    error NoUnconsumedCoin();
    /// @dev The pool charged more for one side than the LP leg it was offered.
    error LiquidityConsumedExceedsLeg();

    /// @notice Max deviation (bps) tolerated between an already-initialized pool's price and the
    ///         intended graduation price. 100 bps (1%) matches the 99/100 LP-min-slippage convention
    ///         of the deployer modules. A larger gap means the pool was seeded by a front-runner at a
    ///         skewed price, so graduation reverts (retryable) rather than add liquidity into it.
    /// @dev The band is measured on price, which is `sqrtPriceX96` squared; see
    ///      `_requireSqrtPriceWithinTolerance`.
    uint256 public constant MAX_INIT_PRICE_DEVIATION_BPS = 100;

    /// @notice Floor (bps) on how much of each side the pool must actually take. Matches the
    ///         `a0Min/a1Min = amount * 99 / 100` floor the ZAMM module passes its venue; v4 has no
    ///         min-amount parameter, so the guarantee is asserted on the settled delta inside
    ///         `unlockCallback`.
    /// @dev Consistent with `MAX_INIT_PRICE_DEVIATION_BPS`: a pool at the edge of a 100 bps price
    ///      band leaves `d/(1+d)` = 99.01 bps of one side unconsumed, inside this floor. Widening the
    ///      band without lowering this floor makes graduation revert rather than strand capital.
    uint256 public constant MIN_LP_CONSUMED_BPS = 9900;

    address public immutable weth;
    IPoolManager public immutable v4PoolManager;
    uint24 public immutable poolFee;
    int24 public immutable tickSpacing;
    IMasterRegistry public immutable masterRegistry;

    string private _metadataURI;

    // ── Alignment-hook type selection ─────────────────────────────────────────
    /// @notice The alignment-hook type factory selected for graduation pools. `address(0)` (the default)
    ///         means no hook: graduation uses the static `poolFee` with `hooks: address(0)`, an untaxed
    ///         pool. When set, each graduation calls `deployHook` on the factory to mint that pool's
    ///         alignment hook and the `PoolKey` uses a dynamic fee so the hook's `beforeSwap` LP-fee
    ///         override is honored.
    /// @dev Global: one factory for every graduation on this venue. Set by the owner to a factory
    ///      registered under `FeatureUtils.ALIGNMENT_HOOK`.
    address public alignmentHookFactory;

    /// @notice Hook fee in basis points forwarded to `deployHook` when a hook is wired: the immutable
    ///         ETH-side tithe baked into each graduation hook. Owner-set; inert while `alignmentHookFactory`
    ///         is `address(0)`.
    uint256 public hookFeeBips;

    /// @notice Initial dynamic LP-fee rate forwarded to `deployHook` when a hook is wired (the hook then
    ///         overrides the pool's LP fee with this via `beforeSwap`). Owner-set; inert while
    ///         `alignmentHookFactory` is `address(0)`.
    uint24 public lpFeeRate;

    /// @notice Ceiling on {lpFeeRate}, in v4 fee units (hundredths of a basis point): 10_000 = 1%.
    /// @dev Equals `UniAlignmentV4Hook.MAX_CONFIGURABLE_LP_FEE`, which the deployed hook enforces. It is
    ///      restated rather than imported so this module has no compile-time dependency on one concrete
    ///      hook type; it selects hook types through `IAlignmentHookFactory`. The two are pinned to each
    ///      other by test.
    uint24 public constant MAX_LP_FEE_RATE = 10_000;

    /// @dev hookFeeBips exceeds 100% (the same guard as UniAlignmentV4Hook's constructor).
    error HookFeeTooHigh();
    /// @dev lpFeeRate exceeds {MAX_LP_FEE_RATE}, the ceiling the deployed hook enforces on itself.
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
        uint256 carvePaid; // effective gross diversion: carve + excess, post-clamp
        uint256 ethForPool; // remainder of the raise → LP
        uint256 tokensForPool;
        uint256 residueTithed; // LP ETH the venue declined, folded onto the rail here
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
        uint256 ethUsed; // ETH the pool actually settled out of r.ethForPool
        uint256 coinUsed; // coin the pool actually settled out of r.tokensForPool
    }

    CallbackContext private _ctx;

    /// @dev A graduation vault cut that could not be delivered (the vault reverted on receiveContribution).
    ///      The ETH is retained in this module and re-sendable via flushPendingVaultCut. Keyed by instance
    ///      because this deployer is a singleton shared across every ERC404 graduation; the bound vault is
    ///      stored alongside the amount so a retry can only re-send to that same vault. Held here, where
    ///      the graduation ETH is already custodied, rather than on ERC404BondingInstance, which is near
    ///      the EIP-170 size ceiling.
    /// @dev INVARIANT: the sum of every pendingVaultCut[*].amount is <= address(this).balance.
    struct PendingCut {
        address vault;
        uint256 amount;
    }

    mapping(address => PendingCut) public pendingVaultCut;

    /// @notice The alignment hook this module minted for a graduated instance, or `address(0)` where
    ///         that graduation took the default untaxed path.
    /// @dev A hooked pool's `PoolKey` names the hook, so anything that trades that pool needs the
    ///      address; recording it here avoids recomputing the factory's init-code hash or scraping
    ///      `AlignmentHookDeployed` logs. Zero marks the static-fee hookless key, non-zero the
    ///      dynamic-fee hooked one. This getter exists only on the Uni-V4 deployer; the ZAMM module has
    ///      none, so asking the wrong module reverts rather than returning zero.
    mapping(address instance => address hook) public graduationHook;

    event LiquidityDeployed(address indexed pool, uint256 amountToken, uint256 amountETH);
    /// @notice A graduation minted an alignment hook, and this instance's pool key carries it.
    /// @dev Emitted on the hooked path only; the untaxed default emits nothing, so the presence of
    ///      this topic reads as "this instance graduated into a dynamic-fee pool".
    event GraduationHookBound(address indexed instance, address indexed hook);
    event GraduationFeePaid(address indexed treasury, uint256 amount);
    event GraduationVaultContribution(address indexed vault, uint256 amount);
    /// @notice The creator's own carve. `requested` is `p.carveEth`, the amount the creator asked for,
    ///         and never includes any other diverted leg.
    event CreatorCarvePaid(address indexed instance, address indexed creator, uint256 requested, uint256 paid);
    /// @notice LP-share ETH the caller's parity clamp could not place at the pool price, tithed 80/19/1 on
    ///         the same rail as the carve. Mirrors the instance's `GraduationEthDiverted.excessEth`.
    event GraduationExcessTithed(address indexed instance, uint256 amount);
    /// @notice A graduation vault cut could not be delivered and was stashed for retry.
    event VaultContributionFailed(address indexed vault, address indexed instance, uint256 amount);
    /// @notice A stashed graduation vault cut was re-delivered.
    event VaultContributionRetried(address indexed vault, address indexed instance, uint256 amount);
    /// @notice The vault's alignment target was de-curated (`isVaultRegistered` false); the graduation
    ///         community cut was returned to the creator instead of feeding the de-curated vault.
    /// @dev INVARIANT: de-curation may destroy value; it may not transfer value to the protocol. No
    ///      `isVaultRegistered`-false branch in this contract routes to `protocolTreasury`.
    event VaultCutReturnedToCreator(address indexed vault, address indexed creator, uint256 amount);
    /// @notice A stashed vault cut was returned to the instance's creator on the retry, because the
    ///         vault's alignment target was de-curated while the cut sat pending.
    /// @dev Distinct topic from `VaultCutReturnedToCreator`, which the graduation path emits when a cut
    ///      is returned as it is earned. Only one of them is new revenue, so a tithe report seeing a
    ///      single event for both would double-count every cut that was stashed once and returned later.
    event PendingVaultCutReturnedToCreator(address indexed vault, address indexed creator, uint256 amount);
    /// @notice The LP capital the pool did not take, and where it went. `ethTithed` joined the 80/19/1
    ///         rail as a second `excessEth` leg; `ethReturned` and `coinReturned` went back to the
    ///         graduating instance.
    /// @dev Wei-scale even on a graduation into a fresh pool: `unlockCallback` fits one floored integer
    ///      liquidity to the two legs, and the pool charges what that liquidity is worth, a hair under
    ///      each leg. Materially non-zero only when the pool was already initialized at a price inside
    ///      `MAX_INIT_PRICE_DEVIATION_BPS` but not at the graduation price, where a full-range add binds
    ///      on one side.
    /// @dev `ethTithed` is its own leg on the rail, beside `CreatorCarvePaid` and
    ///      `GraduationExcessTithed`; the three sum to the graduation's whole diverted total. It is
    ///      reported here because only this module learns what the venue declined; the instance knows
    ///      only what its parity clamp could not place.
    /// @dev `ethTithed` and `ethReturned` are the same ETH under the two destinations it can have, and
    ///      never both non-zero: with a creator the residue rides the rail, and with none (a renounced
    ///      launch) it is force-transferred to the instance beside the coin. Both are zero when the
    ///      venue took the whole ETH leg and declined only coin. Only the tithed leg is revenue: a
    ///      report summing the ETH a graduation diverted adds `ethTithed` and not `ethReturned`.
    event GraduationResidueReturned(
        address indexed instance, uint256 ethTithed, uint256 ethReturned, uint256 coinReturned
    );
    /// @notice Coin swept out of this module to the instance that graduated it.
    event UnconsumedCoinSwept(address indexed instance, uint256 amount);

    /**
     * @notice Deploy V4 liquidity on behalf of an ERC404BondingInstance.
     * @dev Caller must have transferred `p.tokenReserve` tokens to this contract before calling.
     *      ETH is sent as msg.value.
     * @dev `p.tokenReserve` is the pool's coin side as the caller sized it. The ERC404 bonding instance
     *      derives it from the curve's marginal price at the supply the curve reached, so it is not
     *      necessarily the collection's create-time `liquidityReserve`. This module opens the pool at
     *      `ethForPool / tokensForPool`, whatever those are.
     * @dev `p.carveEth` and `p.excessEth` are the two legs the caller diverts out of the LP 80: the
     *      creator's requested carve, and any LP-share ETH the caller's parity clamp could not place at
     *      the pool price. Both are tithed 80/19/1 here (the split sees only their sum) and reported
     *      apart: `CreatorCarvePaid.requested` carries the creator's request alone and the residue gets
     *      its own `GraduationExcessTithed`.
     * @param p Deployment parameters
     */
    // slither-disable-next-line reentrancy-events
    function deployLiquidity(DeployParams calldata p) external payable override {
        // Only a registered ERC404 instance acting as itself may deploy liquidity (instance == token,
        // and the instance is msg.sender at graduation), so a crafted DeployParams is refused.
        if (msg.sender != p.instance || !masterRegistry.isRegisteredInstance(msg.sender)) {
            revert UnauthorizedCaller();
        }
        if (msg.value != p.ethReserve) revert ETHMismatch();

        // Name the pool manager to the graduating instance before any coin moves. The pool manager
        // receives the coin side (settled inside the `unlock` below) and holds it for the life of the
        // market; an ERC404 mints one NFT id per `unit` to an unflagged recipient, so it would take
        // the whole coin side in ids and re-mint them on every sell. The call is hard, not fail-soft:
        // an instance that cannot be told is one whose pool would take that delivery.
        IGraduationSkipNFTTarget(p.instance).markGraduationSkipNFT(address(v4PoolManager));

        AmountsResult memory r = _computeAmounts(p);
        PoolSetupResult memory setup = _setupPoolAndUnlock(p, r);
        _returnResidue(p, r, setup);
        _postUnlock(p, r);
    }

    /// @dev Gives the LP capital the pool did not take an owner in the same transaction that finds it.
    ///      The module is a singleton shared by every ERC404 graduation, so anything left here is
    ///      unattributable: it mixes with the next collection's money and the `pendingVaultCut` stash.
    ///
    ///        * ETH joins the 80/19/1 rail as a second `excessEth` leg, like the LP-share ETH the
    ///          instance's own parity clamp could not place (`ERC404BondingOps.deployLiquidity`).
    ///          `_titheResidue` re-runs the split with the residue folded into the diverted legs, so
    ///          the figures `_postUnlock` pays out account for it.
    ///        * Coin goes back to the graduating instance, the only address with a claim on it. The
    ///          instance's skipNFT is set at `_initializeDN404`, so this mints it no ids.
    ///
    ///      This is not a removal path. The LP position has no exit; only what never entered the pool
    ///      moves. `test/factories/LpLockInvariant.t.sol` pins that by probing for removal-shaped
    ///      selectors.
    ///
    ///      With no creator the rail has no 80 leg to pay, so the ETH follows the coin to the instance
    ///      rather than staying in the singleton.
    function _returnResidue(
        ILiquidityDeployerModule.DeployParams calldata p,
        AmountsResult memory r,
        PoolSetupResult memory setup
    ) private {
        uint256 ethResidue = r.ethForPool - setup.ethUsed;
        uint256 coinResidue = r.tokensForPool - setup.coinUsed;

        if (ethResidue != 0) {
            if (p.creator == address(0)) {
                SafeTransferLib.forceSafeTransferETH(p.instance, ethResidue);
            } else {
                _titheResidue(p, r, ethResidue);
            }
        }
        if (coinResidue != 0) {
            SafeTransferLib.safeTransfer(p.token, p.instance, coinResidue);
        }
        if (ethResidue != 0 || coinResidue != 0) {
            bool renounced = p.creator == address(0);
            emit GraduationResidueReturned(
                p.instance, renounced ? 0 : ethResidue, renounced ? ethResidue : 0, coinResidue
            );
        }
        // `r` describes the pool as delivered, not as sized: `LiquidityDeployed` is what indexers read
        // for the pool's opening depth. `_titheResidue` already lands `ethForPool` on this value;
        // the no-creator branch does not.
        r.ethForPool = setup.ethUsed;
        r.tokensForPool = setup.coinUsed;
    }

    /// @dev Re-runs the graduation split with `residueEth` added to the diverted legs, so every figure
    ///      `_postUnlock` pays is computed against the ETH the pool took. The residue rides the rail
    ///      because it is LP-share ETH: the 1% and 19% legs are levied on the full raise and the 80 is
    ///      the creator's, whatever price the pool was initialized at.
    function _titheResidue(ILiquidityDeployerModule.DeployParams calldata p, AmountsResult memory r, uint256 residueEth)
        private
        pure
    {
        RevenueSplitLib.GraduationSplit memory g =
            RevenueSplitLib.splitGraduation(p.ethReserve, p.carveEth + p.excessEth + residueEth, 0);
        r.protocolFee = g.protocolCut;
        r.vaultCut = g.vaultCut;
        r.creatorCut = g.creatorCut;
        r.carvePaid = g.carveApplied;
        r.ethForPool = g.ethForPool;
        r.residueTithed = residueEth;
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

        // With no `alignmentHookFactory` the pool has no hook and the static `poolFee`. With one, this
        // graduation's alignment hook is deployed and the pool uses a dynamic fee, because the hook's
        // `beforeSwap` returns `lpFeeRate | OVERRIDE_FEE_FLAG`, which v4 honors only on a dynamic-fee
        // pool (`LPFeeLibrary`). The hook carries only 0xCC swap-side permission bits (no liquidity
        // hooks), so the `modifyLiquidity` add below is unaffected.
        IHooks hooks = IHooks(address(0));
        uint24 fee = poolFee;
        if (alignmentHookFactory != address(0)) {
            // The hook binds the whole `PoolKey` it serves, so it is told the pool here, before the key
            // is assembled: `p.token` is the pool's `currency1` and `tickSpacing` this module's
            // immutable. Both are part of the hook's init-code hash, so the pool is part of the hook's
            // identity.
            address hookAddr = IAlignmentHookFactory(alignmentHookFactory)
                .deployHook(IAlignmentVault(payable(p.vault)), p.instance, hookFeeBips, lpFeeRate, p.token, tickSpacing);
            hooks = IHooks(hookAddr);
            fee = LPFeeLibrary.DYNAMIC_FEE_FLAG;
            // The key's other members are public (the currencies, `tickSpacing`, and a fee that is
            // `DYNAMIC_FEE_FLAG` exactly when this is non-zero); the hook is recorded so the pool can
            // be named and traded.
            graduationHook[p.instance] = hookAddr;
            emit GraduationHookBound(p.instance, hookAddr);
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

        (uint128 liq, uint256 used0, uint256 used1) = abi.decode(result, (uint128, uint256, uint256));
        setup.liquidity = liq;
        (setup.ethUsed, setup.coinUsed) = setup.token0IsThis ? (used1, used0) : (used0, used1);
    }

    /// @dev Dispatches graduation fees, emits final event.
    // slither-disable-next-line arbitrary-send-eth,reentrancy-events
    function _postUnlock(ILiquidityDeployerModule.DeployParams calldata p, AmountsResult memory r) internal {
        // 1% of raise (+ 1% of carve) → protocol treasury
        if (r.protocolFee > 0 && p.protocolTreasury != address(0)) {
            SafeTransferLib.safeTransferETH(p.protocolTreasury, r.protocolFee);
            emit GraduationFeePaid(p.protocolTreasury, r.protocolFee);
        }
        // 19% of raise (+ 19% of carve) → alignment vault. The send is isolated: a reverting vault (cut
        // below MIN_CONTRIBUTION, vault at MAX_CONVERSION_PARTICIPANTS, a broken upgrade) must not
        // brick graduation. On failure the r.vaultCut ETH stays in this module, stashed as
        // pendingVaultCut[p.instance] for delivery via flushPendingVaultCut.
        if (r.vaultCut > 0 && p.vault != address(0)) {
            // De-curation gate: if the alignment target was revoked (`isVaultRegistered` false), the
            // community cut folds into the creator leg instead of feeding the de-curated vault.
            // INVARIANT: de-curation may destroy value; it may not transfer value to the protocol, so
            // this branch never routes to `protocolTreasury`. The fold moves whatever `vaultCut`
            // resolved to, and the creator leg below force-transfers so the fold cannot brick it.
            if (!masterRegistry.isVaultRegistered(p.vault)) {
                r.creatorCut += r.vaultCut;
                emit VaultCutReturnedToCreator(p.vault, p.creator, r.vaultCut);
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
        // 80% of carve → creator, plus any community cut folded in by the de-curation gate above.
        // Force-transfer: a creator contract that rejects ETH cannot brick graduation.
        if (r.creatorCut > 0) {
            SafeTransferLib.forceSafeTransferETH(p.creator, r.creatorCut);
        }
        // The diverted legs, reported apart. `r.carvePaid` is the post-clamp figure for their sum;
        // attribution is carve-first (the creator's request is met first and the clamp residue absorbs
        // any squeeze), so the emitted figures sum to `r.carvePaid` exactly. A squeeze cannot arise on
        // the ERC404 graduation path (the instance sizes the legs so their sum is `lp - ethForPool`,
        // inside `splitGraduation`'s headroom).
        if (p.carveEth > 0) {
            emit CreatorCarvePaid(
                p.instance, p.creator, p.carveEth, r.carvePaid < p.carveEth ? r.carvePaid : p.carveEth
            );
        }
        // The caller's clamp residue: `r.carvePaid` less the carve and less the residue this module
        // found itself. Three legs ride the rail and each event reports the one its layer can see;
        // `GraduationResidueReturned` carries the venue-declined leg, so the three sum to
        // `r.carvePaid` with no double-count. Guarded rather than subtracted blind: with
        // `p.creator == address(0)` the split zeroes the carve while `p.carveEth` still carries the
        // request (pinned by `test_deployLiquidity_carve_zeroCreatorZeroesCarve`).
        uint256 diverted = p.carveEth + r.residueTithed;
        if (r.carvePaid > diverted) {
            emit GraduationExcessTithed(p.instance, r.carvePaid - diverted);
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

        // What the pool charges per side, before anything is paid. `getLiquidityForAmounts` fits one
        // liquidity figure to both legs by taking `min(L0, L1)` at the live price, so on a pool
        // initialized away from the graduation price one leg binds and the other is over-supplied. A
        // negative delta is a debt about to be settled (the consumption); a positive delta is credit
        // handed back and is not consumed.
        uint256 used0 = delta0 < 0 ? uint256(-delta0) : 0;
        uint256 used1 = delta1 < 0 ? uint256(-delta1) : 0;

        // Slippage floor: v4 has no min-amount parameter, and ZAMM passes `amount * 99 / 100` mins to
        // its venue, so the same floor is asserted directly on the delta.
        if (used0 * 10_000 < ctx.amount0 * MIN_LP_CONSUMED_BPS || used1 * 10_000 < ctx.amount1 * MIN_LP_CONSUMED_BPS) {
            revert InsufficientLiquidityConsumed();
        }
        // Ceiling: the sibling modules' venues pull through an approval or `msg.value`, so they cannot
        // be charged past the leg offered. This module settles by direct transfer out of a balance that
        // also holds the fee legs and the `pendingVaultCut` stash, so an overcharge would be paid out of
        // other money. `getLiquidityForAmounts` floors the liquidity, so a correct pool cannot reach
        // this; the explicit revert replaces an arithmetic panic.
        if (used0 > ctx.amount0 || used1 > ctx.amount1) revert LiquidityConsumedExceedsLeg();

        // Both checks precede the settle: they are conditions on the trade, and a module that has
        // already paid an overcharge has nothing left to refuse with.
        //
        // Settle/take against this module: the instance transfers the LP tokens to the module
        // (ERC404BondingInstance.deployLiquidity) and the ETH arrives as msg.value, so the module, not
        // ctx.instance, holds both currencies. Using address(this) makes CurrencySettler.settle pay
        // via ERC20 `transfer` instead of a `transferFrom` from an instance that no longer holds the
        // funds.
        // Settle debts (negative delta = we owe tokens)
        if (delta0 < 0) ctx.poolKey.currency0.settle(ctx.poolManager, address(this), used0, false);
        if (delta1 < 0) ctx.poolKey.currency1.settle(ctx.poolManager, address(this), used1, false);
        // Take credits (positive delta = pool owes us dust)
        if (delta0 > 0) ctx.poolKey.currency0.take(ctx.poolManager, address(this), uint256(delta0), false);
        if (delta1 > 0) ctx.poolKey.currency1.take(ctx.poolManager, address(this), uint256(delta1), false);

        return abi.encode(liq, used0, used1);
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    function _computeAmounts(ILiquidityDeployerModule.DeployParams calldata p)
        internal
        pure
        returns (AmountsResult memory r)
    {
        // 1/19/80 split of the raise + the tithed diversions (80/19/1) out of the LP 80. Both diverted
        // legs ride the same rail, so the split's input is their sum and every downstream figure is
        // independent of how the caller apportioned them. The instance resolves the effective carve
        // (allowance × declaredMax, pool-floor clamp); splitGraduation defensively re-clamps to the LP
        // share (minPoolEth = 0 here — the floor is instance policy, the module only guarantees the
        // pool never goes negative).
        uint256 carve = p.creator == address(0) ? 0 : p.carveEth + p.excessEth;
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
    ///      we never seed liquidity at an attacker-chosen price. V4 `initialize` reverts on an
    ///      already-initialized pool, so an unconditional call would be a permanent-DoS vector.
    function _initOrValidatePool(PoolKey memory poolKey, uint160 intendedSqrtPriceX96) internal {
        PoolId poolId = poolKey.toId();
        (uint160 existingSqrtPriceX96,,,) = v4PoolManager.getSlot0(poolId);
        if (existingSqrtPriceX96 == 0) {
            v4PoolManager.initialize(poolKey, intendedSqrtPriceX96);
        } else {
            _requireSqrtPriceWithinTolerance(existingSqrtPriceX96, intendedSqrtPriceX96);
        }
    }

    /// @dev Reverts unless the existing pool's PRICE is within MAX_INIT_PRICE_DEVIATION_BPS of the
    ///      intended graduation price.
    ///
    ///      Measured on price, not on `sqrtPriceX96`: price decides how much of each side the pool
    ///      takes, and a band applied to the root would be about twice as wide as its label. The
    ///      unconsumed side is `d/(1+d)` of its leg.
    ///
    ///      The deviation on price is `|e² − i²| / i² = diff·sum / i²`, and both `diff·sum` and `i²`
    ///      overflow `uint256` at the top of the `uint160` range, so the comparison is taken one
    ///      division early: `(diff·sum / i)·10000 <= i·bps`. `fullMulDiv` carries the intermediate at
    ///      512 bits, so the only rounding is that single floor — worth at most one wei of
    ///      `sqrtPriceX96` on the accepting side of a band measured in whole basis points.
    function _requireSqrtPriceWithinTolerance(uint160 existingSqrtPriceX96, uint160 intendedSqrtPriceX96)
        internal
        pure
    {
        uint256 diff = existingSqrtPriceX96 > intendedSqrtPriceX96
            ? existingSqrtPriceX96 - intendedSqrtPriceX96
            : intendedSqrtPriceX96 - existingSqrtPriceX96;
        uint256 sum = uint256(existingSqrtPriceX96) + intendedSqrtPriceX96;
        uint256 deviation = FixedPointMathLib.fullMulDiv(diff, sum, intendedSqrtPriceX96);
        if (deviation * 10_000 > uint256(intendedSqrtPriceX96) * MAX_INIT_PRICE_DEVIATION_BPS) {
            revert PoolPriceMismatch();
        }
    }

    /// @notice Retry delivering a graduation vault cut that a reverting vault rejected.
    /// @dev Permissionless. The ETH goes to the vault bound at stash time unless that target has been
    ///      de-curated, in which case the cut returns to the instance's creator, as on the primary send.
    ///      The pending amount is zeroed before the external call (checks-effects-interactions); if the
    ///      active vault still reverts the whole transaction reverts and the stash is restored.
    /// @param instance The graduated instance whose stashed cut should be flushed.
    function flushPendingVaultCut(address instance) external {
        PendingCut memory pc = pendingVaultCut[instance];
        if (pc.amount == 0) revert NoPendingVaultCut();
        delete pendingVaultCut[instance];
        if (!masterRegistry.isVaultRegistered(pc.vault)) {
            // Target de-curated while stashed: the cut returns to the instance's creator, never to the
            // treasury. The creator is the instance's `owner()`, the address the primary graduation
            // leg pays as `DeployParams.creator`, so `PendingCut` needs no creator field.
            // forceSafeTransferETH keeps a creator that rejects ETH from stranding the retry.
            address creator = IFactoryInstance(instance).owner();
            SafeTransferLib.forceSafeTransferETH(creator, pc.amount);
            emit PendingVaultCutReturnedToCreator(pc.vault, creator, pc.amount);
        } else {
            IAlignmentVault(payable(pc.vault)).receiveContribution{ value: pc.amount }(
                Currency.wrap(address(0)), pc.amount, instance
            );
            emit VaultContributionRetried(pc.vault, instance, pc.amount);
        }
    }

    /// @notice Send an instance's coin sitting in this module back to that instance.
    /// @dev Backstop behind `_returnResidue` for coin a venue leaves here by a route the in-transaction
    ///      return does not see. Coin only, with no destination parameter:
    ///
    ///        * Permissionless and undirected. For ERC404 the instance is the token, so `instance`'s
    ///          coin can only go to `instance`; a caller chooses nothing, so no owner is trusted.
    ///        * No ETH. The module custodies live graduation ETH and the `pendingVaultCut` stash,
    ///          whose invariant is that the sum of every pending amount is covered by this balance.
    ///          ETH residue is routed in transaction instead.
    ///        * Not a removal path. The graduation LP position lives in the pool manager, not as a
    ///          coin balance here. Pinned by `LpLockInvariant.t.sol`.
    /// @param instance The graduated ERC404 instance, which is also its own token.
    function sweepUnconsumedCoin(address instance) external {
        uint256 amount = SafeTransferLib.balanceOf(instance, address(this));
        if (amount == 0) revert NoUnconsumedCoin();
        SafeTransferLib.safeTransfer(instance, instance, amount);
        emit UnconsumedCoinSwept(instance, amount);
    }

    /// @notice Accept ETH.
    receive() external payable { }

    // ── IComponentModule ───────────────────────────────────────────────────────

    function metadataURI() external view override returns (string memory) {
        return _metadataURI;
    }

    function setMetadataURI(string calldata uri) external override onlyOwner {
        _metadataURI = uri;
        emit MetadataURIUpdated(uri);
    }

    // ── Alignment-hook type selection setters (owner-only) ───────────────────

    /// @notice Select the alignment-hook type factory used at graduation. `address(0)` = off (an
    ///         untaxed static-fee pool). A non-zero factory makes every later graduation a dynamic-fee
    ///         pool carrying that type's freshly-deployed hook, enabling the perpetual swap tithe.
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

    /// @notice Set the initial dynamic LP-fee rate forwarded to newly-deployed graduation hooks.
    /// @dev Bounded by {MAX_LP_FEE_RATE}, the same ceiling `UniAlignmentV4Hook` enforces on itself, and
    ///      NOT by the v4 dynamic-fee ceiling `LPFeeLibrary.MAX_LP_FEE`. The hook's constructor refuses a
    ///      higher initial rate, so without this guard a rate above the ceiling would revert
    ///      `deployHook`, and with it every graduation.
    function setLpFeeRate(uint24 rate) external onlyOwner {
        if (rate > MAX_LP_FEE_RATE) revert LpFeeRateTooHigh();
        lpFeeRate = rate;
        emit LpFeeRateUpdated(rate);
    }
}
