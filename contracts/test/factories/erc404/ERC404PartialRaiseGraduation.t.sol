// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test, Vm } from "forge-std/Test.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { DN404Mirror } from "dn404/src/DN404Mirror.sol";
import { FixedPointMathLib } from "solady/utils/FixedPointMathLib.sol";

import { ERC404BondingInstance, ICarveParamsSource } from "../../../src/factories/erc404/ERC404BondingInstance.sol";
import { ERC404BondingOps } from "../../../src/factories/erc404/ERC404BondingOps.sol";
import { LiquidityDeployerModule } from "../../../src/factories/erc404/LiquidityDeployerModule.sol";
import { CurveParamsComputer } from "../../../src/factories/erc404/CurveParamsComputer.sol";
import { BondingCurveMath } from "../../../src/factories/erc404/libraries/BondingCurveMath.sol";

import { MockV4PoolManager } from "./ERC404GraduationSkipNFT.t.sol";
import { MockMasterRegistry } from "../../mocks/MockMasterRegistry.sol";
import { MockVault } from "../../mocks/MockVault.sol";

/**
 * @title ERC404PartialRaiseGraduationTest
 * @notice PARITY IS AN INVARIANT OF GRADUATION, NOT A PROPERTY OF THE HAPPY PATH.
 *
 *         `deployLiquidity` requires only that bonding has opened, that the collection has not already
 *         graduated, and that the raise is non-zero. It does not require the curve to have sold out. The
 *         pool must therefore open at the curve's marginal price at whatever supply the curve stopped
 *         at — at 25% sold and at 100% sold alike — and every coin the instance was free to place must
 *         either be in that pool or have ceased to exist.
 *
 *         The matrix below graduates at 25/50/75/85/90/95/99/100% of curve supply on BOTH reserve
 *         presets and asserts, in every cell, that the pool's opening price equals the curve's marginal
 *         price. It is run at `liquidityReserveBps = 1000` — the shipping preset — and at 2000. That
 *         distinction is the point of the file: at r = 0.20 the parity coin side is affordable at every
 *         stopping point, so a matrix run only there is feasible everywhere and says nothing about what
 *         ships. At r = 0.10 the coin parity calls for exceeds everything the instance holds once the
 *         curve is roughly 85% sold, and those cells are where the ETH clamp does its work.
 *
 *         VACUITY CHECK ([[helm-vacuous-gates]]): against a fixed create-time `liquidityReserve` the
 *         pool's opening price is `0.8·R_partial / liquidityReserve`, which tracks the raise while the
 *         coin side stands still — it matches the curve's marginal price only in the 100% cell. Every
 *         other cell in the matrix fails outright, and the clamp-boundary and coin-conservation tests
 *         fail with it.
 */
