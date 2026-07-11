// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable } from "solady/auth/Ownable.sol";
import { ReentrancyGuard } from "solady/utils/ReentrancyGuard.sol";
import { FixedPointMathLib } from "solady/utils/FixedPointMathLib.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { IAlignmentVault } from "../../interfaces/IAlignmentVault.sol";
import { IVaultPriceValidator } from "../../interfaces/IVaultPriceValidator.sol";
import { IAlignmentRegistry } from "../../master/interfaces/IAlignmentRegistry.sol";
import {
    IAlgebraFactory,
    IAlgebraPool,
    IAlgebraNFTPositionManager,
    IAlgebraSwapRouter
} from "../../interfaces/algebra/IAlgebra.sol";
import { BestRouteAcquirer } from "../../shared/libraries/BestRouteAcquirer.sol";

interface IWETH9 {
    function deposit() external payable;
    function withdraw(uint256 wad) external;
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

/// @title CypherAlignmentVault
/// @notice Algebra (Cypher AMM) external-target alignment vault. Accumulates the alignment tithe as
///         spendable pending ETH, then — on a permissionless `convertAndAddLiquidity` — acquires the
///         external alignment target with part of that ETH and LPs target/WETH into a user-chosen
///         Algebra pool it resolves or creates. Both the seed price of a fresh pool and the swap floor
///         are derived from the canonical `ReferencePool` TWAP (owner-pinned, deep, unmanipulable) —
///         never from the LP pool's own (thin/manipulable) spot. Holds ONE alignment LP position NFT;
///         repeat converts aggregate into it via `increaseLiquidity` (never a second NFT). Fees are
///         collected from that position, swapped to ETH, and distributed via a MasterChef accumulator.
contract CypherAlignmentVault is IAlignmentVault, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Errors ────────────────────────────────────────────────────────────
    error VaultAlreadyInitialized();
    error ETHOnly();
    error NoPosition();
    error ZeroContributions();
    error NoPendingETH();
    error NotDelegate();
    error TransferFailed();
    error ExceedsMaxBps();
    /// @dev Init: the alignment target is inactive in the registry.
    error TargetNotActive();
    /// @dev Init: the alignment token is not a member of the alignment target.
    error TokenNotInTarget();
    /// @dev Convert/harvest: no canonical ReferencePool is pinned for this (target, token) — the price
    ///      authority is missing, so the vault refuses to seed/floor at a guessed price.
    error NoReferencePool();
    /// @dev Convert: the resolved LP pool's spot price is off vs the canonical reference beyond
    ///      `maxPriceDeviationBps` — the pool was pushed/manipulated; retry once it re-converges.
    error LpPoolPriceDeviation();
    /// @dev Convert: the registry's acquire route for this target is not the Algebra venue.
    error WrongAcquireVenue();
    /// @dev setLpPool: the override pool is zero, is not the canonical `poolByPair(token, weth)`, or a
    ///      position is already open (repointing after a mint would orphan the existing NFT).
    error InvalidLpPool();

    // ── Events ────────────────────────────────────────────────────────────
    event LiquidityAdded(uint256 ethSwapped, uint256 targetReceived, uint256 lpPositionValue, uint256 tokenId);
    event Harvested(uint256 totalFeesETH, uint256 benefactorFees, uint256 protocolFees);
    event DelegateSet(address indexed benefactor, address indexed delegate);
    event ProtocolYieldCutUpdated(uint256 newBps);
    event ProtocolFeesWithdrawn(uint256 amount);
    event PriceValidatorUpdated(address indexed validator);
    event MaxPriceDeviationUpdated(uint256 newBps);
    event PoolResolved(address indexed pool, bool tokenIsZero, bool created);
    event LpPoolOverridden(address indexed pool, bool tokenIsZero, bool empty);

    // ── Full-range ticks (Algebra tick spacing 60: floor(887272/60)*60 = 887220) ──
    int24 public constant TICK_LOWER = -887220;
    int24 public constant TICK_UPPER = 887220;

    // ── Config ────────────────────────────────────────────────────────────
    IAlgebraNFTPositionManager public positionManager;
    IAlgebraSwapRouter public swapRouter;
    address public algebraFactory;
    address public weth;
    /// @notice The EXTERNAL alignment target token this vault acquires and LPs.
    address public alignmentToken;
    address public protocolTreasury;

