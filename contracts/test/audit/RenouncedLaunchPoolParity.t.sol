// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test, Vm } from "forge-std/Test.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { DN404Mirror } from "dn404/src/DN404Mirror.sol";

import { ERC404BondingInstance, ICarveParamsSource } from "../../src/factories/erc404/ERC404BondingInstance.sol";
import { ERC404BondingOps } from "../../src/factories/erc404/ERC404BondingOps.sol";
import { LiquidityDeployerModule } from "../../src/factories/erc404/LiquidityDeployerModule.sol";
import { CurveParamsComputer } from "../../src/factories/erc404/CurveParamsComputer.sol";
import { BondingCurveMath } from "../../src/factories/erc404/libraries/BondingCurveMath.sol";

import { MockV4PoolManager } from "../factories/erc404/ERC404GraduationSkipNFT.t.sol";
import { MockMasterRegistry } from "../mocks/MockMasterRegistry.sol";
import { MockVault } from "../mocks/MockVault.sol";

/**
 * @title RenouncedLaunchPoolParityTest
 * @notice Audit finding L-11 — a renounced launch opened its pool off curve parity.
 *
 *         `LiquidityDeployerModule._computeAmounts` zeroes the whole diverted leg when
 *         `p.creator == address(0)`: a renounced launch has nobody to pay a creator carve to, so the
 *         full LP share goes into the pool. That guard is correct. What was missing is that
 *         `ERC404BondingOps.deployLiquidity` did not know about it — it sized `tokensForPool` at the
 *         curve's marginal price for `lp - carveEth`, a SMALLER ETH leg than the module then used.
 *         More ETH against the same coin opens the pool ABOVE the price the last curve buyer paid,
 *         which is the one thing the graduation sizing exists to prevent, and
 *         `GraduationEthDiverted` reported a carve nobody received.
 *
 *         Reachable because `ERC404BondingInstance` inherits plain solady `Ownable` and never
 *         overrides `renounceOwnership`; graduation from that state runs through a pre-configured
 *         agent, which is what these tests drive.
 */
contract RenouncedLaunchPoolParityTest is Test {
    address internal owner = address(0xA11CE);
    address internal buyer = address(0xB0B);
    address internal agent = address(0xA6E7);
    address internal treasury = address(0x7EA);

    uint256 internal constant NFT_COUNT = 1000;
    uint256 internal constant UNIT = 1e18;
    uint256 internal constant MAX_SUPPLY = NFT_COUNT * UNIT;
    uint256 internal constant TARGET_ETH = 10 ether;
    uint256 internal constant PROD_BPS = 1000;

    /// @dev A carve of 1/8 of the raise. Large enough that sizing the coin side against it rather than
    ///      against the full LP share is a visible price error, not a rounding one.
    uint256 internal constant CARVE_DIVISOR = 8;

    ERC404BondingInstance internal instance;
    LiquidityDeployerModule internal deployer;
    MockMasterRegistry internal registry;
    MockVault internal vault;

    function setUp() public {
        registry = new MockMasterRegistry();
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
                declaredMaxAllowanceBps: 10_000,
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
        instance.initializeMetadata("Renounced", "RNC", "", "", "");
        instance.setBondingOpenTime(block.timestamp + 1);
        instance.setBondingActive(true);
        instance.setAgentDelegation(true);
        vm.stopPrank();

        registry.setAgent(agent, true);
        vm.warp(block.timestamp + 1);
    }

    /// @dev Buy the whole sellable supply, so the parity clamp has no deficit band to fire in and the
    ///      pool's ETH is exactly the LP share. That isolates the carve.
    function _buyOut() internal {
        uint256 amount = MAX_SUPPLY - instance.liquidityReserve();
        vm.deal(buyer, 1000 ether);
        vm.startPrank(buyer);
        instance.setSkipNFT(true);
        instance.buyBonding{ value: 1000 ether }(amount, type(uint256).max, false, bytes(""), bytes(""), 0);
        vm.stopPrank();
    }

    /// @dev Pin the factory's bracket math so `carveRequestBps = 10_000` resolves to a known carve.
    function _pinCarve() internal {
        uint256 carve = instance.reserve() / CARVE_DIVISOR;
        vm.mockCall(
            instance.factory(), abi.encodeWithSelector(ICarveParamsSource.effectiveCarveEth.selector), abi.encode(carve)
        );
    }

    /// @dev `GraduationEthDiverted(ethToPool, excessEth, creatorCarveEth)` — the instance's own report
    ///      of the ETH it sized the coin side against.
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

    /// @dev What the module actually put in the pool: the ETH it forwarded to the venue.
    function _poolEth(Vm.Log[] memory logs) internal view returns (uint256 amount) {
        bytes32 sig = keccak256("LiquidityDeployed(address,uint256,uint256)");
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(deployer) && logs[i].topics[0] == sig) {
                (, uint256 ethForPool) = abi.decode(logs[i].data, (uint256, uint256));
                return ethForPool;
            }
        }
        revert("no LiquidityDeployed from the module");
    }

    // ── The finding ───────────────────────────────────────────────────────────

    /// @notice The instance sizes the coin side for exactly the ETH the module puts in the pool.
    function test_renouncedLaunch_sizesTheCoinSideForTheEthTheModuleActuallyUses() public {
        _buyOut();
        _pinCarve();

        vm.prank(owner);
        instance.renounceOwnership();
        assertEq(instance.owner(), address(0), "the launch is renounced");

        vm.recordLogs();
        vm.prank(agent);
        instance.deployLiquidity(10_000);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        (uint256 ethToPool, uint256 excessEth, uint256 carveEth) = _divertEvent(logs);

        // The module pays no creator carve for a renounced launch, so the instance must not withhold
        // one either. Before the fix this was `raise / CARVE_DIVISOR` of the LP share.
        assertEq(carveEth, 0, "no carve is withheld when there is no creator to pay it to");
        assertEq(_poolEth(logs), ethToPool + excessEth, "the pool got what the instance sized for");
    }

    /// @notice The reported carve is a carve somebody received. With a creator still in place nothing
    ///         about the path changes — this is the control that makes the test above mean something.
    function test_ownedLaunch_stillWithholdsAndPaysTheCarve() public {
        _buyOut();
        uint256 expectedCarve = instance.reserve() / CARVE_DIVISOR;
        _pinCarve();

        vm.recordLogs();
        vm.prank(owner);
        instance.deployLiquidity(10_000);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        (uint256 ethToPool, uint256 excessEth, uint256 carveEth) = _divertEvent(logs);
        assertEq(carveEth, expectedCarve, "an owned launch still withholds its creator carve");
        assertEq(_poolEth(logs), ethToPool + excessEth, "and the pool still gets what was sized for");
        assertGt(carveEth, 0, "the scenario must actually produce a carve");
    }
}
