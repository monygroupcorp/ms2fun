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
    /// @dev A second, healthy vault the registry still curates — the destination the rescue is allowed
    ///      to reach. Its existence is the point: the exit is a move between curated vaults.
    AlignmentEndowmentVault internal liveVault;
    uint256 internal benefactorPrincipalBefore;
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
    int24 internal constant POOL_TICK_SPACING = 60;

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
        liveVault = AlignmentEndowmentVault(payable(LibClone.clone(impl)));
        liveVault.initialize(
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
                LP_FEE_RATE,
                address(masterRegistry),
                address(token), // the pool this hook is bound to (audit L-6)
                POOL_TICK_SPACING
            ),
            hookAddr
        );
        hook = UniAlignmentV4Hook(payable(hookAddr));

        poolKey = PoolKey({
            currency0: ethCurrency,
            currency1: tokenCurrency,
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: POOL_TICK_SPACING,
            hooks: IHooks(hookAddr)
        });
        manager.initialize(poolKey, SQRT_PRICE_1_1);

        vm.deal(address(this), 10_000 ether);
        IPoolManager.ModifyLiquidityParams memory lp =
            IPoolManager.ModifyLiquidityParams({ tickLower: -6000, tickUpper: 6000, liquidityDelta: 100e18, salt: 0 });
        modifyLiquidityRouter.modifyLiquidity{ value: 500 ether }(poolKey, lp, ZERO_BYTES);

        benefactorPrincipalBefore = liveVault.principalOf(address(benefactorInstance));
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

    /// @dev The finding, and the shape of its defence. Steps 1-3 are the reproduction unchanged: a
    ///      healthy tithe, the vault's own documented emergency, and then swap-tax ETH piling up in the
    ///      hook with nowhere to go. Step 4 is the invariant that was violated — real users' swap tax
    ///      must have SOME route out — and step 5 walks the runbook that now provides it.
    function test_migratedVault_queuedFeesHaveAnExit_andTheTitheStops() public {
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
        uint256 trapped = hook.queuedFees();
        assertGt(trapped, afterOne, "the trap is not a one-off: it grows with every swap");
        assertEq(address(hook).balance, trapped, "the hook physically holds the queued ETH");

        // ── 4. Nothing is reachable while the registry still calls this vault a vault. ──
        //
        //     The exits are deliberately gated on the registry rather than on the hook owner's word, so
        //     a live vault's tithe can never be halted or diverted by anyone. Prove that first, or the
        //     recovery below would only be showing that an owner can take the money.
        vm.expectRevert(); // VaultMigrated — the retry lane is real, and genuinely stuck
        hook.flushQueuedFees();

        vm.expectRevert(UniAlignmentV4Hook.VaultStillRegistered.selector);
        hook.haltTithe();

        vm.prank(hookOwner);
        vm.expectRevert(UniAlignmentV4Hook.VaultStillRegistered.selector);
        hook.rescueQueuedFees(address(liveVault));

        // ── 5. THE INVARIANT UNDER TEST ──
        //
        //     Swap-tax ETH taken from real users must have SOME route out of the hook, and the hook must
        //     stop charging a tax it cannot deliver. The route is the runbook step the deployer module's
        //     own retry lane already relies on: the protocol owner retires the dead vault in the master
        //     registry, exactly as it would to clear a stashed graduation cut.
        vm.warp(block.timestamp + 365 days);
        vm.roll(block.number + 2_500_000);
        masterRegistry.setVaultRegistered(address(vault), false); // == MasterRegistryV1.deactivateVault

        // (a) the tithe stops. Permissionless — it needs no owner, only the registry's word.
        hook.haltTithe();
        assertTrue(hook.titheHalted(), "the tithe is halted once the vault is off the registry");

        uint256 swapperBefore = address(this).balance;
        _ethBuy(1 ether);
        assertEq(hook.queuedFees(), trapped, "a halted hook charges nothing: the queue does not grow");
        assertEq(address(hook).balance, trapped, "and it takes nothing from the pool");
        assertGt(swapperBefore - address(this).balance, 0, "the swap itself still went through");

        // (b) the queued ETH leaves, to another vault the registry curates — never to the owner.
        uint256 liveBefore = liveVault.totalPrincipal();
        vm.prank(hookOwner);
        hook.rescueQueuedFees(address(liveVault));

        assertEq(hook.queuedFees(), 0, "the queue is cleared");
        assertEq(address(hook).balance, 0, "no swap-tax ETH is left stranded in the hook");
        assertEq(liveVault.totalPrincipal() - liveBefore, trapped, "every trapped wei reached a live vault");
        assertEq(
            liveVault.principalOf(address(benefactorInstance)) - benefactorPrincipalBefore,
            trapped,
            "and it is credited to the hook's own benefactor, not to whoever called the rescue"
        );

        emit log_named_decimal_uint("ETH recovered from the hook", trapped, 18);
    }

    /// @dev The owner's new lever moves money only between vaults the registry curates. It cannot be
    ///      pointed at the owner, at an EOA, or at an unregistered contract — so the exit added above is
    ///      not a sweep with extra steps.
    function test_rescue_refusesAnyDestinationTheRegistryDoesNotCurate() public {
        _ethBuy(1 ether);
        vm.prank(vaultOwner);
        vault.migratePosition(recoveryVenue);
        _ethBuy(1 ether);
        assertGt(hook.queuedFees(), 0, "precondition: ETH is queued");

        masterRegistry.setVaultRegistered(address(vault), false);
        hook.haltTithe();

        address outsider = makeAddr("outsider");
        masterRegistry.setVaultRegistered(outsider, false);

        vm.prank(hookOwner);
        vm.expectRevert(UniAlignmentV4Hook.VaultNotRegistered.selector);
        hook.rescueQueuedFees(outsider);

        // And it is the owner's lever, not the public's: the destination choice is a curation judgement.
        vm.expectRevert(); // Unauthorized
        hook.rescueQueuedFees(address(liveVault));
    }

    /// @dev De-registration that is reversed must put the tithe back, or a mis-click would silently end
    ///      a community's swap income with no way to restart it.
    function test_resumeTithe_restoresTheTitheWhenTheVaultIsRegisteredAgain() public {
        masterRegistry.setVaultRegistered(address(vault), false);
        hook.haltTithe();
        assertTrue(hook.titheHalted(), "halted");

        vm.expectRevert(UniAlignmentV4Hook.VaultNotRegistered.selector);
        hook.resumeTithe();

        masterRegistry.setVaultRegistered(address(vault), true);
        hook.resumeTithe();
        assertFalse(hook.titheHalted(), "resumed");

        uint256 principalBefore = vault.totalPrincipal();
        _ethBuy(1 ether);
        assertEq(hook.queuedFees(), 0, "a resumed hook forwards again");
        assertGt(vault.totalPrincipal(), principalBefore, "and the tithe lands in the vault");
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
