// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC404Factory } from "../../src/factories/erc404/ERC404Factory.sol";
import { ERC404BondingInstance } from "../../src/factories/erc404/ERC404BondingInstance.sol";
import { ERC404BondingOps } from "../../src/factories/erc404/ERC404BondingOps.sol";
import { LaunchManager } from "../../src/factories/erc404/LaunchManager.sol";
import { CurveParamsComputer } from "../../src/factories/erc404/CurveParamsComputer.sol";
import { BondingCurveMath } from "../../src/factories/erc404/libraries/BondingCurveMath.sol";
import { MockMasterRegistry } from "../mocks/MockMasterRegistry.sol";
import { FreeMintParams } from "../../src/interfaces/IFactoryTypes.sol";
import { GatingScope } from "../../src/gating/IGatingModule.sol";
import { ComponentRegistry } from "../../src/registry/ComponentRegistry.sol";
import { ILiquidityDeployerModule } from "../../src/interfaces/ILiquidityDeployerModule.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { ICreateX, CREATEX } from "../../src/shared/CreateXConstants.sol";
import { CREATEX_BYTECODE } from "createx-forge/script/CreateX.d.sol";

contract MockVaultFMS {
    function supportsCapability(bytes32) external pure returns (bool) {
        return true;
    }
    receive() external payable { }
}

contract MockDeployerFMS is ILiquidityDeployerModule {
    function deployLiquidity(ILiquidityDeployerModule.DeployParams calldata) external payable override { }

    function metadataURI() external view override returns (string memory) {
        return "";
    }
    function setMetadataURI(string calldata) external override { }
}

