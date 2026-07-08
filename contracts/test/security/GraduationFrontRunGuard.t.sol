// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { FixedPointMathLib } from "solady/utils/FixedPointMathLib.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { IHooks } from "v4-core/interfaces/IHooks.sol";

import { LiquidityDeployerModule } from "../../src/factories/erc404/LiquidityDeployerModule.sol";
import { CypherLiquidityDeployerModule } from "../../src/factories/erc404cypher/CypherLiquidityDeployerModule.sol";
import { ZAMMLiquidityDeployerModule } from "../../src/factories/erc404zamm/ZAMMLiquidityDeployerModule.sol";
import { ILiquidityDeployerModule } from "../../src/interfaces/ILiquidityDeployerModule.sol";
import { IAlgebraPool } from "../../src/interfaces/algebra/IAlgebra.sol";
import { CypherAlignmentVault } from "../../src/vaults/cypher/CypherAlignmentVault.sol";

import { MockZAMM } from "../mocks/MockZAMM.sol";
import { MockERC20 } from "../mocks/MockERC20.sol";
import { MockVault } from "../mocks/MockVault.sol";
import { MockWETH } from "../mocks/MockWETH.sol";
import { MockMasterRegistry } from "../mocks/MockMasterRegistry.sol";
import { MockAlgebraFactory, MockAlgebraPositionManager, MockAlgebraSwapRouter } from "../mocks/MockCypherAlgebra.sol";
import { LibClone } from "solady/utils/LibClone.sol";

/**
 * @title GraduationFrontRunGuard
 * @notice Finding 2 regressions: the graduation LP pool is at a publicly computable address, so an
 *         attacker can pre-initialize/pre-seed it. Every LP module must (a) tolerate a benign
 *         pre-init at the correct price (idempotent — graduation still succeeds, no permanent DoS)
 *         and (b) REVERT rather than add liquidity into an attacker-skewed pool. Each test
 *         demonstrates the DoS/skew is blocked by the fix; without the idempotent-init the correct-
 *         price case would revert (permanent DoS), and without the price guard the skewed case would
 *         silently seed LP at the attacker's price.
 */

// ── V4: exposed-helper harness over a minimal slot0 pool manager ──────────────
// The full V4 add-liquidity path is fork-tested (LiquidityDeployerModuleGraduationFork); here we
// drive the front-run-safe init helper directly against a mock that mimics getSlot0/initialize so
// the guard is exercised in the default (non-fork) suite.
contract V4InitGuardHarness is LiquidityDeployerModule {
    constructor(address pm) LiquidityDeployerModule(pm, address(0x3), 3000, 60, address(0)) { }

    function initOrValidate(PoolKey memory key, uint160 intendedSqrtPriceX96) external {
        _initOrValidatePool(key, intendedSqrtPriceX96);
    }

    function requireTol(uint160 existing, uint160 intended) external pure {
        _requireSqrtPriceWithinTolerance(existing, intended);
    }
}

/// @dev Minimal V4 PoolManager: getSlot0 reads a single stored slot0 word (only one pool per test),
///      and initialize mimics V4's revert-on-already-initialized. seed() stands in for a front-runner.
contract MockV4Slot0Manager {
    bytes32 private _slot0;
    bool public initializeCalled;

    function extsload(bytes32) external view returns (bytes32) {
        return _slot0;
    }

    function initialize(PoolKey calldata, uint160 sqrtPriceX96) external returns (int24) {
        require(uint160(uint256(_slot0)) == 0, "AlreadyInitialized");
        _slot0 = bytes32(uint256(sqrtPriceX96));
        initializeCalled = true;
        return 0;
    }

    function seed(uint160 sqrtPriceX96) external {
        _slot0 = bytes32(uint256(sqrtPriceX96));
    }
}

