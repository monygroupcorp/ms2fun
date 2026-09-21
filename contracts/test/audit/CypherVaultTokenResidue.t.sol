// test/audit/CypherVaultTokenResidue.t.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { FixedPointMathLib } from "solady/utils/FixedPointMathLib.sol";
import { MockERC20 } from "../mocks/MockERC20.sol";
import { MockAlgebraPositionManager, MockAlgebraSwapRouter, MockAlgebraFactory } from "../mocks/MockCypherAlgebra.sol";
import { MockWETH } from "../mocks/MockWETH.sol";
import { MockVaultPriceValidator } from "../mocks/MockVaultPriceValidator.sol";
import { MockAlignmentRegistry } from "../mocks/MockAlignmentRegistry.sol";
import { TestableCypherAlignmentVault } from "../helpers/TestableCypherAlignmentVault.sol";
import { IAlignmentRegistry } from "../../src/master/interfaces/IAlignmentRegistry.sol";
import { Currency } from "v4-core/types/Currency.sol";

/// @title  L-12 — the Cypher vault never re-credits the token-side residual
/// @notice L-10 is the same defect, reported against the Uni and ZAMM vaults and fixed in both by
///         PR #436: each of their token->ETH legs now reads the vault's own alignment-token balance
///         instead of only the amount the fee collect returned, so the residue an LP add declines
///         is sold and split with everything else. `CypherAlignmentVault` is the third vault of that
///         family and was not reached by that fix.
///
///         The mechanism is identical. `convertAndAddLiquidity` buys `targetReceived` and offers the
///         whole of it to the position manager; the position takes only what its ratio needs. The ETH
///         half of that same rounding IS handled — `_addToPosition` unwraps `ethForLP - wethUsed` back
///         to native ETH and `convertAndAddLiquidity` carries it in `totalPendingETH`
///         (`CypherAlignmentVault.sol:349-351, :294`). The token half is dropped, and the contract
///         says so in its own words at `:304`: "Leftover target dust remains as tokens in the vault."
///
///         `_harvestAccruedFees` is the only leg that ever sells alignment token, and it sizes the
///         swap from the collect's return alone (`:484`, `:499`), never from the balance. So the
///         residue has no reader: it accretes on every convert and no entry point can move it.
///
///         These tests assert the FIXED behaviour — the sweep that L-10 gave the other two vaults.
///         Neutering the one-line change (restoring `alignmentFees = tokenIsZero ? amount0 : amount1`)
///         turns A, B and E red, on the numbers the finding quotes: the residue reads 1e18 after one
///         convert and 2.1e18 after two, and the harvest realises 0 of it. C and D pass on both sides
///         on purpose — C is the guard that the sweep adds no way to take the token out, D is the
///         control that shows the measurement is of the mechanism and not of the fixture.
contract CypherVaultTokenResidueTest is Test {
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
    address communitySink = makeAddr("communitySink");
    address refPool = makeAddr("refPool");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address stranger = makeAddr("stranger");

    uint256 constant TARGET_ID = 1;
    uint256 constant ETH_PER_TOKEN = 1e18; // reference TWAP: 1 ETH per 1e18 tokens
    uint256 constant ABSORB_BPS = 8000; // the LP add declines 20% of each side

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
        registry.setCommunityPayout(TARGET_ID, communitySink);
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
            makeAddr("zRouter"),
            address(0), // zQuoter unset -> the Algebra fixed-pool fallback, i.e. the mock swap router
            address(validator),
            registry,
            TARGET_ID
        );

        // Acquire inventory, 1:1, and WETH inventory for the residue's own sale back to ETH.
        alignmentToken.mint(address(swapRouter), 1_000 ether);
        swapRouter.setRate(address(weth), address(alignmentToken), 1e18);
        swapRouter.setRate(address(alignmentToken), address(weth), 1e18);
        weth.mint(address(swapRouter), 1_000 ether);
        vm.deal(address(weth), 1_000 ether);
    }

    function _contribute(address who, uint256 amt) internal {
        vm.deal(address(this), amt);
        vault.receiveContribution{ value: amt }(Currency.wrap(address(0)), amt, who);
    }

    function _residue() internal view returns (uint256) {
        return alignmentToken.balanceOf(address(vault));
    }

    // ── A — one convert strands token, and the sweep is what gets it back ────

    function test_A_convertResidueIsSweptByHarvest() public {
        positionManager.setAbsorbBps(ABSORB_BPS);
        _contribute(alice, 10 ether);

        vault.convertAndAddLiquidity(0);

        // 10 ETH pending; the proportion sends half to the acquire at 1:1, so 5e18 target is bought
        // and offered whole. The position takes 80% and declines 1e18.
        uint256 stranded = _residue();
        emit log_named_uint("alignment token left in the vault by one convert", stranded);
        assertEq(stranded, 1 ether, "the LP add declined 20% of a 5e18 buy");

        // The ETH half of the same rounding is already handled, which is the asymmetry:
        assertEq(vault.totalPendingETH(), 1 ether, "unabsorbed ETH is re-credited; token is not");

        // Nothing has been collected, so a harvest sized from the collect alone is a no-op.
        uint256 feesETH = vault.harvest(0);
        emit log_named_uint("ETH the harvest realised from the residue", feesETH);

        assertEq(_residue(), 0, "the residue has a reader: the harvest sells it");
        assertEq(feesETH, 1 ether, "and it lands as fee ETH on the 80/19/1 rail");
    }

    // ── B — with no reader it accretes; with one it is bounded ───────────────

    function test_B_residueDoesNotAccreteAcrossConverts() public {
        positionManager.setAbsorbBps(ABSORB_BPS);

        _contribute(alice, 10 ether);
        vault.convertAndAddLiquidity(0);
        uint256 afterFirst = _residue();

        // The second contribution crystallizes fees first (`receiveContribution:230-232`), which is
        // the same leg the sweep lives on — so round one's residue is cleared before round two adds
        // its own.
        _contribute(bob, 10 ether);
        vault.convertAndAddLiquidity(0);
        uint256 afterSecond = _residue();

        emit log_named_uint("residue after convert 1", afterFirst);
        emit log_named_uint("residue after convert 2", afterSecond);

        // Round two's pending is bob's 10 ETH plus the 1 ETH round one carried, so it buys 5.5e18 and
        // the position declines 1.1e18 of it. What the sweep changes is whether round one's 1e18 is
        // still sitting there underneath: unswept the vault holds 2.1e18, swept it holds only 1.1e18.
        assertEq(afterFirst, 1 ether, "round one strands 1e18");
        assertEq(afterSecond, 1.1 ether, "round two strands its own 1.1e18 and no more");
        assertLt(afterSecond, afterFirst + 1.1 ether, "round one's residue did not survive into round two");
    }

    // ── C — the sweep is not a removal path (passes on both sides, on purpose) ──

    function test_C_noEntryPointHandsAlignmentTokenToAnybody() public {
        positionManager.setAbsorbBps(ABSORB_BPS);
        _contribute(alice, 10 ether);
        vault.convertAndAddLiquidity(0);

        uint256 supplyBefore = alignmentToken.totalSupply();

        // Every value-moving entry point, each driven by a caller it lets through. The sweep sells the
        // residue into the vault's own 80/19/1 split, and that split pays ETH — so no entry point may
        // hand alignment token to an address. This is the guard that the fix adds no removal path, and
        // it passes with or without the fix, on purpose.
        vm.prank(stranger);
        vault.harvest(0); // permissionless
        vm.prank(alice);
        vault.claimFees();
        vault.withdrawProtocolFees();
        vault.withdrawTargetFees();

        assertEq(alignmentToken.balanceOf(alice), 0, "no alignment token to a benefactor");
        assertEq(alignmentToken.balanceOf(protocolTreasury), 0, "none to the protocol treasury");
        assertEq(alignmentToken.balanceOf(communitySink), 0, "none to the community sink");
        assertEq(alignmentToken.balanceOf(stranger), 0, "none to the caller who poked the harvest");
        assertEq(alignmentToken.totalSupply(), supplyBefore, "and none minted or burned");
    }

    // ── D — control: the measurement is of the mechanism, not of the fixture ──

    function test_D_control_fullAbsorptionStrandsNothing() public {
        // absorbBps stays at its 10_000 default: the position takes everything it is offered.
        _contribute(alice, 10 ether);
        vault.convertAndAddLiquidity(0);

        assertEq(_residue(), 0, "nothing declined, nothing stranded");
        assertEq(vault.totalPendingETH(), 0, "and no ETH carried either");
    }

    // ── E — the swept residue rides the same 80/19/1 rail as any other yield ──

    function test_E_sweptResidueSplitsEightyNineteenOne() public {
        positionManager.setAbsorbBps(ABSORB_BPS);
        _contribute(alice, 10 ether);
        vault.convertAndAddLiquidity(0);

        uint256 protocolBefore = vault.accumulatedProtocolFees();
        uint256 targetBefore = vault.accumulatedTargetFees();

        uint256 feesETH = vault.harvest(0);
        assertEq(feesETH, 1 ether, "the whole residue is realised");

        uint256 protocolCut = vault.accumulatedProtocolFees() - protocolBefore;
        uint256 targetCut = vault.accumulatedTargetFees() - targetBefore;
        uint256 benefactorCut = feesETH - protocolCut - targetCut;

        emit log_named_uint("protocol leg (1%)", protocolCut);
        emit log_named_uint("target leg (19%)", targetCut);
        emit log_named_uint("benefactor leg (80%)", benefactorCut);

        assertEq(protocolCut, feesETH * 100 / 10_000, "1% protocol");
        assertEq(targetCut, feesETH * 1900 / 10_000, "19% target");
        assertEq(benefactorCut, feesETH * 8000 / 10_000, "80% benefactors");

        // Alice funded the whole vault, so the benefactor leg is claimable by her and by nobody else.
        assertEq(vault.calculateClaimableAmount(alice), benefactorCut, "the 80% is alice's to claim");
    }
}
