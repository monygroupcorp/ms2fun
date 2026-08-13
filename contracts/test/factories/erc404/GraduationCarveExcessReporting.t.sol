// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test, Vm } from "forge-std/Test.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { DN404Mirror } from "dn404/src/DN404Mirror.sol";

import { ERC404BondingInstance, ICarveParamsSource } from "../../../src/factories/erc404/ERC404BondingInstance.sol";
import { ERC404BondingOps } from "../../../src/factories/erc404/ERC404BondingOps.sol";
import { LiquidityDeployerModule } from "../../../src/factories/erc404/LiquidityDeployerModule.sol";
import { CurveParamsComputer } from "../../../src/factories/erc404/CurveParamsComputer.sol";
import { BondingCurveMath } from "../../../src/factories/erc404/libraries/BondingCurveMath.sol";

import { MockV4PoolManager } from "./ERC404GraduationSkipNFT.t.sol";
import { MockMasterRegistry } from "../../mocks/MockMasterRegistry.sol";
import { MockVault } from "../../mocks/MockVault.sol";

/**
 * @title GraduationCarveExcessReportingTest
 * @notice THE MONEY DOES NOT MOVE; ONLY THE REPORTING SPLITS.
 *
 *         Graduation diverts two different quantities out of the LP 80: the creator's carve, and the
 *         LP-share ETH the parity clamp could not place at the pool price. Both are tithed 80/19/1 on
 *         the same rail. They now travel to the deployer module as two `DeployParams` legs instead of
 *         one summed field, so the module can report them apart — `CreatorCarvePaid.requested` is the
 *         creator's request alone, which is the figure `declaredMaxAllowanceBps` is measured against,
 *         and the residue gets its own `GraduationExcessTithed`.
 *
 *         Two claims, and this file exists to hold both of them:
 *
 *         1. NOTHING CHANGED ABOUT THE DISTRIBUTION. The literals in
 *            `test_distributionIsBitIdenticalToTheMergedField` were measured by running this exact
 *            scenario against the merged-field implementation, before the split existed. They are a
 *            genuine before/after comparison, not a restatement of the code under test: if the module's
 *            split input stops being `carveEth + excessEth`, every one of them moves.
 *         2. THE EVENT NOW TELLS THE TRUTH. `test_creatorCarvePaidReportsTheCarveAlone` asserts the
 *            exact condition that does NOT hold when the two legs are merged.
 *
 *         The scenario: the shipping reserve preset, a curve stopped at 95% (inside the band where the
 *         coin parity calls for exceeds every coin the instance holds, so the clamp fires and leaves a
 *         residue), and a creator carve resolved at the collection's full declared allowance. Both legs
 *         are nonzero and neither is a multiple of the other.
 */
