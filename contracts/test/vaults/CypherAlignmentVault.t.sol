// test/vaults/CypherAlignmentVault.t.sol
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
import { Ownable } from "solady/auth/Ownable.sol";

contract CypherAlignmentVaultTest is Test {
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
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    uint256 constant TARGET_ID = 1;
    uint256 constant ETH_PER_TOKEN = 1e18; // reference TWAP: 1 ETH per 1e18 tokens

    function setUp() public {
        alignmentToken = new MockERC20("Alignment", "ALN");
        weth = new MockWETH();
        positionManager = new MockAlgebraPositionManager();
        swapRouter = new MockAlgebraSwapRouter();
        factory = new MockAlgebraFactory();
        registry = new MockAlignmentRegistry();
        validator = new MockVaultPriceValidator();
        validator.setEthPer1e18Tokens(ETH_PER_TOKEN);

        _wireTarget(TARGET_ID, address(alignmentToken), IAlignmentRegistry.Venue.ALGEBRA, refPool);

        impl = new TestableCypherAlignmentVault();
        vault = _deployVault(TARGET_ID, address(alignmentToken));
    }

    // ── Wiring helpers ──────────────────────────────────────────────────────

    function _wireTarget(uint256 targetId, address token, IAlignmentRegistry.Venue venue, address _refPool) internal {
        registry.setTargetActive(targetId, true);
        registry.setTokenInTarget(targetId, token, true);
        registry.setReferencePool(
            targetId, token, IAlignmentRegistry.ReferencePool({ pool: _refPool, kind: 1, twapWindow: 0 })
        );
        registry.setAcquireRoute(
            targetId, token, IAlignmentRegistry.AcquireRoute({ venue: venue, fee: 0, tickSpacing: 0, feeOrHook: 0 })
        );
    }

    function _deployVault(uint256 targetId, address token) internal returns (TestableCypherAlignmentVault v) {
        v = TestableCypherAlignmentVault(payable(LibClone.clone(address(impl))));
        v.initialize(
            address(positionManager),
            address(swapRouter),
            address(factory),
            address(weth),
            token,
            protocolTreasury,
            address(0), // zRouter
            address(0), // zQuoter → Algebra fixed-pool fallback (the mock swap router)
            address(validator),
            registry,
            targetId
        );
    }

    /// @dev Reference-derived sqrtPriceX96 for the target/WETH pool — mirrors the vault's own derivation.
    function _refSqrt(uint256 ethPerToken) internal view returns (uint160) {
        (uint256 a0, uint256 a1) =
            address(alignmentToken) < address(weth) ? (uint256(1e18), ethPerToken) : (ethPerToken, uint256(1e18));
        return uint160(FixedPointMathLib.sqrt(FixedPointMathLib.fullMulDiv(a1, 1 << 192, a0)));
    }

    function _contribute(address who, uint256 amt) internal {
        vm.deal(address(this), amt);
        vault.receiveContribution{ value: amt }(Currency.wrap(address(0)), amt, who);
    }

    /// @dev Fund the fallback Algebra swap router so the vault's ETH->target acquire yields `rate` (1e18
    ///      = 1 token per ETH) and has target inventory to hand out.
    function _fundAcquire(uint256 inventory, uint256 rate) internal {
        alignmentToken.mint(address(swapRouter), inventory);
        swapRouter.setRate(address(weth), address(alignmentToken), rate);
    }

    /// @dev Stage a collectable-fee harvest on the vault's alignment position (tokenId 1).
    function _stageHarvest(uint256 alignmentFees, uint256 wethFees, bool tokenIsZero) internal {
        vault.setPositionForTest(1, refPool, tokenIsZero);
        if (tokenIsZero) {
            positionManager.setPosition(1, address(alignmentToken), address(weth), address(vault));
            if (alignmentFees > 0) alignmentToken.mint(address(positionManager), alignmentFees);
            if (wethFees > 0) weth.mint(address(positionManager), wethFees);
            positionManager.setFees(1, alignmentFees, wethFees);
        } else {
            positionManager.setPosition(1, address(weth), address(alignmentToken), address(vault));
            if (wethFees > 0) weth.mint(address(positionManager), wethFees);
            if (alignmentFees > 0) alignmentToken.mint(address(positionManager), alignmentFees);
            positionManager.setFees(1, wethFees, alignmentFees);
        }
        if (alignmentFees > 0) {
            // 1:1 honest swap → clears the reference-derived 0.95 floor.
            weth.mint(address(swapRouter), alignmentFees);
            swapRouter.setRate(address(alignmentToken), address(weth), 1e18);
        }
        uint256 totalWETH = (alignmentFees > 0 ? alignmentFees : 0) + wethFees;
        if (totalWETH > 0) vm.deal(address(weth), totalWETH);
    }

    // ── Initialize ──────────────────────────────────────────────────────────

    function test_initialize_setsConfig() public view {
        assertEq(address(vault.positionManager()), address(positionManager));
        assertEq(vault.algebraFactory(), address(factory));
        assertEq(vault.alignmentToken(), address(alignmentToken));
        assertEq(address(vault.alignmentRegistry()), address(registry));
        assertEq(vault.alignmentTargetId(), TARGET_ID);
        assertEq(vault.protocolYieldCutBps(), 100);
        assertEq(vault.maxPriceDeviationBps(), 500);
        assertTrue(vault.isLiquidityReady());
    }

    function test_initialize_revertIfCalledTwice() public {
        vm.expectRevert(CypherAlignmentVault.VaultAlreadyInitialized.selector);
        vault.initialize(
            address(positionManager),
            address(swapRouter),
            address(factory),
            address(weth),
            address(alignmentToken),
            protocolTreasury,
            address(0),
            address(0),
            address(validator),
            registry,
            TARGET_ID
        );
    }

    // ── D3 — registry validation at init ─────────────────────────────────────

    function test_init_revertsWhenTargetInactive() public {
        registry.setTargetActive(2, false);
        registry.setTokenInTarget(2, address(alignmentToken), true);
        TestableCypherAlignmentVault v = TestableCypherAlignmentVault(payable(LibClone.clone(address(impl))));
        vm.expectRevert(CypherAlignmentVault.TargetNotActive.selector);
        v.initialize(
            address(positionManager),
            address(swapRouter),
            address(factory),
            address(weth),
            address(alignmentToken),
            protocolTreasury,
            address(0),
            address(0),
            address(validator),
            registry,
            2
        );
    }

    function test_init_revertsWhenTokenNotInTarget() public {
        registry.setTargetActive(3, true);
        // token intentionally NOT registered in target 3
        TestableCypherAlignmentVault v = TestableCypherAlignmentVault(payable(LibClone.clone(address(impl))));
        vm.expectRevert(CypherAlignmentVault.TokenNotInTarget.selector);
        v.initialize(
            address(positionManager),
            address(swapRouter),
            address(factory),
            address(weth),
            address(alignmentToken),
            protocolTreasury,
            address(0),
            address(0),
            address(validator),
            registry,
            3
        );
    }

    // ── receiveContribution — tracks weight AND spendable pending ETH ─────────

    function test_receiveContribution_tracksWeightAndPending() public {
        _contribute(alice, 2 ether);
        assertEq(vault.benefactorContribution(alice), 2 ether);
        assertEq(vault.totalContributions(), 2 ether);
        assertEq(vault.totalPendingETH(), 2 ether);
    }

    function test_receiveContribution_zeroValueIsNoOp() public {
        vault.receiveContribution(Currency.wrap(address(0)), 0, alice);
        assertEq(vault.totalContributions(), 0);
        assertEq(vault.totalPendingETH(), 0);
    }

    function test_receiveContribution_revertsOnNonEthCurrency() public {
        vm.deal(address(this), 1 ether);
        vm.expectRevert(CypherAlignmentVault.ETHOnly.selector);
        vault.receiveContribution{ value: 1 ether }(Currency.wrap(address(alignmentToken)), 1 ether, alice);
    }

    // ── convertAndAddLiquidity — seed a fresh pool at the reference price ─────

    function test_convert_seedsFreshPoolAtReferencePrice() public {
        _contribute(alice, 10 ether);
        _fundAcquire(100 ether, 1e18);

        uint256 lpValue = vault.convertAndAddLiquidity(0);

        address pool = vault.lpPool();
        assertTrue(pool != address(0), "pool created");
        assertEq(MockAlgebraPool(pool).sqrtPriceX96(), _refSqrt(ETH_PER_TOKEN), "seeded at reference price");
        assertEq(vault.lpTokenId(), 1, "one position minted");
        assertEq(positionManager.ownerOf(1), address(vault), "vault custodies the position (plain _mint)");
        assertGt(lpValue, 0);
        // proportion 50% of 10 ETH swapped, remainder LP'd; nothing left unspendable.
        assertEq(vault.totalPendingETH(), 0, "pending fully deployed");
    }

    /// @dev A manipulated acquire "spot" (swap rate) does NOT move the seed price: it stays the
    ///      canonical reference. This is the self-sandwich regression for Cypher.
    function test_convert_seedPriceIsReferenceNotSpot() public {
        _contribute(alice, 10 ether);
        _fundAcquire(100 ether, 3e18); // acquire spot 3x — must NOT influence the seed

        vault.convertAndAddLiquidity(0);

        address pool = vault.lpPool();
        assertEq(MockAlgebraPool(pool).sqrtPriceX96(), _refSqrt(ETH_PER_TOKEN), "seed follows reference, not spot");
    }

    // ── Thin-pool guard ──────────────────────────────────────────────────────

    function test_convert_revertsWhenExistingPoolDeviates() public {
        _contribute(alice, 10 ether);
        _fundAcquire(100 ether, 1e18);

        // Pre-create + skew the pool >5% off the reference.
        address pool = factory.createPool(address(alignmentToken), address(weth), "");
        MockAlgebraPool(pool).initialize(uint160(uint256(_refSqrt(ETH_PER_TOKEN)) * 2));

        vm.expectRevert(CypherAlignmentVault.LpPoolPriceDeviation.selector);
        vault.convertAndAddLiquidity(0);
    }

    function test_convert_fairThinPoolPasses() public {
        _contribute(alice, 10 ether);
        _fundAcquire(100 ether, 1e18);

        // Fair thin pool: +1% off the reference (sqrt-space), within the 5% band.
        address pool = factory.createPool(address(alignmentToken), address(weth), "");
        MockAlgebraPool(pool).initialize(uint160(uint256(_refSqrt(ETH_PER_TOKEN)) * 10_100 / 10_000));

        vault.convertAndAddLiquidity(0);
        assertEq(vault.lpTokenId(), 1);
        assertEq(vault.lpPool(), pool);
    }

    // ── Griefing DoS recovery — owner override out of a permissionless off-price pool ─────
    // Algebra createPool+initialize are permissionless, so a griefer can pre-seed the vault's
    // target/WETH pool at a garbage price (+ a dust off-price position that does not self-correct).
    // The automatic resolver then reverts LpPoolPriceDeviation forever and never stores lpPool, so
    // convert is permanently bricked and the accrued tithe is stranded. setLpPool is the owner escape.

    function test_grief_offPricePoolBricks_thenOwnerOverrideRecovers() public {
        _contribute(alice, 10 ether);
        _fundAcquire(1000 ether, 1e18);

        // Griefer: createPool + initialize at 2x the reference (>5% off) + a dust position so the
        // pool cannot be freely repriced back within tolerance.
        address pool = factory.createPool(address(alignmentToken), address(weth), "");
        MockAlgebraPool(pool).initialize(uint160(uint256(_refSqrt(ETH_PER_TOKEN)) * 2));
        MockAlgebraPool(pool).setLiquidity(1);

        // The brick: convert reverts and no pool is stored — repeats forever, tithe stranded.
        vm.expectRevert(CypherAlignmentVault.LpPoolPriceDeviation.selector);
        vault.convertAndAddLiquidity(0);
        assertEq(vault.lpPool(), address(0), "no pool stored while bricked");
        assertGt(vault.totalPendingETH(), 0, "tithe still pending (stranded) while bricked");

        // Owner escape hatch: pin the (vetted/repriced) canonical pool.
        vault.setLpPool(pool);
        assertTrue(vault.lpPoolOwnerSet(), "owner override flagged");
        assertEq(vault.lpPool(), pool, "override stores the pool");

        // Convert now proceeds despite the >5% spot — the deviation guard is bypassed for the
        // owner-accepted pool, so the tithe converts into the alignment position.
        uint256 lpValue = vault.convertAndAddLiquidity(0);
        assertGt(lpValue, 0, "convert recovers after the override");
        assertEq(vault.lpTokenId(), 1, "alignment position minted");
        assertEq(vault.lpPool(), pool, "LP'd into the owner-accepted pool");
    }

    function test_setLpPool_onlyOwner() public {
        address pool = factory.createPool(address(alignmentToken), address(weth), "");
        MockAlgebraPool(pool).initialize(_refSqrt(ETH_PER_TOKEN));
        vm.prank(alice);
        vm.expectRevert(Ownable.Unauthorized.selector);
        vault.setLpPool(pool);
    }

    function test_setLpPool_revertsOnNonCanonicalPool() public {
        // Not the poolByPair(token, weth) for this vault → rejected before any state read.
        vm.expectRevert(CypherAlignmentVault.InvalidLpPool.selector);
        vault.setLpPool(makeAddr("randomPool"));
    }

    function test_setLpPool_revertsOnUninitializedPool() public {
        address pool = factory.createPool(address(alignmentToken), address(weth), "");
        // Created but never initialized (globalState price 0) — the owner must accept a live pool.
        vm.expectRevert(CypherAlignmentVault.InvalidLpPool.selector);
        vault.setLpPool(pool);
    }

    function test_setLpPool_revertsAfterPositionOpen() public {
        _contribute(alice, 10 ether);
        _fundAcquire(1000 ether, 1e18);
        vault.convertAndAddLiquidity(0); // fresh-creates + mints the position
        address pool = vault.lpPool();
        vm.expectRevert(CypherAlignmentVault.InvalidLpPool.selector);
        vault.setLpPool(pool); // repointing after a mint would orphan the NFT
    }

    // ── D1 — no tithe ETH left unspendable; residual re-credited to pending ───

    function test_convert_residualEthReturnsToPending() public {
        _contribute(alice, 10 ether);
        _fundAcquire(100 ether, 1e18);
        positionManager.setAbsorbBps(8000); // LP under-absorbs 20% of each side

        vault.convertAndAddLiquidity(0);

        // 50% (5 ETH) swapped; 5 ETH → WETH for LP, of which 80% (4) absorbed → 1 ETH re-credited.
        assertEq(vault.totalPendingETH(), 1 ether, "unabsorbed ETH re-credited to pending");
        assertEq(address(vault).balance, 1 ether, "residual ETH held for the next convert, not stuck");
    }

    function test_convert_revertsWithNoPendingETH() public {
        vm.expectRevert(CypherAlignmentVault.NoPendingETH.selector);
        vault.convertAndAddLiquidity(0);
    }

    function test_convert_revertsWhenReferenceUnset() public {
        _contribute(alice, 10 ether);
        _fundAcquire(100 ether, 1e18);
        registry.setReferencePool(
            TARGET_ID,
            address(alignmentToken),
            IAlignmentRegistry.ReferencePool({ pool: address(0), kind: 0, twapWindow: 0 })
        );
        vm.expectRevert(CypherAlignmentVault.NoReferencePool.selector);
        vault.convertAndAddLiquidity(0);
    }

    function test_convert_revertsWhenAcquireVenueNotAlgebra() public {
        _contribute(alice, 10 ether);
        _fundAcquire(100 ether, 1e18);
        registry.setAcquireRoute(
            TARGET_ID,
            address(alignmentToken),
            IAlignmentRegistry.AcquireRoute({
                venue: IAlignmentRegistry.Venue.UNI_V4, fee: 0, tickSpacing: 0, feeOrHook: 0
            })
        );
        vm.expectRevert(CypherAlignmentVault.WrongAcquireVenue.selector);
        vault.convertAndAddLiquidity(0);
    }

    // ── B2 — repeat convert aggregates into ONE NFT via increaseLiquidity ─────

    function test_convert_repeatAggregatesIntoOnePosition() public {
        _contribute(alice, 10 ether);
        _fundAcquire(1000 ether, 1e18);
        vault.convertAndAddLiquidity(0);

        uint256 id = vault.lpTokenId();
        (,,,,,,, uint128 liq1,,,,) = positionManager.positions(id);

        _contribute(bob, 10 ether);
        vault.convertAndAddLiquidity(0);

        assertEq(vault.lpTokenId(), id, "same tokenId");
        assertEq(positionManager.nextTokenId(), 2, "exactly ONE mint ever (no second NFT)");
        (,,,,,,, uint128 liq2,,,,) = positionManager.positions(id);
        assertGt(liq2, liq1, "liquidity strictly increased");
        assertEq(positionManager.ownerOf(id), address(vault));
    }

    function test_convert_repeatThenHarvestCollectsFromAlignmentPosition() public {
        _contribute(alice, 10 ether);
        _fundAcquire(1000 ether, 1e18);
        vault.convertAndAddLiquidity(0);
        _contribute(bob, 10 ether);
        vault.convertAndAddLiquidity(0);

        // Fees accrue on the vault's OWN alignment position (tokenId 1), collected by harvest.
        uint256 id = vault.lpTokenId();
        weth.mint(address(positionManager), 1 ether);
        // token1 is the WETH side (alignment sorts vs weth); stage a WETH-side fee.
        bool tokenIsZero = vault.tokenIsZero();
        positionManager.setFees(id, tokenIsZero ? 0 : 1 ether, tokenIsZero ? 1 ether : 0);
        vm.deal(address(weth), 1 ether);

        uint256 feesETH = vault.harvest(0);
        assertEq(feesETH, 1 ether);
        assertGt(vault.accRewardPerContribution(), 0);
    }

    // ── harvest — distribution + protocol cut ────────────────────────────────

    function test_harvest_revertsWithNoPosition() public {
        _contribute(alice, 1 ether);
        vm.expectRevert(CypherAlignmentVault.NoPosition.selector);
        vault.harvest(0);
    }

    function test_harvest_distributesFeesToBenefactors() public {
        _contribute(alice, 1 ether);
        _stageHarvest(0.1e18, 0.05e18, true);

        vault.harvest(0);
        assertGt(vault.accRewardPerContribution(), 0);

        uint256 before = alice.balance;
        vm.prank(alice);
        vault.claimFees();
        assertGt(alice.balance, before);
    }

    function test_harvest_takesProtocolCut() public {
        _contribute(alice, 1 ether);
        _stageHarvest(0, 1 ether, true);

        vault.harvest(0);
        assertEq(vault.accumulatedProtocolFees(), 0.01 ether);
        assertEq(vault.calculateClaimableAmount(alice), 0.99 ether);
    }

    // ── harvest oracle-floor (reference-priced, not self-priced) ─────────────

    function test_harvest_floorBlocksSandwich() public {
        _contribute(alice, 1 ether);
        _stageHarvest(1e18, 0, true);
        // Degrade the swap to 0.5 WETH/token — below the reference 0.95 floor.
        swapRouter.setRate(address(alignmentToken), address(weth), 0.5e18);
        vm.expectRevert(bytes("Slippage"));
        vault.harvest(0);
    }

    function test_harvest_floorFromReferenceNotPool() public {
        _contribute(alice, 1 ether);
        _stageHarvest(1e18, 0, true);
        // Honest 1:1 swap clears the reference-derived floor.
        uint256 feesETH = vault.harvest(0);
        assertGt(feesETH, 0);
    }

    // ── claimFees ────────────────────────────────────────────────────────────

    function test_claimFees_proportionalWithMultipleBenefactors() public {
        _contribute(alice, 10 ether);
        _contribute(bob, 20 ether);
        _stageHarvest(0, 1 ether, true);
        vault.harvest(0);

        uint256 benefactorFees = 1 ether * 9900 / 10000;
        vm.prank(alice);
        uint256 aliceClaimed = vault.claimFees();
        vm.prank(bob);
        uint256 bobClaimed = vault.claimFees();
        assertApproxEqRel(aliceClaimed, benefactorFees / 3, 0.01e18);
        assertApproxEqRel(bobClaimed, benefactorFees * 2 / 3, 0.01e18);
    }

    function test_claimFeesAsDelegate_delegateReceivesFees() public {
        _contribute(alice, 1 ether);
        vm.prank(alice);
        vault.delegateBenefactor(carol);
        _stageHarvest(0, 0.1 ether, true);
        vault.harvest(0);

        uint256 carolBefore = carol.balance;
        address[] memory benefactors = new address[](1);
        benefactors[0] = alice;
        vm.prank(carol);
        vault.claimFeesAsDelegate(benefactors);
        assertGt(carol.balance, carolBefore);
    }

    function test_claimFeesAsDelegate_revertsForNonDelegate() public {
        _contribute(alice, 1 ether);
        _stageHarvest(0, 0.1 ether, true);
        vault.harvest(0);

        address[] memory benefactors = new address[](1);
        benefactors[0] = alice;
        vm.prank(bob);
        vm.expectRevert(CypherAlignmentVault.NotDelegate.selector);
        vault.claimFeesAsDelegate(benefactors);
    }

    // ── Governance / views ───────────────────────────────────────────────────

    function test_withdrawProtocolFees_transfersToTreasury() public {
        _contribute(alice, 1 ether);
        _stageHarvest(0, 1 ether, true);
        vault.harvest(0);

        uint256 before = protocolTreasury.balance;
        vm.prank(protocolTreasury);
        vault.withdrawProtocolFees();
        assertEq(protocolTreasury.balance - before, 0.01 ether);
        assertEq(vault.accumulatedProtocolFees(), 0);
    }

    function test_withdrawProtocolFees_revertsIfNotTreasury() public {
        vm.prank(alice);
        vm.expectRevert(Ownable.Unauthorized.selector);
        vault.withdrawProtocolFees();
    }

    function test_setProtocolYieldCutBps_revertsAboveMax() public {
        vm.expectRevert(CypherAlignmentVault.ExceedsMaxBps.selector);
        vault.setProtocolYieldCutBps(1001);
    }

    function test_setMaxPriceDeviationBps_updates() public {
        vault.setMaxPriceDeviationBps(750);
        assertEq(vault.maxPriceDeviationBps(), 750);
    }

    function test_setMaxPriceDeviationBps_revertsAboveMax() public {
        vm.expectRevert(CypherAlignmentVault.ExceedsMaxBps.selector);
        vault.setMaxPriceDeviationBps(2001);
    }

    function test_vaultType_returnsCypherLP() public view {
        assertEq(vault.vaultType(), "CypherLP");
    }

    function test_supportsCapability() public view {
        assertTrue(vault.supportsCapability(keccak256("YIELD_GENERATION")));
        assertTrue(vault.supportsCapability(keccak256("BENEFACTOR_DELEGATION")));
        assertFalse(vault.supportsCapability(keccak256("UNKNOWN")));
    }

    function test_delegateBenefactor_setsDelegate() public {
        vm.prank(alice);
        vault.delegateBenefactor(carol);
        assertEq(vault.getBenefactorDelegate(alice), carol);
    }

    function test_totalShares_equalsTotalContributions() public {
        _contribute(alice, 3 ether);
        assertEq(vault.totalShares(), 3 ether);
    }

    /// @dev NFT custody: the vault holds its alignment position via the Algebra NFPM's plain `_mint`
    ///      (no `onERC721Received` callback). The vault deliberately does NOT implement IERC721Receiver;
    ///      a successful mint-to-vault above proves plain-ownership custody is safe.
    function test_nftCustody_vaultHoldsPositionWithoutReceiver() public {
        _contribute(alice, 10 ether);
        _fundAcquire(100 ether, 1e18);
        vault.convertAndAddLiquidity(0);
        assertEq(positionManager.ownerOf(vault.lpTokenId()), address(vault));
    }
}
