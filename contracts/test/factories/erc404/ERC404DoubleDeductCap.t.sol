// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC404Factory } from "../../../src/factories/erc404/ERC404Factory.sol";
import { ERC404BondingInstance } from "../../../src/factories/erc404/ERC404BondingInstance.sol";
import { ERC404BondingOps } from "../../../src/factories/erc404/ERC404BondingOps.sol";
import { LaunchManager } from "../../../src/factories/erc404/LaunchManager.sol";
import { CurveParamsComputer } from "../../../src/factories/erc404/CurveParamsComputer.sol";
import { BondingCurveMath } from "../../../src/factories/erc404/libraries/BondingCurveMath.sol";
import { MockMasterRegistry } from "../../mocks/MockMasterRegistry.sol";
import { FreeMintParams } from "../../../src/interfaces/IFactoryTypes.sol";
import { GatingScope } from "../../../src/gating/IGatingModule.sol";
import { ComponentRegistry } from "../../../src/registry/ComponentRegistry.sol";
import { ILiquidityDeployerModule } from "../../../src/interfaces/ILiquidityDeployerModule.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { ICreateX, CREATEX } from "../../../src/shared/CreateXConstants.sol";
import { CREATEX_BYTECODE } from "createx-forge/script/CreateX.d.sol";

contract MockVaultDDC {
    function supportsCapability(bytes32) external pure returns (bool) {
        return true;
    }
    receive() external payable { }
}

contract MockDeployerDDC is ILiquidityDeployerModule {
    function deployLiquidity(ILiquidityDeployerModule.DeployParams calldata) external payable override { }

    function metadataURI() external view override returns (string memory) {
        return "";
    }
    function setMetadataURI(string calldata) external override { }
}

/**
 * @title ERC404DoubleDeductCapTest
 * @notice One bonding-cap definition, shared by the curve and the instance.
 *
 *         The free-mint allocation `F` reserves `F` NFTs' worth of coin that is handed out at zero cost.
 *         The bonding cap is therefore `maxSupply − liquidityReserve − F·unit`: full supply, less the
 *         liquidity reserve (computed on the FULL supply, the basis graduation uses), less the free-mint
 *         allocation, removed exactly once. `buyBonding`/`sellBonding` already enforce that expression;
 *         this file pins that the curve the factory builds is scaled to raise `targetETH` across the SAME
 *         span, and that no `F < N` can construct an instance whose cap underflows.
 *
 *         Two properties, from the two impacts the single-definition fix closes:
 *           1. Raise parity — a fully-sold curve raises `targetETH`. The earlier build scaled the curve
 *              over `(N − F)·unit·(1 − r)` while the instance capped at `N·unit·(1 − r) − F·unit`; the
 *              `F·r·unit` gap left a fully-sold curve short of target (measured 7.83% at N=10000, F=1000,
 *              r=0.10). Reproduced here from the OLD span formula, then shown closed by the shipped path.
 *           2. No underflowing cap — for `F` large enough that `F·unit > maxSupply − liquidityReserve`
 *              the cap expression underflows (panic 0x11) at the first buy/sell, bricking the instance.
 *              The create-time guard refuses exactly those allocations.
 */
