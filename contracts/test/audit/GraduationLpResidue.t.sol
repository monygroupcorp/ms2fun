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
 * @notice M-1, 2026-09-17 pre-testnet audit. A graduating launch hands its whole LP leg to a venue
 *         deployer module. When the venue consumes LESS than the module handed it — because a
 *         front-runner pre-initialized the pool at a price inside the module's own tolerance band —
 *         the remainder used to sit in the module forever: none of the three exposed any path that
 *         moved a stray balance out, not an owner sweep, not a permissionless drain, not
 *         `flushPendingVaultCut` (which can only pay out an amount a reverting vault stashed).
 *
 *         Every assertion here is on the fixed behaviour, and each one failed before the fix:
 *
 *           * the post-graduation module balance is ZERO on every venue, for both sides;
 *           * the unconsumed ETH shows up on the 80/19/1 rail, so the raise still adds up;
 *           * the unconsumed coin shows up at the graduating instance;
 *           * the init-price band is 1% ON PRICE, not 1% on `sqrtPriceX96` — it was the latter, so
 *             the constant labelled 100 bps admitted +2.01% and stranded 197 bps of the ETH leg;
 *           * Uniswap v4 has a slippage floor at all. It had none: v4 takes no min-amount
 *             parameter, so the band was the only cap on how little the pool could take.
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

