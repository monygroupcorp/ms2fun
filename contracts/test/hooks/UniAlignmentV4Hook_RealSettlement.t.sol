// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test, console2 } from "forge-std/Test.sol";
import { IHooks } from "v4-core/interfaces/IHooks.sol";
import { IPoolManager } from "v4-core/interfaces/IPoolManager.sol";
import { PoolManager } from "v4-core/PoolManager.sol";
import { Currency, CurrencyLibrary } from "v4-core/types/Currency.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { LPFeeLibrary } from "v4-core/libraries/LPFeeLibrary.sol";
import { TickMath } from "v4-core/libraries/TickMath.sol";
import { PoolSwapTest } from "../../lib/v4-core/src/test/PoolSwapTest.sol";
import { PoolModifyLiquidityTest } from "../../lib/v4-core/src/test/PoolModifyLiquidityTest.sol";
import { UniAlignmentV4Hook } from "../../src/factories/erc404/hooks/UniAlignmentV4Hook.sol";
import { UniTitheHookFactory } from "../../src/factories/erc404/hooks/UniTitheHookFactory.sol";
import { HookAddressMiner } from "../../src/factories/erc404/hooks/HookAddressMiner.sol";
import { IAlignmentVault } from "../../src/interfaces/IAlignmentVault.sol";
import { StateLibrary } from "v4-core/libraries/StateLibrary.sol";
import { PoolId, PoolIdLibrary } from "v4-core/types/PoolId.sol";
import { LiquidityDeployerModule } from "../../src/factories/erc404/LiquidityDeployerModule.sol";
import { ILiquidityDeployerModule } from "../../src/interfaces/ILiquidityDeployerModule.sol";
import { MockMasterRegistry } from "../mocks/MockMasterRegistry.sol";
import { Vm } from "forge-std/Vm.sol";

/**
 * @title UniAlignmentV4Hook_RealSettlement
 * @notice DECISIVE end-to-end test of the REAL UniAlignmentV4Hook against a REAL in-memory v4-core
 *         PoolManager (no fork, no mock hook, no vm.etch of MockTaxHook). Deploys the real hook at an
 *         address carrying the required permission bits (so the real constructor's
 *         validateHookPermissions passes), initializes a native-ETH(currency0)/ERC20(currency1) pool
 *         wired to the hook, adds liquidity, and runs all four swap shapes through PoolManager.
 *
 * WHAT THIS PROVES (noesis-116, Option B fix): the ETH alignment tithe now settles on EVERY real swap
 * shape. The hook splits the ETH-side take by which side ETH is on:
 *   - beforeSwap taxes the ETH INPUT when ETH is the specified currency (shape 1, exact-input ETH buy),
 *     returning the fee as a BeforeSwapDelta on the specified currency so it settles against take(ETH);
 *   - afterSwap taxes the ETH OUTPUT when ETH is the unspecified currency (shape 2 exact-output buy,
 *     shape 3 exact-input sell), returning the fee on the unspecified currency.
 *   - shape 4 (exact-output token->ETH sell, ETH specified output) is untaxed BY DESIGN — never a
 *     frontend path — and must cleanly NOT revert.
 * All four shapes settle (no CurrencyNotSettled). Shapes 1/2/3 deliver the ETH fee to the vault; shape 4
 * delivers nothing. Shape 1 is taxed exactly once (no double-tax).
 *
 * Permission bits: beforeSwap|beforeSwapReturnDelta|afterSwap|afterSwapReturnDelta = 0xCC.
 */