contract GraduationCarveExcessReportingTest is Test {
    address internal owner = address(0xA11CE);
    address internal buyer = address(0xB0B);
    address internal treasury = address(0x7EA);

    uint256 internal constant NFT_COUNT = 1000;
    uint256 internal constant UNIT = 1e18;
    uint256 internal constant MAX_SUPPLY = NFT_COUNT * UNIT;
    uint256 internal constant TARGET_ETH = 10 ether;

    /// @dev The shipping reserve preset. The clamp only has a deficit band to fire in at this preset.
    uint256 internal constant PROD_BPS = 1000;

    /// @dev The stop, and the carve as a fraction of the raise. Chosen together: at 95% sold the parity
    ///      coin side is unaffordable, and a carve of 1/50 of the raise is small enough to leave a
    ///      residue behind (a larger carve shrinks the pool's ETH until parity becomes affordable again
    ///      and the residue vanishes — see `test_fullSaleLeavesNoResidueAndReportsCarveOnly`).
    uint256 internal constant STOP_PCT = 95;
    uint256 internal constant CARVE_DIVISOR = 50;

    // ── Measured against the merged-field implementation, this scenario, before the split ──────────
    uint256 internal constant EXPECT_RAISE = 7_598_439_025_820_559_268;
    uint256 internal constant EXPECT_CARVE = 151_968_780_516_411_185;
    uint256 internal constant EXPECT_EXCESS = 510_164_570_769_613_602;
    uint256 internal constant EXPECT_PROTOCOL_FEE = 82_605_723_771_065_839;
    uint256 internal constant EXPECT_VAULT_CUT = 1_569_508_751_650_250_969;
    uint256 internal constant EXPECT_CREATOR_CUT = 529_706_681_028_819_831;
    uint256 internal constant EXPECT_ETH_FOR_POOL = 5_416_617_869_370_422_629;

    ERC404BondingInstance internal instance;
    LiquidityDeployerModule internal deployer;
    MockVault internal vault;

    // ── Rig ───────────────────────────────────────────────────────────────────────────────────────

    function _rig(uint16 declaredMaxAllowanceBps) internal {
        MockMasterRegistry registry = new MockMasterRegistry();
        vault = new MockVault();
        MockV4PoolManager pool = new MockV4PoolManager();
        deployer = new LiquidityDeployerModule(address(pool), address(0xBEEF), 3000, 60, address(registry));

        CurveParamsComputer curveComputer = new CurveParamsComputer(address(this));
        BondingCurveMath.Params memory curve = curveComputer.computeCurveParams(NFT_COUNT, TARGET_ETH, 1, PROD_BPS);

        vm.startPrank(owner);
        ERC404BondingInstance impl = new ERC404BondingInstance(address(new ERC404BondingOps()));
        instance = ERC404BondingInstance(payable(LibClone.clone(address(impl))));
        DN404Mirror mirror = new DN404Mirror(owner);
        instance.initialize(
            owner,
            address(vault),
            ERC404BondingInstance.BondingParams({
                maxSupply: MAX_SUPPLY,
                unit: UNIT,
                liquidityReserveBps: PROD_BPS,
                declaredMaxAllowanceBps: declaredMaxAllowanceBps,
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
        instance.initializeMetadata("Carve Reporting", "CARV", "", "", "");
        instance.setBondingOpenTime(block.timestamp + 1);
        instance.setBondingActive(true);
        vm.stopPrank();
        vm.warp(block.timestamp + 1);
    }

    /// @dev Buy `pct` percent of the curve's sellable supply. The buyer flags itself NFT-skipping: the
    ///      id side is not what is under test here.
    function _buyPercent(uint256 pct) internal {
        uint256 amount = ((MAX_SUPPLY - instance.liquidityReserve()) * pct) / 100;
        vm.deal(buyer, 1000 ether);
        vm.startPrank(buyer);
        instance.setSkipNFT(true);
        instance.buyBonding{ value: 1000 ether }(amount, type(uint256).max, false, bytes(""), bytes(""), 0);
        vm.stopPrank();
    }

    /// @dev Graduate taking the FULL declared allowance. The bracket math is the factory's and is
    ///      tested there; the seam is mocked so `carveRequestBps = 10_000` resolves to exactly
    ///      `raise / CARVE_DIVISOR` — i.e. the creator asks for, and receives, their whole declared
    ///      allowance. That is the case where a `requested` figure inflated by the clamp residue would
    ///      read as a creator who exceeded their declared allowance.
    function _graduateAtFullAllowance(uint256 carveDivisor) internal returns (Vm.Log[] memory logs) {
        uint256 carve = instance.reserve() / carveDivisor;
        vm.mockCall(
            instance.factory(), abi.encodeWithSelector(ICarveParamsSource.effectiveCarveEth.selector), abi.encode(carve)
        );
        vm.recordLogs();
        vm.prank(owner);
        instance.deployLiquidity(10_000);
        logs = vm.getRecordedLogs();
    }

    /// @dev `GraduationEthDiverted(ethToPool, excessEth, creatorCarveEth)` — the instance's side.
    function _divertEvent(Vm.Log[] memory logs)
        internal
        view
        returns (uint256 ethToPool, uint256 excessEth, uint256 carveEth)
    {
        bytes32 sig = keccak256("GraduationEthDiverted(uint256,uint256,uint256)");
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(instance) && logs[i].topics[0] == sig) {
                return abi.decode(logs[i].data, (uint256, uint256, uint256));
            }
        }
        revert("no GraduationEthDiverted");
    }

    /// @dev `CreatorCarvePaid(instance, creator, requested, paid)` — the module's side.
    function _carvePaidEvent(Vm.Log[] memory logs) internal view returns (bool seen, uint256 requested, uint256 paid) {
        bytes32 sig = keccak256("CreatorCarvePaid(address,address,uint256,uint256)");
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(deployer) && logs[i].topics[0] == sig) {
                assertEq(
                    logs[i].topics[1], bytes32(uint256(uint160(address(instance)))), "carve event names a stranger"
                );
                assertEq(logs[i].topics[2], bytes32(uint256(uint160(owner))), "carve event names a stranger as creator");
                (requested, paid) = abi.decode(logs[i].data, (uint256, uint256));
                seen = true;
            }
        }
    }

    /// @dev `GraduationExcessTithed(instance, amount)` — the module's side.
    function _excessTithedEvent(Vm.Log[] memory logs) internal view returns (bool seen, uint256 amount) {
        bytes32 sig = keccak256("GraduationExcessTithed(address,uint256)");
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(deployer) && logs[i].topics[0] == sig) {
                assertEq(
                    logs[i].topics[1], bytes32(uint256(uint160(address(instance)))), "excess event names a stranger"
                );
                amount = abi.decode(logs[i].data, (uint256));
                seen = true;
            }
        }
    }

    // ── 1. The money did not move ─────────────────────────────────────────────────────────────────

    /// @notice Every downstream figure is bit-identical to what the merged-field implementation paid on
    ///         this scenario. The constants were measured there; nothing in this file recomputes them.
    /// @dev This test must fail if the module's split input stops being the SUM of the two legs — that
    ///      is the whole risk this change carries, and this is the assertion that carries it.
    function test_distributionIsBitIdenticalToTheMergedField() public {
        _rig(10_000);
        _buyPercent(STOP_PCT);

        assertEq(instance.reserve(), EXPECT_RAISE, "the scenario's raise drifted; the literals below no longer apply");

        Vm.Log[] memory logs = _graduateAtFullAllowance(CARVE_DIVISOR);
        (, uint256 excessEth, uint256 carveEth) = _divertEvent(logs);

        // The two legs really are both nonzero and distinct — without this the comparison is vacuous.
        assertEq(carveEth, EXPECT_CARVE, "carve leg drifted");
        assertEq(excessEth, EXPECT_EXCESS, "excess leg drifted");

        assertEq(treasury.balance, EXPECT_PROTOCOL_FEE, "protocolFee moved");
        assertEq(address(vault).balance, EXPECT_VAULT_CUT, "vaultCut moved");
        assertEq(owner.balance, EXPECT_CREATOR_CUT, "creatorCut moved");
        // The mock venue settles nothing, so the pool leg stays on the module.
        assertEq(address(deployer).balance, EXPECT_ETH_FOR_POOL, "ethForPool moved");

        assertEq(
            EXPECT_PROTOCOL_FEE + EXPECT_VAULT_CUT + EXPECT_CREATOR_CUT + EXPECT_ETH_FOR_POOL,
            EXPECT_RAISE,
            "the pinned distribution does not sum to the raise"
        );
        assertEq(address(instance).balance, 0, "ETH stranded on the instance");
    }

    // ── 2. The event now tells the truth ──────────────────────────────────────────────────────────

    /// @notice `CreatorCarvePaid.requested` is the creator's carve and nothing else.
    /// @dev THIS TEST MUST FAIL IF THE TWO LEGS ARE RE-MERGED. With the legs summed into `carveEth`,
    ///      `requested` reports `carve + excess` — a figure larger than the creator's full declared
    ///      allowance, on the event an observer measures that allowance with. The carve here IS the
    ///      full declared allowance, so the inflated figure would read as an over-draw that never
    ///      happened.
    function test_creatorCarvePaidReportsTheCarveAlone() public {
        _rig(10_000);
        _buyPercent(STOP_PCT);
        Vm.Log[] memory logs = _graduateAtFullAllowance(CARVE_DIVISOR);
        (, uint256 excessEth, uint256 carveEth) = _divertEvent(logs);
        assertGt(excessEth, 0, "no clamp residue: the assertion below would be vacuous");

        (bool seen, uint256 requested, uint256 paid) = _carvePaidEvent(logs);
        assertTrue(seen, "the module never reported the creator carve");
        assertEq(requested, carveEth, "requested is not the creator's carve");
        assertTrue(requested != carveEth + excessEth, "requested still carries the clamp residue");
        assertEq(paid, carveEth, "paid is not the creator's carve");
    }

    // ── 3. The two contracts agree ────────────────────────────────────────────────────────────────

    /// @notice The instance and the module describe the same graduation with the same two numbers.
    function test_instanceAndModuleReportTheSameTwoLegs() public {
        _rig(10_000);
        _buyPercent(STOP_PCT);
        Vm.Log[] memory logs = _graduateAtFullAllowance(CARVE_DIVISOR);

        (, uint256 excessEth, uint256 carveEth) = _divertEvent(logs);
        (bool carveSeen, uint256 requested, uint256 carveApplied) = _carvePaidEvent(logs);
        (bool excessSeen, uint256 excessTithed) = _excessTithedEvent(logs);

        assertTrue(carveSeen && excessSeen, "one of the two legs went unreported by the module");
        assertEq(requested, carveEth, "the two contracts disagree about the carve");
        assertEq(excessTithed, excessEth, "the two contracts disagree about the clamp residue");
        // The reported legs partition the tithed total exactly — no wei is double-counted or dropped.
        assertEq(carveApplied + excessTithed, carveEth + excessEth, "the reported legs do not sum to the diversion");
    }

    // ── 4. Zero residue is unchanged ──────────────────────────────────────────────────────────────

    /// @notice A full sale leaves the clamp out of it: no excess event at all, and the carve reported
    ///         exactly as it was before the split.
    function test_fullSaleLeavesNoResidueAndReportsCarveOnly() public {
        _rig(10_000);
        _buyPercent(100);
        uint256 carve = instance.reserve() / CARVE_DIVISOR;
        Vm.Log[] memory logs = _graduateAtFullAllowance(CARVE_DIVISOR);

        (, uint256 excessEth, uint256 carveEth) = _divertEvent(logs);
        assertEq(excessEth, 0, "the clamp engaged on a full sale");
        assertEq(carveEth, carve, "the resolved carve was not forwarded");

        (bool excessSeen,) = _excessTithedEvent(logs);
        assertFalse(excessSeen, "an excess event was emitted with no residue");

        (bool carveSeen, uint256 requested, uint256 paid) = _carvePaidEvent(logs);
        assertTrue(carveSeen, "the module never reported the creator carve");
        assertEq(requested, carve, "requested is not the creator's carve");
        assertEq(paid, carve, "paid is not the creator's carve");
        // The creator's leg absorbs the carve's rounding dust (protocol and vault both floor).
        assertEq(owner.balance, carve - carve / 100 - (carve * 19) / 100, "creator did not receive the carve's 80% leg");
    }
}
