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

/// @notice Audit PoC (cluster item C): `UniAlignmentV4Hook` never binds the `PoolKey` it is handed to
///         the pool it was deployed for. Anyone can `initialize` a SECOND ETH-paired pool on the same
///         hook address and have its swaps titled to this launch's benefactor.
///
///         This test establishes that the surface is REACHABLE and then tests the filing's own
///         disclaimer — "there is no drain because the take is exactly offset". The decisive
///         measurement is ETH conservation across the PoolManager: if the hook's `take()` on the
///         rogue pool were not fully charged back to that pool's swapper, the PoolManager's ETH
///         (which backs EVERY native pool it holds, the real launch pool included) would fall by
///         more than the rogue swapper paid in.
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

    function setUp() public {
        manager = new PoolManager(address(this));
        swapRouter = new PoolSwapTest(manager);
        modifyLiquidityRouter = new PoolModifyLiquidityTest(manager);
        vault = new RecordingVault();

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
                DUMMY_REGISTRY
            ),
            hookAddr
        );
        hook = UniAlignmentV4Hook(payable(hookAddr));

        realToken = new TestToken();
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
            tickSpacing: 60,
            hooks: IHooks(hookAddr)
        });
    }

    function _settings() internal pure returns (PoolSwapTest.TestSettings memory) {
        return PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });
    }

    /// @dev PART 1 — the surface is real: nothing stops a stranger opening a second pool on this hook
    ///      and crediting its tithe to the launch's benefactor.
    ///      PART 2 — the claim under test: doing so drains nothing. ETH conservation across the
    ///      PoolManager is asserted to the wei.
    function test_secondPoolOnSameHook_isReachable_butDrainsNothing() public {
        // ── PART 1: an outsider opens a rogue ETH/rogueToken pool on the very same hook ──
        roguePool = _key(address(rogueToken), address(hook));

        vm.deal(attacker, 1_000 ether);
        vm.startPrank(attacker);
        rogueToken.mint(attacker, 1_000_000 ether);
        rogueToken.approve(address(modifyLiquidityRouter), type(uint256).max);

        manager.initialize(roguePool, SQRT_PRICE_1_1); // no gate: beforeInitialize is not a hook permission
        modifyLiquidityRouter.modifyLiquidity{ value: 100 ether }(
            roguePool,
            IPoolManager.ModifyLiquidityParams({ tickLower: -6000, tickUpper: 6000, liquidityDelta: 10e18, salt: 0 }),
            ZERO_BYTES
        );
        vm.stopPrank();

        emit log_string("rogue pool initialized on the launch's hook: NO revert, no gate");

        // ── PART 2: ETH conservation over a rogue swap ──
        uint256 pmBefore = address(manager).balance;
        uint256 vaultBefore = vault.totalReceived();
        uint256 attackerBefore = attacker.balance;
        uint256 realPoolLiquidityBefore = manager.getLiquidity(_id(realPool));

        uint256 ethIn = 10 ether;
        vm.prank(attacker);
        swapRouter.swap{ value: ethIn }(
            roguePool,
            IPoolManager.SwapParams({
                zeroForOne: true, amountSpecified: -int256(ethIn), sqrtPriceLimitX96: MIN_PRICE_LIMIT
            }),
            _settings(),
            ZERO_BYTES
        );

        uint256 tithe = vault.totalReceived() - vaultBefore;
        uint256 attackerSpent = attackerBefore - attacker.balance;

        emit log_named_decimal_uint("tithe credited to the launch benefactor", tithe, 18);
        emit log_named_decimal_uint("ETH the rogue swapper actually paid    ", attackerSpent, 18);

        assertEq(tithe, ethIn * HOOK_FEE_BIPS / 10_000, "the rogue pool's swap is tithed to this benefactor");
        assertEq(vault.lastBenefactor(), benefactorInstance, "credited to the launch's fixed benefactor");

        // THE INVARIANT: every wei the hook `take()`s off the PoolManager is charged to the rogue
        // pool's own swapper. PM ETH must move by exactly (what the swapper paid) - (tithe taken out).
        // If the take were unfunded, PM ETH would fall short of this by the tithe.
        assertEq(
            address(manager).balance,
            pmBefore + attackerSpent - tithe,
            "PoolManager ETH moved by more than the rogue swapper funded -> a real drain"
        );

        // And the attacker is strictly POORER by the tithe: the credit is a donation, not a farm.
        assertGe(attackerSpent, tithe, "the rogue swapper funded the tithe out of their own ETH");

        // The launch pool is untouched.
        assertEq(
            manager.getLiquidity(_id(realPool)), realPoolLiquidityBefore, "the real launch pool's liquidity is intact"
        );
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
