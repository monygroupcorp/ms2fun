// test/vaults/CypherOracleFloorBand.t.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { MockERC20 } from "../mocks/MockERC20.sol";
import { MockAlgebraPositionManager, MockAlgebraSwapRouter, MockAlgebraFactory } from "../mocks/MockCypherAlgebra.sol";
import { MockWETH } from "../mocks/MockWETH.sol";
import { MockVaultPriceValidator } from "../mocks/MockVaultPriceValidator.sol";
import { MockAlignmentRegistry } from "../mocks/MockAlignmentRegistry.sol";
import { TestableCypherAlignmentVault } from "../helpers/TestableCypherAlignmentVault.sol";
import { IAlignmentRegistry } from "../../src/master/interfaces/IAlignmentRegistry.sol";
import { Currency } from "v4-core/types/Currency.sol";

/// @dev Boundary coverage for the Cypher acquire-side oracle floor (`_floorTargetOut`).
///
///      `CypherAlignmentVault.t.sol` proves the floor EXISTS — a manipulated acquire spot cannot move
///      the seed price, and a grossly-off LP pool reverts. Nothing in the tree pins WHERE the floor
///      sits: which acquire rates it admits and which it refuses, and that `maxPriceDeviationBps` is
///      spent as a bound on PRICE on this path.
///
///      That matters because the same knob is read by a second consumer on the same call
///      (`_validateExistingPool`, which compares sqrtPrice deltas). Pinning this side means a later
///      change to either consumer cannot silently move this one. These tests assert the acquire
///      floor's own contract and make no claim about the pool guard's band.
contract CypherOracleFloorBandTest is Test {
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
            address(0), // zRouter
            address(0), // zQuoter → Algebra fixed-pool fallback (the mock swap router)
            address(validator),
            registry,
            TARGET_ID
        );
    }

    /// @dev Stage a convert whose acquire returns `rateBps/10_000` of the reference rate.
    function _stage(uint256 rateBps) internal {
        vm.deal(address(this), 10 ether);
        vault.receiveContribution{ value: 10 ether }(Currency.wrap(address(0)), 10 ether, alice);
        alignmentToken.mint(address(swapRouter), 100 ether);
        swapRouter.setRate(address(weth), address(alignmentToken), ETH_PER_TOKEN * rateBps / 10_000);
    }

    /// @dev The knob is 500 bps and it is spent as a bound on PRICE here: an acquire returning 4.99%
    ///      below the reference rate is inside the band and settles.
    function test_floor_admitsAcquireJustInsideTheBand() public {
        _stage(10_000 - DEFAULT_BPS + 1); // -4.99%
        vault.convertAndAddLiquidity(0);
        assertTrue(vault.lpPool() != address(0), "convert settled inside the floor");
        assertEq(vault.totalPendingETH(), 0, "pending fully deployed");
    }

    /// @dev One basis point the other side of the same bound is refused by the router against the
    ///      floored minimum. This is the assertion that makes the band a band.
    function test_floor_refusesAcquireJustOutsideTheBand() public {
        _stage(10_000 - DEFAULT_BPS - 1); // -5.01%
        vm.expectRevert(bytes("Slippage"));
        vault.convertAndAddLiquidity(0);
    }

    /// @dev The floor is a FLOOR, not a default: a caller passing `minOutTarget = 0` — the loosest
    ///      bound expressible — is still held to the reference-derived minimum. Without this the
    ///      permissionless caller could sandwich the vault's own acquire.
    function test_floor_bindsWhenCallerPassesZero() public {
        _stage(9_000); // -10%, well outside any admissible band
        vm.expectRevert(bytes("Slippage"));
        vault.convertAndAddLiquidity(0);
    }

    /// @dev `max(callerMin, floor)`: a caller minimum ABOVE the floor is honoured, not discarded. The
    ///      acquire here is inside the oracle band (-1%) but below what this caller asked for.
    function test_floor_callerMinAboveTheFloorStillBinds() public {
        _stage(9_900); // -1%: passes the floor
        // 5 ETH is swapped (full-range proportion is 50% by value), so a -1% acquire yields 4.95e18.
        vm.expectRevert(bytes("Slippage"));
        vault.convertAndAddLiquidity(4.96e18);
    }

    /// @dev The band tracks the knob on this path. Widening the knob to 1000 bps admits an acquire
    ///      that the 500 bps default refuses — the floor reads `maxPriceDeviationBps` live, and reads
    ///      it as a price bound.
    function test_floor_bandFollowsTheKnob() public {
        vault.setMaxPriceDeviationBps(1000);
        _stage(9_100); // -9%: outside the 5% default, inside 10%
        vault.convertAndAddLiquidity(0);
        assertTrue(vault.lpPool() != address(0), "widened knob admits the acquire");
    }
}