    // ── Acquisition routing (Front 2: best-route + Algebra fallback) ────────
    address public zRouter;
    address public zQuoter;

    // ── Alignment target binding (set once at initialize) ───────────────────
    IAlignmentRegistry public alignmentRegistry;
    uint256 public alignmentTargetId;

    // ── LP position (the vault's OWN alignment position) ───────────────────
    uint256 public lpTokenId; // NFT position token ID (0 = not yet minted)
    address public lpPool; // Algebra target/WETH pool address
    bool public tokenIsZero; // true if alignmentToken < weth (token0 in pool)
    /// @notice Set true by {setLpPool}: the owner has explicitly vetted/accepted `lpPool` as the LP
    ///         venue, so `convertAndAddLiquidity` sizes against its live spot and SKIPS the
    ///         reference-deviation revert. The escape hatch that stops a permissionlessly-created,
    ///         off-price Algebra pool (create/initialize is open to anyone) from permanently bricking
    ///         convert — the collection's tithe can never be stranded behind a griefed pool.
    bool public lpPoolOwnerSet;

    // ── Spendable pending ETH (the accumulated tithe awaiting conversion) ───
    uint256 public totalPendingETH;

    // ── Economics ─────────────────────────────────────────────────────────
    uint256 public protocolYieldCutBps; // default 100 (1%)

    // ── Price-manipulation guard (reference-derived floor + LP-pool deviation) ──
    IVaultPriceValidator public priceValidator;
    uint256 public maxPriceDeviationBps; // default 500 (5%)

    // ── Fee buckets ───────────────────────────────────────────────────────
    uint256 public accumulatedProtocolFees;
    uint256 public _totalAccumulatedFees;

    // ── MasterChef accumulator ────────────────────────────────────────────
    uint256 public totalContributions;
    uint256 public accRewardPerContribution; // 1e18 scaled
    mapping(address => uint256) public benefactorContribution;
    mapping(address => uint256) public rewardDebt;

    // ── Delegation ────────────────────────────────────────────────────────
    mapping(address => address) public _benefactorDelegate;

    // ── Clone guard ───────────────────────────────────────────────────────
    bool private _initialized;

    // ── Init ──────────────────────────────────────────────────────────────

    function initialize(
        address _positionManager,
        address _swapRouter,
        // slither-disable-next-line missing-zero-check
        address _algebraFactory,
        // slither-disable-next-line missing-zero-check
        address _weth,
        // slither-disable-next-line missing-zero-check
        address _alignmentToken,
        // slither-disable-next-line missing-zero-check
        address _protocolTreasury,
        // slither-disable-next-line missing-zero-check
        address _zRouter,
        // slither-disable-next-line missing-zero-check
        address _zQuoter,
        // slither-disable-next-line missing-zero-check
        address _priceValidator,
        IAlignmentRegistry _alignmentRegistry,
        uint256 _alignmentTargetId
    ) external {
        if (_initialized) revert VaultAlreadyInitialized();
        _initialized = true;

        // D3 — registry validation: the target must be active and the token a member of it, or the
        // vault would acquire/LP a token the platform never approved for this alignment target.
        if (address(_alignmentRegistry) == address(0)) revert TargetNotActive();
        if (!_alignmentRegistry.isAlignmentTargetActive(_alignmentTargetId)) revert TargetNotActive();
        if (!_alignmentRegistry.isTokenInTarget(_alignmentTargetId, _alignmentToken)) revert TokenNotInTarget();

        positionManager = IAlgebraNFTPositionManager(_positionManager);
        swapRouter = IAlgebraSwapRouter(_swapRouter);
        algebraFactory = _algebraFactory;
        weth = _weth;
        alignmentToken = _alignmentToken;
        protocolTreasury = _protocolTreasury;
        zRouter = _zRouter;
        zQuoter = _zQuoter;
        alignmentRegistry = _alignmentRegistry;
        alignmentTargetId = _alignmentTargetId;
        protocolYieldCutBps = 100;
        maxPriceDeviationBps = 500;
        priceValidator = IVaultPriceValidator(_priceValidator);

        _initializeOwner(msg.sender);
    }

    // ── Receive ───────────────────────────────────────────────────────────

