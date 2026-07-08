// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { SafeTransferLib } from "solady/utils/SafeTransferLib.sol";
import { FixedPointMathLib } from "solady/utils/FixedPointMathLib.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IAlgebraFactory, IAlgebraPool, IAlgebraNFTPositionManager } from "../../interfaces/algebra/IAlgebra.sol";
import { CypherAlignmentVault } from "../../vaults/cypher/CypherAlignmentVault.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { ILiquidityDeployerModule } from "../../interfaces/ILiquidityDeployerModule.sol";
import { IMasterRegistry } from "../../master/interfaces/IMasterRegistry.sol";
import { RevenueSplitLib } from "../../shared/libraries/RevenueSplitLib.sol";
import { Ownable } from "solady/auth/Ownable.sol";

interface IWETH {
    function deposit() external payable;
}

/// @title CypherLiquidityDeployerModule
/// @notice Called by ERC404BondingInstance at graduation.
///         Creates Algebra pool, mints LP to vault, registers benefactor.
contract CypherLiquidityDeployerModule is ILiquidityDeployerModule, Ownable {
    using FixedPointMathLib for uint256;

    error ETHMismatch();
    error InvalidParams();
    error ZeroLiquidity();
    /// @dev Caller is not the genuine, registered ERC404 instance named in p.instance.
    error UnauthorizedCaller();
    /// @dev An attacker pre-initialized the graduation pool at a price outside tolerance.
    error PoolPriceMismatch();

    /// @notice Max deviation (bps) tolerated between an already-initialized pool's sqrtPriceX96 and
    ///         the intended graduation price. 100 bps (1%) mirrors the 99/100 LP-min-slippage
    ///         convention already used in this module. A larger gap means the pool was seeded by a
    ///         front-runner at a skewed price — we revert (retryable) rather than mint LP into it.
    uint256 public constant MAX_INIT_PRICE_DEVIATION_BPS = 100;

    address public immutable algebraFactory;
    address public immutable positionManager;
    address public immutable weth;
    IMasterRegistry public immutable masterRegistry;

    string private _metadataURI;

    // slither-disable-next-line missing-zero-check
    constructor(address _algebraFactory, address _positionManager, address _weth, address _masterRegistry) {
        algebraFactory = _algebraFactory;
        positionManager = _positionManager;
        weth = _weth;
        masterRegistry = IMasterRegistry(_masterRegistry);
        _initializeOwner(msg.sender);
    }

    // Full-range ticks for tick spacing 60: floor(887272/60)*60 = 887220
    int24 public constant TICK_LOWER = -887220;
    int24 public constant TICK_UPPER = 887220;

    event LiquidityDeployed(address indexed vault, address pool, uint256 tokenId, uint256 ethToLP, uint256 tokenToLP);
    event GraduationFeePaid(address indexed treasury, uint256 amount);
    event GraduationVaultContribution(address indexed vault, uint256 amount);
    event CreatorCarvePaid(address indexed instance, address indexed creator, uint256 requested, uint256 paid);

    struct PoolSetupResult {
        uint256 tokenId;
        address pool;
        uint256 ethToLP;
        uint256 protocolFee; // 1% of raise + 1% of carve
        uint256 vaultCut; // 19% of raise + 19% of carve
        uint256 creatorCut; // 80% of carve → creator
        uint256 carvePaid; // effective gross carve (for CreatorCarvePaid)
        bool tokenIsZero;
    }

    /// @notice Deploy Algebra pool liquidity and register with vault.
    /// @dev Caller must have pre-transferred tokenReserve to this contract.
    ///      ETH must equal p.ethReserve exactly.
    // slither-disable-next-line reentrancy-events
    function deployLiquidity(DeployParams calldata p) external payable override {
        // Strict caller guard: only a genuine, registered ERC404 instance acting as itself may
        // deploy liquidity. For ERC404, instance == token, and the instance is the msg.sender at
        // graduation. Blocks arbitrary callers passing a crafted DeployParams.
        if (msg.sender != p.instance || !masterRegistry.isRegisteredInstance(msg.sender)) {
            revert UnauthorizedCaller();
        }
        if (msg.value != p.ethReserve) revert ETHMismatch();
        if (p.token == address(0) || p.vault == address(0)) revert InvalidParams();

        PoolSetupResult memory r = _setupPool(p);
        _postMint(p, r);
    }

    // slither-disable-next-line arbitrary-send-eth,incorrect-equality,timestamp,unused-return
    function _setupPool(ILiquidityDeployerModule.DeployParams calldata p) private returns (PoolSetupResult memory r) {
        // 1/19/80 split of the raise + optional tithed creator carve (80/19/1) out of the LP 80.
        // The instance resolves the effective carve; splitGraduation re-clamps to the LP share.
        uint256 carve = p.creator == address(0) ? 0 : p.carveEth;
        RevenueSplitLib.GraduationSplit memory g = RevenueSplitLib.splitGraduation(p.ethReserve, carve, 0);
        r.protocolFee = g.protocolCut;
        r.vaultCut = g.vaultCut;
        r.creatorCut = g.creatorCut;
        r.carvePaid = g.carveApplied;
        r.ethToLP = g.ethForPool;

        // ── Compute sqrtPriceX96 internally from token ordering ──
        bool tokenIsZero = p.token < weth;
        uint256 amount0 = tokenIsZero ? p.tokenReserve : r.ethToLP;
        uint256 amount1 = tokenIsZero ? r.ethToLP : p.tokenReserve;
        uint160 sqrtPriceX96 = uint160(FixedPointMathLib.sqrt(FixedPointMathLib.fullMulDiv(amount1, 1 << 192, amount0)));

        // ── Wrap ETH to WETH for LP ──
        IWETH(weth).deposit{ value: r.ethToLP }();

        // ── Create/validate Algebra pool (front-run-safe) ──
        // Algebra's createPool reverts if the pair already exists, so an attacker who pre-created the
        // pool would have permanently DoS'd graduation. Instead: reuse an existing pool, initialize it
        // if still fresh, and if it was already initialized accept it only within price tolerance —
        // never mint LP into an attacker-skewed pool.
        r.pool = _createOrValidatePool(p.token, sqrtPriceX96);

        // ── Determine token ordering and amounts ──
        r.tokenIsZero = tokenIsZero;
        (address token0, address token1) = tokenIsZero ? (p.token, weth) : (weth, p.token);

        // ── Approve and mint LP ──
        IERC20(p.token).approve(positionManager, p.tokenReserve);
        IERC20(weth).approve(positionManager, r.ethToLP);

        uint128 liquidity;
        (r.tokenId, liquidity,,) = IAlgebraNFTPositionManager(positionManager)
            .mint(
                IAlgebraNFTPositionManager.MintParams({
                    token0: token0,
                    token1: token1,
                    deployer: address(0),
                    tickLower: TICK_LOWER,
                    tickUpper: TICK_UPPER,
                    amount0Desired: amount0,
                    amount1Desired: amount1,
                    amount0Min: amount0 * 99 / 100, // 1% slippage tolerance
                    amount1Min: amount1 * 99 / 100,
                    recipient: p.vault,
                    deadline: block.timestamp + 15 minutes
                })
            );
        if (liquidity == 0) revert ZeroLiquidity();
    }

    // slither-disable-next-line arbitrary-send-eth,reentrancy-events,timestamp
    function _postMint(ILiquidityDeployerModule.DeployParams calldata p, PoolSetupResult memory r) private {
        CypherAlignmentVault(payable(p.vault)).registerPosition(r.tokenId, r.pool, r.tokenIsZero, p.instance, r.ethToLP);
        // 1% → protocol treasury
        if (r.protocolFee > 0 && p.protocolTreasury != address(0)) {
            SafeTransferLib.safeTransferETH(p.protocolTreasury, r.protocolFee);
            emit GraduationFeePaid(p.protocolTreasury, r.protocolFee);
        }
        // 19% of raise (+ 19% of carve) → alignment vault via receiveContribution
        if (r.vaultCut > 0) {
            CypherAlignmentVault(payable(p.vault)).receiveContribution{ value: r.vaultCut }(
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
        emit LiquidityDeployed(p.vault, r.pool, r.tokenId, r.ethToLP, p.tokenReserve);
    }

    /// @dev Front-run-safe pool acquisition. Returns a pool initialized at (or within tolerance of)
    ///      the intended graduation price, reverting PoolPriceMismatch on an attacker-skewed pre-init.
    function _createOrValidatePool(address token, uint160 intendedSqrtPriceX96) private returns (address pool) {
        pool = IAlgebraFactory(algebraFactory).poolByPair(token, weth);
        if (pool == address(0)) {
            pool = IAlgebraFactory(algebraFactory).createPool(token, weth, "");
            IAlgebraPool(pool).initialize(intendedSqrtPriceX96);
        } else {
            (uint160 existingSqrtPriceX96,,,,,) = IAlgebraPool(pool).globalState();
            if (existingSqrtPriceX96 == 0) {
                IAlgebraPool(pool).initialize(intendedSqrtPriceX96);
            } else {
                _requireSqrtPriceWithinTolerance(existingSqrtPriceX96, intendedSqrtPriceX96);
            }
        }
    }

    /// @dev Reverts unless |existing - intended| / intended <= MAX_INIT_PRICE_DEVIATION_BPS / 10000.
    function _requireSqrtPriceWithinTolerance(uint160 existingSqrtPriceX96, uint160 intendedSqrtPriceX96) private pure {
        uint256 diff = existingSqrtPriceX96 > intendedSqrtPriceX96
            ? existingSqrtPriceX96 - intendedSqrtPriceX96
            : intendedSqrtPriceX96 - existingSqrtPriceX96;
        if (diff * 10_000 > uint256(intendedSqrtPriceX96) * MAX_INIT_PRICE_DEVIATION_BPS) {
            revert PoolPriceMismatch();
        }
    }

    receive() external payable { }

    // ── IComponentModule ───────────────────────────────────────────────────────

    function metadataURI() external view override returns (string memory) {
        return _metadataURI;
    }

    function setMetadataURI(string calldata uri) external override onlyOwner {
        _metadataURI = uri;
        emit MetadataURIUpdated(uri);
    }
}
