// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable } from "solady/auth/Ownable.sol";
import { ReentrancyGuard } from "solady/utils/ReentrancyGuard.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { FixedPointMathLib } from "solady/utils/FixedPointMathLib.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { IAlignmentVault } from "../../interfaces/IAlignmentVault.sol";
import { IVaultPriceValidator } from "../../interfaces/IVaultPriceValidator.sol";
import { IAlignmentRegistry } from "../../master/interfaces/IAlignmentRegistry.sol";
import { BestRouteAcquirer } from "../../shared/libraries/BestRouteAcquirer.sol";
import { SmartTransferLib } from "../../libraries/SmartTransferLib.sol";

/// @notice Minimal ZAMM interface (mirrors ZAMM.sol ABI without requiring its compiler version)
interface IZAMM {
    struct PoolKey {
        uint256 id0;
        uint256 id1;
        address token0;
        address token1;
        uint256 feeOrHook;
    }

    struct Pool {
        uint112 reserve0;
        uint112 reserve1;
        uint32 blockTimestampLast;
        uint256 price0CumulativeLast;
        uint256 price1CumulativeLast;
        uint256 kLast;
        uint256 supply;
    }

    function pools(uint256 poolId) external view returns (Pool memory);
    function balanceOf(address owner, uint256 id) external view returns (uint256);
    function addLiquidity(
        PoolKey calldata poolKey,
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 amount0Min,
        uint256 amount1Min,
        address to,
        uint256 deadline
    ) external payable returns (uint256 amount0, uint256 amount1, uint256 liquidity);
    function removeLiquidity(
        PoolKey calldata poolKey,
        uint256 liquidity,
        uint256 amount0Min,
        uint256 amount1Min,
        address to,
        uint256 deadline
    ) external returns (uint256 amount0, uint256 amount1);
}

/// @notice Minimal zRouter interface
interface IzRouterV2 {
    function swapVZ(
        address to,
        bool exactOut,
        uint256 feeOrHook,
        address tokenIn,
        address tokenOut,
        uint256 idIn,
        uint256 idOut,
        uint256 swapAmount,
        uint256 amountLimit,
        uint256 deadline
    ) external payable returns (uint256 amountIn, uint256 amountOut);
}