/// @dev A pool manager that takes a FIXED fraction of each side regardless of price, so the
///      module's own slippage floor can be exercised independently of the init-price band. Real v4
///      cannot under-consume this far while the band holds, which is the point: the floor is the
///      guard that stops a venue surprise from becoming a strand.
contract LazyV4PoolManager {
    uint256 public takeBps = 10_000;
    bytes32 private _slot0;

    function setTakeBps(uint256 bps) external {
        takeBps = bps;
    }

    function extsload(bytes32) external view returns (bytes32) {
        return _slot0;
    }

    /// @dev A FRESH pool, so the module initializes it at its own intended price and the init-price
    ///      band is not what this test is measuring.
    function initialize(PoolKey calldata, uint160 sqrtPriceX96) external returns (int24 tick) {
        tick = TickMath.getTickAtSqrtPrice(sqrtPriceX96);
        _slot0 = bytes32(uint256(sqrtPriceX96) | (uint256(uint24(tick)) << 160));
    }

    function unlock(bytes calldata data) external returns (bytes memory) {
        return IUnlockCallback(msg.sender).unlockCallback(data);
    }

    uint256 private _a0;
    uint256 private _a1;

    function setDesired(uint256 a0, uint256 a1) external {
        (_a0, _a1) = (a0, a1);
    }

    function modifyLiquidity(PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata, bytes calldata)
        external
        view
        returns (BalanceDelta, BalanceDelta)
    {
        return (
            toBalanceDelta(-int128(int256(_a0 * takeBps / 10_000)), -int128(int256(_a1 * takeBps / 10_000))),
            toBalanceDelta(int128(0), int128(0))
        );
    }

    function sync(Currency) external { }

    function settle() external payable returns (uint256) {
        return 0;
    }

    function take(Currency, address, uint256) external { }

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

    /// @dev `sqrtPriceX96` at `bps` basis points of deviation ON PRICE from the intended price, which
    ///      is the axis the fixed band measures: sqrt(1 + bps/10000) applied to the root.
    function _sqrtPriceAtPriceDeviationBps(int256 bps) internal pure returns (uint160) {
        uint256 intended = _intendedSqrtPrice();
        uint256 ratioWad = uint256(int256(1e18) + bps * 1e18 / 10_000);
        return uint160(intended * FixedPointMathLib.sqrt(ratioWad * 1e18) / 1e18);
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

    /// @dev Every wei of the raise is accounted for: the pool has what it took, the rail has the rest,
    ///      and the module has nothing. The second half is what M-1 was about; the first half is what
    ///      stops a "fix" that simply throws the residue away from passing.
    function _assertRaiseFullyAccounted() internal view {
        uint256 railed = treasury.balance + address(vault).balance + CREATOR.balance;
        assertEq(address(module).balance, 0, "module must hold no ETH after graduation");
        assertEq(railed + address(pm).balance, ETH_RESERVE, "every wei of the raise is placed or paid");
    }

    /// @notice CONTROL: a fresh pool is initialized at the module's own price. Both sides are consumed
    ///         to within rounding, and even that rounding dust is now routed rather than retained.
    function test_v4_freshPool_leavesNoResidue() public {
        _graduate();

        assertEq(instance.balanceOf(address(module)), 0, "no coin left in the module");
        _assertRaiseFullyAccounted();
    }

    /// @notice A front-runner pre-initializes the graduation pool ABOVE the graduation price, at the
    ///         widest deviation the fixed band still accepts. `getLiquidityForAmounts` takes
    ///         `min(L0, L1)` at the live price, the coin side binds, and the ETH the pool did not take
    ///         rides the 80/19/1 rail home instead of staying in a singleton with no exit.
    function test_v4_preInitWithinTolerance_returnsUnconsumedEthToTheRail() public {
        pm.seed(_sqrtPriceAtPriceDeviationBps(99));

        uint256 railedBefore = treasury.balance + address(vault).balance + CREATOR.balance;
        _graduate();

        // The pool took less than the LP leg — otherwise this test proves nothing.
        assertLt(address(pm).balance, ETH_FOR_POOL, "precondition: the pool under-consumed the ETH leg");
        uint256 residue = ETH_FOR_POOL - address(pm).balance;
        emit log_named_decimal_uint("ETH for pool        ", ETH_FOR_POOL, 18);
        emit log_named_decimal_uint("returned to the rail", residue, 18);

        // The rail always takes the base 1% + 19% of the raise; the residue is what it gains ON TOP.
        uint256 railed = treasury.balance + address(vault).balance + CREATOR.balance;
        assertEq(
            railed - railedBefore,
            (ETH_RESERVE - ETH_FOR_POOL) + residue,
            "the rail gained the base cuts plus exactly the unconsumed ETH"
        );
        _assertRaiseFullyAccounted();
    }

    /// @notice The mirror image: pre-initialized BELOW the graduation price binds the ETH side, and
    ///         the unconsumed COIN goes back to the graduating instance.
    function test_v4_preInitWithinTolerance_returnsUnconsumedCoinToTheInstance() public {
        pm.seed(_sqrtPriceAtPriceDeviationBps(-99));

        uint256 instanceCoinBefore = instance.balanceOf(address(instance));
        _graduate();

        uint256 returned = instance.balanceOf(address(instance)) - instanceCoinBefore;
        emit log_named_decimal_uint("coin for pool       ", TOKEN_RESERVE, 18);
        emit log_named_decimal_uint("returned to instance", returned, 18);

        assertEq(instance.balanceOf(address(module)), 0, "no coin left in the module");
        assertGt(returned, 0, "precondition: the pool under-consumed the coin leg");
        assertEq(returned + instance.balanceOf(address(pm)), TOKEN_RESERVE, "every coin is placed or returned");
        _assertRaiseFullyAccounted();
    }

    /// @notice The band is 1% ON PRICE. It used to be applied to `sqrtPriceX96`, whose square is
    ///         price, so a constant labelled 100 bps admitted +2.01% / -1.99% — and the unconsumed
    ///         side is `d/(1+d)` of its leg, so twice the band stranded twice the ETH. A pool just
    ///         inside the band is accepted; a pool just outside it is refused.
    function test_v4_initPriceBand_isOnePercentOnPrice() public {
        pm.seed(_sqrtPriceAtPriceDeviationBps(101));
        instance.mint(address(module), TOKEN_RESERVE);
        vm.deal(address(instance), ETH_RESERVE);
        vm.expectRevert(LiquidityDeployerModule.PoolPriceMismatch.selector);
        instance.graduate(address(module), _params(), ETH_RESERVE);
    }

    /// @notice And the other edge, so the test above cannot pass by refusing everything.
    function test_v4_initPriceBand_acceptsJustInside() public {
        pm.seed(_sqrtPriceAtPriceDeviationBps(99));
        _graduate();
        _assertRaiseFullyAccounted();
    }

    /// @notice Uniswap v4 takes no min-amount parameter, so the ZAMM/Cypher `amount * 99 / 100` floors
    ///         had no equivalent here and the band was the ONLY cap on how little the pool could take.
    ///         The floor is now asserted on the settled delta: a venue that takes under 99% of a leg
    ///         reverts graduation instead of stranding the difference.
    function test_v4_venueTakingUnder99Percent_revertsRatherThanStranding() public {
        LazyV4PoolManager lazy = new LazyV4PoolManager();
        LiquidityDeployerModule m =
            new LiquidityDeployerModule(address(lazy), address(0x3), POOL_FEE, TICK_SPACING, address(registry));
        lazy.setDesired(ETH_FOR_POOL, TOKEN_RESERVE);

        instance.mint(address(m), TOKEN_RESERVE);
        vm.deal(address(instance), ETH_RESERVE);

        lazy.setTakeBps(9899);
        vm.expectRevert(LiquidityDeployerModule.InsufficientLiquidityConsumed.selector);
        instance.graduate(address(m), _params(), ETH_RESERVE);

        // 99% exactly is the sibling convention and is accepted — and the 1% it left is returned.
        lazy.setTakeBps(9900);
        instance.graduate(address(m), _params(), ETH_RESERVE);
        assertEq(address(m).balance, 0, "module must hold no ETH after graduation");
        assertEq(instance.balanceOf(address(m)), 0, "no coin left in the module");
    }

    /// @notice The fix adds NO removal path. The graduation position still lives in the pool manager
    ///         and no selector on the module reaches it — the property `LpLockInvariant.t.sol` pins.
    ///         What changed is only that nothing is left behind to need one.
    function test_v4_stillHasNoRemovalPath() public {
        pm.seed(_sqrtPriceAtPriceDeviationBps(99));
        _graduate();

        string[8] memory sigs = [
            "removeLiquidity(uint256)",
            "removeLiquidity(uint256,uint256,uint256)",
            "decreaseLiquidity(uint256)",
            "withdraw()",
            "withdrawLiquidity()",
            "collect(uint256)",
            "burn(uint256)",
            "unwind()"
        ];
        for (uint256 i = 0; i < sigs.length; i++) {
            (bool ok,) = address(module).call(abi.encodeWithSignature(sigs[i]));
            assertFalse(ok, "removal entry point must not exist");
        }
        vm.expectRevert(LiquidityDeployerModule.NoPendingVaultCut.selector);
        module.flushPendingVaultCut(address(instance));
    }

    /// @notice The coin backstop: permissionless, and with no destination to choose. Anyone may push
    ///         an instance's coin back to that instance, which for ERC404 is the token itself.
    function test_v4_sweepUnconsumedCoin_sendsItToTheInstance() public {
        instance.mint(address(module), 5 ether);

        vm.prank(makeAddr("passerby"));
        module.sweepUnconsumedCoin(address(instance));

        assertEq(instance.balanceOf(address(module)), 0, "the module is empty");
        assertEq(instance.balanceOf(address(instance)), 5 ether, "the instance has it");

        vm.expectRevert(LiquidityDeployerModule.NoUnconsumedCoin.selector);
        module.sweepUnconsumedCoin(address(instance));
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

    function _assertRaiseFullyAccounted() internal view {
        uint256 railed = treasury.balance + address(vault).balance + CREATOR.balance;
        assertEq(address(module).balance, 0, "module must hold no ETH after graduation");
        assertEq(railed + address(zamm).balance, ETH_RESERVE, "every wei of the raise is placed or paid");
    }

    /// @notice A front-runner pre-seeds the pool with a reserve ratio 1% richer in coin than the
    ///         intended graduation ratio — inside `MAX_INIT_PRICE_DEVIATION_BPS`, so the guard passes.
    ///         ZAMM's `addLiquidity` caps the ETH leg at the pool ratio and refunds the remainder to
    ///         `msg.sender` — this module. The module used to DISCARD the returned `(amount0, amount1)`
    ///         entirely, so it never even observed the refund; now it tithes it onto the rail.
    function test_zamm_preSeedWithinTolerance_returnsRefundedEthToTheRail() public {
        zamm.setPool(_poolId(), uint112(ETH_FOR_POOL), uint112(TOKEN_RESERVE * 101 / 100), 1000 ether);

        uint256 railedBefore = treasury.balance + address(vault).balance + CREATOR.balance;
        _graduate();

        assertLt(address(zamm).balance, ETH_FOR_POOL, "precondition: ZAMM capped the ETH leg");
        uint256 residue = ETH_FOR_POOL - address(zamm).balance;
        emit log_named_decimal_uint("ETH for pool        ", ETH_FOR_POOL, 18);
        emit log_named_decimal_uint("returned to the rail", residue, 18);

        // The rail always takes the base 1% + 19% of the raise; the residue is what it gains ON TOP.
        uint256 railed = treasury.balance + address(vault).balance + CREATOR.balance;
        assertEq(
            railed - railedBefore,
            (ETH_RESERVE - ETH_FOR_POOL) + residue,
            "the rail gained the base cuts plus exactly the refunded ETH"
        );
        _assertRaiseFullyAccounted();
    }

    /// @notice The mirror image: a pool 1% poorer in coin caps the COIN leg, and the coin ZAMM never
    ///         pulled goes back to the instance instead of sitting in a module with no transfer path.
    ///         The leftover allowance goes with it — coin the module no longer holds must not stay
    ///         spendable by the AMM.
    function test_zamm_preSeedWithinTolerance_returnsUnpulledCoinToTheInstance() public {
        zamm.setPool(_poolId(), uint112(ETH_FOR_POOL), uint112(TOKEN_RESERVE * 99 / 100), 1000 ether);

        _graduate();

        uint256 returned = token.balanceOf(address(this));
        emit log_named_decimal_uint("returned to instance", returned, 18);

        assertEq(token.balanceOf(address(module)), 0, "no coin left in the module");
        assertGt(returned, 0, "precondition: ZAMM capped the coin leg");
        assertEq(token.allowance(address(module), address(zamm)), 0, "no live allowance over coin it no longer holds");
        assertEq(returned + token.balanceOf(address(zamm)), TOKEN_RESERVE, "every coin is placed or returned");
        _assertRaiseFullyAccounted();
    }

    /// @notice The coin backstop, same shape as the other two venues.
    function test_zamm_sweepUnconsumedCoin_sendsItToTheInstance() public {
        token.mint(address(module), 5 ether);

        vm.prank(makeAddr("passerby"));
        module.sweepUnconsumedCoin(address(token));

        assertEq(token.balanceOf(address(module)), 0, "the module is empty");
        assertEq(token.balanceOf(address(token)), 5 ether, "the token contract has it");
    }

    receive() external payable { }
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
    ///         leaves used to be WETH and coin sitting in a module that exposed no ERC20 transfer path
    ///         at all — not even an owner one. Now the WETH is unwrapped onto the rail and the coin
    ///         goes back to the instance. (`absorbBps` is the repo mock's own knob for exactly this.)
    function test_cypher_venueAbsorbsLessThanSent_returnsBothSides() public {
        positionManager.setAbsorbBps(9900);

        uint256 railedBefore = treasury.balance + address(vault).balance + CREATOR.balance;
        _graduate();

        uint256 wethToPool = weth.balanceOf(address(positionManager));
        assertLt(wethToPool, ETH_FOR_POOL, "precondition: the position manager under-absorbed");
        uint256 residue = ETH_FOR_POOL - wethToPool;
        emit log_named_decimal_uint("ETH for pool (wrapped)", ETH_FOR_POOL, 18);
        emit log_named_decimal_uint("returned to the rail  ", residue, 18);

        assertEq(weth.balanceOf(address(module)), 0, "no WETH left in the module");
        assertEq(address(module).balance, 0, "no ETH left in the module");
        assertEq(token.balanceOf(address(module)), 0, "no coin left in the module");
        assertEq(
            token.allowance(address(module), address(positionManager)),
            0,
            "no live allowance over coin it no longer holds"
        );
        assertGt(token.balanceOf(address(this)), 0, "the unabsorbed coin came back to the instance");
        assertEq(
            token.balanceOf(address(this)) + token.balanceOf(address(positionManager)),
            TOKEN_RESERVE,
            "every coin is placed or returned"
        );

        // The rail always takes the base 1% + 19% of the raise; the residue is what it gains ON TOP.
        uint256 railed = treasury.balance + address(vault).balance + CREATOR.balance;
        assertEq(
            railed - railedBefore,
            (ETH_RESERVE - ETH_FOR_POOL) + residue,
            "the rail gained the base cuts plus exactly the unabsorbed ETH"
        );
        assertEq(railed + wethToPool, ETH_RESERVE, "every wei of the raise is placed or paid");
    }

    /// @notice Same band defect as Uniswap v4, same fix: the tolerance is 1% ON PRICE, where it used
    ///         to be 1% on `sqrtPriceX96` and therefore 2% on the quantity that decides consumption.
    ///         Cypher's `amountNMin` floors capped the damage at 1% of a leg, but the label was still
    ///         wrong by a factor of two.
    function test_cypher_initPriceBand_isOnePercentOnPrice() public {
        bool tokenIsZero = address(token) < address(weth);
        uint256 amount0 = tokenIsZero ? TOKEN_RESERVE : ETH_FOR_POOL;
        uint256 amount1 = tokenIsZero ? ETH_FOR_POOL : TOKEN_RESERVE;
        uint256 intended = FixedPointMathLib.sqrt(FixedPointMathLib.fullMulDiv(amount1, 1 << 192, amount0));

        address pool = algebraFactory.createPool(address(token), address(weth), "");
        // +1.01% on PRICE: inside the old root-measured band, outside the fixed price-measured one.
        IAlgebraPool(pool).initialize(uint160(intended * FixedPointMathLib.sqrt(10_101e14 * 1e18) / 1e18));

        token.mint(address(module), TOKEN_RESERVE);
        vm.deal(address(this), ETH_RESERVE);
        vm.expectRevert(CypherLiquidityDeployerModule.PoolPriceMismatch.selector);
        module.deployLiquidity{ value: ETH_RESERVE }(_params());
    }

    /// @notice The coin backstop, same shape as the other two venues.
    function test_cypher_sweepUnconsumedCoin_sendsItToTheInstance() public {
        token.mint(address(module), 5 ether);

        vm.prank(makeAddr("passerby"));
        module.sweepUnconsumedCoin(address(token));

        assertEq(token.balanceOf(address(module)), 0, "the module is empty");
        assertEq(token.balanceOf(address(token)), 5 ether, "the token contract has it");
    }

    receive() external payable { }
}