contract UniAlignmentV4Hook_RealSettlement is Test {
    PoolManager internal manager;
    PoolSwapTest internal swapRouter;
    PoolModifyLiquidityTest internal modifyLiquidityRouter;

    UniAlignmentV4Hook internal hook;
    MockVault internal vault;
    TestToken internal token;

    Currency internal ethCurrency; // native, address(0), currency0
    Currency internal tokenCurrency; // ERC20, currency1
    PoolKey internal poolKey;

    bytes internal constant ZERO_BYTES = "";
    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;
    uint160 internal MIN_PRICE_LIMIT = TickMath.MIN_SQRT_PRICE + 1;
    uint160 internal MAX_PRICE_LIMIT = TickMath.MAX_SQRT_PRICE - 1;

    address internal constant WETH = address(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);
    address internal owner = address(0xB055);
    address internal benefactor = address(0x7777777777777777777777777777777777777777);
    uint256 internal constant HOOK_FEE_BIPS = 100; // 1%
    uint24 internal constant LP_FEE_RATE = 3000; // 0.3%

    function setUp() public {
        manager = new PoolManager(address(this));
        swapRouter = new PoolSwapTest(manager);
        modifyLiquidityRouter = new PoolModifyLiquidityTest(manager);

        // currency1 = ERC20; currency0 = native ETH (address(0) < any token address).
        token = new TestToken();
        token.mint(address(this), 1_000_000 ether);
        token.approve(address(swapRouter), type(uint256).max);
        token.approve(address(modifyLiquidityRouter), type(uint256).max);
        tokenCurrency = Currency.wrap(address(token));
        ethCurrency = CurrencyLibrary.ADDRESS_ZERO;

        vault = new MockVault();

        // Address carrying EXACTLY beforeSwap|beforeSwapReturnDelta|afterSwap|afterSwapReturnDelta (0xCC)
        // in the low 14 bits, so the real constructor's validateHookPermissions() passes. Higher bits free.
        // 0xCC = 1<<7 (beforeSwap) | 1<<6 (afterSwap) | 1<<3 (beforeSwapReturnDelta) | 1<<2 (afterSwapReturnDelta).
        address hookAddr = address((uint160(0x4242) << 14) | uint160(0x00CC));

        deployCodeTo(
            "UniAlignmentV4Hook.sol:UniAlignmentV4Hook",
            abi.encode(
                IPoolManager(address(manager)),
                IAlignmentVault(payable(address(vault))),
                WETH,
                owner,
                benefactor,
                HOOK_FEE_BIPS,
                LP_FEE_RATE
            ),
            hookAddr
        );
        hook = UniAlignmentV4Hook(payable(hookAddr));

        // Dynamic-fee pool (hook overrides LP fee in beforeSwap), native/token, hook wired in.
        poolKey = PoolKey({
            currency0: ethCurrency,
            currency1: tokenCurrency,
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks: IHooks(hookAddr)
        });
        manager.initialize(poolKey, SQRT_PRICE_1_1);

        // Fund and add wide-range liquidity: native side needs ETH value; token side is approved.
        vm.deal(address(this), 10_000 ether);
        IPoolManager.ModifyLiquidityParams memory lp =
            IPoolManager.ModifyLiquidityParams({ tickLower: -6000, tickUpper: 6000, liquidityDelta: 100e18, salt: 0 });
        modifyLiquidityRouter.modifyLiquidity{ value: 500 ether }(poolKey, lp, ZERO_BYTES);
    }

    function _settings() internal pure returns (PoolSwapTest.TestSettings memory) {
        return PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });
    }

    // ---- Shape 1: exact-input ETH->token buy — ETH is the SPECIFIED input. Taxed in beforeSwap. ----
    // Was the CRITICAL bug: unconditional afterSwap take(ETH) returned the delta on the token
    // (unspecified) currency -> CurrencyNotSettled -> every frontend buy reverted. Now it settles and
    // the ETH fee reaches the vault, taxed exactly once.
    function test_exactInput_ethBuy_settles_and_taxes_once() public {
        uint256 beforeBal = vault.totalReceived();
        IPoolManager.SwapParams memory p = IPoolManager.SwapParams({
            zeroForOne: true,
            amountSpecified: -1 ether, // exact input: spend 1 ETH
            sqrtPriceLimitX96: MIN_PRICE_LIMIT
        });
        // No revert (previously reverted CurrencyNotSettled).
        swapRouter.swap{ value: 1 ether }(poolKey, p, _settings(), ZERO_BYTES);

        // Fee is exactly 1% of the 1 ETH input, delivered ONCE (proves no double-tax: 0.01, not 0.02).
        uint256 expectedFee = (1 ether * HOOK_FEE_BIPS) / 10000; // 0.01 ETH
        assertEq(vault.totalReceived() - beforeBal, expectedFee, "shape1 fee must be exactly 1% of ETH input, once");
        assertEq(hook.queuedFees(), 0, "no fees should be queued (vault accepts)");
    }

    // ---- Shape 2: exact-output ETH->token buy — ETH is UNSPECIFIED. Taxed in afterSwap (unchanged). ----
    function test_exactOutput_ethBuy_settles_and_taxes() public {
        uint256 beforeBal = vault.totalReceived();
        IPoolManager.SwapParams memory p = IPoolManager.SwapParams({
            zeroForOne: true,
            amountSpecified: 1e18, // exact output: receive 1e18 token
            sqrtPriceLimitX96: MIN_PRICE_LIMIT
        });
        swapRouter.swap{ value: 100 ether }(poolKey, p, _settings(), ZERO_BYTES);

        // ETH fee delivered to the vault (1% of the ETH the pool moved).
        assertGt(vault.totalReceived() - beforeBal, 0, "shape2 must deliver ETH fee to vault");
    }

    // ---- Shape 3: exact-input token->ETH sell — ETH is UNSPECIFIED. Taxed in afterSwap (unchanged). ----
    function test_exactInput_tokenSell_settles_and_taxes() public {
        uint256 beforeBal = vault.totalReceived();
        IPoolManager.SwapParams memory p = IPoolManager.SwapParams({
            zeroForOne: false,
            amountSpecified: -1e18, // exact input: sell 1e18 token
            sqrtPriceLimitX96: MAX_PRICE_LIMIT
        });
        swapRouter.swap(poolKey, p, _settings(), ZERO_BYTES);

        assertGt(vault.totalReceived() - beforeBal, 0, "shape3 must deliver ETH fee to vault");
    }

    // ---- Shape 4: exact-output token->ETH sell — ETH is SPECIFIED output. Untaxed BY DESIGN. ----
    // Was the second reverting shape; now it must cleanly settle WITHOUT taxing (never a frontend path).
    function test_exactOutput_tokenSell_settles_untaxed() public {
        uint256 beforeBal = vault.totalReceived();
        IPoolManager.SwapParams memory p = IPoolManager.SwapParams({
            zeroForOne: false,
            amountSpecified: 0.5 ether, // exact output: receive 0.5 ETH
            sqrtPriceLimitX96: MAX_PRICE_LIMIT
        });
        // No revert (previously reverted CurrencyNotSettled).
        swapRouter.swap(poolKey, p, _settings(), ZERO_BYTES);

        // Untaxed by design: nothing reaches the vault, nothing is queued.
        assertEq(vault.totalReceived() - beforeBal, 0, "shape4 is untaxed by design");
        assertEq(hook.queuedFees(), 0, "shape4 queues nothing");
    }

    receive() external payable { }
}

