// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { IHooks } from "v4-core/interfaces/IHooks.sol";
import { IPoolManager } from "v4-core/interfaces/IPoolManager.sol";
import { PoolManager } from "v4-core/PoolManager.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { Currency, CurrencyLibrary } from "v4-core/types/Currency.sol";
import { BalanceDelta } from "v4-core/types/BalanceDelta.sol";
import { BeforeSwapDelta, BeforeSwapDeltaLibrary } from "v4-core/types/BeforeSwapDelta.sol";
import { PoolModifyLiquidityTest } from "v4-core/test/PoolModifyLiquidityTest.sol";
import { AlignmentHookSwapRouter } from "../../../src/peripherals/AlignmentHookSwapRouter.sol";

/// @notice Minimal ERC20; its address sorts above native ETH, so it is currency1.
contract PlainToken {
    string public name = "Plain";
    string public symbol = "PLN";
    uint8 public decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amt) external {
        balanceOf[to] += amt;
        totalSupply += amt;
    }

    function transfer(address to, uint256 amt) external returns (bool) {
        balanceOf[msg.sender] -= amt;
        balanceOf[to] += amt;
        return true;
    }

    function approve(address sp, uint256 amt) external returns (bool) {
        allowance[msg.sender][sp] = amt;
        return true;
    }

    function transferFrom(address from, address to, uint256 amt) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) allowance[from][msg.sender] = a - amt;
        balanceOf[from] -= amt;
        balanceOf[to] += amt;
        return true;
    }
}

/**
 * @notice A hostile pool hook (T4: anyone graduates a collection whose mined hook is this contract).
 *         Its beforeSwap re-enters `AlignmentHookSwapRouter.swap` on the SAME router, mid-unlock,
 *         sending its own msg.value and trying to have its ETH leg settled out of the ETH the router
 *         already holds for the outer victim. Only the beforeSwap bit (1 << 7) is set on its address.
 */
contract ReentryHook is IHooks {
    AlignmentHookSwapRouter public router;
    PoolKey public key;
    bool public attempted;
    bool public reentrySucceeded;

    function setUp(address r, PoolKey memory k) external {
        router = AlignmentHookSwapRouter(r);
        key = k;
    }

    function beforeSwap(address, PoolKey calldata, IPoolManager.SwapParams calldata, bytes calldata)
        external
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (!attempted) {
            attempted = true;
            try router.swap{ value: 0.01 ether }(
                key, true, false, 0.01 ether, 0, address(this), block.timestamp + 100
            ) {
                reentrySucceeded = true;
            } catch { }
        }
        return (this.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    function beforeInitialize(address, PoolKey calldata, uint160) external override returns (bytes4) {
        return this.beforeInitialize.selector;
    }

    function afterInitialize(address, PoolKey calldata, uint160, int24) external override returns (bytes4) {
        return this.afterInitialize.selector;
    }

    function beforeAddLiquidity(address, PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata, bytes calldata)
        external
        override
        returns (bytes4)
    {
        return this.beforeAddLiquidity.selector;
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external override returns (bytes4, BalanceDelta) {
        return (this.afterAddLiquidity.selector, BalanceDelta.wrap(0));
    }

    function beforeRemoveLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        bytes calldata
    ) external override returns (bytes4) {
        return this.beforeRemoveLiquidity.selector;
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external override returns (bytes4, BalanceDelta) {
        return (this.afterRemoveLiquidity.selector, BalanceDelta.wrap(0));
    }

    function afterSwap(address, PoolKey calldata, IPoolManager.SwapParams calldata, BalanceDelta, bytes calldata)
        external
        override
        returns (bytes4, int128)
    {
        return (this.afterSwap.selector, 0);
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        override
        returns (bytes4)
    {
        return this.beforeDonate.selector;
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        override
        returns (bytes4)
    {
        return this.afterDonate.selector;
    }
}

contract H01_HookSwapReentry is Test {
    PoolManager internal manager;
    AlignmentHookSwapRouter internal router;
    ReentryHook internal hook;
    PlainToken internal token;
    PoolKey internal key;

    address internal victim = makeAddr("victim");
    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    /// @dev The v4 test routers pay leftover ETH back with a plain transfer.
    receive() external payable { }

    function setUp() public {
        manager = new PoolManager(address(this));
        router = new AlignmentHookSwapRouter(address(manager));
        token = new PlainToken();

        // Hook address carrying exactly the beforeSwap flag (1 << 7) in the low 14 bits.
        address hookAddr = address((uint160(0xDEAD) << 14) | uint160(0x0080));
        ReentryHook impl = new ReentryHook();
        vm.etch(hookAddr, address(impl).code);
        hook = ReentryHook(payable(hookAddr));

        key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(token)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(hookAddr)
        });
        hook.setUp(address(router), key);
        manager.initialize(key, SQRT_PRICE_1_1);

        PoolModifyLiquidityTest liquidizer = new PoolModifyLiquidityTest(manager);
        token.mint(address(this), 1_000_000 ether);
        token.approve(address(liquidizer), type(uint256).max);
        vm.deal(address(this), 10_000 ether);
        liquidizer.modifyLiquidity{ value: 10_000 ether }(
            key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: -6000, tickUpper: 6000, liquidityDelta: 100e18, salt: bytes32(0)
            }),
            ""
        );

        vm.deal(victim, 10 ether);
    }

    /// @notice Defended: a hook re-entering `swap` during the victim's swap cannot have its ETH leg
    ///         paid out of the outer caller's msg.value. The nested `unlock` hits the pool manager's
    ///         transient lock and reverts `AlreadyUnlocked`, so the router holds nobody else's change
    ///         and refunds the victim exactly its own unused ETH.
    function test_Defended_HookReentryCannotSettleEthLegFromOuterMsgValue() public {
        uint256 victimEthBefore = victim.balance;
        uint256 victimTokBefore = token.balanceOf(victim);

        vm.prank(victim);
        (uint256 amountIn, uint256 amountOut) =
            router.swap{ value: 1 ether }(key, true, false, 1 ether, 0, victim, block.timestamp + 100);

        // The reentry was attempted and lost: the singleton lock spans the whole outer swap.
        assertTrue(hook.attempted(), "hook never ran");
        assertFalse(hook.reentrySucceeded(), "nested swap settled from outer msg.value");

        // Concrete accounting: the victim lost exactly the ETH it named and gained real output.
        assertEq(victimEthBefore - victim.balance, amountIn, "victim paid more than the swap owed");
        assertEq(victim.balance, victimEthBefore - 1 ether, "victim's ETH went somewhere but its own trade");
        assertEq(victimTokBefore + amountOut, token.balanceOf(victim), "output not delivered to victim");
        assertGt(amountOut, 0);
        assertEq(amountIn, 1 ether);

        // Nobody else profited off the victim's held value.
        assertEq(address(router).balance, 0, "router kept ETH");
        assertEq(address(hook).balance, 0, "hook gained ETH from the outer swap");
    }
}
