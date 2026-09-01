// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { ZAMMAlignmentVault, IZAMM } from "../../src/vaults/zamm/ZAMMAlignmentVault.sol";
import { CypherAlignmentVault } from "../../src/vaults/cypher/CypherAlignmentVault.sol";
import { TestableUniAlignmentVault } from "../helpers/TestableUniAlignmentVault.sol";
import { TestableCypherAlignmentVault } from "../helpers/TestableCypherAlignmentVault.sol";
import { MockZAMM } from "../mocks/MockZAMM.sol";
import { MockZRouter } from "../mocks/MockZRouter.sol";
import { MockWETH } from "../mocks/MockWETH.sol";
import { MockEXECToken } from "../mocks/MockEXECToken.sol";
import { MockERC20 } from "../mocks/MockERC20.sol";
import { MockVaultPriceValidator } from "../mocks/MockVaultPriceValidator.sol";
import { MockAlignmentRegistry } from "../mocks/MockAlignmentRegistry.sol";
import { MockAlgebraPositionManager, MockAlgebraSwapRouter, MockAlgebraFactory } from "../mocks/MockCypherAlgebra.sol";
import { IVaultPriceValidator } from "../../src/interfaces/IVaultPriceValidator.sol";
import { IAlignmentRegistry } from "../../src/master/interfaces/IAlignmentRegistry.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { IHooks } from "v4-core/interfaces/IHooks.sol";

/// @title HarvestFirstOrdering
/// @notice Cross-vault regression for the crystallize-first ordering (noesis-393): every path that
///         grows a vault's fee-accumulator weight must first crystallize the LP fees accrued up to that
///         point, so a benefactor arriving later cannot claim a share of fees earned before they joined.
///         The invariant asserted throughout: an incumbent's claimable fees are UNCHANGED by a later
///         benefactor's join, and the joiner's claim on pre-join fees is ZERO.
///
///         Each test passes against the crystallize-first ordering and fails against the prior ordering
///         (weight grown before the accrued fees are folded into the accumulator), where the joiner
///         captures a stake-proportional slice of the incumbent's pre-join fees.

// ─────────────────────────────────────────────────────────────────────────────
// ZAMM — full property demonstration (control vs. treatment)
// ─────────────────────────────────────────────────────────────────────────────

