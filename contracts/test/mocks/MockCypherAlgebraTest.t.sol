// test/mocks/MockCypherAlgebraTest.t.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "forge-std/Test.sol";
import "../mocks/MockCypherAlgebra.sol";

contract MockCypherAlgebraTest is Test {
    MockAlgebraFactory factory;
    MockAlgebraPositionManager positionManager;
    MockAlgebraSwapRouter swapRouter;

    address weth;
    address token;

    function setUp() public {
        weth = makeAddr("weth");
        token = makeAddr("token");
        factory = new MockAlgebraFactory();
        positionManager = new MockAlgebraPositionManager();
        swapRouter = new MockAlgebraSwapRouter();
    }

    function test_factoryCreatesPool() public {
        address pool = factory.createPool(token, weth, "");
        assertNotEq(pool, address(0));
        assertEq(factory.poolByPair(token, weth), pool);
        assertEq(factory.poolByPair(weth, token), pool); // symmetric
    }

    function test_poolCanBeInitialized() public {
        address pool = factory.createPool(token, weth, "");
        MockAlgebraPool(pool).initialize(79228162514264337593543950336); // 1:1 sqrtPrice
        (uint160 price,,,,,) = MockAlgebraPool(pool).globalState();
        assertGt(price, 0);
    }

    function test_positionManagerMintReturnsTokenId() public {
        // Setup ERC20 mocks
        MockERC20 t0 = new MockERC20("A", "A");
        MockERC20 t1 = new MockERC20("B", "B");
        t0.mint(address(this), 10e18);
        t1.mint(address(this), 10e18);
        t0.approve(address(positionManager), 10e18);
        t1.approve(address(positionManager), 10e18);

        (uint256 tokenId, uint128 liquidity,,) = positionManager.mint(
            IAlgebraNFTPositionManager.MintParams({
                token0: address(t0),
                token1: address(t1),
                deployer: address(0),
                tickLower: -887220,
                tickUpper: 887220,
                amount0Desired: 1e18,
                amount1Desired: 1e18,
                amount0Min: 0,
                amount1Min: 0,
                recipient: address(this),
                deadline: block.timestamp + 1
            })
        );
        assertEq(tokenId, 1);
        assertGt(liquidity, 0);
        assertEq(positionManager.ownerOf(tokenId), address(this));
    }

    function test_positionManagerIncreaseLiquidityAggregates() public {
        MockERC20 t0 = new MockERC20("A", "A");
        MockERC20 t1 = new MockERC20("B", "B");
        t0.mint(address(this), 10e18);
        t1.mint(address(this), 10e18);
        t0.approve(address(positionManager), 10e18);
        t1.approve(address(positionManager), 10e18);

        (uint256 tokenId, uint128 mintedLiq,,) = positionManager.mint(
            IAlgebraNFTPositionManager.MintParams({
                token0: address(t0),
                token1: address(t1),
                deployer: address(0),
                tickLower: -887220,
                tickUpper: 887220,
                amount0Desired: 1e18,
                amount1Desired: 1e18,
                amount0Min: 0,
                amount1Min: 0,
                recipient: address(this),
                deadline: block.timestamp + 1
            })
        );

        (,,,,,,, uint128 liqAfterMint,,,,) = positionManager.positions(tokenId);
        assertEq(liqAfterMint, mintedLiq, "position starts at minted liquidity");

        // First add into the SAME tokenId strictly increases liquidity.
        (uint128 addLiq1,,) = positionManager.increaseLiquidity(
            IAlgebraNFTPositionManager.IncreaseLiquidityParams({
                tokenId: tokenId,
                amount0Desired: 0.5e18,
                amount1Desired: 0.5e18,
                amount0Min: 0,
                amount1Min: 0,
                deadline: block.timestamp + 1
            })
        );
        (,,,,,,, uint128 liqAfterAdd1,,,,) = positionManager.positions(tokenId);
        assertGt(liqAfterAdd1, liqAfterMint, "first add strictly increases liquidity");
        assertEq(liqAfterAdd1, liqAfterMint + addLiq1, "aggregated by the returned delta");

        // Second add into the SAME tokenId increases again — the repeat-convert aggregation 027b needs.
        (uint128 addLiq2,,) = positionManager.increaseLiquidity(
            IAlgebraNFTPositionManager.IncreaseLiquidityParams({
                tokenId: tokenId,
                amount0Desired: 0.25e18,
                amount1Desired: 0.25e18,
                amount0Min: 0,
                amount1Min: 0,
                deadline: block.timestamp + 1
            })
        );
        (,,,,,,, uint128 liqAfterAdd2,,,,) = positionManager.positions(tokenId);
        assertGt(liqAfterAdd2, liqAfterAdd1, "second add strictly increases liquidity again");
        assertEq(liqAfterAdd2, liqAfterAdd1 + addLiq2, "monotonic aggregation into one tokenId");
    }

    function test_positionManagerCollectReturnsFees() public {
        // Setup and mint a position first
        MockERC20 t0 = new MockERC20("A", "A");
        MockERC20 t1 = new MockERC20("B", "B");
        t0.mint(address(this), 10e18);
        t1.mint(address(this), 10e18);
        t0.approve(address(positionManager), 10e18);
        t1.approve(address(positionManager), 10e18);

        (uint256 tokenId,,,) = positionManager.mint(
            IAlgebraNFTPositionManager.MintParams({
                token0: address(t0),
                token1: address(t1),
                deployer: address(0),
                tickLower: -887220,
                tickUpper: 887220,
                amount0Desired: 1e18,
                amount1Desired: 1e18,
                amount0Min: 0,
                amount1Min: 0,
                recipient: address(this),
                deadline: block.timestamp + 1
            })
        );

        // Set fees and collect
        positionManager.setFees(tokenId, 0.1e18, 0.05e18);
        t0.mint(address(positionManager), 0.1e18);
        t1.mint(address(positionManager), 0.05e18);

        (uint256 a0, uint256 a1) = positionManager.collect(
            IAlgebraNFTPositionManager.CollectParams({
                tokenId: tokenId, recipient: address(this), amount0Max: type(uint128).max, amount1Max: type(uint128).max
            })
        );
        assertEq(a0, 0.1e18);
        assertEq(a1, 0.05e18);
    }
}
