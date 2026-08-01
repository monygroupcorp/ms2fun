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
import { IAlignmentVault } from "../../src/interfaces/IAlignmentVault.sol";

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
