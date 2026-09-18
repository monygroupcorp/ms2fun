// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { IHooks } from "v4-core/interfaces/IHooks.sol";
import { IPoolManager } from "v4-core/interfaces/IPoolManager.sol";
import { PoolManager } from "v4-core/PoolManager.sol";
import { Currency, CurrencyLibrary } from "v4-core/types/Currency.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { LPFeeLibrary } from "v4-core/libraries/LPFeeLibrary.sol";
import { TickMath } from "v4-core/libraries/TickMath.sol";
import { StateLibrary } from "v4-core/libraries/StateLibrary.sol";
import { PoolId, PoolIdLibrary } from "v4-core/types/PoolId.sol";
import { PoolSwapTest } from "../../lib/v4-core/src/test/PoolSwapTest.sol";
import { PoolModifyLiquidityTest } from "../../lib/v4-core/src/test/PoolModifyLiquidityTest.sol";

import { UniAlignmentV4Hook } from "../../src/factories/erc404/hooks/UniAlignmentV4Hook.sol";
import { IAlignmentVault } from "../../src/interfaces/IAlignmentVault.sol";

/// @notice Audit L-6: `UniAlignmentV4Hook` never bound the `PoolKey` it was handed to the pool it was
///         deployed for. It checked `currency0 == address(0)` and nothing else, so anyone could
///         `initialize` a SECOND ETH-paired pool on the same hook address and have its swaps tithed to
///         this launch's benefactor.
///
///         This file began as the PoC for that and now pins the fix: the hook is deployed against a
///         pool (`poolToken`, `poolTickSpacing` are constructor arguments) and refuses every other key,
///         so a rogue pool can still be initialized on the hook's address but can never swap through it.
///         Each test here is red against the pre-fix contract.
contract HookSecondPoolNotBoundTest is Test {
    using StateLibrary for PoolManager;
    using PoolIdLibrary for PoolKey;

    PoolManager internal manager;
    PoolSwapTest internal swapRouter;
    PoolModifyLiquidityTest internal modifyLiquidityRouter;

    UniAlignmentV4Hook internal hook;
    RecordingVault internal vault;

    TestToken internal realToken; // the launch's graduated token
    TestToken internal rogueToken; // a worthless token the attacker mints

    PoolKey internal realPool;
    PoolKey internal roguePool;

    bytes internal constant ZERO_BYTES = "";
    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;
    uint160 internal MIN_PRICE_LIMIT = TickMath.MIN_SQRT_PRICE + 1;

    address internal hookOwner = makeAddr("hookOwner");
    address internal benefactorInstance = makeAddr("benefactorInstance");
    address internal attacker = makeAddr("attacker");

    /// @dev Non-zero stand-in for the master registry: the hook ctor only null-checks it, and no
    ///      test here reaches `haltTithe`/`resumeTithe`/`rescueQueuedFees`, the only readers.
    address internal constant DUMMY_REGISTRY = address(0x5EE9);
    uint256 internal constant HOOK_FEE_BIPS = 100; // 1%
    uint24 internal constant LP_FEE_RATE = 3000;
    int24 internal constant POOL_TICK_SPACING = 60;

    function setUp() public {
        manager = new PoolManager(address(this));
        swapRouter = new PoolSwapTest(manager);
        modifyLiquidityRouter = new PoolModifyLiquidityTest(manager);
        vault = new RecordingVault();

        // The launch's coin is deployed FIRST: since the L-6 fix the hook binds the pool it serves, so
        // `currency1` is a constructor argument and has to exist before the hook does.
        address realTokenPredicted = address(new TestToken());

        address hookAddr = address((uint160(0x7733) << 14) | uint160(0x00CC));
        deployCodeTo(
            "UniAlignmentV4Hook.sol:UniAlignmentV4Hook",
            abi.encode(
                IPoolManager(address(manager)),
                IAlignmentVault(payable(address(vault))),
                makeAddr("weth"),
                hookOwner,
                benefactorInstance,
                HOOK_FEE_BIPS,
                LP_FEE_RATE,
                DUMMY_REGISTRY,
                address(realTokenPredicted),
                POOL_TICK_SPACING
            ),
            hookAddr
        );
        hook = UniAlignmentV4Hook(payable(hookAddr));

        realToken = TestToken(realTokenPredicted);
        rogueToken = new TestToken();

        realPool = _key(address(realToken), hookAddr);
        manager.initialize(realPool, SQRT_PRICE_1_1);

        vm.deal(address(this), 10_000 ether);
        realToken.mint(address(this), 1_000_000 ether);
        realToken.approve(address(modifyLiquidityRouter), type(uint256).max);
        modifyLiquidityRouter.modifyLiquidity{ value: 500 ether }(
            realPool,
            IPoolManager.ModifyLiquidityParams({ tickLower: -6000, tickUpper: 6000, liquidityDelta: 100e18, salt: 0 }),
            ZERO_BYTES
        );
    }

    function _key(address token, address hookAddr) internal pure returns (PoolKey memory) {
        return PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(token),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: POOL_TICK_SPACING,
            hooks: IHooks(hookAddr)
        });
    }

    function _settings() internal pure returns (PoolSwapTest.TestSettings memory) {
        return PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });
    }

    /// @dev THE FINDING, now pinned as closed. An outsider can still `initialize` a rogue ETH-paired
    ///      pool naming this hook — `beforeInitialize` is not one of the hook's permission bits and
    ///      adding it would change the address the hook must be mined to — but the pool is inert: its
    ///      first swap reverts `PoolNotBound`, so nothing is ever taken from the PoolManager and nothing
    ///      is ever credited to the launch's benefactor.
    ///
    ///      Before the fix this test measured the OTHER half of the finding instead: the rogue swap went
    ///      through, its tithe was credited to the launch's benefactor, and ETH conservation across the
    ///      PoolManager held to the wei (crediting the benefactor 0.1 ETH cost the attacker 3.61 ETH) —
    ///      a donation surface, never a farm, which is why L-6 is a Low. That measurement is what the
    ///      revert now makes unreachable, so it is recorded here rather than asserted.
    function test_secondPoolOnSameHook_cannotSwap() public {
        roguePool = _key(address(rogueToken), address(hook));

        vm.deal(attacker, 1_000 ether);
        vm.startPrank(attacker);
        rogueToken.mint(attacker, 1_000_000 ether);
        rogueToken.approve(address(modifyLiquidityRouter), type(uint256).max);

        manager.initialize(roguePool, SQRT_PRICE_1_1); // still no gate: beforeInitialize is not a permission
        modifyLiquidityRouter.modifyLiquidity{ value: 100 ether }(
            roguePool,
            IPoolManager.ModifyLiquidityParams({ tickLower: -6000, tickUpper: 6000, liquidityDelta: 10e18, salt: 0 }),
            ZERO_BYTES
        );
        vm.stopPrank();

        uint256 pmBefore = address(manager).balance;
        uint256 vaultBefore = vault.totalReceived();

        uint256 ethIn = 10 ether;
        vm.prank(attacker);
        vm.expectRevert();
        swapRouter.swap{ value: ethIn }(
            roguePool,
            IPoolManager.SwapParams({
                zeroForOne: true, amountSpecified: -int256(ethIn), sqrtPriceLimitX96: MIN_PRICE_LIMIT
            }),
            _settings(),
            ZERO_BYTES
        );

        assertEq(vault.totalReceived(), vaultBefore, "nothing was tithed out of a pool this hook does not serve");
        assertEq(address(manager).balance, pmBefore, "nothing was taken off the PoolManager");
    }

    /// @dev The other half of a bind: the pool the hook WAS deployed for still works. A guard that closed
    ///      the rogue pool by closing every pool would pass the test above and brick the launch.
    function test_theBoundPoolIsStillTithed() public {
        uint256 vaultBefore = vault.totalReceived();

        uint256 ethIn = 10 ether;
        swapRouter.swap{ value: ethIn }(
            realPool,
            IPoolManager.SwapParams({
                zeroForOne: true, amountSpecified: -int256(ethIn), sqrtPriceLimitX96: MIN_PRICE_LIMIT
            }),
            _settings(),
            ZERO_BYTES
        );

        assertEq(
            vault.totalReceived() - vaultBefore,
            ethIn * HOOK_FEE_BIPS / 10_000,
            "the launch's own pool is tithed exactly as before"
        );
        assertEq(vault.lastBenefactor(), benefactorInstance, "credited to the launch's fixed benefactor");
    }

    /// @dev The launch's own coin, this hook, and every other field right — except the tick spacing. v4
    ///      keys on the whole struct, so this is a DIFFERENT pool, and binding `currency1` alone would
    ///      have left it open.
    function test_sameTokenDifferentTickSpacing_cannotSwap() public {
        PoolKey memory offSpacing = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(realToken)),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: POOL_TICK_SPACING + 1,
            hooks: IHooks(address(hook))
        });

        vm.deal(attacker, 1_000 ether);
        vm.startPrank(attacker);
        realToken.mint(attacker, 1_000_000 ether);
        realToken.approve(address(modifyLiquidityRouter), type(uint256).max);
        manager.initialize(offSpacing, SQRT_PRICE_1_1);
        modifyLiquidityRouter.modifyLiquidity{ value: 100 ether }(
            offSpacing,
            // Multiples of the off-spacing key's own 61, so the add is rejected by the hook and never
            // by v4's tick alignment.
            IPoolManager.ModifyLiquidityParams({ tickLower: -6100, tickUpper: 6100, liquidityDelta: 10e18, salt: 0 }),
            ZERO_BYTES
        );

        uint256 vaultBefore = vault.totalReceived();
        vm.expectRevert();
        swapRouter.swap{ value: 10 ether }(
            offSpacing,
            IPoolManager.SwapParams({
                zeroForOne: true, amountSpecified: -int256(10 ether), sqrtPriceLimitX96: MIN_PRICE_LIMIT
            }),
            _settings(),
            ZERO_BYTES
        );
        vm.stopPrank();

        assertEq(vault.totalReceived(), vaultBefore, "an off-spacing pool on the same pair is refused too");
    }

    function _id(PoolKey memory k) internal pure returns (PoolId) {
        return k.toId();
    }

    receive() external payable { }
}

contract RecordingVault {
    uint256 public totalReceived;
    address public lastBenefactor;

    function receiveContribution(Currency, uint256 amount, address benefactor) external payable {
        require(msg.value == amount, "value");
        totalReceived += amount;
        lastBenefactor = benefactor;
    }

    receive() external payable { }
}

contract TestToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

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
        if (allowance[from][msg.sender] != type(uint256).max) allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