    /// @dev Bare receive: accepts WETH unwrap proceeds and swap-dust refunds during a vault operation
    ///      without crediting them as contributions (contributions arrive only via receiveContribution).
    receive() external payable { }

    function receiveContribution(Currency currency, uint256 amount, address benefactor) external payable override {
        if (Currency.unwrap(currency) != address(0)) revert ETHOnly();
        if (benefactor == address(0) || msg.value == 0) return;
        // Credit MasterChef fee weight AND accumulate spendable pending ETH so the tithe is convertible
        // into the alignment LP (the corrected D1 invariant: no tithe ETH is left unspendable).
        _addContribution(benefactor, msg.value);
        totalPendingETH += msg.value;
        emit ContributionReceived(benefactor, msg.value);
    }

    function _addContribution(address benefactor, uint256 amount) internal {
        // Snapshot debt for new contribution amount (MasterChef pattern)
        rewardDebt[benefactor] += amount * accRewardPerContribution / 1e18; // round down: benefactor cannot over-claim
        benefactorContribution[benefactor] += amount;
        totalContributions += amount;
    }

    // ── Convert & add liquidity ─────────────────────────────────────────────

    /// @notice Acquire the alignment target with part of the pending ETH and LP target/WETH into the
    ///         user-chosen Algebra pool, all priced from the canonical reference. Permissionless.
    /// @param minOutTarget Caller's minimum alignment tokens out for the acquire swap (floored to an
    ///        oracle-derived value so a loose bound cannot sandwich the vault's own ETH->token swap).
    /// @return lpPositionValue ethSwapped + targetReceived deployed this convert.
    // slither-disable-next-line reentrancy-benign,reentrancy-eth
    function convertAndAddLiquidity(uint256 minOutTarget) external nonReentrant returns (uint256 lpPositionValue) {
        uint256 pending = totalPendingETH;
        if (pending == 0) revert NoPendingETH();

        // (a) Reference price — the sole price authority (deep, owner-pinned, unmanipulable TWAP).
        uint256 ethPerToken = _referenceEthPerToken();
        uint160 referenceSqrtPrice = _deriveReferenceSqrtPrice(ethPerToken);

        // (b) Resolve/create the LP pool; a fresh pool is seeded at the REFERENCE price, an existing
        //     one is accepted only within maxPriceDeviationBps of it. `validatedSqrtPrice` is the price
        //     the swap proportion is sized against (reference for a fresh/just-seeded pool).
        uint160 validatedSqrtPrice = _resolveOrCreatePool(referenceSqrtPrice);

        // (c) Proportion of ETH to swap vs. hold for LP (027a venue-agnostic core). ethIsCurrency0 is
        //     true iff WETH sorts below the alignment token (WETH is token0 of the Algebra pool).
        uint256 proportion = priceValidator.calculateSwapProportionFromSqrtPrice(
            alignmentToken, TICK_LOWER, TICK_UPPER, validatedSqrtPrice, weth < alignmentToken
        );
        uint256 ethToSwap = pending * proportion / 1e18; // round down: excess stays as ethForLP

        // (d) Acquire — sanity-assert the registry route is Algebra, floor the min-out via the
        //     canonical reference, then best-route (zQuoter) with an Algebra fixed-pool fallback.
        if (
            alignmentRegistry.getAcquireRoute(alignmentTargetId, alignmentToken).venue
                != IAlignmentRegistry.Venue.ALGEBRA
        ) {
            revert WrongAcquireVenue();
        }
        uint256 flooredMinOut = _floorTargetOut(ethToSwap, minOutTarget);
        uint256 targetReceived = BestRouteAcquirer.acquireViaAlgebra(
            zRouter, zQuoter, alignmentToken, ethToSwap, flooredMinOut, address(swapRouter), weth, block.timestamp
        );

        // (e) LP — first convert mints ONE full-range NFT; every later convert aggregates into it.
        uint256 ethForLP = pending - ethToSwap;
        uint256 wethUsed = _addToPosition(targetReceived, ethForLP);

        // (f) D1 residual — unabsorbed ETH (WETH not taken by the LP add) returns to pending so no
        //     tithe ETH is ever left unspendable. The swap leg (ethToSwap) is fully consumed.
        totalPendingETH = ethForLP - wethUsed;

        lpPositionValue = ethToSwap + targetReceived;
        emit LiquidityAdded(ethToSwap, targetReceived, lpPositionValue, lpTokenId);
    }

