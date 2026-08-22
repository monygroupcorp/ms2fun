// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { ProtocolOwnedLiquidityV1 } from "../../src/treasury/ProtocolOwnedLiquidityV1.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { IPoolManager } from "v4-core/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "v4-core/interfaces/callback/IUnlockCallback.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { IHooks } from "v4-core/interfaces/IHooks.sol";
import { BalanceDelta, toBalanceDelta } from "v4-core/types/BalanceDelta.sol";
import { TickMath } from "v4-core/libraries/TickMath.sol";
import { Ownable } from "solady/auth/Ownable.sol";
import { MockERC20 } from "../mocks/MockERC20.sol";
import { LiquidityAmounts } from "../../src/libraries/v4/LiquidityAmounts.sol";

/// @notice Minimal MasterRegistry mock for access control testing
contract MockMasterRegistry {
    mapping(address => bool) public isRegisteredInstance;

    function setRegistered(address instance, bool status) external {
        isRegisteredInstance[instance] = status;
    }
}

/// @notice Faithful V4 PoolManager stub for the POL escrow flow.
/// @dev The real `v4-core/PoolManager.sol` pins `pragma solidity =0.8.26` and cannot compile in this
///      tree (pinned to 0.8.28), so we mirror ONLY the surface `ProtocolOwnedLiquidityV1` touches, with
///      the true settle mechanics that matter for the drain-fix invariant:
///        - `unlock` re-enters the caller's `unlockCallback` (so `msg.sender` there is this manager);
///        - `extsload` feeds `StateLibrary.getSlot0` a fixed 1:1 price;
///        - `modifyLiquidity` sizes the position with the SAME `LiquidityAmounts` math V4 uses and
///          returns the amounts owed as NEGATIVE deltas (`used <= provided`, rounding down);
///        - `settle()` is payable and simply ACCEPTS whatever the caller sends — exactly the point:
///          the native leg can only be paid from ETH the caller actually transfers out of its own
///          balance, so escrow-vs-shared accounting is exercised for real.
contract MockPoolManagerV4 {
    uint160 internal constant SQRT_PRICE_1_1 = 79_228_162_514_264_337_593_543_950_336;

    function unlock(bytes calldata data) external returns (bytes memory) {
        return IUnlockCallback(msg.sender).unlockCallback(data);
    }

    /// @dev getSlot0 reads this; return a 1:1 price (tick 0), zero fees.
    function extsload(bytes32) external pure returns (bytes32) {
        return bytes32(uint256(SQRT_PRICE_1_1));
    }

    function modifyLiquidity(PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata params, bytes calldata)
        external
        pure
        returns (BalanceDelta callerDelta, BalanceDelta feesAccrued)
    {
        int256 liqDelta = params.liquidityDelta;
        feesAccrued = toBalanceDelta(0, 0);
        if (liqDelta == 0) {
            return (toBalanceDelta(0, 0), feesAccrued);
        }
        uint160 sqrtA = TickMath.getSqrtPriceAtTick(params.tickLower);
        uint160 sqrtB = TickMath.getSqrtPriceAtTick(params.tickUpper);
        uint256 magnitude = liqDelta > 0 ? uint256(liqDelta) : uint256(-liqDelta);
        (uint256 amt0, uint256 amt1) =
            LiquidityAmounts.getAmountsForLiquidity(SQRT_PRICE_1_1, sqrtA, sqrtB, uint128(magnitude));
        if (liqDelta > 0) {
            // Amounts owed by the LP are negative deltas (debts to settle).
            callerDelta = toBalanceDelta(-int128(int256(amt0)), -int128(int256(amt1)));
        } else {
            // A burn credits the LP: positive deltas the LP may `take`.
            callerDelta = toBalanceDelta(int128(int256(amt0)), int128(int256(amt1)));
        }
    }

    function sync(Currency) external { }

    // solhint-disable-next-line no-empty-blocks
    function settle() external payable returns (uint256) {
        return msg.value;
    }

    /// @dev A real `take`: pay the credited amount out of this manager's own holdings, so a burn's
    ///      principal is observable on the recipient's balance rather than assumed.
    function take(Currency currency, address to, uint256 amount) external {
        if (Currency.unwrap(currency) == address(0)) {
            (bool ok,) = to.call{ value: amount }("");
            require(ok, "take native failed");
        } else {
            MockERC20(Currency.unwrap(currency)).transfer(to, amount);
        }
    }
}