contract V4FrontRunGuardTest is Test {
    V4InitGuardHarness harness;
    MockV4Slot0Manager pm;

    uint160 constant INTENDED = 79_228_162_514_264_337_593_543_950_336; // sqrtPriceX96 for a 1:1 pool

    function setUp() public {
        pm = new MockV4Slot0Manager();
        harness = new V4InitGuardHarness(address(pm));
    }

    function _key() internal view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(0xC0FFEE)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
    }

    /// @notice Fresh pool (slot0 == 0) is initialized at the intended price.
    function test_v4_freshPool_initializes() public {
        harness.initOrValidate(_key(), INTENDED);
        assertTrue(pm.initializeCalled(), "fresh pool must be initialized");
    }

    /// @notice Pre-initialized at the correct price: idempotent — no re-init, no revert (no DoS).
    function test_v4_preInitCorrectPrice_idempotent() public {
        pm.seed(INTENDED);
        harness.initOrValidate(_key(), INTENDED); // must not revert
        assertFalse(pm.initializeCalled(), "already-initialized pool must not be re-initialized");
    }

    /// @notice Pre-initialized at a skewed price (>1%): reverts instead of seeding LP at attacker price.
    function test_v4_preInitSkewedPrice_reverts() public {
        pm.seed(uint160(uint256(INTENDED) * 2)); // ~4x price — far outside tolerance
        vm.expectRevert(LiquidityDeployerModule.PoolPriceMismatch.selector);
        harness.initOrValidate(_key(), INTENDED);
    }

    /// @notice Tolerance boundary: exactly 1% deviation passes; just beyond reverts.
    function test_v4_toleranceBoundary() public view {
        uint160 atEdge = uint160(uint256(INTENDED) * 101 / 100); // +1.00%
        harness.requireTol(atEdge, INTENDED); // must not revert
    }

    function test_v4_toleranceJustOver_reverts() public {
        uint160 over = uint160(uint256(INTENDED) * 101 / 100 + 1);
        vm.expectRevert(LiquidityDeployerModule.PoolPriceMismatch.selector);
        harness.requireTol(over, INTENDED);
    }
}

// ── Cypher (Algebra) ──────────────────────────────────────────────────────────
contract CypherFrontRunGuardTest is Test {
    CypherLiquidityDeployerModule deployer;
    CypherAlignmentVault vault;
    MockAlgebraFactory algebraFactory;
    MockAlgebraPositionManager positionManager;
    MockAlgebraSwapRouter swapRouter;
    MockERC20 token;
    MockWETH weth;
    MockMasterRegistry registry;

    address protocolTreasury = makeAddr("treasury");
    address instance;

    uint256 constant ETH_RESERVE = 1 ether;
    uint256 constant TOKEN_RESERVE = 1000e18;

    function setUp() public {
        algebraFactory = new MockAlgebraFactory();
        positionManager = new MockAlgebraPositionManager();
        swapRouter = new MockAlgebraSwapRouter();
        token = new MockERC20("Token", "TKN");
        weth = new MockWETH();
        registry = new MockMasterRegistry();
        instance = address(this);

        deployer = new CypherLiquidityDeployerModule(
            address(algebraFactory), address(positionManager), address(weth), address(registry)
        );

        CypherAlignmentVault impl = new CypherAlignmentVault();
        vault = CypherAlignmentVault(payable(LibClone.clone(address(impl))));
        vault.initialize(
            address(positionManager),
            address(swapRouter),
            address(weth),
            address(token),
            protocolTreasury,
            address(deployer),
            address(0)
        );
    }

    /// @dev The exact intended graduation sqrtPriceX96 the module computes (mirrors _setupPool).
    function _intendedSqrtPrice() internal view returns (uint160) {
        uint256 ethToLP = ETH_RESERVE - ETH_RESERVE / 100 - (ETH_RESERVE * 19) / 100; // 80%
        bool tokenIsZero = address(token) < address(weth);
        uint256 amount0 = tokenIsZero ? TOKEN_RESERVE : ethToLP;
        uint256 amount1 = tokenIsZero ? ethToLP : TOKEN_RESERVE;
        return uint160(FixedPointMathLib.sqrt(FixedPointMathLib.fullMulDiv(amount1, 1 << 192, amount0)));
    }

    function _params() internal view returns (ILiquidityDeployerModule.DeployParams memory p) {
        p = ILiquidityDeployerModule.DeployParams({
            ethReserve: ETH_RESERVE,
            tokenReserve: TOKEN_RESERVE,
            protocolTreasury: protocolTreasury,
            token: address(token),
            vault: address(vault),
            instance: instance,
            creator: address(0),
            carveEth: 0
        });
    }

    function _deploy() internal {
        token.mint(address(deployer), TOKEN_RESERVE);
        vm.deal(address(this), ETH_RESERVE);
        deployer.deployLiquidity{ value: ETH_RESERVE }(_params());
    }

    /// @notice Attacker pre-creates+initializes the pool at a skewed price → graduation REVERTS.
    function test_cypher_frontRun_skewedPrice_reverts() public {
        address pool = algebraFactory.createPool(address(token), address(weth), "");
        IAlgebraPool(pool).initialize(uint160(uint256(_intendedSqrtPrice()) * 2));

        token.mint(address(deployer), TOKEN_RESERVE);
        vm.deal(address(this), ETH_RESERVE);
        vm.expectRevert(CypherLiquidityDeployerModule.PoolPriceMismatch.selector);
        deployer.deployLiquidity{ value: ETH_RESERVE }(_params());
    }

    /// @notice Attacker pre-creates+initializes at the CORRECT price → graduation still SUCCEEDS.
    function test_cypher_frontRun_correctPrice_idempotentSuccess() public {
        address pool = algebraFactory.createPool(address(token), address(weth), "");
        IAlgebraPool(pool).initialize(_intendedSqrtPrice());

        _deploy();
        assertGt(vault.lpTokenId(), 0, "graduation must complete despite benign pre-init");
    }

    /// @notice Attacker only pre-CREATES the pool (uninitialized) — the old unconditional createPool
    ///         would have reverted "Pool exists" (permanent DoS); the module now reuses+initializes it.
    function test_cypher_frontRun_createdButUninitialized_success() public {
        algebraFactory.createPool(address(token), address(weth), ""); // exists but price == 0
        _deploy();
        assertGt(vault.lpTokenId(), 0, "graduation must complete on a pre-created uninitialized pool");
    }
}