contract ERC404PartialRaiseGraduationTest is Test {
    using FixedPointMathLib for uint256;

    /// @dev Mirrors the module's own event so `vm.getRecordedLogs` has a signature to match on.
    event LiquidityDeployed(address indexed pool, uint256 amountToken, uint256 amountETH);

    address internal owner = address(0xA11CE);
    address internal buyer = address(0xB0B);
    address internal treasury = address(0x7EA);

    uint256 internal constant NFT_COUNT = 1000;
    uint256 internal constant UNIT = 1e18;
    uint256 internal constant MAX_SUPPLY = NFT_COUNT * UNIT;
    uint256 internal constant TARGET_ETH = 10 ether;

    /// @notice The shipping reserve preset, and the test preset the repo's other graduation tests use.
    uint256 internal constant PROD_BPS = 1000;
    uint256 internal constant TEST_BPS = 2000;

    /// @dev Relative tolerance on the parity assertion, WAD. 1e-6 — the same tolerance
    ///      `CurveParamsComputer` solves the pole against, and orders of magnitude above the integer
    ///      rounding in the sizing itself (one ulp on amounts of 1e18 and up).
    uint256 internal constant PARITY_TOL_WAD = 1e12;

    /// @dev Percent-of-curve-supply stopping points. 85 is the razor edge where the coin parity needs
    ///      and the coin the instance holds are equal to four decimal places on the shipping preset;
    ///      90/95/99 are the deficit band and are the reason this item exists; 100 is the anchor, the
    ///      one cell the create-time sizing also gets right.
    uint256[8] internal STOPS = [uint256(25), 50, 75, 85, 90, 95, 99, 100];

    struct Rig {
        ERC404BondingInstance instance;
        LiquidityDeployerModule deployer;
        MockV4PoolManager pool;
        MockVault vault;
        MockMasterRegistry registry;
        uint256 maxBondingSupply;
    }

    // ── Rig ───────────────────────────────────────────────────────────────────────────────────────

    function _rig(uint256 reserveBps, uint16 declaredMaxAllowanceBps) internal returns (Rig memory r) {
        r.registry = new MockMasterRegistry();
        r.vault = new MockVault();
        r.pool = new MockV4PoolManager();
        r.deployer = new LiquidityDeployerModule(address(r.pool), address(0xBEEF), 3000, 60, address(r.registry));

        CurveParamsComputer curveComputer = new CurveParamsComputer(address(this));
        BondingCurveMath.Params memory curve = curveComputer.computeCurveParams(NFT_COUNT, TARGET_ETH, 1, reserveBps);

        vm.startPrank(owner);
        ERC404BondingInstance impl = new ERC404BondingInstance(address(new ERC404BondingOps()));
        r.instance = ERC404BondingInstance(payable(LibClone.clone(address(impl))));
        DN404Mirror mirror = new DN404Mirror(owner);

        r.instance
            .initialize(
                owner,
                address(r.vault),
                ERC404BondingInstance.BondingParams({
                    maxSupply: MAX_SUPPLY,
                    unit: UNIT,
                    liquidityReserveBps: reserveBps,
                    declaredMaxAllowanceBps: declaredMaxAllowanceBps,
                    curve: curve
                }),
                address(r.deployer),
                address(0),
                address(mirror)
            );
        r.instance
            .initializeProtocol(
                ERC404BondingInstance.ProtocolParams({
                    globalMessageRegistry: address(0x700),
                    protocolTreasury: treasury,
                    masterRegistry: address(r.registry),
                    bondingFeeBps: 100,
                    weth: address(0xBEEF)
                })
            );
        r.instance.initializeMetadata("Partial Raise", "PART", "", "", "");
        r.instance.setBondingOpenTime(block.timestamp + 1);
        r.instance.setBondingActive(true);
        vm.stopPrank();
        vm.warp(block.timestamp + 1);

        r.maxBondingSupply = MAX_SUPPLY - r.instance.liquidityReserve();
    }

    /// @dev Buy `pct` percent of the curve's sellable supply. The buyer flags itself NFT-skipping first:
    ///      the coin amounts here are thousands of ids' worth and the id side is not what is under test.
    function _buyPercent(Rig memory r, uint256 pct) internal returns (uint256 amount) {
        amount = (r.maxBondingSupply * pct) / 100;
        vm.deal(buyer, 1000 ether);
        vm.startPrank(buyer);
        r.instance.setSkipNFT(true);
        r.instance.buyBonding{ value: 1000 ether }(amount, type(uint256).max, false, bytes(""), bytes(""), 0);
        vm.stopPrank();
    }

    /// @dev The curve's marginal price at the CURRENT supply, in wei per WAD of coin, derived straight
    ///      from the stored curve parameters — `p(S) = kCoeff / ((poleWad - s) * normalizationFactor)`
    ///      with `s = totalBondingSupply / normalizationFactor`. Independent of anything graduation
    ///      computes: it reads the pole and the amplitude the create path solved and scaled.
    function _marginalPriceWad(ERC404BondingInstance inst) internal view returns (uint256) {
        (uint256 kCoeff, uint256 poleWad, uint256 normalizationFactor) = inst.curveParams();
        uint256 sWad = inst.totalBondingSupply() / normalizationFactor;
        return FixedPointMathLib.fullMulDiv(kCoeff, 1e18, (poleWad - sWad) * normalizationFactor);
    }

    /// @dev Graduate and read back what the deployer module actually put in the pool. The module's own
    ///      `LiquidityDeployed(pool, amountToken, amountETH)` carries the post-split figures, which is
    ///      the pair the pool price is formed from.
    function _graduate(Rig memory r, uint256 carveRequestBps)
        internal
        returns (uint256 tokensToPool, uint256 ethToPool)
    {
        vm.recordLogs();
        vm.prank(owner);
        r.instance.deployLiquidity(carveRequestBps);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 sig = LiquidityDeployed.selector;
        bool seen;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(r.deployer) && logs[i].topics[0] == sig) {
                (tokensToPool, ethToPool) = abi.decode(logs[i].data, (uint256, uint256));
                seen = true;
            }
        }
        assertTrue(seen, "the deployer module never reported a pool");
    }

    /// @dev `GraduationSupplyBurned(availableCoin, tokensToPool, burned)`, emitted by the instance.
    function _burnEvent(Vm.Log[] memory logs, address instance)
        internal
        pure
        returns (uint256 availableCoin, uint256 tokensToPool, uint256 burned)
    {
        bytes32 sig = keccak256("GraduationSupplyBurned(uint256,uint256,uint256)");
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == instance && logs[i].topics[0] == sig) {
                return abi.decode(logs[i].data, (uint256, uint256, uint256));
            }
        }
        revert("no GraduationSupplyBurned");
    }

    /// @dev `GraduationEthDiverted(ethToPool, excessEth, creatorCarveEth)`, emitted by the instance.
    function _divertEvent(Vm.Log[] memory logs, address instance)
        internal
        pure
        returns (uint256 ethToPool, uint256 excessEth, uint256 carveEth)
    {
        bytes32 sig = keccak256("GraduationEthDiverted(uint256,uint256,uint256)");
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == instance && logs[i].topics[0] == sig) {
                return abi.decode(logs[i].data, (uint256, uint256, uint256));
            }
        }
        revert("no GraduationEthDiverted");
    }

    function _assertParity(uint256 tokensToPool, uint256 ethToPool, uint256 expectedPriceWad, string memory label)
        internal
    {
        assertGt(tokensToPool, 0, string.concat(label, ": pool got no coin"));
        assertGt(ethToPool, 0, string.concat(label, ": pool got no ETH"));
        uint256 poolPriceWad = FixedPointMathLib.fullMulDiv(ethToPool, 1e18, tokensToPool);
        uint256 diff =
            poolPriceWad > expectedPriceWad ? poolPriceWad - expectedPriceWad : expectedPriceWad - poolPriceWad;
        assertLe(
            diff * 1e18,
            expectedPriceWad * PARITY_TOL_WAD,
            string.concat(label, ": pool did not open at the curve's marginal price")
        );
    }

    /// @dev The price the pool was ACTUALLY initialized at, decoded from the sqrtPriceX96 the module
    ///      handed the pool manager. ETH is currency0 (address(0) sorts below any token), so slot0
    ///      encodes coin-per-ETH; this inverts it back to wei per WAD of coin.
    function _assertPoolInitializedAtParity(Rig memory r, uint256 expectedPriceWad, string memory label) internal {
        uint256 sqrtPriceX96 = uint256(uint160(uint256(r.pool.extsload(bytes32(0)))));
        assertGt(sqrtPriceX96, 0, string.concat(label, ": pool was never initialized"));
        uint256 openPriceWad = FixedPointMathLib.fullMulDiv(1e18, 1 << 192, sqrtPriceX96 * sqrtPriceX96);
        uint256 diff =
            openPriceWad > expectedPriceWad ? openPriceWad - expectedPriceWad : expectedPriceWad - openPriceWad;
        assertLe(
            diff * 1e18,
            expectedPriceWad * PARITY_TOL_WAD,
            string.concat(label, ": the initialized pool price is not the curve's marginal price")
        );
    }

    // ── The matrix ────────────────────────────────────────────────────────────────────────────────

    function test_parityAtEveryStoppingPoint_productionPreset() public {
        _parityMatrix(PROD_BPS, "r=1000");
    }

    function test_parityAtEveryStoppingPoint_testPreset() public {
        _parityMatrix(TEST_BPS, "r=2000");
    }

    function _parityMatrix(uint256 reserveBps, string memory preset) internal {
        for (uint256 i = 0; i < STOPS.length; i++) {
            string memory label = string.concat(preset, " @", vm.toString(STOPS[i]), "%");
            Rig memory r = _rig(reserveBps, 0);
            _buyPercent(r, STOPS[i]);

            uint256 priceWad = _marginalPriceWad(r.instance);
            (uint256 tokensToPool, uint256 ethToPool) = _graduate(r, 0);

            _assertParity(tokensToPool, ethToPool, priceWad, label);
            _assertPoolInitializedAtParity(r, priceWad, label);

            // Nothing is left behind on the instance: no unowned coin overhang, no stranded ETH.
            assertEq(r.instance.balanceOf(address(r.instance)), 0, string.concat(label, ": coin left on instance"));
            assertEq(address(r.instance).balance, 0, string.concat(label, ": ETH left on instance"));
            assertTrue(r.instance.graduated(), string.concat(label, ": did not graduate"));
        }
    }

    /// @notice The anchor cell. At a full sale the derived coin side must reproduce the create-time
    ///         `liquidityReserve` exactly-ish: the pole is solved at create so the curve's end price IS
    ///         the pool's opening price, which makes the identity algebraic rather than numerical.
    function test_fullSaleReproducesTheCreateTimeReserve() public {
        Rig memory r = _rig(PROD_BPS, 0);
        _buyPercent(r, 100);
        uint256 reserveAtCreate = r.instance.liquidityReserve();

        (uint256 tokensToPool,) = _graduate(r, 0);

        uint256 diff = tokensToPool > reserveAtCreate ? tokensToPool - reserveAtCreate : reserveAtCreate - tokensToPool;
        // 1e-4 relative: the pole is solved to 1e-6 and the raise itself is an integral of a floored
        // integrand, so the two sides agree to well within a basis point but not to the wei.
        assertLe(diff * 10_000, reserveAtCreate, "full-sale coin side diverged from liquidityReserve");
    }

    // ── The clamp ─────────────────────────────────────────────────────────────────────────────────

    /// @notice A clamp that fires everywhere is as wrong as one that never fires. Below the deficit band
    ///         the pool takes the whole LP share of the raise and coin is burned; inside it the coin
    ///         runs out first, the ETH is clamped to what that coin is worth at the curve price, and
    ///         nothing is left to burn.
    function test_clampEngagesOnlyInsideTheDeficitBand() public {
        // Below the band: full LP-share ETH into the pool, a real burn, no diverted excess.
        Rig memory below = _rig(PROD_BPS, 0);
        _buyPercent(below, 75);
        uint256 raiseBelow = below.instance.reserve();
        vm.recordLogs();
        vm.prank(owner);
        below.instance.deployLiquidity(0);
        Vm.Log[] memory logsBelow = vm.getRecordedLogs();
        (uint256 poolEthBelow, uint256 excessBelow, uint256 carveBelow) =
            _divertEvent(logsBelow, address(below.instance));
        (,, uint256 burnedBelow) = _burnEvent(logsBelow, address(below.instance));
        assertEq(excessBelow, 0, "the clamp engaged below the deficit band");
        assertEq(carveBelow, 0, "no carve was requested");
        assertGt(burnedBelow, 0, "nothing was burned below the deficit band");
        // The pool really did take the whole LP share when the clamp stayed out of the way.
        assertEq(
            poolEthBelow,
            raiseBelow - raiseBelow / 100 - (raiseBelow * 19) / 100,
            "the pool did not take the full LP share below the band"
        );

        // Inside the band: the coin runs out, so the ETH is clamped and nothing is left to burn.
        Rig memory inside = _rig(PROD_BPS, 0);
        _buyPercent(inside, 95);
        uint256 raiseInside = inside.instance.reserve();
        vm.recordLogs();
        vm.prank(owner);
        inside.instance.deployLiquidity(0);
        Vm.Log[] memory logsInside = vm.getRecordedLogs();
        (uint256 poolEthInside, uint256 excessInside,) = _divertEvent(logsInside, address(inside.instance));
        (,, uint256 burnedInside) = _burnEvent(logsInside, address(inside.instance));
        assertGt(excessInside, 0, "the clamp did not engage inside the deficit band");
        assertEq(burnedInside, 0, "coin was burned while the pool was short of parity coin");
        assertLt(poolEthInside, (raiseInside * 80) / 100, "clamped ETH was not actually withheld");

        // And the preset is what decides: the same 95% stop on the 2000 bps preset is affordable.
        Rig memory feasible = _rig(TEST_BPS, 0);
        _buyPercent(feasible, 95);
        vm.recordLogs();
        vm.prank(owner);
        feasible.instance.deployLiquidity(0);
        (, uint256 excessFeasible,) = _divertEvent(vm.getRecordedLogs(), address(feasible.instance));
        assertEq(excessFeasible, 0, "the clamp engaged on a preset where parity is affordable");
    }

    // ── Conservation ──────────────────────────────────────────────────────────────────────────────

    /// @notice No ETH is stranded. Inside the deficit band the pool takes less than the LP share, so the
    ///         remainder must land on the same 1/19/80 rail the raise itself uses — never on the
    ///         instance, where it would be a second unowned overhang.
    function test_ethIsConservedInTheDeficitBand() public {
        Rig memory r = _rig(PROD_BPS, 0);
        _buyPercent(r, 95);
        uint256 raise = r.instance.reserve();

        uint256 treasuryBefore = treasury.balance;
        uint256 vaultBefore = address(r.vault).balance;
        uint256 creatorBefore = owner.balance;

        (, uint256 ethToPool) = _graduate(r, 0);

        // The mock venue settles nothing, so the pool's ETH stays on the deployer module — that balance
        // IS the pool leg here. Everything else went out through the split.
        uint256 accounted = address(r.deployer).balance + (treasury.balance - treasuryBefore)
            + (address(r.vault).balance - vaultBefore) + (owner.balance - creatorBefore);

        assertEq(address(r.deployer).balance, ethToPool, "the module did not retain exactly the pool leg");
        assertEq(accounted, raise, "graduation ETH did not sum to the raise");
        assertEq(address(r.instance).balance, 0, "ETH was stranded on the instance");
    }

    /// @notice No coin is stranded. Every coin the instance was free to place is either in the pool or
    ///         gone; buyers keep exactly what they bought.
    function test_coinIsConservedAndTheInstanceIsEmpty() public {
        Rig memory r = _rig(PROD_BPS, 0);
        uint256 bought = _buyPercent(r, 60);

        vm.recordLogs();
        vm.prank(owner);
        r.instance.deployLiquidity(0);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        (uint256 availableCoin, uint256 tokensToPool, uint256 burned) = _burnEvent(logs, address(r.instance));

        assertEq(availableCoin - tokensToPool, burned, "the burn event's components do not sum");
        assertEq(r.instance.totalSupply() + burned, MAX_SUPPLY, "burned coin did not leave total supply");
        assertEq(r.instance.balanceOf(address(r.instance)), 0, "coin stranded on the instance");
        assertEq(r.instance.balanceOf(address(r.deployer)), tokensToPool, "the pool leg's coin did not travel");
        assertEq(r.instance.balanceOf(buyer), bought, "a buyer's position moved");
        assertEq(
            r.instance.balanceOf(address(r.deployer)) + r.instance.balanceOf(buyer),
            r.instance.totalSupply(),
            "coin exists outside the pool and its buyers"
        );
    }

    // ── The carve ─────────────────────────────────────────────────────────────────────────────────

    /// @notice Parity is measured against the ETH the pool ACTUALLY receives. A creator carve therefore
    ///         makes a SMALLER pool at the right price — it can never reopen the gap under the curve.
    function test_carveShrinksThePoolWithoutMovingItsPrice() public {
        Rig memory r = _rig(PROD_BPS, 10_000);
        _buyPercent(r, 50);
        uint256 raise = r.instance.reserve();

        // The factory seam is mocked: the bracket math itself is the factory's and is tested there.
        // A carve of 30% of the raise is far beyond anything the brackets would grant, which is the
        // point — it is the largest carve the split can physically absorb out of the LP 80.
        uint256 carve = (raise * 30) / 100;
        vm.mockCall(
            r.instance.factory(),
            abi.encodeWithSelector(ICarveParamsSource.effectiveCarveEth.selector),
            abi.encode(carve)
        );

        uint256 priceWad = _marginalPriceWad(r.instance);
        (uint256 tokensToPool, uint256 ethToPool) = _graduate(r, 10_000);

        _assertParity(tokensToPool, ethToPool, priceWad, "carve");
        _assertPoolInitializedAtParity(r, priceWad, "carve");
        assertLt(ethToPool, (raise * 80) / 100, "the carve did not actually shrink the pool");
    }

    // ── Burn side effects ─────────────────────────────────────────────────────────────────────────

    /// @notice Burning instance-held coin has no NFT-side effect. `_initializeDN404` flags the initial
    ///         supply owner — this instance — as NFT-skipping, so it owns no ids, the burn walks no ids,
    ///         and already-issued buyer ids are untouched by the lower `idLimit` a smaller total supply
    ///         implies (that bound applies to FUTURE mints only).
    function test_burnDoesNotDisturbIssuedIds() public {
        Rig memory r = _rig(PROD_BPS, 0);

        // A buyer who DOES take ids, so there is something to disturb.
        uint256 amount = (r.maxBondingSupply * 5) / 100;
        vm.deal(buyer, 1000 ether);
        vm.prank(buyer);
        r.instance.buyBonding{ value: 1000 ether }(amount, type(uint256).max, true, bytes(""), bytes(""), 0);

        uint256 idsBefore = r.instance.balanceOf(buyer) / UNIT;
        assertGt(idsBefore, 0, "the buyer took no ids");

        vm.recordLogs();
        vm.prank(owner);
        r.instance.deployLiquidity(0);
        (,, uint256 burned) = _burnEvent(vm.getRecordedLogs(), address(r.instance));

        assertGt(burned, 0, "nothing was burned, so the assertion below is vacuous");
        assertEq(r.instance.balanceOf(buyer) / UNIT, idsBefore, "the burn moved a buyer's id count");
        assertEq(r.instance.balanceOf(buyer), amount, "the burn moved a buyer's balance");
    }
}