/// @notice The free-mint tranche is handed out without crediting `totalBondingSupply` or `reserve`,
///         but `sellBonding` redeems it against `reserve` like any other coin. These tests state the
///         two things that should hold and do not.
///
///         Fixture is the SHIPPED STANDARD preset (`script/LaunchPresets.sol`): targetETH 25 ether,
///         unitPerNFT 1e5, liquidityReserveBps 1000. nftCount 100, freeMint.allocation 10, so
///         maxSupply = 1e25, liquidityReserve = 1e24, allocation = 1e24 and the bonding span is
///         M = 8e24 — the free tranche is 12.5% of M. No protocol treasury is set, so the 1% exit
///         fee is zero and every number below is pure curve arithmetic.
contract FreeMintCurveSolvencyTest is Test {
    uint256 internal _saltCounter;

    ERC404Factory factory;
    LaunchManager launchMgr;
    CurveParamsComputer curveComp;
    MockMasterRegistry mockRegistry;
    MockVaultFMS mockVault;
    ComponentRegistry componentRegistry;
    MockDeployerFMS mockDeployer;

    address protocol = makeAddr("protocol");
    address creator = makeAddr("creator");
    address buyerEarly = makeAddr("buyerEarly");
    address buyerLate = makeAddr("buyerLate");
    address hub = makeAddr("hub");
    address mockGMR = makeAddr("gmr");

    uint8 constant PRESET_ID = 1;
    uint256 constant NFT_COUNT = 100;
    uint256 constant FREE_ALLOC = 10;

    function _nextSalt() internal returns (bytes32) {
        _saltCounter++;
        return bytes32(abi.encodePacked(address(factory), uint8(0x00), bytes11(uint88(_saltCounter))));
    }

    function setUp() public {
        vm.etch(CREATEX, CREATEX_BYTECODE);
        vm.startPrank(protocol);

        mockRegistry = new MockMasterRegistry();
        mockVault = new MockVaultFMS();
        launchMgr = new LaunchManager(protocol);
        curveComp = new CurveParamsComputer(protocol);
        mockDeployer = new MockDeployerFMS();

        ComponentRegistry impl = new ComponentRegistry();
        address proxy = LibClone.deployERC1967(address(impl));
        componentRegistry = ComponentRegistry(proxy);
        componentRegistry.initialize(protocol);
        componentRegistry.approveComponent(address(curveComp), bytes32("curve_computer"), "Curve");
        componentRegistry.approveComponent(address(mockDeployer), keccak256("liquidity"), "Deployer");

        // The shipped STANDARD preset, verbatim.
        launchMgr.setPreset(
            PRESET_ID,
            LaunchManager.Preset({
                targetETH: 25 ether,
                unitPerNFT: 100_000,
                liquidityReserveBps: 1000,
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
                globalMessageRegistry: mockGMR,
                launchManager: address(launchMgr),
                componentRegistry: address(componentRegistry)
            })
        );

        vm.stopPrank();
    }

    function _deploy(uint256 alloc) internal returns (ERC404BondingInstance inst) {
        vm.prank(creator);
        address a = factory.createInstance(
            ERC404Factory.CreateParams({
                salt: _nextSalt(),
                owner: creator,
                nftCount: NFT_COUNT,
                presetId: PRESET_ID,
                vault: address(mockVault),
                name: string.concat("Curve", vm.toString(_saltCounter)),
                symbol: "CRV",
                styleUri: "",
                tokenBaseURI: "",
                stakingModule: address(0),
                declaredMaxAllowanceBps: 0
            }),
            "ipfs://meta",
            address(mockDeployer),
            address(0), // NO gating module: claimFreeMint is open to any address
            FreeMintParams({ allocation: alloc, scope: GatingScope.BOTH })
        );
        inst = ERC404BondingInstance(payable(a));
        vm.startPrank(creator);
        inst.setBondingOpenTime(block.timestamp + 1);
        vm.warp(block.timestamp + 2);
        inst.setBondingActive(true);
        vm.stopPrank();
    }

    function _maxBonding(ERC404BondingInstance inst) internal view returns (uint256) {
        return inst.maxSupply() - inst.liquidityReserve() - (inst.freeMintAllocation() * inst.unit());
    }

    function _curve(ERC404BondingInstance inst) internal view returns (BondingCurveMath.Params memory p) {
        (uint256 k, uint256 pole, uint256 norm) = inst.curveParams();
        p = BondingCurveMath.Params({ kCoeff: k, poleWad: pole, normalizationFactor: norm });
    }

    function _buy(ERC404BondingInstance inst, address who, uint256 amount) internal returns (uint256 cost) {
        cost = BondingCurveMath.calculateCost(_curve(inst), inst.totalBondingSupply(), amount);
        vm.deal(who, cost);
        vm.prank(who);
        inst.buyBonding{ value: cost }(amount, cost, false, bytes(""), bytes(""), 0);
    }

    /// @dev Claim the whole free tranche from `n` fresh addresses and sweep it to `hub`.
    function _claimAllFreeAndSweep(ERC404BondingInstance inst, uint256 n) internal returns (uint256 swept) {
        uint256 unit = inst.unit();
        for (uint256 i = 0; i < n; i++) {
            address claimer = address(uint160(0x100000 + i));
            vm.prank(claimer);
            inst.claimFreeMint("");
            vm.prank(claimer);
            inst.transfer(hub, unit);
            swept += unit;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 1. The reserve that paid buyers funded is drained by coin nobody paid for.
    // ─────────────────────────────────────────────────────────────────────────
    function test_freeMintDrainsTheReservePaidBuyersFunded() public {
        ERC404BondingInstance inst = _deploy(FREE_ALLOC);
        uint256 M = _maxBonding(inst);

        uint256 paidIn = _buy(inst, buyerEarly, M);
        assertEq(inst.reserve(), paidIn, "reserve should equal what the curve was paid");
        emit log_named_decimal_uint("ETH paid in by curve buyers", paidIn, 18);

        // The free tranche moves no ETH and does not touch totalBondingSupply.
        uint256 supplyBefore = inst.totalBondingSupply();
        uint256 reserveBefore = inst.reserve();
        uint256 swept = _claimAllFreeAndSweep(inst, FREE_ALLOC);
        assertEq(inst.totalBondingSupply(), supplyBefore, "claimFreeMint moved totalBondingSupply");
        assertEq(inst.reserve(), reserveBefore, "claimFreeMint moved reserve");

        // ...yet it sells straight back into that reserve, at the top of the curve.
        vm.prank(hub);
        inst.sellBonding(swept, 0, bytes32(0), bytes(""), 0);

        emit log_named_decimal_uint("ETH extracted by free claimers", hub.balance, 18);
        emit log_named_decimal_uint("reserve left for paid buyers", inst.reserve(), 18);
        emit log_named_decimal_uint("shortfall", paidIn - inst.reserve(), 18);

        // The curve's own solvency statement: every wei a buyer paid in is still behind the coin
        // the curve sold them. Nobody but a curve buyer has put ETH in or taken ETH out here.
        assertGe(
            inst.reserve(), paidIn, "reserve fell below what curve buyers paid in, with no curve buyer having sold"
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. The loss lands on the LAST cohort, not spread across holders.
    //    Absent any other seller, the most recent buyer can always exit at entry.
    // ─────────────────────────────────────────────────────────────────────────
    function test_lastPaidCohortCannotExitAtItsEntryPrice() public {
        ERC404BondingInstance inst = _deploy(FREE_ALLOC);
        uint256 M = _maxBonding(inst);

        uint256 paidEarly = _buy(inst, buyerEarly, M / 2);
        uint256 paidLate = _buy(inst, buyerLate, M / 2);
        emit log_named_decimal_uint("early cohort paid", paidEarly, 18);
        emit log_named_decimal_uint("late cohort paid", paidLate, 18);

        uint256 swept = _claimAllFreeAndSweep(inst, FREE_ALLOC);
        vm.prank(hub);
        inst.sellBonding(swept, 0, bytes32(0), bytes(""), 0);

        // The late cohort is first in the queue after the free dump and still cannot get out whole.
        uint256 before = buyerLate.balance;
        vm.prank(buyerLate);
        inst.sellBonding(M / 2, 0, bytes32(0), bytes(""), 0);
        uint256 got = buyerLate.balance - before;

        emit log_named_decimal_uint("late cohort recovered", got, 18);
        emit log_named_decimal_uint("late cohort loss", paidLate - got, 18);

        assertGe(got, paidLate, "the last paid cohort cannot exit at the price it entered at");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. Control: with the tranche disabled the same script is solvent, so the
    //    failures above are the free mint and nothing else in the fixture.
    // ─────────────────────────────────────────────────────────────────────────
    function test_control_noFreeMint_lastCohortExitsWhole() public {
        ERC404BondingInstance inst = _deploy(0);
        uint256 M = _maxBonding(inst);

        _buy(inst, buyerEarly, M / 2);
        uint256 paidLate = _buy(inst, buyerLate, M / 2);

        uint256 before = buyerLate.balance;
        vm.prank(buyerLate);
        inst.sellBonding(M / 2, 0, bytes32(0), bytes(""), 0);
        uint256 got = buyerLate.balance - before;

        assertGe(got, paidLate, "control: last cohort must exit whole when no free tranche exists");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. The tail of the paid position is not merely underwater — it is unsellable.
    //    `totalBondingSupply` never counted the free tranche, so once it is dumped
    //    the counter is short by exactly that much and the residual coin exceeds
    //    the supply the curve believes exists.
    // ─────────────────────────────────────────────────────────────────────────
    function test_residualPaidCoinIsUnsellable() public {
        ERC404BondingInstance inst = _deploy(FREE_ALLOC);
        uint256 M = _maxBonding(inst);

        _buy(inst, buyerEarly, M / 2);
        _buy(inst, buyerLate, M / 2);

        uint256 swept = _claimAllFreeAndSweep(inst, FREE_ALLOC);
        vm.prank(hub);
        inst.sellBonding(swept, 0, bytes32(0), bytes(""), 0);
        vm.prank(buyerLate);
        inst.sellBonding(M / 2, 0, bytes32(0), bytes(""), 0);

        emit log_named_uint("early cohort still holds (coin)", inst.balanceOf(buyerEarly));
        emit log_named_uint("totalBondingSupply the curve believes", inst.totalBondingSupply());

        // Coin the curve sold for ETH now exceeds the supply the curve is tracking.
        assertLe(
            inst.balanceOf(buyerEarly),
            inst.totalBondingSupply(),
            "paid coin outstanding exceeds totalBondingSupply: the tail cannot be sold at all"
        );
    }
}