/// @notice Minimal vault stub that accepts the hook's ETH contribution and tracks the total received.
contract MockVault {
    event Received(Currency currency, uint256 amount, address benefactor);

    uint256 public totalReceived;

    receive() external payable { }

    function receiveContribution(Currency currency, uint256 amount, address benefactor) external payable {
        totalReceived += msg.value;
        emit Received(currency, amount, benefactor);
    }
}

/// @notice Minimal ERC20 sufficient for v4 CurrencySettler (transfer/transferFrom/approve).
contract TestToken {
    string public name = "TEST";
    string public symbol = "TEST";
    uint8 public decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/**
 * @title UniTitheHookFactory_RealSettlement
 * @notice DECISIVE proof that a hook DEPLOYED BY THE FACTORY (on-chain salt-mine + CREATE2), not
 *         hand-placed via deployCodeTo, passes Uniswap v4's `validateHookPermissions` when wired into a
 *         REAL in-memory v4-core PoolManager: the pool initializes without reverting and taxes a live
 *         swap. Runs ONLY under `FOUNDRY_CONFIG=foundry.v4.toml` (co-located in this already-skipped
 *         file so the pinned-0.8.28 default profile never compiles the real PoolManager import).
 */
contract UniTitheHookFactory_RealSettlement is Test {
    PoolManager internal manager;
    PoolSwapTest internal swapRouter;
    PoolModifyLiquidityTest internal modifyLiquidityRouter;

    UniTitheHookFactory internal factory;
    address internal hookAddr;
    MockVault internal vault;
    TestToken internal token;

    Currency internal ethCurrency;
    Currency internal tokenCurrency;
    PoolKey internal poolKey;

    address internal constant WETH = address(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);
    address internal owner = address(0xB055);
    address internal benefactor = address(0x7777777777777777777777777777777777777777);
    uint256 internal constant HOOK_FEE_BIPS = 100; // 1%
    uint24 internal constant LP_FEE_RATE = 3000; // 0.3%

    bytes internal constant ZERO_BYTES = "";
    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;
    uint160 internal MIN_PRICE_LIMIT = TickMath.MIN_SQRT_PRICE + 1;

    function setUp() public {
        manager = new PoolManager(address(this));
        swapRouter = new PoolSwapTest(manager);
        modifyLiquidityRouter = new PoolModifyLiquidityTest(manager);

        token = new TestToken();
        token.mint(address(this), 1_000_000 ether);
        token.approve(address(swapRouter), type(uint256).max);
        token.approve(address(modifyLiquidityRouter), type(uint256).max);
        tokenCurrency = Currency.wrap(address(token));
        ethCurrency = CurrencyLibrary.ADDRESS_ZERO;

        vault = new MockVault();

        // The factory mines a salt on-chain and CREATE2-deploys the hook at a 0xCC-valid address.
        factory = new UniTitheHookFactory(IPoolManager(address(manager)), WETH, owner);
        hookAddr = factory.deployHook(IAlignmentVault(payable(address(vault))), benefactor, HOOK_FEE_BIPS, LP_FEE_RATE);
    }

    /// @notice The factory-mined address carries exactly 0xCC and a real pool initializes with it — no revert.
    function test_factory_hook_initializes_real_pool() public {
        assertTrue(
            HookAddressMiner.isValidUniAlignmentHookAddress(hookAddr), "factory hook must carry exactly 0xCC bits"
        );

        UniAlignmentV4Hook hook = UniAlignmentV4Hook(payable(hookAddr));
        assertEq(address(hook.poolManager()), address(manager), "poolManager wired");
        assertEq(address(hook.vault()), address(vault), "vault wired");
        assertEq(hook.benefactor(), benefactor, "benefactor wired");
        assertEq(hook.hookFeeBips(), HOOK_FEE_BIPS, "fee wired");

        poolKey = PoolKey({
            currency0: ethCurrency,
            currency1: tokenCurrency,
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks: IHooks(hookAddr)
        });
        // The decisive assertion: real v4-core validates the hook's permission bits at initialize().
        manager.initialize(poolKey, SQRT_PRICE_1_1);
    }

    /// @notice A live swap through the factory-deployed hook taxes the ETH side to the vault (end-to-end).
    function test_factory_hook_taxes_real_swap() public {
        poolKey = PoolKey({
            currency0: ethCurrency,
            currency1: tokenCurrency,
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks: IHooks(hookAddr)
        });
        manager.initialize(poolKey, SQRT_PRICE_1_1);

        vm.deal(address(this), 10_000 ether);
        IPoolManager.ModifyLiquidityParams memory lp =
            IPoolManager.ModifyLiquidityParams({ tickLower: -6000, tickUpper: 6000, liquidityDelta: 100e18, salt: 0 });
        modifyLiquidityRouter.modifyLiquidity{ value: 500 ether }(poolKey, lp, ZERO_BYTES);

        uint256 beforeBal = vault.totalReceived();
        IPoolManager.SwapParams memory p = IPoolManager.SwapParams({
            zeroForOne: true,
            amountSpecified: -1 ether, // exact-input ETH buy
            sqrtPriceLimitX96: MIN_PRICE_LIMIT
        });
        swapRouter.swap{ value: 1 ether }(
            poolKey, p, PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false }), ZERO_BYTES
        );

        uint256 expectedFee = (1 ether * HOOK_FEE_BIPS) / 10000; // 1% of 1 ETH = 0.01 ETH
        assertEq(vault.totalReceived() - beforeBal, expectedFee, "factory hook must tithe 1% of ETH input to vault");
    }

    receive() external payable { }
}