contract ProtocolOwnedLiquidityTest is Test {
    ProtocolOwnedLiquidityV1 public implementation;
    ProtocolOwnedLiquidityV1 public pol;
    MockMasterRegistry public mockRegistry;
    MockERC20 public token;

    address public owner = address(0x1);
    address public alice = address(0x2);
    address public bob = address(0x3);

    function setUp() public {
        implementation = new ProtocolOwnedLiquidityV1();
        bytes memory initData = abi.encodeWithSelector(ProtocolOwnedLiquidityV1.initialize.selector, owner);
        ERC1967Proxy proxy = new ERC1967Proxy(address(implementation), initData);
        pol = ProtocolOwnedLiquidityV1(payable(address(proxy)));

        mockRegistry = new MockMasterRegistry();
        token = new MockERC20("Mock", "MOCK");

        vm.deal(alice, 100 ether);
        vm.deal(bob, 10 ether);
    }

    // ========== Initialization ==========

    function test_initialize() public view {
        assertEq(pol.owner(), owner);
    }

    function test_initialize_revertDouble() public {
        vm.expectRevert(Ownable.AlreadyInitialized.selector);
        pol.initialize(address(0x999));
    }

    // ========== Configuration ==========

    function test_setV4PoolManager() public {
        vm.prank(owner);
        pol.setV4PoolManager(address(0x999));
        assertEq(pol.v4PoolManager(), address(0x999));
    }

    function test_setV4PoolManager_RevertNonOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        pol.setV4PoolManager(address(0x999));
    }

    function test_setV4PoolManager_RevertZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(ProtocolOwnedLiquidityV1.InvalidAddress.selector);
        pol.setV4PoolManager(address(0));
    }

    function test_setWETH() public {
        vm.prank(owner);
        pol.setWETH(address(0x888));
        assertEq(pol.weth(), address(0x888));
    }

    function test_setWETH_RevertNonOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        pol.setWETH(address(0x888));
    }

    function test_setWETH_RevertZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(ProtocolOwnedLiquidityV1.InvalidAddress.selector);
        pol.setWETH(address(0));
    }

    function test_setMasterRegistry() public {
        vm.prank(owner);
        pol.setMasterRegistry(address(mockRegistry));
        assertEq(address(pol.masterRegistry()), address(mockRegistry));
    }

    function test_setMasterRegistry_RevertNonOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        pol.setMasterRegistry(address(mockRegistry));
    }

    // ========== receivePOL gate (moved verbatim from the treasury) ==========

    function test_receivePOL_RevertRegistryNotConfigured() public {
        PoolKey memory key = _dummyPoolKey();
        vm.prank(alice);
        vm.expectRevert(ProtocolOwnedLiquidityV1.RegistryNotConfigured.selector);
        pol.receivePOL(key, -887220, 887220, 1 ether, 1 ether);
    }

    function test_receivePOL_RevertNotRegisteredInstance() public {
        vm.prank(owner);
        pol.setMasterRegistry(address(mockRegistry));

        PoolKey memory key = _dummyPoolKey();
        vm.prank(alice);
        vm.expectRevert(ProtocolOwnedLiquidityV1.NotRegisteredInstance.selector);
        pol.receivePOL(key, -887220, 887220, 1 ether, 1 ether);
    }

    function test_receivePOL_RevertV4NotConfigured() public {
        vm.prank(owner);
        pol.setMasterRegistry(address(mockRegistry));
        mockRegistry.setRegistered(alice, true);

        vm.prank(owner);
        pol.setWETH(address(0x888));

        PoolKey memory key = _dummyPoolKey();
        vm.prank(alice);
        vm.expectRevert(ProtocolOwnedLiquidityV1.V4NotConfigured.selector);
        pol.receivePOL(key, -887220, 887220, 1 ether, 1 ether);
    }

    function test_receivePOL_RevertWETHNotConfigured() public {
        vm.prank(owner);
        pol.setMasterRegistry(address(mockRegistry));
        mockRegistry.setRegistered(alice, true);

        vm.prank(owner);
        pol.setV4PoolManager(address(0x999));

        PoolKey memory key = _dummyPoolKey();
        vm.prank(alice);
        vm.expectRevert(ProtocolOwnedLiquidityV1.WETHNotConfigured.selector);
        pol.receivePOL(key, -887220, 887220, 1 ether, 1 ether);
    }

    // ========== receivePOL escrow / drain-regression (noesis-111) ==========
    //
    // Live-pool fixture: a real V4 PoolManager with a native/token pool at 1:1, so `receivePOL`
    // exercises the true `modifyLiquidity` + settle path. These prove the §2f fix: the V4 position is
    // funded strictly from caller-escrowed value, never from this contract's shared balance.

    int24 internal constant TICK_LOWER = -887_220;
    int24 internal constant TICK_UPPER = 887_220;

    MockPoolManagerV4 internal pm;

    /// @dev Native ETH is currency0 (address(0) is the lowest), the mock token is currency1.
    function _livePoolKey() internal view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(token)),
            fee: 3000,
            tickSpacing: int24(60),
            hooks: IHooks(address(0))
        });
    }

    /// @dev Stand up the V4 stub + a native/token pool at 1:1 and fully configure `pol`.
    function _setUpLivePool() internal returns (PoolKey memory key) {
        pm = new MockPoolManagerV4();

        vm.startPrank(owner);
        pol.setV4PoolManager(address(pm));
        pol.setWETH(address(0xBEEF)); // unused by the native leg; config guard only
        pol.setMasterRegistry(address(mockRegistry));
        vm.stopPrank();

        mockRegistry.setRegistered(alice, true);

        key = _livePoolKey();

        // Fund the caller (alice) with the token leg and approval.
        token.mint(alice, 100 ether);
        vm.prank(alice);
        token.approve(address(pol), type(uint256).max);
    }

    /// @notice Headline drain regression: with correct escrow the position deploys AND the pre-seeded
    ///         shared ETH is untouchable — the position is funded only by the caller's `msg.value`.
    function test_receivePOL_DeploysFromEscrow_SharedETHUntouched() public {
        PoolKey memory key = _setUpLivePool();

        // Pre-seed the shared balance the way pooled fees / treasury seeding would (via receive()).
        uint256 seeded = 5 ether;
        vm.deal(address(this), seeded);
        (bool ok,) = address(pol).call{ value: seeded }("");
        assertTrue(ok);
        assertEq(address(pol).balance, seeded, "seed precondition");

        uint256 nativeAmt = 1 ether;
        uint256 tokenAmt = 1 ether;

        vm.prank(alice);
        pol.receivePOL{ value: nativeAmt }(key, TICK_LOWER, TICK_UPPER, nativeAmt, tokenAmt);

        // Position deployed.
        assertEq(pol.polInstanceCount(), 1, "position count");
        (,,, uint128 liquidity) = pol.getPolPosition(alice);
        assertGt(liquidity, 0, "liquidity deployed");

        // The pre-seeded shared ETH is EXACTLY unchanged: escrow funded the leg, dust was refunded.
        assertEq(address(pol).balance, seeded, "shared ETH must be untouched");
        // No caller escrow is stranded here either.
        assertEq(token.balanceOf(address(pol)), 0, "no leftover token escrow in POL");
    }

    /// @notice A `msg.value`-short call cannot fund the native leg from the shared balance: it reverts,
    ///         and the pre-seeded shared ETH is untouched. This is the drain vector, closed.
    function test_receivePOL_MsgValueShort_RevertsCannotDrainShared() public {
        PoolKey memory key = _setUpLivePool();

        uint256 seeded = 5 ether;
        vm.deal(address(this), seeded);
        (bool ok,) = address(pol).call{ value: seeded }("");
        assertTrue(ok);

        // Directs a 1 ETH native leg but escrows 0 → must revert, cannot borrow the shared 5 ETH.
        vm.prank(alice);
        vm.expectRevert(ProtocolOwnedLiquidityV1.NativeValueMismatch.selector);
        pol.receivePOL{ value: 0 }(key, TICK_LOWER, TICK_UPPER, 1 ether, 1 ether);

        assertEq(address(pol).balance, seeded, "shared ETH untouched after revert");
        assertEq(pol.polInstanceCount(), 0, "no position");
    }

    /// @notice Over-escrowed native value is rejected too (must equal the native leg exactly).
    function test_receivePOL_MsgValueOver_Reverts() public {
        PoolKey memory key = _setUpLivePool();
        vm.prank(alice);
        vm.expectRevert(ProtocolOwnedLiquidityV1.NativeValueMismatch.selector);
        pol.receivePOL{ value: 2 ether }(key, TICK_LOWER, TICK_UPPER, 1 ether, 1 ether);
    }

    /// @notice The token leg is pulled from the caller for this deploy (not assumed already pooled here).
    function test_receivePOL_TokenLegPulledFromCaller() public {
        PoolKey memory key = _setUpLivePool();

        uint256 aliceTokenBefore = token.balanceOf(alice);

        vm.prank(alice);
        pol.receivePOL{ value: 1 ether }(key, TICK_LOWER, TICK_UPPER, 1 ether, 1 ether);

        // Alice paid the token leg (consumed amount); any unconsumed token escrow was refunded to her.
        assertLt(token.balanceOf(alice), aliceTokenBefore, "caller funded the token leg");
        assertEq(token.balanceOf(address(pol)), 0, "no token escrow retained");
    }

    /// @notice Without allowance the caller-pull reverts — the contract never fronts the token leg.
    function test_receivePOL_RevertInsufficientAllowance() public {
        PoolKey memory key = _setUpLivePool();

        vm.prank(alice);
        token.approve(address(pol), 0);

        vm.prank(alice);
        vm.expectRevert();
        pol.receivePOL{ value: 1 ether }(key, TICK_LOWER, TICK_UPPER, 1 ether, 1 ether);
    }

    /// @notice Escrow the position does not consume is refunded to the caller, not stranded in POL.
    function test_receivePOL_RefundsUnusedEscrow() public {
        PoolKey memory key = _setUpLivePool();

        uint256 seeded = 3 ether;
        vm.deal(address(this), seeded);
        (bool ok,) = address(pol).call{ value: seeded }("");
        assertTrue(ok);

        uint256 aliceEthBefore = alice.balance;

        // Over-provide the native leg (3 ETH) relative to the 1 ETH token leg; at 1:1 full-range the
        // position is sized by the smaller leg, so most native escrow is refunded.
        vm.prank(alice);
        pol.receivePOL{ value: 3 ether }(key, TICK_LOWER, TICK_UPPER, 3 ether, 1 ether);

        // Caller spent strictly less than the full 3 ETH escrow (got a refund).
        assertGt(alice.balance, aliceEthBefore - 3 ether, "unused native escrow refunded to caller");
        // Shared seed untouched; no native or token escrow left behind.
        assertEq(address(pol).balance, seeded, "shared ETH untouched");
        assertEq(token.balanceOf(address(pol)), 0, "no token escrow retained");
    }

    /// @notice One position per instance guard still holds after the escrow rewrite.
    function test_receivePOL_RevertAlreadyDeployed() public {
        PoolKey memory key = _setUpLivePool();

        vm.prank(alice);
        pol.receivePOL{ value: 1 ether }(key, TICK_LOWER, TICK_UPPER, 1 ether, 1 ether);

        vm.prank(alice);
        vm.expectRevert(ProtocolOwnedLiquidityV1.POLAlreadyDeployed.selector);
        pol.receivePOL{ value: 1 ether }(key, TICK_LOWER, TICK_UPPER, 1 ether, 1 ether);
    }

    // ========== withdrawPOL — the principal exit (noesis-303) ==========
    //
    // The deposit seam has a matching exit: an owner-gated negative `liquidityDelta` through the same
    // `unlock` callback. These assert the principal actually comes back and that partial exits keep the
    // remainder live.

    /// @notice A deployed position can be fully exited: the principal lands on this contract and the
    ///         existing owner sweep moves it out.
    function test_withdrawPOL_ReturnsPrincipalToTreasury() public {
        PoolKey memory key = _setUpLivePool();

        vm.prank(alice);
        pol.receivePOL{ value: 1 ether }(key, TICK_LOWER, TICK_UPPER, 1 ether, 1 ether);

        (,,, uint128 liquidity) = pol.getPolPosition(alice);
        assertGt(liquidity, 0, "liquidity deployed");
        // Every wei of the principal is inside the position before the exit.
        assertEq(address(pol).balance, 0, "no loose native before exit");
        assertEq(token.balanceOf(address(pol)), 0, "no loose token before exit");

        vm.prank(owner);
        (uint256 amount0, uint256 amount1) = pol.withdrawPOL(alice, liquidity);

        assertGt(amount0, 0, "native principal returned");
        assertGt(amount1, 0, "token principal returned");
        assertEq(address(pol).balance, amount0, "native principal credited to POL");
        assertEq(token.balanceOf(address(pol)), amount1, "token principal credited to POL");

        (,,, uint128 liquidityAfter) = pol.getPolPosition(alice);
        assertEq(liquidityAfter, 0, "position fully burnt");

        // The existing sweeps now have something to sweep — before the exit they had nothing.
        uint256 bobBefore = bob.balance;
        vm.prank(owner);
        pol.withdrawETH(bob, amount0);
        assertEq(bob.balance, bobBefore + amount0, "recovered native swept to recipient");

        vm.prank(owner);
        pol.withdrawERC20(address(token), bob, amount1);
        assertEq(token.balanceOf(bob), amount1, "recovered token swept to recipient");
    }

    /// @notice The exit is owner-gated: no one else can move the protocol's liquidity.
    function test_withdrawPOL_RevertNonOwner() public {
        PoolKey memory key = _setUpLivePool();

        vm.prank(alice);
        pol.receivePOL{ value: 1 ether }(key, TICK_LOWER, TICK_UPPER, 1 ether, 1 ether);

        (,,, uint128 liquidity) = pol.getPolPosition(alice);

        // alice is the registered instance that funded the position, bob is unrelated — neither may exit it.
        vm.prank(alice);
        vm.expectRevert(Ownable.Unauthorized.selector);
        pol.withdrawPOL(alice, liquidity);

        vm.prank(bob);
        vm.expectRevert(Ownable.Unauthorized.selector);
        pol.withdrawPOL(alice, liquidity);

        (,,, uint128 liquidityAfter) = pol.getPolPosition(alice);
        assertEq(liquidityAfter, liquidity, "position untouched by unauthorized calls");
    }

    /// @notice A partial exit returns part of the principal and leaves the remainder live and readable.
    function test_withdrawPOL_PartialLeavesRemainderIntact() public {
        PoolKey memory key = _setUpLivePool();

        vm.prank(alice);
        pol.receivePOL{ value: 1 ether }(key, TICK_LOWER, TICK_UPPER, 1 ether, 1 ether);

        (int24 tickLower, int24 tickUpper, bytes32 salt, uint128 liquidity) = pol.getPolPosition(alice);
        uint128 half = liquidity / 2;

        vm.prank(owner);
        (uint256 amount0, uint256 amount1) = pol.withdrawPOL(alice, half);
        assertGt(amount0, 0, "partial native returned");
        assertGt(amount1, 0, "partial token returned");

        (int24 tickLowerAfter, int24 tickUpperAfter, bytes32 saltAfter, uint128 liquidityAfter) =
            pol.getPolPosition(alice);
        assertEq(liquidityAfter, liquidity - half, "remaining liquidity tracked");
        assertGt(liquidityAfter, 0, "remainder still live");
        assertEq(tickLowerAfter, tickLower, "range unchanged");
        assertEq(tickUpperAfter, tickUpper, "range unchanged");
        assertEq(saltAfter, salt, "salt unchanged");

        // The remainder is still a real position: fee collection still routes to it.
        vm.prank(bob);
        pol.claimPOLFees(alice);

        // And the rest can be exited afterwards.
        vm.prank(owner);
        pol.withdrawPOL(alice, liquidityAfter);
        (,,, uint128 liquidityFinal) = pol.getPolPosition(alice);
        assertEq(liquidityFinal, 0, "remainder exited");
    }

    function test_withdrawPOL_RevertNoPosition() public {
        vm.prank(owner);
        vm.expectRevert(ProtocolOwnedLiquidityV1.NoPOLPosition.selector);
        pol.withdrawPOL(address(0xDEAD), 1);
    }

    function test_withdrawPOL_RevertZeroLiquidity() public {
        PoolKey memory key = _setUpLivePool();

        vm.prank(alice);
        pol.receivePOL{ value: 1 ether }(key, TICK_LOWER, TICK_UPPER, 1 ether, 1 ether);

        vm.prank(owner);
        vm.expectRevert(ProtocolOwnedLiquidityV1.InvalidLiquidityAmount.selector);
        pol.withdrawPOL(alice, 0);
    }

    function test_withdrawPOL_RevertExceedsPosition() public {
        PoolKey memory key = _setUpLivePool();

        vm.prank(alice);
        pol.receivePOL{ value: 1 ether }(key, TICK_LOWER, TICK_UPPER, 1 ether, 1 ether);

        (,,, uint128 liquidity) = pol.getPolPosition(alice);

        vm.prank(owner);
        vm.expectRevert(ProtocolOwnedLiquidityV1.InvalidLiquidityAmount.selector);
        pol.withdrawPOL(alice, liquidity + 1);
    }

    // ========== claimPOLFees ==========

    function test_claimPOLFees_RevertNoPosition() public {
        // Permissionless — anyone may call — but reverts with no position.
        vm.prank(alice);
        vm.expectRevert(ProtocolOwnedLiquidityV1.NoPOLPosition.selector);
        pol.claimPOLFees(address(0xDEAD));
    }

    /// @notice `claimPOLFees` stays permissionless: a non-owner, non-instance caller may collect for a
    ///         live position (here it simply nets zero fees, but is NOT access-gated).
    function test_claimPOLFees_PermissionlessForLivePosition() public {
        PoolKey memory key = _setUpLivePool();

        vm.prank(alice);
        pol.receivePOL{ value: 1 ether }(key, TICK_LOWER, TICK_UPPER, 1 ether, 1 ether);

        // bob is neither owner nor a registered instance, yet may call for alice's position.
        vm.prank(bob);
        pol.claimPOLFees(alice);
    }

    // ========== unlockCallback caller check ==========

    function test_unlockCallback_RevertUnauthorized() public {
        vm.prank(owner);
        pol.setV4PoolManager(address(0x999));

        // Only the configured PoolManager may invoke the callback.
        vm.prank(alice);
        vm.expectRevert(Ownable.Unauthorized.selector);
        pol.unlockCallback("");
    }

    // ========== Owner sweeps ==========

    function test_withdrawETH() public {
        vm.deal(address(pol), 5 ether);

        vm.prank(owner);
        pol.withdrawETH(bob, 3 ether);

        assertEq(bob.balance, 13 ether);
        assertEq(pol.getBalance(), 2 ether);
    }

    function test_withdrawETH_RevertNonOwner() public {
        vm.deal(address(pol), 1 ether);
        vm.prank(alice);
        vm.expectRevert();
        pol.withdrawETH(alice, 1 ether);
    }

    function test_withdrawETH_RevertInsufficientBalance() public {
        vm.prank(owner);
        vm.expectRevert(ProtocolOwnedLiquidityV1.InsufficientBalance.selector);
        pol.withdrawETH(bob, 1 ether);
    }

    function test_withdrawETH_RevertZeroAddress() public {
        vm.deal(address(pol), 1 ether);
        vm.prank(owner);
        vm.expectRevert(ProtocolOwnedLiquidityV1.InvalidRecipient.selector);
        pol.withdrawETH(address(0), 1 ether);
    }

    function test_withdrawERC20() public {
        token.mint(address(pol), 1000);

        vm.prank(owner);
        pol.withdrawERC20(address(token), bob, 500);

        assertEq(token.balanceOf(bob), 500);
        assertEq(token.balanceOf(address(pol)), 500);
    }

    function test_withdrawERC20_RevertNonOwner() public {
        token.mint(address(pol), 1000);
        vm.prank(alice);
        vm.expectRevert();
        pol.withdrawERC20(address(token), alice, 1000);
    }

    // ========== Views ==========

    function test_polInstanceCount_InitiallyZero() public view {
        assertEq(pol.polInstanceCount(), 0);
    }

    function test_getPolPosition_EmptyForUnknown() public view {
        (int24 tickLower, int24 tickUpper, bytes32 salt, uint128 liquidity) = pol.getPolPosition(address(0xDEAD));
        assertEq(tickLower, 0);
        assertEq(tickUpper, 0);
        assertEq(salt, bytes32(0));
        assertEq(liquidity, 0);
    }

    function test_receive_acceptsETH() public {
        vm.prank(alice);
        (bool success,) = address(pol).call{ value: 1 ether }("");
        assertTrue(success);
        assertEq(pol.getBalance(), 1 ether);
    }

    // ========== Helpers ==========

    function _dummyPoolKey() internal pure returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(0xAAA)),
            currency1: Currency.wrap(address(0xBBB)),
            fee: 3000,
            tickSpacing: int24(60),
            hooks: IHooks(address(0))
        });
    }
}
