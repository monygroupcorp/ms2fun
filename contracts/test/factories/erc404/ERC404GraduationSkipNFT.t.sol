// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { DN404Mirror } from "dn404/src/DN404Mirror.sol";

import { PoolKey } from "v4-core/types/PoolKey.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { IPoolManager } from "v4-core/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "v4-core/interfaces/callback/IUnlockCallback.sol";
import { BalanceDelta, toBalanceDelta } from "v4-core/types/BalanceDelta.sol";

import { ERC404BondingInstance } from "../../../src/factories/erc404/ERC404BondingInstance.sol";
import { ERC404BondingOps } from "../../../src/factories/erc404/ERC404BondingOps.sol";
import { LiquidityDeployerModule } from "../../../src/factories/erc404/LiquidityDeployerModule.sol";
import { CurveParamsComputer } from "../../../src/factories/erc404/CurveParamsComputer.sol";
import { BondingCurveMath } from "../../../src/factories/erc404/libraries/BondingCurveMath.sol";
import { FixedPointMathLib } from "solady/utils/FixedPointMathLib.sol";

import { ZAMMLiquidityDeployerModule } from "../../../src/factories/erc404zamm/ZAMMLiquidityDeployerModule.sol";
import { CypherLiquidityDeployerModule } from "../../../src/factories/erc404cypher/CypherLiquidityDeployerModule.sol";
import { IGraduationSkipNFTTarget } from "../../../src/interfaces/ILiquidityDeployerModule.sol";

import { MockMasterRegistry } from "../../mocks/MockMasterRegistry.sol";
import { MockVault } from "../../mocks/MockVault.sol";
import { MockZAMM } from "../../mocks/MockZAMM.sol";
import { MockWETH } from "../../mocks/MockWETH.sol";
import { MockAlgebraFactory, MockAlgebraPositionManager } from "../../mocks/MockCypherAlgebra.sol";

/// @dev Minimal V4 PoolManager: enough of the surface for one full graduation add — `extsload` for
///      `StateLibrary.getSlot0`, `initialize`, `unlock` (re-entering the caller's `unlockCallback`),
///      `modifyLiquidity` returning a caller-configured debt, and the `sync`/`settle`/`take` triple the
///      deployer settles through. The real add-liquidity math is fork-tested elsewhere; what this stands
///      in for is the leg that matters here — the graduated coin actually landing on the pool.
contract MockV4PoolManager {
    bytes32 private _slot0;
    int128 public owed0;
    int128 public owed1;

    function setOwed(int128 a0, int128 a1) external {
        owed0 = a0;
        owed1 = a1;
    }

    function extsload(bytes32) external view returns (bytes32) {
        return _slot0;
    }

    function initialize(PoolKey calldata, uint160 sqrtPriceX96) external returns (int24) {
        _slot0 = bytes32(uint256(sqrtPriceX96));
        return 0;
    }

    function unlock(bytes calldata data) external returns (bytes memory) {
        return IUnlockCallback(msg.sender).unlockCallback(data);
    }

    function modifyLiquidity(PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata, bytes calldata)
        external
        view
        returns (BalanceDelta, BalanceDelta)
    {
        // Negative = the adder owes the pool; this is the settle path that moves the coin.
        return (toBalanceDelta(-owed0, -owed1), toBalanceDelta(int128(0), int128(0)));
    }

    function sync(Currency) external { }

    function settle() external payable returns (uint256) {
        return 0;
    }

    function take(Currency, address, uint256) external { }

    receive() external payable { }
}

/**
 * @title ERC404GraduationSkipNFTTest
 * @notice Graduation moves the whole `liquidityReserve` through two contracts — the deployer module and
 *         the venue's pool. This instance's `_skipNFTDefault` override returns `false` for every address,
 *         so an unflagged recipient (contract or not) takes delivery of one NFT id per `unit`, and the
 *         reserve's worth of ids was therefore minted to the module, burned again on the settle leg, and
 *         minted a second time to the pool. The cost of that round trip scales with the collection size,
 *         so past a few thousand ids graduation no longer fits in a block.
 *
 *         The guard: a graduation carrying 20,000 ids' worth of reserve, asserted to complete inside a
 *         stated gas bound, with neither counterparty holding an id afterwards — while the pool's coin
 *         balance proves the reserve really arrived. Reverting the fix restores the round trip and the
 *         gas bound fails.
 */
