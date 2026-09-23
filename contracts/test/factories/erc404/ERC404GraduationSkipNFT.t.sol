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
import { TickMath } from "v4-core/libraries/TickMath.sol";
import { LiquidityAmounts } from "../../../src/libraries/v4/LiquidityAmounts.sol";

import { ERC404BondingInstance } from "../../../src/factories/erc404/ERC404BondingInstance.sol";
import { ERC404BondingOps } from "../../../src/factories/erc404/ERC404BondingOps.sol";
import { LiquidityDeployerModule } from "../../../src/factories/erc404/LiquidityDeployerModule.sol";
import { CurveParamsComputer } from "../../../src/factories/erc404/CurveParamsComputer.sol";
import { BondingCurveMath } from "../../../src/factories/erc404/libraries/BondingCurveMath.sol";
import { FixedPointMathLib } from "solady/utils/FixedPointMathLib.sol";

import { ZAMMLiquidityDeployerModule } from "../../../src/factories/erc404zamm/ZAMMLiquidityDeployerModule.sol";
import { IGraduationSkipNFTTarget } from "../../../src/interfaces/ILiquidityDeployerModule.sol";

import { MockMasterRegistry } from "../../mocks/MockMasterRegistry.sol";
import { MockVault } from "../../mocks/MockVault.sol";
import { MockZAMM } from "../../mocks/MockZAMM.sol";
import { MockWETH } from "../../mocks/MockWETH.sol";

/// @dev Minimal V4 PoolManager: enough of the surface for one full graduation add — `extsload` for
///      `StateLibrary.getSlot0`, `initialize`, `unlock` (re-entering the caller's `unlockCallback`),
///      `modifyLiquidity` charging for the liquidity it was handed, and the `sync`/`settle`/`take`
///      triple the deployer settles through. The real add-liquidity math is fork-tested elsewhere.
/// @dev IT CHARGES FOR WHAT IT MINTS. `modifyLiquidity` inverts the caller's own `liquidityDelta` at
///      the pool's live price — `getAmountsForLiquidity` is the exact counterpart of the
///      `getLiquidityForAmounts` the deployer sized it with — so the debt it reports is the debt a real
///      pool would report, and the ETH and coin both actually move. It used to report a debt the TEST
///      configured, defaulting to zero, which meant a graduation here settled nothing and the whole LP
///      leg stayed on the deployer module. Several suites then read that retained balance as a stand-in
///      for the pool's. That was the strand M-1 names, written into the fixtures as if it were the
///      design, and it is why the deployer's own slippage floor had nothing to bite on here.
///      `setOwed` remains for the one test that wants a specific debt rather than an honest one.
contract MockV4PoolManager {
    bytes32 private _slot0;
    int128 public owed0;
    int128 public owed1;
    bool public owedOverridden;
    /// @dev Basis points of each honest leg the pool DECLINES, for driving the deployer's residue
    ///      return without hand-computing the legs. 0 (the default) is an honest full take.
    uint256 public shortBps;

    function setShortBps(uint256 bps) external {
        shortBps = bps;
    }

    function setOwed(int128 a0, int128 a1) external {
        owed0 = a0;
        owed1 = a1;
        owedOverridden = true;
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

    function modifyLiquidity(PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata p, bytes calldata)
        external
        view
        returns (BalanceDelta, BalanceDelta)
    {
        // Negative = the adder owes the pool; this is the settle path that moves the coin.
        if (owedOverridden) {
            return (toBalanceDelta(-owed0, -owed1), toBalanceDelta(int128(0), int128(0)));
        }
        (uint256 amount0, uint256 amount1) = LiquidityAmounts.getAmountsForLiquidity(
            uint160(uint256(_slot0)),
            TickMath.getSqrtPriceAtTick(p.tickLower),
            TickMath.getSqrtPriceAtTick(p.tickUpper),
            uint128(uint256(p.liquidityDelta))
        );
        amount0 = amount0 * (10_000 - shortBps) / 10_000;
        amount1 = amount1 * (10_000 - shortBps) / 10_000;
        return
            (toBalanceDelta(-int128(int256(amount0)), -int128(int256(amount1))), toBalanceDelta(int128(0), int128(0)));
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
            IERC20Like(Currency.unwrap(currency)).transfer(to, amount);
        }
    }

    receive() external payable { }
}

interface IERC20Like {
    function transfer(address to, uint256 amount) external returns (bool);
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

    /// @dev Nothing to arm: `MockV4PoolManager` charges for the liquidity it is handed, on both legs.
    ///      This used to set the coin leg by hand and leave the ETH leg at zero, which meant the whole
    ///      ETH side stayed on the deployer module for the rest of the test.
    function _armPool() internal { }

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

    /// @notice THE RESIDUE COMES BACK THROUGH THE SAME EYE OF THE NEEDLE. A venue that finds its pool
    ///         pre-initialized away from the graduation price takes one side in full and declines part
    ///         of the other; the deployer module now hands that remainder back to the instance rather
    ///         than stranding it (audit M-1, 2026-09-17). On this collection 1% of the coin side is
    ///         ~200 ids' worth, so if the instance were not itself NFT-skipping the return leg would
    ///         mint that many ids and the burn would destroy them again — the same round trip
    ///         `markGraduationSkipNFT` exists to prevent, reintroduced on the way out. It is flagged at
    ///         `_initializeDN404`, and this is the assertion that says so rather than the comment that
    ///         claims it.
    /// @dev The returned coin is BURNED, not kept: after `graduated` no path can move instance-held
    ///         coin, so the instance is empty afterwards and total supply is down by the residue.
    function test_graduation_returnedResidueMintsNoIdsAndIsBurned() public {
        _seedReserve();
        // The venue declines 99 bps of each leg — just inside the deployer's own 99% floor, which the
        // inverse-math amounts are already a hair under before the short is applied.
        uint256 shortBps = 99;
        poolManager.setShortBps(shortBps);

        uint256 supplyBefore = instance.totalSupply();
        uint256 idsBefore = mirror.totalSupply();

        vm.prank(owner);
        uint256 before = gasleft();
        instance.deployLiquidity(0);
        uint256 spent = before - gasleft();

        uint256 delivered = instance.balanceOf(address(poolManager));
        uint256 residue = supplyBefore - instance.totalSupply();
        assertGt(residue, 100 * UNIT, "precondition: the declined leg is worth more than 100 ids");
        assertApproxEqRel(
            residue, delivered * shortBps / (10_000 - shortBps), 1e15, "the residue is what the venue declined"
        );

        assertEq(instance.balanceOf(address(instance)), 0, "the returned residue was not burned");
        assertEq(instance.balanceOf(address(deployer)), 0, "coin stranded on the deployer module");
        assertEq(mirror.totalSupply(), idsBefore, "the return leg minted ids");
        assertEq(mirror.balanceOf(address(instance)), 0, "the instance was minted ids for the residue");
        assertLt(spent, GRADUATION_GAS_BOUND, "the residue return put the id round trip back");
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
    ///      no-NFT-work graduation on either venue (measured: Uni and ZAMM under 700k) and two orders
    ///      of magnitude below what the round trip costs at this size (measured: ~246M on each venue
    ///      with the mechanism removed).
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