/**
 * @title LiquidityDeployerModuleGraduation_RealSettlement
 * @notice noesis-117b DECISIVE end-to-end proof of the alignment-hook wiring on the graduation path,
 *         driven THROUGH the real `LiquidityDeployerModule.deployLiquidity` against a real in-memory
 *         v4-core PoolManager (no fork). Two paths:
 *
 *           (a) ENABLED: with `setAlignmentHookFactory(uniTitheFactory)` set, a graduation stands up a
 *               pool whose `hooks` is a valid factory-deployed tithe hook AND whose `fee` is
 *               `DYNAMIC_FEE_FLAG` (proven by the pool being initialized at exactly that PoolKey's id),
 *               and every one of the 4 swap shapes routes the ETH-leg tithe to the vault (shape 4 untaxed
 *               by design). Reuses the RealSettlement swap-shape proof through a real graduation.
 *
 *           (b) DEFAULT (OFF): with `alignmentHookFactory == address(0)` (untouched), the graduation pool
 *               is `hooks: address(0)` + the static `poolFee` — byte-identical to the pre-117b untaxed
 *               pool; no hook is deployed and no dynamic-fee pool exists (regression guard).
 *
 *         Runs ONLY under `FOUNDRY_CONFIG=foundry.v4.toml` (co-located in this already-skip-excluded file
 *         so the pinned-0.8.28 default profile never compiles the real PoolManager import).
 */