contract ERC404GraduationSkipNFTTest is Test {
    ERC404BondingInstance internal instance;
    DN404Mirror internal mirror;
    LiquidityDeployerModule internal deployer;
    MockV4PoolManager internal poolManager;
    MockMasterRegistry internal registry;
    MockVault internal vault;
    CurveParamsComputer internal curveComputer;

    address internal owner = address(0xA11CE);
    address internal buyer = address(0xB0B);
    address internal treasury = address(0x7EA);

    /// @dev 100,000 ids at 1e18 per id, 20% reserved for liquidity → 20,000 ids' worth of reserve.
    ///      The earlier behavior round-tripped an NFT per reserved unit; at ~17.75k gas apiece that is
    ///      an order of magnitude past a 30M block, so this size was simply not graduatable.
    uint256 internal constant NFT_COUNT = 100_000;
    uint256 internal constant UNIT = 1e18;
    uint256 internal constant MAX_SUPPLY = NFT_COUNT * UNIT;
    uint256 internal constant LIQUIDITY_RESERVE_BPS = 2000;
    uint256 internal constant RESERVED_IDS = (NFT_COUNT * LIQUIDITY_RESERVE_BPS) / 10000; // 20,000

    /// @dev Ceiling for the whole graduation call. Comfortably above the settled cost of a
    ///      no-NFT-work graduation and far below what a single reserved id's round trip would add
    ///      twenty thousand times over.
    uint256 internal constant GRADUATION_GAS_BOUND = 3_000_000;

    function setUp() public {
        registry = new MockMasterRegistry();
        vault = new MockVault();
        poolManager = new MockV4PoolManager();
        deployer = new LiquidityDeployerModule(address(poolManager), address(0xBEEF), 3000, 60, address(registry));
        curveComputer = new CurveParamsComputer(address(this));

        BondingCurveMath.Params memory curve =
            curveComputer.computeCurveParams(NFT_COUNT, 10 ether, 1, LIQUIDITY_RESERVE_BPS);

        vm.startPrank(owner);
        ERC404BondingInstance impl = new ERC404BondingInstance(address(new ERC404BondingOps()));
        instance = ERC404BondingInstance(payable(LibClone.clone(address(impl))));
        mirror = new DN404Mirror(owner);

        instance.initialize(
            owner,
            address(vault),
            ERC404BondingInstance.BondingParams({
                maxSupply: MAX_SUPPLY,
                unit: UNIT,
                liquidityReserveBps: LIQUIDITY_RESERVE_BPS,
                declaredMaxAllowanceBps: 0,
                curve: curve
            }),
            address(deployer),
            address(0),
            address(mirror)
        );
        instance.initializeProtocol(
            ERC404BondingInstance.ProtocolParams({
                globalMessageRegistry: address(0x700),
                protocolTreasury: treasury,
                masterRegistry: address(registry),
                bondingFeeBps: 100,
                weth: address(0xBEEF)
            })
        );
        instance.initializeMetadata("Graduation Gas", "GRAD", "", "", "");
        instance.setBondingOpenTime(block.timestamp + 1);
        instance.setBondingActive(true);
        vm.stopPrank();
        vm.warp(block.timestamp + 1);

        assertEq(instance.liquidityReserve(), RESERVED_IDS * UNIT, "reserve sizing");
    }

    /// @dev SELL THE WHOLE CURVE. Graduation's coin side is derived from the price the curve actually
    ///      reached (noesis-188), so the reserved-id count this file is about is only in play at a full
    ///      sale — where the derived side reproduces `liquidityReserve`, i.e. the 20,000 ids' worth
    ///      measured here. The buyer flags itself NFT-skipping first: its own 80,000 ids are not the
    ///      subject, the graduation counterparties' are.
    function _seedReserve() internal {
        vm.deal(buyer, 1000 ether);
        vm.startPrank(buyer);
        instance.setSkipNFT(true);
        instance.buyBonding{ value: 1000 ether }(
            MAX_SUPPLY - instance.liquidityReserve(), type(uint256).max, false, bytes(""), bytes(""), 0
        );
        vm.stopPrank();
        assertGt(instance.reserve(), 0, "the curve took ETH");
    }

    /// @dev The coin side graduation will settle, recomputed here from the stored curve parameters
    ///      rather than taken from the contract under test: `tokensForPool = ethForPool / p(S)`,
    ///      capped by the coin the instance still holds.
    function _poolCoinSide() internal view returns (uint256) {
        (uint256 kCoeff, uint256 poleWad, uint256 normalizationFactor) = instance.curveParams();
        uint256 sWad = instance.totalBondingSupply() / normalizationFactor;
        uint256 raise = instance.reserve();
        uint256 ethForPool = raise - raise / 100 - (raise * 19) / 100;
        uint256 want = FixedPointMathLib.fullMulDiv(ethForPool, (poleWad - sWad) * normalizationFactor, kCoeff);
        uint256 available = instance.balanceOf(address(instance));
        return want > available ? available : want;
    }

    /// @dev The mock pool reports the debt the real one would on the coin leg. The ETH leg is left at
    ///      zero — this file measures the id traffic the coin leg generates, not the ETH settlement.
    function _armPool() internal {
        // ETH is currency0 (address(0) sorts below any token), so the coin is currency1.
        poolManager.setOwed(int128(0), int128(int256(_poolCoinSide())));
    }

    function test_graduation_isGasBoundedAtALargeCollection() public {
        _seedReserve();
        _armPool();

        vm.prank(owner);
        uint256 before = gasleft();
        instance.deployLiquidity(0);
        uint256 spent = before - gasleft();

        assertTrue(instance.graduated(), "graduation completed");
        assertLt(spent, GRADUATION_GAS_BOUND, "graduation gas scaled with the reserved id count");
    }

    function test_graduation_mintsNoIdsToItsCounterparties() public {
        _seedReserve();
        _armPool();

        vm.prank(owner);
        instance.deployLiquidity(0);

        // The coin really did travel instance → module → pool. Without this the id assertions below
        // would hold trivially. At a full sale the derived coin side is the create-time reserve to
        // within a basis point — the pole is solved at create so the curve's end price IS the pool's.
        uint256 delivered = instance.balanceOf(address(poolManager));
        assertGt(delivered, 0, "the pool holds no coin");
        assertApproxEqRel(delivered, RESERVED_IDS * UNIT, 1e14, "the pool holds the reserve");
        assertEq(instance.balanceOf(address(deployer)), 0, "the module passed the reserve on");

        assertEq(mirror.balanceOf(address(deployer)), 0, "the deployer module holds no id");
        assertEq(mirror.balanceOf(address(poolManager)), 0, "the pool holds no id");
        assertTrue(instance.getSkipNFT(address(deployer)), "the module is flagged NFT-skipping");
        assertTrue(instance.getSkipNFT(address(poolManager)), "the pool is flagged NFT-skipping");
    }

    /// @dev The flag is set permanently, not saved and restored: the pool keeps receiving coin for the
    ///      life of the market, and a restored `false` would re-mint the reserve's worth of ids into it
    ///      on the sell side of the very next swap.
    function test_poolStaysNFTSkippingAfterGraduation() public {
        _seedReserve();
        _armPool();

        vm.prank(owner);
        instance.deployLiquidity(0);

        // A later credit to the pool — the shape of a swap paying coin back in — mints nothing.
        vm.prank(buyer);
        instance.transfer(address(poolManager), UNIT);
        assertEq(mirror.balanceOf(address(poolManager)), 0, "a post-graduation credit minted ids to the pool");
    }
}