// ── ZAMM ──────────────────────────────────────────────────────────────────────
contract ZAMMFrontRunGuardTest is Test {
    ZAMMLiquidityDeployerModule module;
    MockZAMM zamm;
    MockERC20 token;
    MockVault vault;
    MockMasterRegistry registry;

    address treasury = address(0xBEEF);
    address instance;

    uint256 constant FEE_OR_HOOK = 30;
    uint256 constant ETH_RESERVE = 10 ether;
    uint256 constant TOKEN_RESERVE = 1000 ether;

    function setUp() public {
        zamm = new MockZAMM();
        token = new MockERC20("Test", "TST");
        vault = new MockVault();
        registry = new MockMasterRegistry();
        module = new ZAMMLiquidityDeployerModule(address(zamm), FEE_OR_HOOK, address(registry));
        instance = address(this);
    }

    /// @dev Recompute the module's poolId for the ETH/token pair (ETH is token0, address(0) < token).
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
            instance: instance,
            creator: address(0),
            carveEth: 0
        });
    }

    // Intended ratio a1/a0 = tokenReserve / ethForPool, ethForPool = 80% of raise = 8 ether.
    uint112 constant ETH_FOR_POOL = 8 ether;

    /// @notice Attacker pre-seeds the pool at a skewed reserve ratio → graduation REVERTS.
    function test_zamm_frontRun_skewedRatio_reverts() public {
        // reserve ratio = 2000/8 = 250 vs intended 1000/8 = 125 → ~2x skew, far outside tolerance.
        zamm.setPool(_poolId(), ETH_FOR_POOL, 2000 ether, 1000 ether);

        token.mint(address(module), TOKEN_RESERVE);
        vm.deal(address(this), ETH_RESERVE);
        vm.expectRevert(ZAMMLiquidityDeployerModule.PoolPriceMismatch.selector);
        module.deployLiquidity{ value: ETH_RESERVE }(_params());
    }

    /// @notice Attacker pre-seeds at the CORRECT ratio → graduation still SUCCEEDS (idempotent).
    function test_zamm_frontRun_correctRatio_success() public {
        zamm.setPool(_poolId(), ETH_FOR_POOL, uint112(TOKEN_RESERVE), 1000 ether);

        token.mint(address(module), TOKEN_RESERVE);
        vm.deal(address(this), ETH_RESERVE);
        module.deployLiquidity{ value: ETH_RESERVE }(_params());

        assertEq(treasury.balance, ETH_RESERVE / 100, "graduation completes: protocol paid 1%");
    }

    /// @notice Fresh pool (no reserves) is created at our ratio by addLiquidity — success.
    function test_zamm_freshPool_success() public {
        token.mint(address(module), TOKEN_RESERVE);
        vm.deal(address(this), ETH_RESERVE);
        module.deployLiquidity{ value: ETH_RESERVE }(_params());
        assertEq(address(vault).balance, (ETH_RESERVE * 19) / 100, "vault paid 19% on fresh-pool graduation");
    }
}
