// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { FixedPointMathLib } from "solady/utils/FixedPointMathLib.sol";

import { IUnlockCallback } from "v4-core/interfaces/callback/IUnlockCallback.sol";
import { IPoolManager } from "v4-core/interfaces/IPoolManager.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { IHooks } from "v4-core/interfaces/IHooks.sol";
import { BalanceDelta, toBalanceDelta } from "v4-core/types/BalanceDelta.sol";
import { TickMath } from "v4-core/libraries/TickMath.sol";
import { SqrtPriceMath } from "v4-core/libraries/SqrtPriceMath.sol";
import { SafeCast } from "v4-core/libraries/SafeCast.sol";

import { LiquidityDeployerModule } from "../../src/factories/erc404/LiquidityDeployerModule.sol";
import { ZAMMLiquidityDeployerModule } from "../../src/factories/erc404zamm/ZAMMLiquidityDeployerModule.sol";
import { CypherLiquidityDeployerModule } from "../../src/factories/erc404cypher/CypherLiquidityDeployerModule.sol";
import { ILiquidityDeployerModule } from "../../src/interfaces/ILiquidityDeployerModule.sol";
import { CypherAlignmentVault } from "../../src/vaults/cypher/CypherAlignmentVault.sol";

import { MockERC20 } from "../mocks/MockERC20.sol";
import { MockWETH } from "../mocks/MockWETH.sol";
import { MockVault } from "../mocks/MockVault.sol";
import { MockZAMM } from "../mocks/MockZAMM.sol";
import { MockMasterRegistry } from "../mocks/MockMasterRegistry.sol";
import { MockAlignmentRegistry } from "../mocks/MockAlignmentRegistry.sol";
import { MockAlgebraFactory, MockAlgebraPositionManager, MockAlgebraSwapRouter } from "../mocks/MockCypherAlgebra.sol";
import { IAlgebraPool } from "../../src/interfaces/algebra/IAlgebra.sol";
import { LibClone } from "solady/utils/LibClone.sol";

/**
 * @title GraduationLpResidue
 * @notice A graduating launch hands its whole LP leg to a venue deployer module. When the venue
 *         consumes LESS than the module handed it — because a front-runner pre-initialized the pool
 *         at a price inside the module's own tolerance band — the remainder sits in the module. None
 *         of the three modules exposes any path that moves a stray balance out: not an owner sweep,
 *         not a permissionless drain, not `flushPendingVaultCut` (which can only pay out an amount a
 *         reverting vault previously stashed). These tests assert the post-graduation module balance
 *         is zero and show that it is not.
 */

// ─────────────────────────────────────────────────────────────────────────────
// A. Uniswap v4
// ─────────────────────────────────────────────────────────────────────────────

/// @dev A pool manager whose `modifyLiquidity` runs the REAL v4 arithmetic: the in-range branch of
///      `v4-core/libraries/Pool.sol:modifyLiquidity` verbatim, over v4-core's own `SqrtPriceMath`
///      signed delta helpers (round-up on an add). v4-core's `PoolManager` pins `pragma solidity
///      0.8.26` and cannot be compiled under this repo's pinned 0.8.28 deploy profile; `Pool.sol`,
///      `SqrtPriceMath.sol` and `TickMath.sol` are all `^0.8.0`, so the arithmetic under test is the
///      shipped arithmetic even though the wrapper is local.
contract RealMathV4PoolManager {
    using SafeCast for uint256;
    using SafeCast for int256;

    bytes32 private _slot0;

    function _pack(uint160 sqrtPriceX96) private pure returns (bytes32) {
        int24 tick = TickMath.getTickAtSqrtPrice(sqrtPriceX96);
        return bytes32(uint256(sqrtPriceX96) | (uint256(uint24(tick)) << 160));
    }

    function extsload(bytes32) external view returns (bytes32) {
        return _slot0;
    }

    function initialize(PoolKey calldata, uint160 sqrtPriceX96) external returns (int24) {
        require(uint160(uint256(_slot0)) == 0, "AlreadyInitialized");
        _slot0 = _pack(sqrtPriceX96);
        return TickMath.getTickAtSqrtPrice(sqrtPriceX96);
    }

    /// @dev Stands in for the front-runner's `initialize`.
    function seed(uint160 sqrtPriceX96) external {
        _slot0 = _pack(sqrtPriceX96);
    }

    function unlock(bytes calldata data) external returns (bytes memory) {
        return IUnlockCallback(msg.sender).unlockCallback(data);
    }

    function modifyLiquidity(PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata p, bytes calldata)
        external
        view
        returns (BalanceDelta, BalanceDelta)
    {
        uint160 sqrtPriceX96 = uint160(uint256(_slot0));
        int128 liquidityDelta = int128(p.liquidityDelta);
        // Full-range position: the live price is always strictly inside, so this is Pool.sol's
        // `tick < tickUpper` branch.
        BalanceDelta delta = toBalanceDelta(
            SqrtPriceMath.getAmount0Delta(sqrtPriceX96, TickMath.getSqrtPriceAtTick(p.tickUpper), liquidityDelta)
                .toInt128(),
            SqrtPriceMath.getAmount1Delta(TickMath.getSqrtPriceAtTick(p.tickLower), sqrtPriceX96, liquidityDelta)
                .toInt128()
        );
        return (delta, toBalanceDelta(int128(0), int128(0)));
    }

    function sync(Currency) external { }

    function settle() external payable returns (uint256) {
        return 0;
    }

    function take(Currency currency, address to, uint256 amount) external {
        if (Currency.unwrap(currency) == address(0)) {
            (bool ok,) = payable(to).call{ value: amount }("");
            require(ok, "take: eth");
        } else {
            MockERC20(Currency.unwrap(currency)).transfer(to, amount);
        }
    }

    receive() external payable { }
}