/**
 * @title VenueGraduationSkipNFTBase
 * @notice Shared rig for the per-venue graduation guards. Builds one real `ERC404BondingInstance`
 *         wired to the deployer module under test, sells the whole curve, and graduates.
 * @dev The three venues differ only in which module they wire and which address ends up holding the
 *      pool's coin side; the property being pinned is identical, so the setup is stated once. Each
 *      venue subclass supplies its module and names its own counterparties.
 */
abstract contract VenueGraduationSkipNFTBase is Test {
    ERC404BondingInstance internal instance;
    DN404Mirror internal mirror;
    MockMasterRegistry internal registry;
    MockVault internal vault;
    CurveParamsComputer internal curveComputer;

    address internal owner = address(0xA11CE);
    address internal buyer = address(0xB0B);
    address internal treasury = address(0x7EA);

    uint256 internal constant NFT_COUNT = 100_000;
    uint256 internal constant UNIT = 1e18;
    uint256 internal constant MAX_SUPPLY = NFT_COUNT * UNIT;
    uint256 internal constant LIQUIDITY_RESERVE_BPS = 2000;
    uint256 internal constant RESERVED_IDS = (NFT_COUNT * LIQUIDITY_RESERVE_BPS) / 10000; // 20,000

    /// @dev Ceiling for the whole graduation call. Comfortably above the settled cost of a
    ///      no-NFT-work graduation on any of the three venues (measured: Uni and ZAMM under 700k,
    ///      Cypher 861k) and two orders of magnitude below what the round trip costs at this size
    ///      (measured: ~246M on each venue with the mechanism removed).
    uint256 internal constant GRADUATION_GAS_BOUND = 3_000_000;

    /// @dev The venue's deployer module, wired into the instance at `initialize`.
    function _deployerModule() internal view virtual returns (address);

    function _buildInstance() internal {
        registry = new MockMasterRegistry();
        vault = new MockVault();
        curveComputer = new CurveParamsComputer(address(this));

        BondingCurveMath.Params memory curve =
            curveComputer.computeCurveParams(NFT_COUNT, 10 ether, 1, LIQUIDITY_RESERVE_BPS);

        vm.startPrank(owner);
        ERC404BondingInstance impl = new ERC404BondingInstance(address(new ERC404BondingOps()));
        instance = ERC404BondingInstance(payable(LibClone.clone(address(impl))));
        mirror = new DN404Mirror(owner);

        instance.initialize(
            owner,
            address(vault),
            ERC404BondingInstance.BondingParams({
                maxSupply: MAX_SUPPLY,
                unit: UNIT,
                liquidityReserveBps: LIQUIDITY_RESERVE_BPS,
                declaredMaxAllowanceBps: 0,
                curve: curve
            }),
            _deployerModule(),
            address(0),
            address(mirror)
        );
        instance.initializeProtocol(
            ERC404BondingInstance.ProtocolParams({
                globalMessageRegistry: address(0x700),
                protocolTreasury: treasury,
                masterRegistry: address(registry),
                bondingFeeBps: 100,
                weth: address(0xBEEF)
            })
        );
        instance.initializeMetadata("Graduation Gas", "GRAD", "", "", "");
        instance.setBondingOpenTime(block.timestamp + 1);
        instance.setBondingActive(true);
        vm.stopPrank();
        vm.warp(block.timestamp + 1);
    }

    /// @dev Sell the whole curve, so the derived coin side reproduces `liquidityReserve` — the 20,000
    ///      ids' worth this file is about. The buyer flags itself NFT-skipping first: its own 80,000
    ///      ids are not the subject, the graduation counterparties' are.
    function _seedReserve() internal {
        vm.deal(buyer, 1000 ether);
        vm.startPrank(buyer);
        instance.setSkipNFT(true);
        instance.buyBonding{ value: 1000 ether }(
            MAX_SUPPLY - instance.liquidityReserve(), type(uint256).max, false, bytes(""), bytes(""), 0
        );
        vm.stopPrank();
        assertGt(instance.reserve(), 0, "the curve took ETH");
    }

    function _graduate() internal returns (uint256 gasSpent) {
        vm.prank(owner);
        uint256 before = gasleft();
        instance.deployLiquidity(0);
        gasSpent = before - gasleft();
        assertTrue(instance.graduated(), "graduation completed");
    }

    // ── The callback's own authorization ──────────────────────────────────────

    /// @notice Only the wired deployer module may flag a graduation counterparty. Anyone else is
    ///         refused — the flag is permanent and suppresses id delivery, so an open setter would
    ///         let a passerby silence any address's NFT side.
    function test_markGraduationSkipNFT_refusesANonDeployerCaller() public {
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert(IGraduationSkipNFTTarget.NotLiquidityDeployer.selector);
        instance.markGraduationSkipNFT(stranger);
        assertFalse(instance.getSkipNFT(stranger), "a stranger flagged an address");
    }

    /// @notice The wired module may, and the effect is the flag. This is the positive control for the
    ///         authorization test above: without it, a callback that reverted for EVERY caller would
    ///         still pass that one.
    function test_markGraduationSkipNFT_acceptsTheWiredDeployer() public {
        address subject = makeAddr("subject");
        assertFalse(instance.getSkipNFT(subject), "subject starts unflagged");
        vm.prank(_deployerModule());
        instance.markGraduationSkipNFT(subject);
        assertTrue(instance.getSkipNFT(subject), "the wired deployer could not flag");
    }

    /// @notice THE REENTRANCY PIN. `deployLiquidity`'s body is `nonReentrant` and it is the frame that
    ///         calls into the module, which calls back into `markGraduationSkipNFT`. Solady's guard is
    ///         a single shared lock, so a `nonReentrant` on the callback would revert this graduation —
    ///         and every graduation on every venue. A full graduation completing through the callback
    ///         is what pins the callback's guard set.
    function test_graduation_completesThroughTheCallback() public {
        _seedReserve();
        _armVenue();
        _graduate();
    }

    /// @dev Arm whatever the venue's pool double needs before graduation (Uni's settle debt, etc.).
    function _armVenue() internal virtual { }
}

