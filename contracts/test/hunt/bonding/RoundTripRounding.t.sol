// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC404BondingInstance } from "../../../src/factories/erc404/ERC404BondingInstance.sol";
import { ERC404BondingOps } from "../../../src/factories/erc404/ERC404BondingOps.sol";
import { CurveParamsComputer } from "../../../src/factories/erc404/CurveParamsComputer.sol";
import { BondingCurveMath } from "../../../src/factories/erc404/libraries/BondingCurveMath.sol";
import { ILiquidityDeployerModule } from "../../../src/interfaces/ILiquidityDeployerModule.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { DN404Mirror } from "dn404/src/DN404Mirror.sol";

contract MockLiquidityDeployer is ILiquidityDeployerModule {
    function deployLiquidity(ILiquidityDeployerModule.DeployParams calldata) external payable override { }
    function metadataURI() external view override returns (string memory) { return ""; }
    function setMetadataURI(string calldata) external override { }
}

/**
 * @title RoundTripRoundingHunt
 * @notice Hunt: does the curve's floor at `supply / normalizationFactor`, evaluated separately on
 *         the buy and sell legs, let a T4 who splits one buy across bucket boundaries and sells
 *         once refund more ETH than they paid, draining reserve other buyers funded?
 * @dev `calculateCost` and `calculateRefund` both difference the SAME `_calculateIntegralFromZero`
 *      at the same bucket floors, so a buy sequence telescopes to exactly the single sell's refund;
 *      the attacker is left holding exactly the sell fee. Pins that equality.
 */
contract RoundTripRoundingHunt is Test {
    ERC404BondingInstance public instance;
    CurveParamsComputer public curveComputer;

    address public owner = address(0x1);
    address public honest = address(0x2);
    address public attacker = address(0x3);
    address public treasury = address(0xFEE);

    uint256 constant MAX_SUPPLY = 10_000_000 * 1e18;
    uint256 constant LIQUIDITY_RESERVE_BPS = 1000;
    uint256 constant NORM_FACTOR = 1e7;

    function setUp() public {
        curveComputer = new CurveParamsComputer(address(this));
        BondingCurveMath.Params memory curveParams =
            BondingCurveMath.Params({ kCoeff: 0.025 ether, poleWad: 1.0438e18, normalizationFactor: NORM_FACTOR });

        vm.startPrank(owner);
        ERC404BondingInstance impl = new ERC404BondingInstance(address(new ERC404BondingOps()));
        instance = ERC404BondingInstance(payable(LibClone.clone(address(impl))));
        instance.initialize(
            owner, address(0xBEEF), _bondingParams(curveParams), address(new MockLiquidityDeployer()), address(0),
            address(new DN404Mirror(owner))
        );
        instance.initializeProtocol(ERC404BondingInstance.ProtocolParams({
            globalMessageRegistry: address(0x700),
            protocolTreasury: treasury,
            masterRegistry: address(0x400),
            bondingFeeBps: 100,
            weth: address(0xBEEF)
        }));
        instance.initializeMetadata("Hunt Token", "HUNT", "", "", "");
        vm.stopPrank();
    }

    function _bondingParams(BondingCurveMath.Params memory curveParams)
        internal
        pure
        returns (ERC404BondingInstance.BondingParams memory)
    {
        return ERC404BondingInstance.BondingParams({
            maxSupply: MAX_SUPPLY,
            unit: 1_000_000 ether,
            liquidityReserveBps: LIQUIDITY_RESERVE_BPS,
            declaredMaxAllowanceBps: 0,
            curve: curveParams
        });
    }

    function _cost(uint256 amount) internal view returns (uint256) {
        (uint256 k, uint256 pole, uint256 nf) = instance.curveParams();
        return curveComputer.calculateCost(
            BondingCurveMath.Params({ kCoeff: k, poleWad: pole, normalizationFactor: nf }),
            instance.totalBondingSupply(), amount);
    }

    function _refund(uint256 amount) internal view returns (uint256) {
        (uint256 k, uint256 pole, uint256 nf) = instance.curveParams();
        return curveComputer.calculateRefund(
            BondingCurveMath.Params({ kCoeff: k, poleWad: pole, normalizationFactor: nf }),
            instance.totalBondingSupply(), amount);
    }

    function _activate() internal {
        vm.startPrank(owner);
        uint256 openTime = block.timestamp + 1 days;
        instance.setBondingOpenTime(openTime);
        instance.setBondingActive(true);
        vm.stopPrank();
        vm.warp(openTime);
    }

    function test_Defended_BuySellRoundTripLeaksNoRounding() public {
        _activate();

        // Honest T4 buyer lands supply deep on the curve, 3 base units above a bucket boundary,
        // where a normalization bucket is worth hundreds of wei, and funds the reserve.
        vm.deal(honest, 1 ether);
        vm.startPrank(honest);
        uint256 honestBuy = 8_990_000 * 1e18 + 3;
        uint256 hc = _cost(honestBuy);
        instance.buyBonding{ value: hc }(honestBuy, hc, false, bytes(""), bytes(""), 0);
        vm.stopPrank();

        uint256 reserveBefore = instance.reserve();

        // Attacker (T4) splits one purchase into four buys of ~1000 buckets each, with offsets that
        // misalign each successive buy against the whole-bucket boundaries, then sells the lot once.
        uint256[4] memory sizes = [
            uint256(10_000_000_007), uint256(10_000_000_000) + 9_999_993, uint256(20_000_000_001),
            uint256(10_000_000_000) + 9_999_991
        ];

        vm.deal(attacker, 1 ether);
        uint256 balanceBefore = attacker.balance;
        uint256 paid;
        uint256 total;
        vm.startPrank(attacker);
        for (uint256 i; i < sizes.length; ++i) {
            uint256 cost = _cost(sizes[i]);
            assertGt(cost, 0, "each buy must cross a bucket boundary");
            instance.buyBonding{ value: cost }(sizes[i], cost, false, bytes(""), bytes(""), 0);
            paid += cost;
            total += sizes[i];
        }

        uint256 refundGross = _refund(total);
        uint256 sellFee = (refundGross * instance.bondingFeeBps()) / 10000;
        assertGt(sellFee, 0, "precondition: nonzero sell fee");

        instance.sellBonding(total, 0, bytes32(0), bytes(""), 0);
        uint256 balanceAfter = attacker.balance;
        vm.stopPrank();

        // The hypothesis is false: bucket floors telescope, gross refund == gross cost exactly.
        assertEq(paid, refundGross, "split buys must cost exactly the single sell's gross refund");
        // The attacker ends net-negative by exactly the fee — no rounding drain.
        assertEq(balanceBefore - balanceAfter, sellFee, "attacker loses exactly the sell fee");
        // And the reserve the honest buyer funded is untouched end to end.
        assertEq(instance.reserve(), reserveBefore, "round trip must not drain the shared reserve");
    }
}
