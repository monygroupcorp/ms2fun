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
import { PoolSwapTest } from "../../lib/v4-core/src/test/PoolSwapTest.sol";
import { PoolModifyLiquidityTest } from "../../lib/v4-core/src/test/PoolModifyLiquidityTest.sol";
import { LibClone } from "solady/utils/LibClone.sol";

import { UniAlignmentV4Hook } from "../../src/factories/erc404/hooks/UniAlignmentV4Hook.sol";
import { IAlignmentVault } from "../../src/interfaces/IAlignmentVault.sol";
import { AlignmentEndowmentVault } from "../../src/vaults/aave/AlignmentEndowmentVault.sol";

import {
    MockWETH,
    MockStataToken,
    MockMasterRegistry,
    MockAmbassadorRegistry,
    MockOwnable
} from "../vaults/aave/AlignmentEndowmentVault.t.sol";

/// @notice Audit PoC (finding F): the V4 tithe hook's `queuedFees` has exactly one exit — a hard call
///         into an `immutable` vault. `AlignmentEndowmentVault.migratePosition` closes that vault's
///         intake PERMANENTLY (`migrated = true` -> `receiveContribution` reverts `VaultMigrated`), so
///         from that block on the hook keeps taxing every swap, every wei of tax lands in `queuedFees`,
///         and `flushQueuedFees()` reverts forever. The hook has no owner sweep, no pause, and both
///         `vault` and `hookFeeBips` are `immutable`.
///
///         The existing suite's flush test (`UniAlignmentV4Hook_RealSettlement
///         .test_flushQueuedFees_creditsBenefactor`) only covers a TRANSIENT revert — it `vm.etch`es a
///         working vault over the reverting one before flushing. Nothing covers the permanent case.
///
///         Real vault, real hook, real in-memory v4-core PoolManager. No mocks on the path under test.
contract HookQueuedFeesMigratedVaultTest is Test {
    PoolManager internal manager;
    PoolSwapTest internal swapRouter;
    PoolModifyLiquidityTest internal modifyLiquidityRouter;

    UniAlignmentV4Hook internal hook;
    AlignmentEndowmentVault internal vault;
    TestToken internal token;

    MockWETH internal weth;
    MockStataToken internal stata;
    MockMasterRegistry internal masterRegistry;
    MockAmbassadorRegistry internal alignmentRegistry;
    MockOwnable internal benefactorInstance;

    Currency internal ethCurrency;
    Currency internal tokenCurrency;
    PoolKey internal poolKey;

    bytes internal constant ZERO_BYTES = "";
    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;
    uint160 internal MIN_PRICE_LIMIT = TickMath.MIN_SQRT_PRICE + 1;
    uint160 internal MAX_PRICE_LIMIT = TickMath.MAX_SQRT_PRICE - 1;

    address internal vaultOwner = makeAddr("vaultOwner");
    address internal treasury = makeAddr("treasury");
    address internal alignmentToken = makeAddr("alignmentToken");
    address internal community = makeAddr("community");
    address internal recoveryVenue = makeAddr("recoveryVenue");
    address internal hookOwner = makeAddr("hookOwner");

    uint256 internal constant TARGET_ID = 1;
    uint256 internal constant HOOK_FEE_BIPS = 100; // 1%
    uint24 internal constant LP_FEE_RATE = 3000;

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

        // ── The REAL endowment vault, wired exactly as the aave suite wires it. ──
        weth = new MockWETH();
        stata = new MockStataToken(address(weth));
        alignmentRegistry = new MockAmbassadorRegistry();
        alignmentRegistry.setCommunityPayout(TARGET_ID, community);
        masterRegistry = new MockMasterRegistry();
        masterRegistry.setAlignmentRegistry(address(alignmentRegistry));

        address impl = address(new AlignmentEndowmentVault());
        vault = AlignmentEndowmentVault(payable(LibClone.clone(impl)));
        vault.initialize(
            vaultOwner, address(weth), address(stata), treasury, address(masterRegistry), alignmentToken, TARGET_ID
        );

        // The hook credits a fixed benefactor, and the vault requires a contract benefactor.
        benefactorInstance = new MockOwnable(address(this));

        // ── The REAL hook at a 0xCC-permission address, bound to the REAL vault (immutable). ──
        address hookAddr = address((uint160(0x9911) << 14) | uint160(0x00CC));
        deployCodeTo(
            "UniAlignmentV4Hook.sol:UniAlignmentV4Hook",
            abi.encode(
                IPoolManager(address(manager)),
                IAlignmentVault(payable(address(vault))),
                address(weth),
                hookOwner,
                address(benefactorInstance),
                HOOK_FEE_BIPS,
                LP_FEE_RATE
            ),
            hookAddr
        );
        hook = UniAlignmentV4Hook(payable(hookAddr));

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
    }

    function _settings() internal pure returns (PoolSwapTest.TestSettings memory) {
        return PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });
    }

    /// @dev Exact-input ETH buy: `beforeSwap` taxes the ETH input and forwards it to the vault.
    function _ethBuy(uint256 amount) internal {
        IPoolManager.SwapParams memory p = IPoolManager.SwapParams({
            zeroForOne: true, amountSpecified: -int256(amount), sqrtPriceLimitX96: MIN_PRICE_LIMIT
        });
        swapRouter.swap{ value: amount }(poolKey, p, _settings(), ZERO_BYTES);
    }

    function test_migratedVault_trapsQueuedFeesForever_whileHookKeepsTaxing() public {
        // ── 1. Healthy: the tithe reaches the vault and nothing queues. ──
        _ethBuy(1 ether);
        assertEq(hook.queuedFees(), 0, "healthy vault: nothing queued");
        assertGt(vault.totalPrincipal(), 0, "healthy vault: tithe became principal");
        uint256 principalBefore = vault.totalPrincipal();

        // ── 2. The vault's OWN documented emergency: Aave reserve deprecation -> migratePosition. ──
        vm.prank(vaultOwner);
        vault.migratePosition(recoveryVenue);
        assertTrue(vault.migrated(), "vault is decommissioned");
        assertEq(recoveryVenue.balance, principalBefore, "principal moved to the recovery venue");

        // ── 3. The hook is immutable-bound to that vault. It keeps taxing, every wei queues. ──
        _ethBuy(1 ether);
        uint256 afterOne = hook.queuedFees();
        assertEq(afterOne, 1 ether * HOOK_FEE_BIPS / 10_000, "swap 1 after migrate: fully queued");

        _ethBuy(1 ether);
        _ethBuy(1 ether);
        uint256 afterThree = hook.queuedFees();
        assertGt(afterThree, afterOne, "the trap is not a one-off: it grows with every swap");
        assertEq(address(hook).balance, afterThree, "the hook physically holds the trapped ETH");

        // ── 4. THE INVARIANT UNDER TEST ──
        //
        //     Swap-tax ETH taken from real users must have SOME route out of the hook. The hook's whole
        //     `queuedFees` design exists on the premise that a vault revert is transient and a later
        //     retry clears it — that is what `flushQueuedFees` is for, and it is what the existing suite
        //     covers (RealSettlement `vm.etch`es a working vault in before flushing). `migrated` is not
        //     transient. Assert the premise instead of the defect: after any amount of waiting, the
        //     trapped ETH is recoverable by SOMEBODY.
        vm.warp(block.timestamp + 365 days);
        vm.roll(block.number + 2_500_000);

        uint256 trapped = hook.queuedFees();
        assertGt(trapped, 0, "precondition: ETH is trapped in the hook");

        bool recoverable;

        // (a) the permissionless retry lane
        (bool ok,) = address(hook).call(abi.encodeCall(UniAlignmentV4Hook.flushQueuedFees, ()));
        if (ok) recoverable = true;

        // (b) any owner lever. The hook's ENTIRE owner surface is `setLpFeeRate` — `vault`,
        //     `benefactor` and `hookFeeBips` are all `immutable`, and there is no sweep, no pause and
        //     no re-point. Exercise the one lever there is, then retry.
        vm.prank(hookOwner);
        hook.setLpFeeRate(0);
        (ok,) = address(hook).call(abi.encodeCall(UniAlignmentV4Hook.flushQueuedFees, ()));
        if (ok) recoverable = true;

        // (c) the vault side: `migrated` is one-way. No call re-opens intake.
        vm.prank(vaultOwner);
        (ok,) = address(vault).call(abi.encodeWithSignature("unmigrate()"));
        if (ok) recoverable = true;

        assertTrue(recoverable, "swap-tax ETH queued against a migrated vault has no exit");

        // And the trap is not static: the tithe is still live, so it keeps growing.
        _ethBuy(1 ether);
        assertEq(hook.queuedFees(), trapped, "the hook must stop taxing once its vault can no longer accept");

        emit log_named_decimal_uint("ETH trapped in the hook", hook.queuedFees(), 18);
    }

    /// @dev The liquidity router refunds unspent native value to the caller.
    receive() external payable { }
}

contract TestToken {
    string public name = "TestToken";
    string public symbol = "TT";
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
        if (allowance[from][msg.sender] != type(uint256).max) allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
