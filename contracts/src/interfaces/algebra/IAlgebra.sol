// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal Algebra Integral factory interface
/// @dev `createPool` / `poolByPair` are the default-deployer path, which is the one this repo uses. The
///      factory also exposes a separate custom-deployer path (`customPoolByPair`) that is not declared here
///      because nothing in this repo creates or reads a custom pool.
interface IAlgebraFactory {
    function createPool(address tokenA, address tokenB, bytes calldata data) external returns (address pool);
    function poolByPair(address tokenA, address tokenB) external view returns (address pool);
}

/// @notice Minimal Algebra Integral pool interface
interface IAlgebraPool {
    function initialize(uint160 sqrtPriceX96) external;
    function globalState()
        external
        view
        returns (uint160 price, int24 tick, uint16 lastFee, uint8 pluginConfig, uint16 communityFee, bool unlocked);
    /// @notice The plugin (hook) attached to this pool; the Integral volatility-oracle plugin lives here.
    /// @dev `address(0)` = no plugin, so the pool exposes no TWAP oracle and cannot serve as a reference pool.
    function plugin() external view returns (address);
}

/// @notice Minimal Algebra Integral volatility-oracle plugin interface (the pool's `plugin()`).
/// @dev Hand-written against the production Algebra Integral `IVolatilityOracle` signature (verified against
///      camel404 `lib/Algebra/src/plugin/contracts/interfaces/plugins/IVolatilityOracle.sol`). `getTimepoints`
///      is the Algebra analogue of Uniswap V3's `observe`: it returns cumulative ticks at the requested lookback
///      offsets, from which a TWAP tick is `(tickCumulatives[1] - tickCumulatives[0]) / window`.
interface IVolatilityOracle {
    function getTimepoints(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint88[] memory volatilityCumulatives);
}

/// @notice Algebra Integral NonfungiblePositionManager (adds a deployer field vs Uniswap V3)
interface IAlgebraNFTPositionManager {
    struct MintParams {
        address token0;
        address token1;
        address deployer; // Algebra-specific: ALGEBRA_DEFAULT_DEPLOYER for a factory-created pool
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    struct IncreaseLiquidityParams {
        uint256 tokenId;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }

    struct DecreaseLiquidityParams {
        uint256 tokenId;
        uint128 liquidity;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    function mint(MintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);

    /// @dev Adds liquidity to an existing `tokenId` with tokens paid by `msg.sender`. Signature matches
    ///      the production Algebra Integral NFPM (camel404 `lib/Algebra/.../INonfungiblePositionManager.sol`).
    function increaseLiquidity(IncreaseLiquidityParams calldata params)
        external
        payable
        returns (uint128 liquidity, uint256 amount0, uint256 amount1);

    function collect(CollectParams calldata params) external payable returns (uint256 amount0, uint256 amount1);

    function decreaseLiquidity(DecreaseLiquidityParams calldata params)
        external
        payable
        returns (uint256 amount0, uint256 amount1);

    /// @dev Returns 12 values: nonce, operator, token0, token1, deployer,
    ///      tickLower, tickUpper, liquidity, feeGrowth0, feeGrowth1, tokensOwed0, tokensOwed1
    function positions(uint256 tokenId)
        external
        view
        returns (
            uint88 nonce,
            address operator,
            address token0,
            address token1,
            address deployer,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity,
            uint256 feeGrowthInside0LastX128,
            uint256 feeGrowthInside1LastX128,
            uint128 tokensOwed0,
            uint128 tokensOwed1
        );

    function approve(address spender, uint256 tokenId) external;
    function ownerOf(uint256 tokenId) external view returns (address);
    function transferFrom(address from, address to, uint256 tokenId) external;
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
}

/// @notice Algebra Integral SwapRouter (uses limitSqrtPrice instead of sqrtPriceLimitX96)
/// @dev The params tuple carries a `deployer` field between `tokenOut` and `recipient`, matching the
///      deployed Algebra Integral periphery router (`exactInputSingle` selector `0x1679c792`). The
///      seven-field Algebra V2 tuple — the same fields with `deployer` omitted — hashes to a different
///      selector (`0xbc651188`), which the deployed router does not expose: a call built from that shape
///      reaches the router's fallback and reverts. `test/fork/CypherAlgebraSeamFork.t.sol` pins both
///      facts against the live bytecode.
interface IAlgebraSwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        /// @dev Algebra-specific: names the pool deployer for a custom pool. `address(0)` selects the
        ///      factory's default deployer — the pool the Cypher LP family creates and LPs into via
        ///      `IAlgebraFactory.createPool` / `poolByPair`. Custom-deployer pools live behind the
        ///      factory's separate `customPoolByPair` path and are not used by this repo.
        address deployer;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 limitSqrtPrice; // Algebra-specific (0 = no limit)
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

// The default pool deployer for factory-created (non-custom) Algebra pools. Every Cypher-family pool is
// created through `IAlgebraFactory.createPool`, so this is the value the swap-router and NFPM params carry
// on every call this repo makes.
address constant ALGEBRA_DEFAULT_DEPLOYER = address(0);