contract ERC404DoubleDeductCapTest is Test {
    using BondingCurveMath for BondingCurveMath.Params;

    uint256 internal _saltCounter;

    ERC404Factory factory;
    LaunchManager launchMgr;
    CurveParamsComputer curveComp;
    MockMasterRegistry mockRegistry;
    MockVaultDDC mockVault;
    ComponentRegistry componentRegistry;
    MockDeployerDDC mockDeployer;

    address protocol = makeAddr("protocol");
    address creator = makeAddr("creator");
    address buyer = makeAddr("buyer");

    // r = 0.10 — the shipping reserve preset, where the double-deduct is largest relative to the raise.
    uint8 constant PRESET_ID = 1;
    uint256 constant TARGET_ETH = 10 ether;
    uint256 constant UNIT_PER_NFT = 1; // unit = 1e18
    uint256 constant UNIT = UNIT_PER_NFT * 1e18;
    uint256 constant RESERVE_BPS = 1000;

    function _nextSalt() internal returns (bytes32) {
        _saltCounter++;
        return bytes32(abi.encodePacked(address(factory), uint8(0x00), bytes11(uint88(_saltCounter))));
    }

    function setUp() public {
        vm.etch(CREATEX, CREATEX_BYTECODE);
        vm.startPrank(protocol);

        mockRegistry = new MockMasterRegistry();
        mockVault = new MockVaultDDC();
        launchMgr = new LaunchManager(protocol);
        curveComp = new CurveParamsComputer(protocol);
        mockDeployer = new MockDeployerDDC();

        ComponentRegistry impl = new ComponentRegistry();
        address proxy = LibClone.deployERC1967(address(impl));
        componentRegistry = ComponentRegistry(proxy);
        componentRegistry.initialize(protocol);
        componentRegistry.approveComponent(address(curveComp), bytes32("curve_computer"), "Curve");
        componentRegistry.approveComponent(address(mockDeployer), keccak256("liquidity"), "Deployer");

        launchMgr.setPreset(
            PRESET_ID,
            LaunchManager.Preset({
                targetETH: TARGET_ETH,
                unitPerNFT: UNIT_PER_NFT,
                liquidityReserveBps: RESERVE_BPS,
                curveComputer: address(curveComp),
                active: true
            })
        );

        ERC404BondingInstance instanceImpl = new ERC404BondingInstance(address(new ERC404BondingOps()));
        factory = new ERC404Factory(
            ERC404Factory.CoreConfig({
                implementation: address(instanceImpl),
                masterRegistry: address(mockRegistry),
                protocol: protocol,
                weth: address(0xBEEF)
            }),
            ERC404Factory.ModuleConfig({
                globalMessageRegistry: makeAddr("gmr"),
                launchManager: address(launchMgr),
                componentRegistry: address(componentRegistry)
            })
        );

        vm.stopPrank();
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    function _createParams(uint256 nftCount) internal returns (ERC404Factory.CreateParams memory) {
        return ERC404Factory.CreateParams({
            salt: _nextSalt(),
            owner: creator,
            nftCount: nftCount,
            presetId: PRESET_ID,
            vault: address(mockVault),
            name: string.concat("DDC", vm.toString(_saltCounter)),
            symbol: "DDC",
            styleUri: "",
            tokenBaseURI: "",
            stakingModule: address(0),
            declaredMaxAllowanceBps: 0
        });
    }

    function _create(uint256 nftCount, uint256 alloc) internal returns (ERC404BondingInstance) {
        vm.prank(creator);
        address inst = factory.createInstance(
            _createParams(nftCount),
            "ipfs://meta",
            address(mockDeployer),
            address(0),
            FreeMintParams({ allocation: alloc, scope: GatingScope.BOTH })
        );
        return ERC404BondingInstance(payable(inst));
    }

    /// @dev The cap the instance actually enforces, from its stored getters — the byte-identical
    ///      expression `buyBonding`/`sellBonding` gate on.
    function _instanceCap(ERC404BondingInstance inst) internal view returns (uint256) {
        return inst.maxSupply() - inst.liquidityReserve() - inst.freeMintAllocation() * inst.unit();
    }

    function _curveOf(ERC404BondingInstance inst) internal view returns (BondingCurveMath.Params memory p) {
        (uint256 kCoeff, uint256 poleWad, uint256 normalizationFactor) = inst.curveParams();
        p = BondingCurveMath.Params({ kCoeff: kCoeff, poleWad: poleWad, normalizationFactor: normalizationFactor });
    }

    // ── Property 1: the curve span and the instance cap are one value; a full sale raises targetETH ──

    /// @notice The curve the factory built is scaled to raise `targetETH` across EXACTLY the cap the
    ///         instance enforces — proving span == cap (acceptance c) and full-sale == target (a) at once.
    function test_curveSpanEqualsInstanceCap_andFullSaleRaisesTarget() public {
        ERC404BondingInstance inst = _create(10_000, 1000);

        uint256 cap = _instanceCap(inst);
        assertGt(cap, 0, "cap must be positive");

        // The curve raises targetETH exactly at the instance cap: this is only true if the span the
        // curve was scaled over equals the cap. (Pre-fix the curve was scaled over a larger span, so it
        // reached target only beyond the cap.)
        uint256 raiseAtCap = _curveOf(inst).calculateCost(0, cap);
        assertApproxEqRel(raiseAtCap, TARGET_ETH, 0.001e18, "fixed curve does not raise target at the cap");
    }

    /// @notice The OLD span definition — `computeCurveParams(N − F, ...)`, the pre-fix call — scaled the
    ///         curve over `(N − F)·unit·(1 − r)`, so integrating it only up to the instance cap falls
    ///         short of target. Documents the 7.83% shortfall the single-definition fix closes.
    function test_oldSpanFallsShortAtCap_fixClosesIt() public {
        ERC404BondingInstance inst = _create(10_000, 1000);
        uint256 cap = _instanceCap(inst);

        // Pre-fix curve: the free mint was removed a second time inside the computer via curveNftCount.
        BondingCurveMath.Params memory oldCurve =
            curveComp.computeCurveParams(10_000 - 1000, TARGET_ETH, UNIT_PER_NFT, RESERVE_BPS);
        uint256 oldRaiseAtCap = oldCurve.calculateCost(0, cap);

        assertLt(oldRaiseAtCap, TARGET_ETH, "old span should under-raise at the cap");
        uint256 shortfallBps = ((TARGET_ETH - oldRaiseAtCap) * 10_000) / TARGET_ETH;
        // Measured ~783 bps for this configuration; bracket it rather than pin the wei.
        assertGt(shortfallBps, 700, "old-span shortfall smaller than the measured defect");
        assertLt(shortfallBps, 860, "old-span shortfall larger than the measured defect");

        // The shipped path closes it: the same cap now raises target within rounding.
        uint256 fixedRaiseAtCap = _curveOf(inst).calculateCost(0, cap);
        assertApproxEqRel(fixedRaiseAtCap, TARGET_ETH, 0.001e18, "fix did not close the shortfall");
    }

    /// @notice End-to-end: buying the entire cap on the live instance banks ~targetETH in the reserve.
    function test_fullSale_banksTargetEthInReserve() public {
        ERC404BondingInstance inst = _create(10_000, 1000);
        uint256 cap = _instanceCap(inst);

        vm.startPrank(creator);
        inst.setBondingOpenTime(block.timestamp + 1);
        inst.setBondingActive(true);
        vm.stopPrank();
        vm.warp(block.timestamp + 2);

        vm.deal(buyer, 100 ether);
        vm.startPrank(buyer);
        inst.setSkipNFT(true); // buying thousands of ids' worth; the id side is not under test
        inst.buyBonding{ value: 100 ether }(cap, type(uint256).max, false, bytes(""), bytes(""), 0);
        vm.stopPrank();

        assertEq(inst.totalBondingSupply(), cap, "did not sell the whole cap");
        assertApproxEqRel(inst.reserve(), TARGET_ETH, 0.001e18, "a fully-sold curve did not raise target");
    }

    /// @notice A zero free mint is unchanged: cap == maxSupply − liquidityReserve and the curve raises
    ///         target across it, exactly as before the free-mint deduction path existed.
    function test_zeroFreeMint_isUnchanged() public {
        ERC404BondingInstance inst = _create(10_000, 0);
        uint256 cap = _instanceCap(inst);
        assertEq(cap, inst.maxSupply() - inst.liquidityReserve(), "zero-alloc cap changed");
        assertApproxEqRel(_curveOf(inst).calculateCost(0, cap), TARGET_ETH, 0.001e18, "zero-alloc raise off target");
    }

    // ── Property 2: no F < N can construct an underflowing cap ───────────────────────────────────────

    /// @notice The exact brick input from the report: N=100, F=95, r=0.10. Pre-fix `create()` succeeded
    ///         (F < N) and the cap `maxSupply − liquidityReserve − F·unit = (90 − 95)·unit` underflowed
    ///         (panic 0x11) at the first buy/sell, killing the instance. The guard refuses it at create.
    function test_brickInput_isRefusedAtCreate() public {
        // The pre-fix cap arithmetic underflows for this input — the condition the guard now gates on.
        uint256 maxSupply = 100 * UNIT;
        uint256 liquidityReserve = (maxSupply * RESERVE_BPS) / 10_000; // 10 * UNIT
        assertGt(95 * UNIT, maxSupply - liquidityReserve, "brick precondition not reproduced");

        vm.prank(creator);
        vm.expectRevert(ERC404Factory.FreeMintAllocationExceedsBondingCap.selector);
        factory.createInstance(
            _createParams(100),
            "ipfs://meta",
            address(mockDeployer),
            address(0),
            FreeMintParams({ allocation: 95, scope: GatingScope.BOTH })
        );
    }

    /// @notice The boundary `F·unit == maxSupply − liquidityReserve` (F=90 at N=100, r=0.10) yields a
    ///         zero-length cap. The guard uses strict `>`, so it passes the guard, but the curve refuses a
    ///         zero span (`ReferenceAreaZero`) — so create still reverts and no dead instance is born.
    function test_zeroLengthCap_revertsAtCreate() public {
        vm.prank(creator);
        vm.expectRevert(CurveParamsComputer.ReferenceAreaZero.selector);
        factory.createInstance(
            _createParams(100),
            "ipfs://meta",
            address(mockDeployer),
            address(0),
            FreeMintParams({ allocation: 90, scope: GatingScope.BOTH })
        );
    }

    /// @notice The largest allocation the guard admits still builds a healthy, non-underflowing instance
    ///         whose curve raises target at the cap — the guard is not over-tight.
    function test_largestAdmissibleAllocation_isHealthy() public {
        // N=100, r=0.10 → post-reserve supply = 90·unit; F=89 leaves a one-unit cap that is still valid.
        ERC404BondingInstance inst = _create(100, 89);
        uint256 cap = _instanceCap(inst);
        assertEq(cap, UNIT, "cap should be exactly one unit");
        assertApproxEqRel(_curveOf(inst).calculateCost(0, cap), TARGET_ETH, 0.001e18, "healthy curve off target");

        vm.startPrank(creator);
        inst.setBondingOpenTime(block.timestamp + 1);
        inst.setBondingActive(true);
        vm.stopPrank();
        vm.warp(block.timestamp + 2);

        // The first buy and a sell back both execute — no panic 0x11 at the cap.
        vm.deal(buyer, 100 ether);
        vm.startPrank(buyer);
        inst.setSkipNFT(true);
        inst.buyBonding{ value: 100 ether }(cap, type(uint256).max, false, bytes(""), bytes(""), 0);
        inst.sellBonding(cap, 0, bytes32(0), bytes(""), 0);
        vm.stopPrank();
        assertEq(inst.totalBondingSupply(), 0, "sell back to empty failed");
    }

    /// @notice A range of admissible allocations: every `F` the guard admits produces a curve that raises
    ///         target at its cap and a cap that does not underflow.
    function test_admissibleAllocations_allRaiseTargetAtCap() public {
        uint256[5] memory allocs = [uint256(0), 1000, 4000, 7000, 8900];
        for (uint256 i = 0; i < allocs.length; i++) {
            ERC404BondingInstance inst = _create(10_000, allocs[i]);
            uint256 cap = _instanceCap(inst);
            assertGt(cap, 0, "cap underflowed or zero");
            assertApproxEqRel(
                _curveOf(inst).calculateCost(0, cap),
                TARGET_ETH,
                0.001e18,
                string.concat("alloc ", vm.toString(allocs[i]), ": curve off target at cap")
            );
        }
    }
}