/// @title ZAMMAlignmentVault
/// @notice ZAMM-backed alignment vault. ETH in, ETH out. No peripherals.
contract ZAMMAlignmentVault is IAlignmentVault, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using FixedPointMathLib for uint256;

    // ── Solady ReentrancyGuard slot ─────────────────────────────────────
    // Mirrors Solady's `_REENTRANCY_GUARD_SLOT` (private constant).
    // Derived as: uint72(bytes9(keccak256("_REENTRANCY_GUARD_SLOT")))
    uint256 private constant _RG_SLOT = 0x929eee149b4bd21268;
    // Compile-time assert: if the derivation changes, the denominator is 0 → compilation fails.
    uint256 private constant _RG_SLOT_ASSERT =
        1 / (_RG_SLOT == uint256(uint72(bytes9(keccak256("_REENTRANCY_GUARD_SLOT")))) ? 1 : 0);

    // ── Errors ────────────────────────────────────────────────────────────
    error VaultAlreadyInitialized();
    error ETHOnly();
    error NoPendingETH();
    error NotDelegate();
    error ZeroContributions();
    error InsufficientOutput();
    error TransferFailed();
    error ExceedsMaxBps();
    /// @dev Init: a required address argument (the WETH fallback rail) was the zero address.
    error InvalidAddress();
    error TreasuryNotSet();
    error ContributionBelowMinimum();
    error TooManyPendingBenefactors();
    error HarvestSameBlock();
    error PoolKeyLocked();
    error NoReferencePool();

    // ── Anti-DoS constants ────────────────────────────────────────────────
    uint256 public constant MIN_CONTRIBUTION = 0.001 ether;
    uint256 public constant MAX_PENDING_BENEFACTORS = 500;

    // ── Events ────────────────────────────────────────────────────────────
    event LiquidityAdded(uint256 ethSwapped, uint256 tokenReceived, uint256 lpMinted);
    event Harvested(uint256 totalFees, uint256 benefactorFees);
    event DelegateSet(address indexed benefactor, address indexed delegate);
    event ProtocolYieldCutUpdated(uint256 newBps);
    event PriceValidatorUpdated(address indexed validator);
    event ZQuoterUpdated(address indexed zQuoter);
    event MaxPriceDeviationUpdated(uint256 newBps);
    event ProtocolTreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event ProtocolFeesWithdrawn(uint256 amount);
    event PoolKeyUpdated(uint256 indexed poolId);

    // ── Core config (locked post-init) ───────────────────────────────────
    address public zamm;
    address public zRouter;
    address public alignmentToken;
    IZAMM.PoolKey internal _poolKey;
    uint256 public poolId;

    // zQuoter for on-chain best-route acquisition (owner-set, address(0) = fixed-pool fallback only).
    // Wired post-deploy by the factory; the fixed _poolKey.feeOrHook ZAMM pool stays the fallback.
    address public zQuoter;

    // ── Protocol economics ────────────────────────────────────────────────
    address public protocolTreasury;
    uint256 public protocolYieldCutBps; // default 100 (1%)

    // ── Price-manipulation guard (F5) ─────────────────────────────────────
    /// @notice Independent price source (Uniswap TWAP) used to floor swap slippage on the
    ///         permissionless convert/harvest paths. address(0) = no floor (caller minOut only).
    IVaultPriceValidator public priceValidator;
    uint256 public maxPriceDeviationBps; // default 500 (5%)

    // ── Alignment target binding (set once at init; mirrors Uni) ──────────
    /// @notice Registry holding the DAO-pinned canonical {ReferencePool} the anti-sandwich floor reads.
    IAlignmentRegistry public alignmentRegistry;
    /// @notice ID of the alignment target this vault serves; keys the reference-pool lookup.
    uint256 public alignmentTargetId;

    // ── Principal tracking ────────────────────────────────────────────────
    uint256 public principalETH; // nominal cumulative ETH deposited (reporting)
    uint256 public principalToken; // nominal cumulative token deposited (reporting)
    /// @notice Geometric-mean (constant-product) invariant baseline of the vault's LP principal:
    ///         Σ sqrt(ethUsed_i * tokenUsed_i) over every deposit. Fee detection compares the pool's
    ///         current per-share invariant against this fixed baseline so that price movement (which
    ///         leaves sqrt(k)/share unchanged) is NOT mistaken for fee growth. Never reduced on harvest —
    ///         a full-fee harvest pulls currentInvariant back down to exactly this value.
    uint256 public principalInvariant;

    // ── Pending (between conversions) ─────────────────────────────────────
    uint256 public pendingETH;
    mapping(address => uint256) public pendingContribution;
    address[] internal _pendingBenefactors;

    // ── MasterChef accumulator ────────────────────────────────────────────
    uint256 public totalContributions;
    uint256 public accRewardPerContribution; // 1e18 scaled
    mapping(address => uint256) public benefactorContribution;
    mapping(address => uint256) public rewardDebt;

    // ── Delegation ────────────────────────────────────────────────────────
    mapping(address => address) public _benefactorDelegate;

    // ── Protocol fee bucket ───────────────────────────────────────────────
    uint256 public accumulatedProtocolFees;

    // ── Flash-loan / same-block harvest guard ────────────────────────────
    uint256 private _lastHarvestBlock;

    // ── Clone guard ───────────────────────────────────────────────────────
    bool private _initialized;

    // ── WETH fallback rail ────────────────────────────────────────────────
    /// @notice Canonical WETH used as the ETH-transfer fallback when a benefactor/delegate is a smart
    ///         wallet that rejects plain ETH (adoption-gap F1). Set once at init, zero-checked. Appended
    ///         at the end of storage so the addition is slot-append-only (layout-safe for these fresh,
    ///         non-upgradeable CREATE3 clones — each clone owns its storage against a fixed impl).
    address public weth;

    // ── Init ──────────────────────────────────────────────────────────────

    function initialize(
        address _zamm,
        address _zRouter,
        address _weth,
        address _alignmentToken,
        IZAMM.PoolKey calldata key,
        address _protocolTreasury,
        address _priceValidator,
        IAlignmentRegistry _alignmentRegistry,
        uint256 _alignmentTargetId
    ) external {
        if (_initialized) revert VaultAlreadyInitialized();
        if (_protocolTreasury == address(0)) revert TreasuryNotSet();
        // WETH is the fallback rail for benefactor yield when a smart-wallet recipient rejects plain ETH
        // (adoption-gap F1). A zero WETH would silently disable the fallback, so reject it at init.
        if (_weth == address(0)) revert InvalidAddress();
        _initialized = true;

        zamm = _zamm;
        zRouter = _zRouter;
        weth = _weth;
        alignmentToken = _alignmentToken;
        _poolKey = key;
        poolId = uint256(keccak256(abi.encode(key)));

        protocolTreasury = _protocolTreasury;
        protocolYieldCutBps = 100;
        maxPriceDeviationBps = 500;
        // F5: wire the oracle floor at init (mirrors Uni). address(0) → floor inert (back-compat);
        // production deploys pass the shared UniswapVaultPriceValidator so swaps are TWAP-floored.
        priceValidator = IVaultPriceValidator(_priceValidator);

        // Alignment target binding (mirrors Uni): the anti-sandwich floor resolves the DAO-pinned
        // canonical ReferencePool from this registry keyed by (alignmentTargetId, alignmentToken).
        alignmentRegistry = _alignmentRegistry;
        alignmentTargetId = _alignmentTargetId;

        _initializeOwner(msg.sender);
    }

    // ── Receive ───────────────────────────────────────────────────────────

    /// @dev Silently accept ETH when inside a nonReentrant call (e.g. ZAMM removeLiquidity
    ///      returning ETH, zRouter returning swap proceeds). Only track contributions when
    ///      ETH arrives outside of an active vault operation.
    receive() external payable {
        if (!_isLocked()) _trackPending(msg.sender, msg.value);
    }

    function _isLocked() internal view returns (bool locked) {
        assembly { locked := eq(sload(_RG_SLOT), address()) }
    }

    function receiveContribution(
        Currency currency,
        uint256,
        /*amount*/
        address benefactor
    )
        external
        payable
        override
    {
        if (Currency.unwrap(currency) != address(0)) revert ETHOnly();
        _trackPending(benefactor, msg.value);
    }

    function _trackPending(address benefactor, uint256 amount) internal {
        if (benefactor == address(0) || amount == 0) return;
        if (amount < MIN_CONTRIBUTION) revert ContributionBelowMinimum();
        if (pendingContribution[benefactor] == 0) {
            if (_pendingBenefactors.length >= MAX_PENDING_BENEFACTORS) revert TooManyPendingBenefactors();
            _pendingBenefactors.push(benefactor);
        }
        pendingContribution[benefactor] += amount;
        pendingETH += amount;
        emit ContributionReceived(benefactor, amount);
    }

    // ── View: pool key ────────────────────────────────────────────────────
    function getPoolKey() external view returns (IZAMM.PoolKey memory) {
        return _poolKey;
    }

    /// @notice Whether this vault is operationally wired for liquidity provision (O2 gate).
    /// @dev True once the ZAMM pool key (token1 side set) AND a price validator are configured, so
    ///      the wizard can safely offer the ZAMM venue. A vault deployed with a zero pool key
    ///      (pre-wiring) reports false and is hidden/disabled in the picker.
    function isLiquidityReady() external view returns (bool) {
        return _poolKey.token1 != address(0) && address(priceValidator) != address(0);
    }

    /// @notice Set the ZAMM pool key for liquidity operations (owner = deploying factory).
    /// @dev Fills the post-init wiring gap: the vault can be deployed against a zero pool key and
    ///      wired once the ETH/token ZAMM pool is chosen. Only allowed while no liquidity has been
    ///      deployed yet (principalInvariant == 0) so an active position's key can never be swapped
    ///      out from under it. `poolId` is re-derived to stay consistent with the key.
    /// @param key ZAMM pool key for the ETH/alignmentToken pool
    function setPoolKey(IZAMM.PoolKey calldata key) external onlyOwner {
        if (principalInvariant != 0) revert PoolKeyLocked();
        _poolKey = key;
        poolId = uint256(keccak256(abi.encode(key)));
        emit PoolKeyUpdated(poolId);
    }

    // ── convertAndAddLiquidity ────────────────────────────────────────────

    struct SwapLPResult {
        uint256 tokenBought;
        uint256 ethUsed;
        uint256 tokenUsed;
        uint256 lp;
    }

    /// @notice Buy alignment token and add ETH+token to ZAMM. Anyone can call (incentivized).
    function convertAndAddLiquidity(uint256 minTokenOut, uint256 minEth, uint256 minToken)
        external
        nonReentrant
        returns (uint256 lpMinted)
    {
        uint256 totalEth = pendingETH;
        if (totalEth == 0) revert NoPendingETH();

        address[] memory benefactors = _pendingBenefactors;
        pendingETH = 0;
        delete _pendingBenefactors;

        uint256 deployETH = totalEth;

        IZAMM.Pool memory pool = IZAMM(zamm).pools(poolId);
        uint256 ethToSwap;
        if (pool.reserve0 == 0) {
            ethToSwap = deployETH / 2; // round down: extra wei goes to LP side
        } else {
            uint256 r0 = pool.reserve0;
            ethToSwap = FixedPointMathLib.sqrt(r0 * r0 + deployETH * r0) - r0;
        }
        uint256 ethForLP = deployETH - ethToSwap;

        // Floor the caller's slippage bound to an oracle-derived minimum so a permissionless caller
        // cannot pass loose minTokenOut and sandwich the vault's own ETH->token swap (F5).
        uint256 effMinTokenOut = _floorTokenOut(ethToSwap, minTokenOut);
        SwapLPResult memory r = _swapAndAddLiquidity(ethToSwap, ethForLP, effMinTokenOut, minEth, minToken);

        lpMinted = r.lp;
        principalETH += r.ethUsed;
        principalToken += r.tokenUsed;
        // Liquidity is added at the pool ratio, so this deposit's LP claim has invariant value
        // sqrt(ethUsed * tokenUsed). Accumulating it gives a price-history-independent baseline.
        principalInvariant += FixedPointMathLib.sqrt(r.ethUsed * r.tokenUsed);

        for (uint256 i = 0; i < benefactors.length; i++) {
            address b = benefactors[i];
            uint256 contrib = pendingContribution[b];
            delete pendingContribution[b];
            if (contrib == 0) continue;

            uint256 settled = contrib * deployETH / totalEth; // round down: dust stays unallocated
            rewardDebt[b] += settled * accRewardPerContribution / 1e18; // round down: benefactor cannot over-claim
            benefactorContribution[b] += settled;
            totalContributions += settled;
        }

        emit LiquidityAdded(ethToSwap, r.tokenBought, lpMinted);
    }

    function _swapAndAddLiquidity(
        uint256 ethToSwap,
        uint256 ethForLP,
        uint256 minTokenOut,
        uint256 minEth,
        uint256 minToken
    ) private returns (SwapLPResult memory r) {
        // Unified acquire (Front 2): pick the deepest pool via on-chain zQuoter and dispatch to the
        // matching TYPED zRouter leg; degrade to the fixed _poolKey.feeOrHook swapVZ pool when zQuoter
        // is unset/empty. minTokenOut (the oracle floor) is enforced by the router. The ZAMM LP-add
        // below is unchanged (venue-native).
        r.tokenBought = BestRouteAcquirer.acquireViaVZ(
            zRouter, zQuoter, alignmentToken, ethToSwap, minTokenOut, _poolKey.feeOrHook, block.timestamp + 15 minutes
        );

        IERC20(alignmentToken).forceApprove(zamm, r.tokenBought);
        (r.ethUsed, r.tokenUsed, r.lp) = IZAMM(zamm).addLiquidity{ value: ethForLP }(
            _poolKey, ethForLP, r.tokenBought, minEth, minToken, address(this), block.timestamp + 15 minutes
        );
    }

    // ── harvest ───────────────────────────────────────────────────────────

    /// @notice Harvest fee growth from ZAMM pool. Anyone can call (incentivized).
    /// @param minEthOut Minimum ETH to receive from token→ETH fee swap
    function harvest(uint256 minEthOut) external nonReentrant returns (uint256 feesCollected) {
        if (block.number == _lastHarvestBlock) revert HarvestSameBlock();
        _lastHarvestBlock = block.number;
        if (totalContributions == 0) revert ZeroContributions();

        uint256 lpHeld = IZAMM(zamm).balanceOf(address(this), poolId);
        if (lpHeld == 0) return 0;

        IZAMM.Pool memory pool = IZAMM(zamm).pools(poolId);
        uint256 totalSupply = pool.supply;
        if (totalSupply == 0) return 0;

        // Measure fee growth by the constant-product invariant, NOT the ETH-side reserve share.
        // In a constant-product pool reserve0 (the ETH side) rises and falls with price, so a
        // reserve-share comparison mislabels impermanent loss / price appreciation as "fees" and
        // would burn principal LP to pay it out. Real LP fees are the only thing that grows
        // sqrt(k)/share, so the vault's per-share invariant value minus its deposit baseline is
        // exactly the accrued fee (price movement cancels out).
        uint256 rootK = FixedPointMathLib.sqrt(uint256(pool.reserve0) * uint256(pool.reserve1));
        uint256 currentInvariant = rootK * lpHeld / totalSupply; // round down: conservative valuation
        uint256 invFees = currentInvariant > principalInvariant ? currentInvariant - principalInvariant : 0;
        if (invFees == 0) return 0;

        uint256 feeLP = lpHeld * invFees / currentInvariant; // round down: slightly fewer LP tokens burned
        if (feeLP == 0) return 0;

        feesCollected = _removeFeeLP(feeLP, minEthOut);

        uint256 afterReward = feesCollected;

        uint256 protocolCut = afterReward * protocolYieldCutBps / 10000; // round down: favors benefactors
        uint256 benefactorFees = afterReward - protocolCut;

        accumulatedProtocolFees += protocolCut;

        if (benefactorFees > 0 && totalContributions > 0) {
            accRewardPerContribution += benefactorFees * 1e18 / totalContributions; // round down: dust stays in vault
        }

        // Deliberately do NOT touch principal here. feeLP is exactly the LP whose invariant value
        // exceeds the baseline, so removing it pulls currentInvariant back down to principalInvariant;
        // reducing the baseline would make the next harvest see phantom fees and bleed principal —
        // the very flaw this invariant rework closes. principalETH/principalToken stay as the nominal
        // cumulative-deposit record for reporting.

        emit Harvested(feesCollected, benefactorFees);
        emit FeesAccumulated(benefactorFees);
    }

    function _removeFeeLP(uint256 feeLP, uint256 minEthOut) private returns (uint256 feesCollected) {
        (uint256 ethRemoved, uint256 tokRemoved) =
            IZAMM(zamm).removeLiquidity(_poolKey, feeLP, 0, 0, address(this), block.timestamp + 15 minutes);
        uint256 swappedEth;
        if (tokRemoved > 0) {
            // Floor the caller's slippage bound to an oracle-derived minimum (F5).
            uint256 effMinEthOut = _floorEthOut(tokRemoved, minEthOut);
            IERC20(alignmentToken).forceApprove(zRouter, tokRemoved);
            (, swappedEth) = IzRouterV2(zRouter)
                .swapVZ(
                    address(this),
                    false,
                    _poolKey.feeOrHook,
                    alignmentToken,
                    address(0),
                    0,
                    0,
                    tokRemoved,
                    effMinEthOut,
                    block.timestamp + 15 minutes
                );
        }
        feesCollected = ethRemoved + swappedEth;
    }

    // ── claimFees + delegation ────────────────────────────────────────────

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

    function delegateBenefactor(address delegate) external override {
        _benefactorDelegate[msg.sender] = delegate;
        emit DelegateSet(msg.sender, delegate);
    }

    function calculateClaimableAmount(address benefactor) external view override returns (uint256) {
        uint256 contrib = benefactorContribution[benefactor];
        if (contrib == 0) return 0;
        return contrib * accRewardPerContribution / 1e18 - rewardDebt[benefactor]; // round down: favors vault
    }

    function _claim(address benefactor) internal returns (uint256 ethClaimed) {
        address recipient = _benefactorDelegate[benefactor] == address(0) ? benefactor : _benefactorDelegate[benefactor];
        return _claimTo(benefactor, recipient);
    }

    function _claimTo(address benefactor, address recipient) internal returns (uint256 ethClaimed) {
        uint256 contrib = benefactorContribution[benefactor];
        if (contrib == 0) return 0;
        uint256 pending = contrib * accRewardPerContribution / 1e18 - rewardDebt[benefactor]; // round down: favors vault
        if (pending == 0) return 0;
        rewardDebt[benefactor] = contrib * accRewardPerContribution / 1e18; // round down: benefactor cannot over-claim
        // WETH-fallback transfer: a smart-wallet recipient rejecting plain ETH still receives its yield
        // as WETH instead of bricking the claim (adoption-gap F1). Covers both claimFees and delegate.
        SmartTransferLib.smartTransferETH(recipient, pending, weth);
        ethClaimed = pending;
        emit FeesClaimed(benefactor, pending);
    }

    // ── Governance (owner only) ───────────────────────────────────────────

    function setProtocolYieldCutBps(uint256 bps) external onlyOwner {
        if (bps > 10000) revert ExceedsMaxBps();
        protocolYieldCutBps = bps;
        emit ProtocolYieldCutUpdated(bps);
    }

    function setProtocolTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert TreasuryNotSet();
        address old = protocolTreasury;
        protocolTreasury = treasury_;
        emit ProtocolTreasuryUpdated(old, treasury_);
    }

    /// @notice Wire the independent price validator used to floor convert/harvest swap slippage (F5).
    ///         Pass address(0) to disable the floor (caller-supplied minimums only).
    function setPriceValidator(address validator) external onlyOwner {
        priceValidator = IVaultPriceValidator(validator);
        emit PriceValidatorUpdated(validator);
    }

    /// @notice Set the on-chain zQuoter used for best-route acquisition (owner = deploying factory).
    /// @dev address(0) disables best-route selection, leaving only the fixed _poolKey.feeOrHook swapVZ
    ///      fallback (mirrors the priceValidator "inert when zero" pattern). Only the acquire
    ///      (ETH->alignment token) leg consults it; the harvest token->ETH swap is unchanged.
    ///      minTokenOut is always the vault's own oracle floor, so a mis-set quoter can never widen
    ///      slippage — the worst case is degrading to the fixed pool.
    /// @param newZQuoter zQuoter address, or address(0) to use fixed-pool acquisition only
    function setZQuoter(address newZQuoter) external onlyOwner {
        zQuoter = newZQuoter;
        emit ZQuoterUpdated(newZQuoter);
    }

    function setMaxPriceDeviationBps(uint256 bps) external onlyOwner {
        if (bps > 2000) revert ExceedsMaxBps();
        maxPriceDeviationBps = bps;
        emit MaxPriceDeviationUpdated(bps);
    }

    /// @dev Floor a caller-supplied token-out minimum (ETH->token swap) to a canonical-reference-derived
    ///      value. Reads the DAO-pinned {ReferencePool} for this (target, token) and prices it via the
    ///      validator's pinned-pool TWAP path. NO fail-open: an unset reference reverts {NoReferencePool}
    ///      and an unusable one reverts inside {quoteEthForTokensVia}, so a permissionless caller cannot
    ///      disable the floor. 1e18 is the reference token amount; the pinned quote is linear so the
    ///      per-unit price cancels the decimals.
    function _floorTokenOut(uint256 ethIn, uint256 callerMin) internal view returns (uint256) {
        IAlignmentRegistry.ReferencePool memory ref =
            alignmentRegistry.getReferencePool(alignmentTargetId, alignmentToken);
        if (ref.pool == address(0)) revert NoReferencePool();
        uint256 ethPerTokenUnit =
            priceValidator.quoteEthForTokensVia(ref.pool, ref.kind, ref.twapWindow, alignmentToken, 1e18);
        uint256 expectedOut = ethIn * 1e18 / ethPerTokenUnit;
        uint256 floor = expectedOut * (10000 - maxPriceDeviationBps) / 10000; // round down: lenient floor
        return callerMin > floor ? callerMin : floor;
    }

    /// @dev Floor a caller-supplied ETH-out minimum (token->ETH swap) to a canonical-reference-derived
    ///      value, using the SAME pinned {ReferencePool} as the buy-side floor. NO fail-open (see
    ///      {_floorTokenOut}).
    function _floorEthOut(uint256 tokenIn, uint256 callerMin) internal view returns (uint256) {
        IAlignmentRegistry.ReferencePool memory ref =
            alignmentRegistry.getReferencePool(alignmentTargetId, alignmentToken);
        if (ref.pool == address(0)) revert NoReferencePool();
        uint256 expectedEth =
            priceValidator.quoteEthForTokensVia(ref.pool, ref.kind, ref.twapWindow, alignmentToken, tokenIn);
        uint256 floor = expectedEth * (10000 - maxPriceDeviationBps) / 10000; // round down: lenient floor
        return callerMin > floor ? callerMin : floor;
    }

    function withdrawProtocolFees() external {
        if (protocolTreasury == address(0)) revert TreasuryNotSet();
        uint256 amount = accumulatedProtocolFees;
        accumulatedProtocolFees = 0;
        (bool ok,) = protocolTreasury.call{ value: amount }("");
        if (!ok) revert TransferFailed();
        emit ProtocolFeesWithdrawn(amount);
    }

    // ── View helpers ──────────────────────────────────────────────────────

    function lpBalance() external view returns (uint256) {
        return IZAMM(zamm).balanceOf(address(this), poolId);
    }

    // ── IAlignmentVault stubs ─────────────────────────────────────────────

    function getBenefactorContribution(address b) external view override returns (uint256) {
        return benefactorContribution[b];
    }

    function getBenefactorShares(address b) external view override returns (uint256) {
        return benefactorContribution[b];
    }

    function getBenefactorDelegate(address b) external view override returns (address) {
        return _benefactorDelegate[b] == address(0) ? b : _benefactorDelegate[b];
    }

    function vaultType() external pure override returns (string memory) {
        return "ZAMMLP";
    }

    function description() external pure override returns (string memory) {
        return "Full-range constant-product liquidity on ZAMM with proportional yield distribution";
    }

    function accumulatedFees() external view override returns (uint256) {
        return address(this).balance - pendingETH;
    }

    function totalShares() external view override returns (uint256) {
        return totalContributions;
    }

    function supportsCapability(bytes32 cap) external pure override returns (bool) {
        return cap == keccak256("YIELD_GENERATION") || cap == keccak256("BENEFACTOR_DELEGATION");
    }

    function currentPolicy() external pure override returns (bytes memory) {
        return "";
    }

    function validateCompliance(address) external pure override returns (bool) {
        return true;
    }
}