contract HarvestFirstZammTest is Test {
    MockEXECToken internal alignmentToken;
    MockWETH internal weth;
    MockAlignmentRegistry internal registry;
    MockVaultPriceValidator internal validator;
    ZAMMAlignmentVault internal impl;

    uint256 internal constant TARGET_ID = 1;
    address internal constant REF_POOL = address(0xBEEF);
    address internal constant TREASURY = address(0x99);

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    IZAMM.PoolKey internal poolKey;

    function setUp() public {
        alignmentToken = new MockEXECToken(100_000_000e18);
        weth = new MockWETH();
        registry = new MockAlignmentRegistry();
        registry.setReferencePool(
            TARGET_ID,
            address(alignmentToken),
            IAlignmentRegistry.ReferencePool({ pool: REF_POOL, kind: 0, twapWindow: 1800 })
        );
        validator = new MockVaultPriceValidator();
        validator.setEthPer1e18Tokens(1e18); // 1 ETH per 1e18 tokens → honest 1:1 mock swaps clear the floor
        impl = new ZAMMAlignmentVault();

        poolKey = IZAMM.PoolKey({ id0: 0, id1: 0, token0: address(0), token1: address(alignmentToken), feeOrHook: 30 });

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    /// @dev Fresh vault with its OWN ZAMM + router mocks so the two scenarios never share pool state.
    function _freshVault() internal returns (ZAMMAlignmentVault v, MockZAMM zamm, MockZRouter router) {
        zamm = new MockZAMM();
        router = new MockZRouter();
        vm.deal(address(zamm), 100 ether);
        vm.deal(address(router), 100 ether);
        alignmentToken.transfer(address(zamm), 1_000_000e18);
        alignmentToken.transfer(address(router), 1_000_000e18);

        v = ZAMMAlignmentVault(payable(LibClone.clone(address(impl))));
        v.initialize(
            address(zamm),
            address(router),
            address(weth),
            address(alignmentToken),
            poolKey,
            TREASURY,
            address(validator),
            IAlignmentRegistry(address(registry)),
            TARGET_ID
        );
    }

    function _contribute(ZAMMAlignmentVault v, address who, uint256 amount) internal {
        vm.prank(who);
        v.receiveContribution{ value: amount }(Currency.wrap(address(0)), amount, who);
    }

    /// @dev Sole-LP seed (mirrors the vault's own IL-vs-fees harness): empty pool + 1:1 router, so
    ///      after `who`'s convert the vault holds the entire LP supply at a known invariant baseline.
    function _seedSoleLp(ZAMMAlignmentVault v, MockZAMM zamm, MockZRouter router, address who) internal {
        uint256 pid = v.poolId();
        zamm.setPool(pid, 0, 0, 0);
        router.setOutRatio(1e18);
        _contribute(v, who, 4 ether);
        v.convertAndAddLiquidity(0, 0, 0);
    }

    /// @dev Grow both reserves +10% at fixed supply → sqrt(k)/share rises: genuine, as-yet-unharvested
    ///      LP fees sitting in the position (the same signal the vault's fee detector recognizes).
    function _accruePreJoinFees(ZAMMAlignmentVault v, MockZAMM zamm) internal {
        uint256 pid = v.poolId();
        zamm.setPool(pid, 2.2 ether, 2.2 ether, 1000 ether);
    }

    /// @notice Incumbent's claimable is identical whether or not a later benefactor joins, and the
    ///         joiner captures none of the pre-join fees.
    function test_zamm_joinDoesNotDiluteIncumbentPreJoinFees() public {
        // Control: alice is the only benefactor; her pre-join fees are harvested to her alone.
        (ZAMMAlignmentVault vc, MockZAMM zc, MockZRouter rc) = _freshVault();
        _seedSoleLp(vc, zc, rc, alice);
        _accruePreJoinFees(vc, zc);
        vc.harvest(0);
        uint256 aliceControl = vc.calculateClaimableAmount(alice);
        assertGt(aliceControl, 0, "sanity: pre-join fees must actually accrue to the incumbent");

        // Treatment: identical accrual, then bob joins with an equal stake and converts. The convert
        // must crystallize alice's pre-join fees BEFORE bob's weight is added.
        (ZAMMAlignmentVault vt, MockZAMM zt, MockZRouter rt) = _freshVault();
        _seedSoleLp(vt, zt, rt, alice);
        _accruePreJoinFees(vt, zt);
        _contribute(vt, bob, 4 ether);
        vt.convertAndAddLiquidity(0, 0, 0);

        uint256 aliceTreatment = vt.calculateClaimableAmount(alice);
        uint256 bobTreatment = vt.calculateClaimableAmount(bob);

        // Prior ordering: bob's weight is added before the pre-join fees are crystallized, so a later
        // harvest splits them across alice+bob and aliceTreatment collapses to a stake-proportional
        // fraction of aliceControl (≈50% at equal stakes) — this assertion catches that regression.
        assertEq(aliceTreatment, aliceControl, "a later join must not change the incumbent's claimable");
        assertEq(bobTreatment, 0, "joiner must capture none of the pre-join fees");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Uni — pre-weight-change crystallization on convertAndAddLiquidity
// ─────────────────────────────────────────────────────────────────────────────

/// @dev Test-only vault exposing an LP-fee injection seam. Live fee collection needs a real V4
///      PoolManager, so the unit harness stands in for it by overriding the (production-`virtual`)
///      collection primitive to return a staged, as-yet-uncollected fee amount.
contract HarvestFirstUniVault is TestableUniAlignmentVault {
    uint256 public stagedLpFeeEth;

    function stageUncollectedLpFees(uint256 ethAmount) external payable {
        require(msg.value == ethAmount, "must fund the staged fees");
        stagedLpFeeEth += ethAmount;
    }

    function _claimVaultFees() internal override returns (uint256 ethCollected, uint256 tokenCollected) {
        ethCollected = stagedLpFeeEth;
        stagedLpFeeEth = 0;
        tokenCollected = 0;
    }
}

contract HarvestFirstUniTest is Test {
    HarvestFirstUniVault internal vault;
    MockEXECToken internal alignmentToken;
    MockZRouter internal mockZRouter;
    MockVaultPriceValidator internal mockValidator;
    MockAlignmentRegistry internal registry;

    address internal constant WETH = address(0x1111111111111111111111111111111111111111);
    address internal constant POOL_MANAGER = address(0x2222222222222222222222222222222222222222);
    uint256 internal constant TARGET_ID = 1;
    address internal constant TREASURY = address(0xFEE);

    address internal owner = address(0x1);
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    function setUp() public {
        vm.startPrank(owner);
        alignmentToken = new MockEXECToken(1_000_000e18);
        mockZRouter = new MockZRouter();
        mockValidator = new MockVaultPriceValidator();
        registry = new MockAlignmentRegistry();
        registry.setTargetActive(TARGET_ID, true);
        registry.setTokenInTarget(TARGET_ID, address(alignmentToken), true);
        registry.setReferencePool(
            TARGET_ID,
            address(alignmentToken),
            IAlignmentRegistry.ReferencePool({ pool: address(0xBEEF), kind: 0, twapWindow: 1800 })
        );
        mockValidator.setEthPer1e18Tokens(1e18);

        vm.deal(address(mockZRouter), 100 ether);
        alignmentToken.transfer(address(mockZRouter), 100_000e18);

        HarvestFirstUniVault vaultImpl = new HarvestFirstUniVault();
        vault = HarvestFirstUniVault(payable(LibClone.clone(address(vaultImpl))));
        vault.initialize(
            owner,
            WETH,
            POOL_MANAGER,
            address(alignmentToken),
            address(mockZRouter),
            3000,
            60,
            IVaultPriceValidator(address(mockValidator)),
            IAlignmentRegistry(address(registry)),
            TARGET_ID,
            TREASURY
        );
        vault.setV4PoolKey(
            PoolKey({
                currency0: Currency.wrap(address(0)),
                currency1: Currency.wrap(address(alignmentToken)),
                fee: 3000,
                tickSpacing: 60,
                hooks: IHooks(address(0))
            })
        );
        vm.stopPrank();

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(address(this), 100 ether);
    }

    function _contribute(address who, uint256 amount) internal {
        vm.prank(who);
        (bool ok,) = address(vault).call{ value: amount }("");
        assertTrue(ok, "contribution failed");
    }

    /// @notice A benefactor joining while fees sit uncollected in the position captures none of them;
    ///         the incumbent retains the entire benefactor share (80% of the 80/19/1 split).
    function test_uni_joinCrystallizesBeforeMintingShares() public {
        // Alice converts and becomes the sole share holder / sole LP.
        _contribute(alice, 10 ether);
        vault.convertAndAddLiquidity(1);
        assertGt(vault.totalShares(), 0, "alice holds shares");

        // 1 ETH of LP fees accrues in the position but is NOT yet collected into the accumulator.
        vault.stageUncollectedLpFees{ value: 1 ether }(1 ether);

        // Bob joins with an equal stake and converts. The convert must collect + accrue the pending
        // fee at alice's (sole) weight BEFORE bob's shares mint.
        _contribute(bob, 10 ether);
        vault.convertAndAddLiquidity(1);

        // 80/19/1 split: benefactors get 80% of the 1 ETH pre-join fee = 0.8 ETH, all to the incumbent.
        assertApproxEqAbs(vault.calculateClaimableAmount(alice), 0.8 ether, 1e6, "incumbent retains all pre-join fees");
        assertEq(vault.calculateClaimableAmount(bob), 0, "joiner captures none of the pre-join fees");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cypher — pre-weight-change crystallization on receiveContribution
// ─────────────────────────────────────────────────────────────────────────────

contract HarvestFirstCypherTest is Test {
    TestableCypherAlignmentVault internal vault;
    TestableCypherAlignmentVault internal impl;
    MockERC20 internal alignmentToken;
    MockWETH internal weth;
    MockAlgebraPositionManager internal positionManager;
    MockAlgebraSwapRouter internal swapRouter;
    MockAlgebraFactory internal factory;
    MockAlignmentRegistry internal registry;
    MockVaultPriceValidator internal validator;

    address internal treasury = makeAddr("treasury");
    address internal refPool = makeAddr("refPool");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    uint256 internal constant TARGET_ID = 1;

    function setUp() public {
        alignmentToken = new MockERC20("Alignment", "ALN");
        weth = new MockWETH();
        positionManager = new MockAlgebraPositionManager();
        swapRouter = new MockAlgebraSwapRouter();
        factory = new MockAlgebraFactory();
        registry = new MockAlignmentRegistry();
        validator = new MockVaultPriceValidator();
        validator.setEthPer1e18Tokens(1e18);

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
            treasury,
            makeAddr("zRouter"), // unused by these tests; initialize now requires nonzero
            address(0),
            address(validator),
            registry,
            TARGET_ID
        );
    }

    function _contribute(address who, uint256 amount) internal {
        vm.deal(address(this), amount);
        vault.receiveContribution{ value: amount }(Currency.wrap(address(0)), amount, who);
    }

    /// @dev Stage `wethFees` of collectable WETH-side fee on the vault's alignment position (tokenId 1).
    function _stageWethFees(uint256 wethFees) internal {
        vault.setPositionForTest(1, refPool, true);
        positionManager.setPosition(1, address(alignmentToken), address(weth), address(vault));
        weth.mint(address(positionManager), wethFees);
        positionManager.setFees(1, 0, wethFees); // token0 = alignment (0 fee), token1 = weth (fee)
        vm.deal(address(weth), wethFees);
    }

    /// @notice Cypher grows the accumulator weight synchronously in receiveContribution; a benefactor
    ///         arriving while fees sit uncollected must not dilute the incumbent's pre-join fees.
    function test_cypher_contributionCrystallizesBeforeGrowingWeight() public {
        // Alice is the incumbent, holding all contribution weight.
        _contribute(alice, 1 ether);

        // 1 ETH of fees accrues on the vault's position, uncollected.
        _stageWethFees(1 ether);

        // Bob contributes an equal stake. receiveContribution must collect + accrue the pending fee at
        // alice's (sole) weight BEFORE bob's weight is added.
        _contribute(bob, 1 ether);

        // 80/19/1 split: 0.8 ETH benefactor share, all to the incumbent; the joiner gets nothing of it.
        assertEq(vault.calculateClaimableAmount(alice), 0.8 ether, "incumbent retains all pre-join fees");
        assertEq(vault.calculateClaimableAmount(bob), 0, "joiner captures none of the pre-join fees");
        assertEq(vault.accumulatedProtocolFees(), 0.01 ether, "1% protocol cut taken once");
        assertEq(vault.accumulatedTargetFees(), 0.19 ether, "19% target cut taken once");
    }
}