/**
 * @title ZAMMGraduationSkipNFTTest
 * @notice The ZAMM venue's coin counterparty is the singleton AMM: `addLiquidity` pulls the pool's
 *         coin side out of the deployer module and into `zamm`, which holds it for the life of the
 *         market. The module names it to the instance before the pull.
 */
contract ZAMMGraduationSkipNFTTest is VenueGraduationSkipNFTBase {
    ZAMMLiquidityDeployerModule internal deployer;
    MockZAMM internal zamm;

    function _deployerModule() internal view override returns (address) {
        return address(deployer);
    }

    function setUp() public {
        zamm = new MockZAMM();
        MockMasterRegistry preRegistry = new MockMasterRegistry();
        deployer = new ZAMMLiquidityDeployerModule(address(zamm), 30, address(preRegistry));
        _buildInstance();
        preRegistry.setRegisteredInstance(address(instance), true);
    }

    function test_graduation_isGasBoundedAtALargeCollection() public {
        _seedReserve();
        uint256 spent = _graduate();
        assertLt(spent, GRADUATION_GAS_BOUND, "graduation gas scaled with the reserved id count");
    }

    function test_graduation_mintsNoIdsToItsCounterparties() public {
        _seedReserve();
        _graduate();

        // The coin really did travel instance -> module -> AMM. Without this the id assertions below
        // would hold trivially.
        uint256 delivered = instance.balanceOf(address(zamm));
        assertGt(delivered, 0, "the AMM holds no coin");
        assertApproxEqRel(delivered, RESERVED_IDS * UNIT, 1e14, "the AMM holds the reserve");
        assertEq(instance.balanceOf(address(deployer)), 0, "the module passed the reserve on");

        assertEq(mirror.balanceOf(address(deployer)), 0, "the deployer module holds no id");
        assertEq(mirror.balanceOf(address(zamm)), 0, "the AMM holds no id");
        assertTrue(instance.getSkipNFT(address(deployer)), "the module is flagged NFT-skipping");
        assertTrue(instance.getSkipNFT(address(zamm)), "the AMM is flagged NFT-skipping");
    }

    /// @dev The flag is permanent, not saved and restored: the AMM keeps receiving coin on the sell
    ///      side of every later swap, and a restored flag would re-mint the reserve's worth of ids.
    function test_counterpartyStaysNFTSkippingAfterGraduation() public {
        _seedReserve();
        _graduate();

        vm.prank(buyer);
        instance.transfer(address(zamm), UNIT);
        assertEq(mirror.balanceOf(address(zamm)), 0, "a post-graduation credit minted ids to the AMM");
    }
}

