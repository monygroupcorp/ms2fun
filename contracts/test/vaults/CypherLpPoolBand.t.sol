// test/vaults/CypherLpPoolBand.t.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { FixedPointMathLib } from "solady/utils/FixedPointMathLib.sol";
import { MockERC20 } from "../mocks/MockERC20.sol";
import {
    MockAlgebraPositionManager,
    MockAlgebraSwapRouter,
    MockAlgebraFactory,
    MockAlgebraPool
} from "../mocks/MockCypherAlgebra.sol";
import { MockWETH } from "../mocks/MockWETH.sol";
import { MockVaultPriceValidator } from "../mocks/MockVaultPriceValidator.sol";
import { MockAlignmentRegistry } from "../mocks/MockAlignmentRegistry.sol";
import { TestableCypherAlignmentVault } from "../helpers/TestableCypherAlignmentVault.sol";
import { CypherAlignmentVault } from "../../src/vaults/cypher/CypherAlignmentVault.sol";
import { IAlignmentRegistry } from "../../src/master/interfaces/IAlignmentRegistry.sol";
import { Currency } from "v4-core/types/Currency.sol";

/// @dev Boundary coverage for the Cypher existing-pool guard (`_validateExistingPool`).
///
///      `CypherOracleFloorBand.t.sol` pins where the acquire floor sits and proves the knob is spent
///      as a bound on PRICE there. This is its companion for the second consumer of the same knob on
///      the same call: the pre-existing target/WETH pool the vault is asked to LP into. Both must
///      measure the same scale, or one number means two things — a pool between the two bands would
///      be refused for the buy and accepted for the LP placement.
contract CypherLpPoolBandTest is Test {
    TestableCypherAlignmentVault vault;
    TestableCypherAlignmentVault impl;
    MockERC20 alignmentToken;
    MockWETH weth;
    MockAlgebraPositionManager positionManager;
    MockAlgebraSwapRouter swapRouter;
    MockAlgebraFactory factory;
    MockAlignmentRegistry registry;
    MockVaultPriceValidator validator;

    address protocolTreasury = makeAddr("treasury");
    address refPool = makeAddr("refPool");
    address alice = makeAddr("alice");

    uint256 constant TARGET_ID = 1;
    uint256 constant ETH_PER_TOKEN = 1e18; // reference TWAP: 1 ETH per 1e18 tokens
    uint256 constant DEFAULT_BPS = 500; // the vault's initialized deviation knob

    function setUp() public {
        alignmentToken = new MockERC20("Alignment", "ALN");
        weth = new MockWETH();
        positionManager = new MockAlgebraPositionManager();
        swapRouter = new MockAlgebraSwapRouter();
        factory = new MockAlgebraFactory();
        registry = new MockAlignmentRegistry();
        validator = new MockVaultPriceValidator();
        validator.setEthPer1e18Tokens(ETH_PER_TOKEN);

        registry.setTargetActive(TARGET_ID, true);
        registry.setTokenInTarget(TARGET_ID, address(alignmentToken), true);
        registry.setReferencePool(
            TARGET_ID,
            address(alignmentToken),
            IAlignmentRegistry.ReferencePool({ pool: refPool, kind: 1, twapWindow: 0 })
        );
        registry.setAcquireRoute(
            TARGET_ID,
            address(alignmentToken),
            IAlignmentRegistry.AcquireRoute({
                venue: IAlignmentRegistry.Venue.ALGEBRA, fee: 0, tickSpacing: 0, feeOrHook: 0
            })
        );

        impl = new TestableCypherAlignmentVault();
        vault = TestableCypherAlignmentVault(payable(LibClone.clone(address(impl))));
        vault.initialize(
            address(positionManager),
            address(swapRouter),
            address(factory),
            address(weth),
            address(alignmentToken),
            protocolTreasury,
            makeAddr("zRouter"), // unused by these tests; initialize now requires nonzero
            address(0), // zQuoter → Algebra fixed-pool fallback (the mock swap router)
            address(validator),
            registry,
            TARGET_ID
        );
    }

    /// @dev The vault's own reference-price derivation, mirrored so a pool can be seeded relative to it.
    function _refSqrt(uint256 ethPerToken) internal view returns (uint160) {
        (uint256 a0, uint256 a1) =
            address(alignmentToken) < address(weth) ? (uint256(1e18), ethPerToken) : (ethPerToken, uint256(1e18));
        return uint160(FixedPointMathLib.sqrt(FixedPointMathLib.fullMulDiv(a1, 1 << 192, a0)));
    }

    /// @dev Pre-create the target/WETH pool at `priceBps/10_000` of the reference POOL PRICE — the
    ///      token1/token0 ratio the guard bounds — and stage a convert whose acquire sits exactly on
    ///      the reference rate, so the only thing that can refuse the call is the pool guard.
    ///
    ///      Seeding is done on the price and converted back to sqrt here, rather than by re-deriving
    ///      from a scaled `ethPerToken`, because the token/WETH sort order decides whether the pool
    ///      price runs with or against ETH-per-token. Parameterising on the pool price makes these
    ///      bounds mean the same thing under either ordering.
    function _stagePoolAtPrice(uint256 priceBps) internal {
        vm.deal(address(this), 10 ether);
        vault.receiveContribution{ value: 10 ether }(Currency.wrap(address(0)), 10 ether, alice);
        alignmentToken.mint(address(swapRouter), 100 ether);
        swapRouter.setRate(address(weth), address(alignmentToken), ETH_PER_TOKEN);
        uint256 refSqrt = _refSqrt(ETH_PER_TOKEN);
        uint160 seeded = uint160(FixedPointMathLib.sqrt(refSqrt * refSqrt * priceBps / 10_000));
        address pool = factory.createPool(address(alignmentToken), address(weth), "");
        MockAlgebraPool(pool).initialize(seeded);
    }

    /// @dev 4.90% above the reference pool price is inside the 500 bps band and the convert settles.
    function test_poolGuard_admitsJustInsideTheBandAbove() public {
        _stagePoolAtPrice(10_000 + DEFAULT_BPS - 10); // +4.90%
        vault.convertAndAddLiquidity(0);
        assertTrue(vault.lpPool() != address(0), "convert settled inside the pool band");
    }

    /// @dev 5.10% above is outside it. A sqrt-space comparison admitted this pool: spending 500 bps
    ///      in sqrt space reached +10.25% of pool price, so reverting the guard turns this red.
    function test_poolGuard_refusesJustOutsideTheBandAbove() public {
        _stagePoolAtPrice(10_000 + DEFAULT_BPS + 10); // +5.10%
        vm.expectRevert(CypherAlignmentVault.LpPoolPriceDeviation.selector);
        vault.convertAndAddLiquidity(0);
    }

    /// @dev The band is symmetric about the reference in the space it is declared in, which a
    ///      sqrt-space comparison is not: 4.90% below settles.
    function test_poolGuard_admitsJustInsideTheBandBelow() public {
        _stagePoolAtPrice(10_000 - DEFAULT_BPS + 10); // -4.90%
        vault.convertAndAddLiquidity(0);
        assertTrue(vault.lpPool() != address(0), "convert settled inside the pool band");
    }

    /// @dev And 5.10% below is refused. The old sqrt-space band reached -9.75% of pool price, so this
    ///      too goes red against the unfixed guard.
    function test_poolGuard_refusesJustOutsideTheBandBelow() public {
        _stagePoolAtPrice(10_000 - DEFAULT_BPS - 10); // -5.10%
        vm.expectRevert(CypherAlignmentVault.LpPoolPriceDeviation.selector);
        vault.convertAndAddLiquidity(0);
    }

    /// @dev The point of the fix, half one: a 6% offset is outside the 500 bps knob, and the pool
    ///      guard says so. The old sqrt-space guard admitted this pool.
    function test_poolGuard_refusesASixPercentPool() public {
        _stagePoolAtPrice(10_600); // +6%
        vm.expectRevert(CypherAlignmentVault.LpPoolPriceDeviation.selector);
        vault.convertAndAddLiquidity(0);
    }

    /// @dev Half two, the reason half one matters: the SAME knob, the SAME 6%, on the other consumer
    ///      reading it during the same call. The acquire floor refuses it too. Before the fix these two
    ///      disagreed — a 6% offset was refused for the buy and accepted for the LP placement.
    function test_acquireFloor_refusesTheSameSixPercent() public {
        vm.deal(address(this), 10 ether);
        vault.receiveContribution{ value: 10 ether }(Currency.wrap(address(0)), 10 ether, alice);
        alignmentToken.mint(address(swapRouter), 100 ether);
        swapRouter.setRate(address(weth), address(alignmentToken), ETH_PER_TOKEN * 9_400 / 10_000);
        vm.expectRevert(bytes("Slippage"));
        vault.convertAndAddLiquidity(0);
    }

    /// @dev The pool band tracks the knob live, on the same scale the floor reads it: widening to
    ///      1000 bps admits a pool 9% off, which the 500 bps default refuses.
    function test_poolGuard_bandFollowsTheKnob() public {
        vault.setMaxPriceDeviationBps(1000);
        _stagePoolAtPrice(10_900); // +9%: outside the 5% default, inside 10%
        vault.convertAndAddLiquidity(0);
        assertTrue(vault.lpPool() != address(0), "widened knob admits the pool");
    }

    /// @dev A pool so far off that its sqrt gap exceeds the reference itself takes the early branch.
    ///      It must still surface as `LpPoolPriceDeviation`, not as an arithmetic revert.
    function test_poolGuard_grosslyOffPoolStillRevertsAsDeviation() public {
        _stagePoolAtPrice(1_000_000); // 100x the reference price
        vm.expectRevert(CypherAlignmentVault.LpPoolPriceDeviation.selector);
        vault.convertAndAddLiquidity(0);
    }
}