contract LiquidityDeployerModuleGraduation_RealSettlement is Test {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    PoolManager internal manager;
    PoolSwapTest internal swapRouter;

    UniTitheHookFactory internal factory;
    LiquidityDeployerModule internal module;
    MockMasterRegistry internal registry;
    MockVault internal vault;
    TestToken internal token;

    Currency internal ethCurrency;
    Currency internal tokenCurrency;

    address internal constant WETH = address(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);
    address internal owner = address(0xB055);
    uint256 internal constant HOOK_FEE_BIPS = 100; // 1%
    uint24 internal constant LP_FEE_RATE = 3000; // 0.3% dynamic LP fee (hook override)
    uint24 internal constant POOL_FEE = 3000; // static fee on the untaxed default path
    int24 internal constant TICK_SPACING = 60;

    bytes internal constant ZERO_BYTES = "";
    uint160 internal MIN_PRICE_LIMIT = TickMath.MIN_SQRT_PRICE + 1;
    uint160 internal MAX_PRICE_LIMIT = TickMath.MAX_SQRT_PRICE - 1;

    // keccak256("AlignmentHookDeployed(address,address,address,uint256,uint24)")
    bytes32 internal constant ALIGNMENT_HOOK_DEPLOYED =
        keccak256("AlignmentHookDeployed(address,address,address,uint256,uint24)");

    function setUp() public {
        manager = new PoolManager(address(this));
        swapRouter = new PoolSwapTest(manager);

        token = new TestToken();
        tokenCurrency = Currency.wrap(address(token));
        ethCurrency = CurrencyLibrary.ADDRESS_ZERO;

        vault = new MockVault();
        registry = new MockMasterRegistry(); // isRegisteredInstance() defaults true
        factory = new UniTitheHookFactory(IPoolManager(address(manager)), WETH, owner);
        // poolManager = the real in-memory manager; static poolFee + tickSpacing are the module immutables.
        module = new LiquidityDeployerModule(address(manager), WETH, POOL_FEE, TICK_SPACING, address(registry));
    }

    // ── (a) ENABLED: hooked, dynamic-fee pool that tithes all 4 shapes ───────

    function test_graduation_withHook_dynamicFee_and_tithesAllShapes() public {
        module.setAlignmentHookFactory(address(factory));
        module.setHookFeeBips(HOOK_FEE_BIPS);
        module.setLpFeeRate(LP_FEE_RATE);

        vm.recordLogs();
        _graduate(100 ether, 1_000_000 ether);
        address hookAddr = _capturedHook();

        assertTrue(hookAddr != address(0), "a hook must be deployed at graduation");
        assertTrue(HookAddressMiner.isValidUniAlignmentHookAddress(hookAddr), "hook carries exactly 0xCC bits");
        UniAlignmentV4Hook hook = UniAlignmentV4Hook(payable(hookAddr));
        assertEq(hook.hookFeeBips(), HOOK_FEE_BIPS, "hook fee wired from module config");
        assertEq(hook.benefactor(), address(this), "benefactor == graduating instance");

        // The pool exists at EXACTLY the DYNAMIC-fee + this-hook key: proves fee == DYNAMIC_FEE_FLAG and
        // hooks == the deployed hook (a different fee/hook would yield a different, uninitialized poolId).
        PoolKey memory hookedKey = _key(LPFeeLibrary.DYNAMIC_FEE_FLAG, IHooks(hookAddr));
        (uint160 sqrtHooked,,,) = StateLibrary.getSlot0(IPoolManager(address(manager)), hookedKey.toId());
        assertTrue(sqrtHooked != 0, "graduation pool is the DYNAMIC-fee hooked pool");

        // And the untaxed static pool today's code would create was NOT created.
        PoolKey memory staticKey = _key(POOL_FEE, IHooks(address(0)));
        (uint160 sqrtStatic,,,) = StateLibrary.getSlot0(IPoolManager(address(manager)), staticKey.toId());
        assertEq(sqrtStatic, 0, "no untaxed static pool created when the hook is enabled");

        // ---- the tithe settles on every real swap shape through the graduated hooked pool ----
        _prepSwapper();

        // shape 1: exact-input ETH buy — ETH specified input, taxed exactly 1% in beforeSwap, once.
        uint256 b1 = vault.totalReceived();
        swapRouter.swap{ value: 1 ether }(hookedKey, _sp(true, -1 ether, MIN_PRICE_LIMIT), _settings(), ZERO_BYTES);
        assertEq(vault.totalReceived() - b1, (1 ether * HOOK_FEE_BIPS) / 10000, "shape1 tithes 1% of ETH input once");

        // shape 2: exact-output ETH buy — ETH unspecified, taxed in afterSwap.
        uint256 b2 = vault.totalReceived();
        swapRouter.swap{ value: 100 ether }(hookedKey, _sp(true, 1e18, MIN_PRICE_LIMIT), _settings(), ZERO_BYTES);
        assertGt(vault.totalReceived() - b2, 0, "shape2 tithes ETH to vault");

        // shape 3: exact-input token sell — ETH unspecified, taxed in afterSwap.
        uint256 b3 = vault.totalReceived();
        swapRouter.swap(hookedKey, _sp(false, -1e18, MAX_PRICE_LIMIT), _settings(), ZERO_BYTES);
        assertGt(vault.totalReceived() - b3, 0, "shape3 tithes ETH to vault");

        // shape 4: exact-output token->ETH sell — ETH specified output, untaxed BY DESIGN, must not revert.
        uint256 b4 = vault.totalReceived();
        swapRouter.swap(hookedKey, _sp(false, 0.5 ether, MAX_PRICE_LIMIT), _settings(), ZERO_BYTES);
        assertEq(vault.totalReceived() - b4, 0, "shape4 is untaxed by design");
    }

    // ── (b) DEFAULT OFF: untaxed static pool, byte-identical to today ────────

    function test_graduation_default_off_untaxedStaticPool_byteIdentical() public {
        // module left at its default: alignmentHookFactory == address(0), no setters called.
        assertEq(module.alignmentHookFactory(), address(0), "module ships OFF");

        vm.recordLogs();
        _graduate(100 ether, 1_000_000 ether);

        assertEq(_capturedHook(), address(0), "no hook deployed on the default path");

        // The graduation pool is the static-fee, no-hook pool — byte-identical to the pre-117b behavior.
        PoolKey memory staticKey = _key(POOL_FEE, IHooks(address(0)));
        (uint160 sqrtStatic,,,) = StateLibrary.getSlot0(IPoolManager(address(manager)), staticKey.toId());
        assertTrue(sqrtStatic != 0, "default graduation is the static-fee, no-hook untaxed pool");

        // No dynamic-fee pool exists on the default path.
        PoolKey memory dynKey = _key(LPFeeLibrary.DYNAMIC_FEE_FLAG, IHooks(address(0)));
        (uint160 sqrtDyn,,,) = StateLibrary.getSlot0(IPoolManager(address(manager)), dynKey.toId());
        assertEq(sqrtDyn, 0, "no dynamic-fee pool created on the default path");
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    function _graduate(uint256 ethReserve, uint256 tokenReserve) internal {
        // Mirror ERC404BondingInstance.deployLiquidity: LP tokens pre-transferred to the module, ETH sent
        // as msg.value, the instance itself is the caller (== p.instance, registered).
        token.mint(address(module), tokenReserve);
        vm.deal(address(this), ethReserve);
        module.deployLiquidity{ value: ethReserve }(
            ILiquidityDeployerModule.DeployParams({
                ethReserve: ethReserve,
                tokenReserve: tokenReserve,
                protocolTreasury: address(0), // skip protocol send
                vault: address(vault),
                token: address(token),
                instance: address(this),
                creator: address(0),
                carveEth: 0
            })
        );
    }

    /// @dev The hook address the factory emitted at graduation (address(0) if none deployed).
    function _capturedHook() internal returns (address) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics.length > 0 && logs[i].topics[0] == ALIGNMENT_HOOK_DEPLOYED) {
                return address(uint160(uint256(logs[i].topics[1])));
            }
        }
        return address(0);
    }

    function _key(uint24 fee, IHooks hooks) internal view returns (PoolKey memory) {
        return PoolKey({
            currency0: ethCurrency, currency1: tokenCurrency, fee: fee, tickSpacing: TICK_SPACING, hooks: hooks
        });
    }

    /// @dev Fund + approve this contract so it can run the sell shapes through the swap router.
    function _prepSwapper() internal {
        token.mint(address(this), 1_000_000 ether);
        token.approve(address(swapRouter), type(uint256).max);
        vm.deal(address(this), 10_000 ether);
    }

    function _sp(bool zeroForOne, int256 amountSpecified, uint160 limit)
        internal
        pure
        returns (IPoolManager.SwapParams memory)
    {
        return IPoolManager.SwapParams({
            zeroForOne: zeroForOne, amountSpecified: amountSpecified, sqrtPriceLimitX96: limit
        });
    }

    function _settings() internal pure returns (PoolSwapTest.TestSettings memory) {
        return PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });
    }

    receive() external payable { }
}