/**
 * @title CypherGraduationSkipNFTTest
 * @notice The Algebra venue is why the mechanism is a callback rather than a getter: the pool is
 *         created DURING graduation, so no accessor on the module can name it beforehand. Both the
 *         pool and the position manager are flagged — which of the two takes custody of the coin is
 *         an implementation detail of the periphery (this repo's in-tree Algebra double pulls both
 *         amounts to the position manager; production periphery pays payer->pool inside the mint
 *         callback), and flagging both is correct under either.
 */
contract CypherGraduationSkipNFTTest is VenueGraduationSkipNFTBase {
    CypherLiquidityDeployerModule internal deployer;
    MockAlgebraFactory internal algebraFactory;
    MockAlgebraPositionManager internal positionManager;
    MockWETH internal weth;

    function _deployerModule() internal view override returns (address) {
        return address(deployer);
    }

    function setUp() public {
        algebraFactory = new MockAlgebraFactory();
        positionManager = new MockAlgebraPositionManager();
        weth = new MockWETH();
        MockMasterRegistry preRegistry = new MockMasterRegistry();
        deployer = new CypherLiquidityDeployerModule(
            address(algebraFactory), address(positionManager), address(weth), address(preRegistry)
        );
        _buildInstance();
        preRegistry.setRegisteredInstance(address(instance), true);
    }

    function _pool() internal view returns (address) {
        return algebraFactory.poolByPair(address(instance), address(weth));
    }

    function test_graduation_isGasBoundedAtALargeCollection() public {
        _seedReserve();
        uint256 spent = _graduate();
        assertLt(spent, GRADUATION_GAS_BOUND, "graduation gas scaled with the reserved id count");
    }

    function test_graduation_mintsNoIdsToItsCounterparties() public {
        _seedReserve();
        _graduate();

        address pool = _pool();
        assertTrue(pool != address(0), "no pool was created");

        // The coin really did travel instance -> module -> periphery. Under this repo's Algebra
        // double the position manager is where it lands; the assertion is on the union of the two
        // counterparties so it stays true under either custody model.
        uint256 delivered = instance.balanceOf(pool) + instance.balanceOf(address(positionManager));
        assertGt(delivered, 0, "neither counterparty holds coin");
        assertApproxEqRel(delivered, RESERVED_IDS * UNIT, 1e14, "the counterparties hold the reserve");
        assertEq(instance.balanceOf(address(deployer)), 0, "the module passed the reserve on");

        assertEq(mirror.balanceOf(address(deployer)), 0, "the deployer module holds no id");
        assertEq(mirror.balanceOf(pool), 0, "the pool holds no id");
        assertEq(mirror.balanceOf(address(positionManager)), 0, "the position manager holds no id");
        assertTrue(instance.getSkipNFT(address(deployer)), "the module is flagged NFT-skipping");
        assertTrue(instance.getSkipNFT(pool), "the pool is flagged NFT-skipping");
        assertTrue(instance.getSkipNFT(address(positionManager)), "the position manager is flagged NFT-skipping");
    }

    /// @dev The flag is permanent, not saved and restored: the pool keeps receiving coin on the sell
    ///      side of every later swap, and a restored flag would re-mint the reserve's worth of ids.
    function test_counterpartyStaysNFTSkippingAfterGraduation() public {
        _seedReserve();
        _graduate();

        address pool = _pool();
        vm.startPrank(buyer);
        instance.transfer(pool, UNIT);
        instance.transfer(address(positionManager), UNIT);
        vm.stopPrank();
        assertEq(mirror.balanceOf(pool), 0, "a post-graduation credit minted ids to the pool");
        assertEq(mirror.balanceOf(address(positionManager)), 0, "a post-graduation credit minted ids to the periphery");
    }
}