    /// @dev Wrap `ethForLP` to WETH and add (target, WETH) into the vault's single alignment position:
    ///      mint on the first convert (stores `lpTokenId`), `increaseLiquidity` on every later one.
    ///      Returns the WETH actually pulled by the position manager (for residual accounting). Leftover
    ///      target dust remains as tokens in the vault.
    // slither-disable-next-line reentrancy-benign
    function _addToPosition(uint256 targetAmount, uint256 ethForLP) private returns (uint256 wethUsed) {
        IWETH9(weth).deposit{ value: ethForLP }();
        IERC20(alignmentToken).forceApprove(address(positionManager), targetAmount);
        IWETH9(weth).approve(address(positionManager), ethForLP);

        (uint256 amount0Desired, uint256 amount1Desired) =
            tokenIsZero ? (targetAmount, ethForLP) : (ethForLP, targetAmount);

        uint256 used0;
        uint256 used1;
        if (lpTokenId == 0) {
            (address token0, address token1) = tokenIsZero ? (alignmentToken, weth) : (weth, alignmentToken);
            (uint256 tokenId,, uint256 a0, uint256 a1) = positionManager.mint(
                IAlgebraNFTPositionManager.MintParams({
                    token0: token0,
                    token1: token1,
                    deployer: address(0),
                    tickLower: TICK_LOWER,
                    tickUpper: TICK_UPPER,
                    amount0Desired: amount0Desired,
                    amount1Desired: amount1Desired,
                    amount0Min: 0,
                    amount1Min: 0,
                    recipient: address(this),
                    deadline: block.timestamp
                })
            );
            lpTokenId = tokenId;
            (used0, used1) = (a0, a1);
        } else {
            (, uint256 a0, uint256 a1) = positionManager.increaseLiquidity(
                IAlgebraNFTPositionManager.IncreaseLiquidityParams({
                    tokenId: lpTokenId,
                    amount0Desired: amount0Desired,
                    amount1Desired: amount1Desired,
                    amount0Min: 0,
                    amount1Min: 0,
                    deadline: block.timestamp
                })
            );
            (used0, used1) = (a0, a1);
        }

        wethUsed = tokenIsZero ? used1 : used0;
        // Return any WETH the position manager did not pull back to native ETH for the pending balance.
        uint256 leftoverWeth = ethForLP - wethUsed;
        if (leftoverWeth > 0) IWETH9(weth).withdraw(leftoverWeth);
    }

    /// @dev Resolve the target/WETH Algebra pool, creating and seeding it at the reference price when
    ///      absent (or when present-but-uninitialized). An already-initialized pool is accepted only
    ///      within `maxPriceDeviationBps` of the reference. Sets `lpPool`/`tokenIsZero`. Returns the
    ///      sqrtPrice the swap proportion should be sized against (reference for a fresh/seeded pool).
    // slither-disable-next-line reentrancy-benign
    function _resolveOrCreatePool(uint160 referenceSqrtPrice) private returns (uint160 validatedSqrtPrice) {
        bool created;
        address pool = lpPool;
        if (pool == address(0)) {
            pool = IAlgebraFactory(algebraFactory).poolByPair(alignmentToken, weth);
            if (pool == address(0)) {
                pool = IAlgebraFactory(algebraFactory).createPool(alignmentToken, weth, "");
                IAlgebraPool(pool).initialize(referenceSqrtPrice);
                created = true;
                validatedSqrtPrice = referenceSqrtPrice;
            } else {
                validatedSqrtPrice = _validateExistingPool(pool, referenceSqrtPrice);
            }
            lpPool = pool;
            tokenIsZero = alignmentToken < weth;
            emit PoolResolved(pool, tokenIsZero, created);
        } else {
            validatedSqrtPrice = _validateExistingPool(pool, referenceSqrtPrice);
        }
    }