/// @dev Stands in for the graduating ERC404 instance: it IS the token (ERC404 instance == token),
///      answers the `IGraduationSkipNFTTarget` handshake, and is the `msg.sender` the module's
///      caller guard demands.
contract FakeERC404Instance is MockERC20 {
    constructor() MockERC20("Graduating", "GRAD") { }

    function markGraduationSkipNFT(address) external { }

    function owner() external view returns (address) {
        return address(this);
    }

    function graduate(address module, ILiquidityDeployerModule.DeployParams memory p, uint256 value) external {
        ILiquidityDeployerModule(module).deployLiquidity{ value: value }(p);
    }

    receive() external payable { }
}

contract V4GraduationLpResidueTest is Test {
    LiquidityDeployerModule internal module;
    RealMathV4PoolManager internal pm;
    FakeERC404Instance internal instance;
    MockVault internal vault;
    MockMasterRegistry internal registry;

    address internal treasury = makeAddr("treasury");
    address internal constant CREATOR = address(0xC0FFEE);

    // The shipped mid launch preset (`script/LaunchPresets.sol`: 5 / 25 / 50 ether targets).
    uint256 internal constant ETH_RESERVE = 25 ether;
    uint256 internal constant TOKEN_RESERVE = 1_000_000 ether;
    uint256 internal constant ETH_FOR_POOL = ETH_RESERVE - ETH_RESERVE / 100 - (ETH_RESERVE * 19) / 100; // 80%

    uint24 internal constant POOL_FEE = 3000;
    int24 internal constant TICK_SPACING = 60;

    function setUp() public {
        pm = new RealMathV4PoolManager();
        registry = new MockMasterRegistry();
        vault = new MockVault();
        instance = new FakeERC404Instance();
        module = new LiquidityDeployerModule(address(pm), address(0x3), POOL_FEE, TICK_SPACING, address(registry));
    }

    /// @dev The module's own intended price (`_computeSqrtPrice`, token0IsThis == false).
    function _intendedSqrtPrice() internal pure returns (uint160) {
        return uint160(FixedPointMathLib.sqrt(FixedPointMathLib.fullMulDiv(TOKEN_RESERVE, 1 << 192, ETH_FOR_POOL)));
    }

    function _key() internal view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(instance)),
            fee: POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });
    }

    function _params() internal view returns (ILiquidityDeployerModule.DeployParams memory p) {
        p = ILiquidityDeployerModule.DeployParams({
            ethReserve: ETH_RESERVE,
            tokenReserve: TOKEN_RESERVE,
            protocolTreasury: treasury,
            vault: address(vault),
            token: address(instance),
            instance: address(instance),
            creator: CREATOR,
            carveEth: 0,
            excessEth: 0
        });
    }

    function _graduate() internal {
        instance.mint(address(module), TOKEN_RESERVE);
        vm.deal(address(instance), ETH_RESERVE);
        instance.graduate(address(module), _params(), ETH_RESERVE);
    }

    /// @notice CONTROL: a fresh pool is initialized at the module's own price, so both sides are
    ///         consumed to within rounding dust and nothing of consequence is left behind.
    function test_v4_freshPool_leavesNoMeaningfulResidue() public {
        _graduate();
        emit log_named_uint("fresh-pool residue, wei ", address(module).balance);
        emit log_named_uint("fresh-pool residue, coin", instance.balanceOf(address(module)));
        assertLt(address(module).balance, 1000, "fresh-pool graduation must leave at most rounding dust");
    }

    /// @notice A front-runner pre-initializes the graduation pool at +1.00% on `sqrtPriceX96` — the
    ///         exact edge `MAX_INIT_PRICE_DEVIATION_BPS` permits. The module accepts the pool,
    ///         `getLiquidityForAmounts` takes `min(L0, L1)` at the LIVE price, the token side binds,
    ///         and the unconsumed ETH stays in a module with no way to move it out.
    function test_v4_preInitWithinTolerance_strandsEth() public {
        pm.seed(uint160(uint256(_intendedSqrtPrice()) * 101 / 100));

        _graduate();

        uint256 stranded = address(module).balance;
        emit log_named_decimal_uint("ETH for pool        ", ETH_FOR_POOL, 18);
        emit log_named_decimal_uint("stranded in module  ", stranded, 18);
        emit log_named_uint("stranded, bps of LP ETH", stranded * 10_000 / ETH_FOR_POOL);

        assertEq(stranded, 0, "graduation must not leave ETH in the deployer module");
    }

    /// @notice The mirror image: pre-initialized 1.00% BELOW on `sqrtPriceX96` strands the COIN side
    ///         instead, in a module with no ERC20 transfer path at all.
    function test_v4_preInitWithinTolerance_strandsToken() public {
        // Largest downward deviation the guard still accepts: diff <= intended/100 (floored).
        uint160 intended = _intendedSqrtPrice();
        pm.seed(uint160(uint256(intended) - uint256(intended) / 100));

        _graduate();

        uint256 stranded = instance.balanceOf(address(module));
        emit log_named_decimal_uint("tokens for pool     ", TOKEN_RESERVE, 18);
        emit log_named_decimal_uint("stranded in module  ", stranded, 18);
        emit log_named_uint("stranded, bps of LP coin", stranded * 10_000 / TOKEN_RESERVE);

        assertEq(stranded, 0, "graduation must not leave coin in the deployer module");
    }

    /// @notice And there is no way out. After the strand the module holds the ETH; the only
    ///         value-moving entry point it has is `flushPendingVaultCut`, which can pay out nothing
    ///         but an amount a reverting vault previously stashed. The contract is `Ownable`, but the
    ///         only owner-gated functions are `setMetadataURI`, `setAlignmentHookFactory`,
    ///         `setHookFeeBips` and `setLpFeeRate` — no sweep, no rescue, and `receive()` is bare.
    function test_v4_strandedEth_hasNoExit() public {
        pm.seed(uint160(uint256(_intendedSqrtPrice()) * 101 / 100));
        _graduate();

        uint256 stranded = address(module).balance;
        assertGt(stranded, 0, "precondition: ETH is stranded");

        vm.expectRevert(LiquidityDeployerModule.NoPendingVaultCut.selector);
        module.flushPendingVaultCut(address(instance));

        vm.prank(module.owner());
        vm.expectRevert(); // no owner-gated function moves value; this selector does not exist
        (bool ok,) = address(module).call(abi.encodeWithSignature("withdraw()"));
        ok;

        assertEq(address(module).balance, stranded, "the ETH is still there, with no path out");
    }

    /// @notice The label says 1%. The check is applied to `sqrtPriceX96`, and price is its square, so
    ///         the band a front-runner actually gets is -1.99% / +2.01% on PRICE. This test passes —
    ///         it is documentation of the real width, not a failure.
    function test_v4_tolerance_isTwoPercentOnPrice() public view {
        uint160 intended = _intendedSqrtPrice();
        // The extreme pool prices the guard accepts: |diff| <= intended/100 (floored).
        uint160 high = uint160(uint256(intended) + uint256(intended) / 100);
        uint160 low = uint160(uint256(intended) - uint256(intended) / 100);

        // price ratio in bps, computed as (sqrt/intended)^2. One bps of slack absorbs the
        // integer truncation in `intended/100` itself.
        uint256 highBps = FixedPointMathLib.fullMulDiv(uint256(high) * high, 10_000, uint256(intended) * intended);
        uint256 lowBps = FixedPointMathLib.fullMulDiv(uint256(low) * low, 10_000, uint256(intended) * intended);

        assertApproxEqAbs(highBps, 10_201, 1, "+1% on sqrtPriceX96 is +2.01% on price");
        assertApproxEqAbs(lowBps, 9801, 1, "-1% on sqrtPriceX96 is -1.99% on price");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// B. ZAMM
// ─────────────────────────────────────────────────────────────────────────────

contract ZAMMGraduationLpResidueTest is Test {
    function markGraduationSkipNFT(address) external { }

    ZAMMLiquidityDeployerModule internal module;
    MockZAMM internal zamm;
    MockERC20 internal token;
    MockVault internal vault;
    MockMasterRegistry internal registry;

    address internal treasury = makeAddr("treasury");
    address internal constant CREATOR = address(0xC0FFEE);

    uint256 internal constant FEE_OR_HOOK = 30;
    uint256 internal constant ETH_RESERVE = 25 ether;
    uint256 internal constant TOKEN_RESERVE = 1_000_000 ether;
    uint256 internal constant ETH_FOR_POOL = ETH_RESERVE - ETH_RESERVE / 100 - (ETH_RESERVE * 19) / 100;

    function setUp() public {
        zamm = new MockZAMM();
        token = new MockERC20("Test", "TST");
        vault = new MockVault();
        registry = new MockMasterRegistry();
        module = new ZAMMLiquidityDeployerModule(address(zamm), FEE_OR_HOOK, address(registry));
    }

    function _poolId() internal view returns (uint256) {
        MockZAMM.PoolKey memory key =
            MockZAMM.PoolKey({ id0: 0, id1: 0, token0: address(0), token1: address(token), feeOrHook: FEE_OR_HOOK });
        return uint256(keccak256(abi.encode(key)));
    }

    function _params() internal view returns (ILiquidityDeployerModule.DeployParams memory p) {
        p = ILiquidityDeployerModule.DeployParams({
            ethReserve: ETH_RESERVE,
            tokenReserve: TOKEN_RESERVE,
            protocolTreasury: treasury,
            vault: address(vault),
            token: address(token),
            instance: address(this),
            creator: CREATOR,
            carveEth: 0,
            excessEth: 0
        });
    }

    function _graduate() internal {
        token.mint(address(module), TOKEN_RESERVE);
        vm.deal(address(this), ETH_RESERVE);
        module.deployLiquidity{ value: ETH_RESERVE }(_params());
    }

    /// @notice A front-runner pre-seeds the pool with a reserve ratio 1% richer in coin than the
    ///         intended graduation ratio — inside `MAX_INIT_PRICE_DEVIATION_BPS`, so the guard
    ///         passes. ZAMM's `addLiquidity` then caps the ETH leg at the pool ratio and refunds the
    ///         remainder to `msg.sender` — this module — whose `receive()` is bare. The module
    ///         discards the returned `(amount0, amount1)` entirely, so it never even observes it.
    function test_zamm_preSeedWithinTolerance_strandsRefundedEth() public {
        // reserve1/reserve0 = 1.01 x the intended TOKEN_RESERVE/ETH_FOR_POOL.
        zamm.setPool(_poolId(), uint112(ETH_FOR_POOL), uint112(TOKEN_RESERVE * 101 / 100), 1000 ether);

        _graduate();

        uint256 stranded = address(module).balance;
        emit log_named_decimal_uint("ETH for pool        ", ETH_FOR_POOL, 18);
        emit log_named_decimal_uint("stranded in module  ", stranded, 18);
        emit log_named_uint("stranded, bps of LP ETH", stranded * 10_000 / ETH_FOR_POOL);

        assertEq(stranded, 0, "ZAMM's ETH refund must not be stranded in the deployer module");
    }

    /// @notice The mirror image: a pool 1% poorer in coin caps the COIN leg, and the unpulled
    ///         balance sits in a module with no ERC20 transfer path.
    function test_zamm_preSeedWithinTolerance_strandsToken() public {
        zamm.setPool(_poolId(), uint112(ETH_FOR_POOL), uint112(TOKEN_RESERVE * 99 / 100), 1000 ether);

        _graduate();

        uint256 stranded = token.balanceOf(address(module));
        emit log_named_decimal_uint("stranded coin       ", stranded, 18);
        assertEq(stranded, 0, "unpulled coin must not be stranded in the deployer module");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// C. Cypher / Algebra
// ─────────────────────────────────────────────────────────────────────────────

contract CypherGraduationLpResidueTest is Test {
    function markGraduationSkipNFT(address) external { }

    CypherLiquidityDeployerModule internal module;
    CypherAlignmentVault internal vault;
    MockAlgebraFactory internal algebraFactory;
    MockAlgebraPositionManager internal positionManager;
    MockAlgebraSwapRouter internal swapRouter;
    MockERC20 internal token;
    MockWETH internal weth;
    MockMasterRegistry internal registry;
    MockAlignmentRegistry internal alignmentRegistry;

    address internal treasury = makeAddr("treasury");
    address internal constant CREATOR = address(0xC0FFEE);

    uint256 internal constant ETH_RESERVE = 25 ether;
    uint256 internal constant TOKEN_RESERVE = 1_000_000 ether;
    uint256 internal constant ETH_FOR_POOL = ETH_RESERVE - ETH_RESERVE / 100 - (ETH_RESERVE * 19) / 100;
    uint256 internal constant TARGET_ID = 1;

    function setUp() public {
        algebraFactory = new MockAlgebraFactory();
        positionManager = new MockAlgebraPositionManager();
        swapRouter = new MockAlgebraSwapRouter();
        token = new MockERC20("Token", "TKN");
        weth = new MockWETH();
        registry = new MockMasterRegistry();
        alignmentRegistry = new MockAlignmentRegistry();
        alignmentRegistry.setTargetActive(TARGET_ID, true);
        alignmentRegistry.setTokenInTarget(TARGET_ID, address(token), true);

        module = new CypherLiquidityDeployerModule(
            address(algebraFactory), address(positionManager), address(weth), address(registry)
        );

        CypherAlignmentVault impl = new CypherAlignmentVault();
        vault = CypherAlignmentVault(payable(LibClone.clone(address(impl))));
        vault.initialize(
            address(positionManager),
            address(swapRouter),
            address(algebraFactory),
            address(weth),
            address(token),
            treasury,
            makeAddr("zRouter"),
            address(0),
            address(0),
            alignmentRegistry,
            TARGET_ID
        );
    }

    function _params() internal view returns (ILiquidityDeployerModule.DeployParams memory p) {
        p = ILiquidityDeployerModule.DeployParams({
            ethReserve: ETH_RESERVE,
            tokenReserve: TOKEN_RESERVE,
            protocolTreasury: treasury,
            token: address(token),
            vault: address(vault),
            instance: address(this),
            creator: CREATOR,
            carveEth: 0,
            excessEth: 0
        });
    }

    function _graduate() internal {
        token.mint(address(module), TOKEN_RESERVE);
        vm.deal(address(this), ETH_RESERVE);
        module.deployLiquidity{ value: ETH_RESERVE }(_params());
    }

    /// @notice The module wraps the WHOLE LP leg to WETH up front and mints with `amount*99/100`
    ///         floors, so the position manager may absorb as little as 99% of each side. Whatever it
    ///         leaves is WETH and ERC20 coin sitting in a module that exposes no ERC20 transfer path
    ///         — not even an owner one. (`absorbBps = 9900` is the repo mock's own knob for exactly
    ///         this; real Algebra under-consumes one side rather than both, but the stranded WETH is
    ///         the same magnitude.)
    function test_cypher_venueAbsorbsLessThanSent_strandsWeth() public {
        positionManager.setAbsorbBps(9900);

        _graduate();

        uint256 strandedWeth = weth.balanceOf(address(module));
        uint256 strandedToken = token.balanceOf(address(module));
        emit log_named_decimal_uint("ETH for pool (wrapped)", ETH_FOR_POOL, 18);
        emit log_named_decimal_uint("stranded WETH         ", strandedWeth, 18);
        emit log_named_decimal_uint("stranded coin         ", strandedToken, 18);

        assertEq(strandedWeth, 0, "unconsumed WETH must not be stranded in the deployer module");
    }
}