    /// @dev A previously-created pool: initialize a still-fresh one at the reference; otherwise require
    ///      its spot within tolerance of the reference (a manipulated/pushed pool reverts) — UNLESS the
    ///      owner has accepted this pool via {setLpPool}, in which case the vault sizes against the pool's
    ///      own live spot (the owner-vetted escape hatch out of a permissionless off-price grief). The
    ///      acquire leg stays reference-floored either way, so a bad spot cannot loosen the swap bound.
    function _validateExistingPool(address pool, uint160 referenceSqrtPrice)
        private
        returns (uint160 validatedSqrtPrice)
    {
        (uint160 existingSqrtPrice,,,,,) = IAlgebraPool(pool).globalState();
        if (existingSqrtPrice == 0) {
            IAlgebraPool(pool).initialize(referenceSqrtPrice);
            return referenceSqrtPrice;
        }
        if (lpPoolOwnerSet) return existingSqrtPrice;
        uint256 diff = existingSqrtPrice > referenceSqrtPrice
            ? existingSqrtPrice - referenceSqrtPrice
            : referenceSqrtPrice - existingSqrtPrice;
        if (diff * 10_000 > uint256(referenceSqrtPrice) * maxPriceDeviationBps) revert LpPoolPriceDeviation();
        validatedSqrtPrice = existingSqrtPrice;
    }

    /// @dev sqrtPriceX96 for the target/WETH pool derived purely from the canonical reference's
    ///      ETH-per-1e18-token. Decimals cancel because `ethPerToken` is denominated per the SAME 1e18
    ///      raw-token amount used as the token-side reserve. Ordering mirrors the launch deployer.
    function _deriveReferenceSqrtPrice(uint256 ethPerToken) private view returns (uint160) {
        (uint256 amount0, uint256 amount1) =
            alignmentToken < weth ? (uint256(1e18), ethPerToken) : (ethPerToken, uint256(1e18));
        return uint160(FixedPointMathLib.sqrt(FixedPointMathLib.fullMulDiv(amount1, 1 << 192, amount0)));
    }

    /// @dev Read the canonical ReferencePool's ETH value of 1e18 alignment tokens. Reverts (no
    ///      fail-open) when the reference is unset or yields no usable TWAP — the vault refuses to
    ///      seed or floor at a guessed price.
    function _referenceEthPerToken() private view returns (uint256 ethPerToken) {
        IAlignmentRegistry.ReferencePool memory ref =
            alignmentRegistry.getReferencePool(alignmentTargetId, alignmentToken);
        if (ref.pool == address(0)) revert NoReferencePool();
        ethPerToken = priceValidator.quoteEthForTokensVia(ref.pool, ref.kind, ref.twapWindow, alignmentToken, 1e18);
        if (ethPerToken == 0) revert NoReferencePool();
    }

    /// @dev Floor a caller-supplied token-out minimum (ETH->target acquire) to a reference-derived
    ///      value. Reference-priced, not LP-pool-priced, so a manipulated LP spot cannot loosen it.
    function _floorTargetOut(uint256 ethIn, uint256 callerMin) private view returns (uint256) {
        uint256 ethPerToken = _referenceEthPerToken();
        uint256 expectedOut = ethIn * 1e18 / ethPerToken; // round down
        uint256 floor = expectedOut * (10_000 - maxPriceDeviationBps) / 10_000; // round down: lenient floor
        return callerMin > floor ? callerMin : floor;
    }

    /// @dev Floor a caller-supplied WETH-out minimum (target->WETH harvest swap) to a reference-derived
    ///      value. Reverts (no fail-open) when the reference is unset (mirrors the acquire floor).
    function _floorWethOut(uint256 tokenIn, uint256 callerMin) internal view returns (uint256) {
        uint256 ethPerToken = _referenceEthPerToken();
        uint256 expectedEth = ethPerToken * tokenIn / 1e18; // round down
        uint256 floor = expectedEth * (10_000 - maxPriceDeviationBps) / 10_000; // round down: lenient floor
        return callerMin > floor ? callerMin : floor;
    }

    // ── harvest ───────────────────────────────────────────────────────────

    /// @notice Collect fees from the vault's alignment LP position, swap the target leg to ETH, and
    ///         distribute via the MasterChef accumulator.
    /// @param minAmountOut Minimum WETH from the target->WETH swap (floored to the reference).
    // slither-disable-next-line incorrect-equality,reentrancy-benign,timestamp
    function harvest(uint256 minAmountOut) external nonReentrant returns (uint256 feesETH) {
        if (totalContributions == 0) revert ZeroContributions();
        if (lpTokenId == 0) revert NoPosition();

        (uint256 amount0, uint256 amount1) = positionManager.collect(
            IAlgebraNFTPositionManager.CollectParams({
                tokenId: lpTokenId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );

        uint256 alignmentFees = tokenIsZero ? amount0 : amount1;
        uint256 wethFees = tokenIsZero ? amount1 : amount0;

        // slither-disable-next-line uninitialized-local
        uint256 wethFromSwap;
        if (alignmentFees > 0) {
            uint256 effMinAmountOut = _floorWethOut(alignmentFees, minAmountOut);
            IERC20(alignmentToken).forceApprove(address(swapRouter), alignmentFees);
            wethFromSwap = swapRouter.exactInputSingle(
                IAlgebraSwapRouter.ExactInputSingleParams({
                    tokenIn: alignmentToken,
                    tokenOut: weth,
                    recipient: address(this),
                    deadline: block.timestamp,
                    amountIn: alignmentFees,
                    amountOutMinimum: effMinAmountOut,
                    limitSqrtPrice: 0
                })
            );
        }

        uint256 totalWETH = wethFees + wethFromSwap;
        if (totalWETH == 0) return 0;

        IWETH9(weth).withdraw(totalWETH);
        feesETH = totalWETH;

        uint256 protocolCut = feesETH * protocolYieldCutBps / 10000; // round down: favors benefactors
        uint256 benefactorFees = feesETH - protocolCut;

        accumulatedProtocolFees += protocolCut;
        _totalAccumulatedFees += benefactorFees;

        if (benefactorFees > 0) {
            accRewardPerContribution += benefactorFees * 1e18 / totalContributions; // round down: dust stays in vault
        }

        emit Harvested(feesETH, benefactorFees, protocolCut);
        emit FeesAccumulated(benefactorFees);
    }

    // ── Fee claiming ──────────────────────────────────────────────────────

    function claimFees() external override nonReentrant returns (uint256 ethClaimed) {
        ethClaimed = _claim(msg.sender);
    }

    function claimFeesAsDelegate(address[] calldata benefactors)
        external
        override
        nonReentrant
        returns (uint256 totalClaimed)
    {
        for (uint256 i = 0; i < benefactors.length; i++) {
            address b = benefactors[i];
            address delegate = _benefactorDelegate[b] == address(0) ? b : _benefactorDelegate[b];
            if (delegate != msg.sender) revert NotDelegate();
            totalClaimed += _claimTo(b, msg.sender);
        }
    }

    function _claim(address benefactor) internal returns (uint256) {
        address recipient = _benefactorDelegate[benefactor] == address(0) ? benefactor : _benefactorDelegate[benefactor];
        return _claimTo(benefactor, recipient);
    }

    // slither-disable-next-line calls-loop,incorrect-equality,timestamp
    function _claimTo(address benefactor, address recipient) internal returns (uint256 ethClaimed) {
        uint256 contrib = benefactorContribution[benefactor];
        if (contrib == 0) return 0;
        uint256 pending = contrib * accRewardPerContribution / 1e18 - rewardDebt[benefactor]; // round down: favors vault
        if (pending == 0) return 0;
        rewardDebt[benefactor] = contrib * accRewardPerContribution / 1e18; // round down: benefactor cannot over-claim
        (bool ok,) = recipient.call{ value: pending }("");
        if (!ok) revert TransferFailed();
        ethClaimed = pending;
        emit FeesClaimed(benefactor, pending);
    }

    // ── Governance ────────────────────────────────────────────────────────

    // slither-disable-next-line reentrancy-events
    function withdrawProtocolFees() external {
        if (msg.sender != protocolTreasury) revert Unauthorized();
        uint256 amount = accumulatedProtocolFees;
        accumulatedProtocolFees = 0;
        (bool ok,) = protocolTreasury.call{ value: amount }("");
        if (!ok) revert TransferFailed();
        emit ProtocolFeesWithdrawn(amount);
    }

    function setProtocolYieldCutBps(uint256 bps) external onlyOwner {
        if (bps > 1000) revert ExceedsMaxBps();
        protocolYieldCutBps = bps;
        emit ProtocolYieldCutUpdated(bps);
    }

    /// @notice Wire the independent price validator used to floor swaps and read the reference TWAP.
    function setPriceValidator(address validator) external onlyOwner {
        priceValidator = IVaultPriceValidator(validator);
        emit PriceValidatorUpdated(validator);
    }

    function setMaxPriceDeviationBps(uint256 bps) external onlyOwner {
        if (bps > 2000) revert ExceedsMaxBps();
        maxPriceDeviationBps = bps;
        emit MaxPriceDeviationUpdated(bps);
    }

    /// @notice Owner escape hatch: accept a specific canonical target/WETH Algebra pool as the LP venue,
    ///         bypassing the reference-deviation guard on subsequent converts.
    /// @dev `createPool`+`initialize` on Algebra are permissionless, so anyone can pre-create the vault's
    ///      target/WETH pool at a garbage price (optionally with a dust off-price position). The automatic
    ///      resolver would then revert `LpPoolPriceDeviation` on every convert with no way to store the
    ///      pool — permanently bricking convert and stranding the accumulated tithe. This lets the owner
    ///      (the trusted platform), after vetting/repricing the pool to a fair value, pin it so convert
    ///      proceeds by sizing against the pool's own live spot. Only settable before the first LP mint
    ///      (`lpTokenId == 0`); repointing after a position exists would orphan the NFT. The acquire leg
    ///      remains floored to the canonical reference regardless, so this never loosens the swap bound.
    function setLpPool(address pool) external onlyOwner {
        if (lpTokenId != 0) revert InvalidLpPool();
        if (pool == address(0)) revert InvalidLpPool();
        // Must be THE canonical pool for the pair (Algebra is one-pool-per-pair) and already initialized
        // — the owner accepts a live pool they have vetted, not an arbitrary or unseeded address.
        if (IAlgebraFactory(algebraFactory).poolByPair(alignmentToken, weth) != pool) revert InvalidLpPool();
        (uint160 price,,,,,) = IAlgebraPool(pool).globalState();
        if (price == 0) revert InvalidLpPool();

        lpPool = pool;
        tokenIsZero = alignmentToken < weth;
        lpPoolOwnerSet = true;
        emit LpPoolOverridden(pool, tokenIsZero, IAlgebraPool(pool).liquidity() == 0);
    }

    // ── IAlignmentVault compliance ────────────────────────────────────────

    function calculateClaimableAmount(address benefactor) external view override returns (uint256) {
        uint256 contrib = benefactorContribution[benefactor];
        if (contrib == 0) return 0;
        return contrib * accRewardPerContribution / 1e18 - rewardDebt[benefactor]; // round down: favors vault
    }

    function getBenefactorContribution(address benefactor) external view override returns (uint256) {
        return benefactorContribution[benefactor];
    }

    function getBenefactorShares(address benefactor) external view override returns (uint256) {
        return benefactorContribution[benefactor];
    }

    /// @notice Whether this vault is operationally wired for liquidity provision (O2 gate).
    /// @dev True once the Algebra position manager, factory, and a price validator are configured, so
    ///      the wizard can safely offer the Cypher venue.
    function isLiquidityReady() external view returns (bool) {
        return
            address(positionManager) != address(0) && algebraFactory != address(0)
                && address(priceValidator) != address(0);
    }

    function vaultType() external pure override returns (string memory) {
        return "CypherLP";
    }

    function description() external pure override returns (string memory) {
        return "External-target alignment: reference-priced acquire + full-range LP on Algebra (Cypher AMM)";
    }

    function accumulatedFees() external view override returns (uint256) {
        return _totalAccumulatedFees;
    }

    function totalShares() external view override returns (uint256) {
        return totalContributions;
    }

    function supportsCapability(bytes32 capability) external pure override returns (bool) {
        return capability == keccak256("YIELD_GENERATION") || capability == keccak256("BENEFACTOR_DELEGATION");
    }

    function currentPolicy() external pure override returns (bytes memory) {
        return "";
    }

    function validateCompliance(address) external pure override returns (bool) {
        return true;
    }

    function delegateBenefactor(address delegate) external override {
        _benefactorDelegate[msg.sender] = delegate;
        emit DelegateSet(msg.sender, delegate);
    }

    function getBenefactorDelegate(address benefactor) external view override returns (address) {
        address d = _benefactorDelegate[benefactor];
        return d == address(0) ? benefactor : d;
    }
}
