// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ICurveComputer } from "../../src/interfaces/ICurveComputer.sol";
import { BondingCurveMath } from "../../src/factories/erc404/libraries/BondingCurveMath.sol";

contract MockCurveComputer is ICurveComputer {
    function computeCurveParams(uint256 nftCount, uint256 targetETH, uint256 unitPerNFT, uint256 liquidityReserveBps)
        external
        pure
        override
        returns (BondingCurveMath.Params memory)
    {
        return BondingCurveMath.Params({
            kCoeff: targetETH / nftCount, poleWad: 1.0438e18, normalizationFactor: unitPerNFT * 1e7
        });
    }
}

contract ICurveComputerTest is Test {
    MockCurveComputer computer;

    function setUp() public {
        computer = new MockCurveComputer();
    }

    function test_computeCurveParams_returnsParams() public {
        BondingCurveMath.Params memory p = computer.computeCurveParams(100, 15 ether, 1e6, 2000);
        assertGt(p.kCoeff, 0);
        assertGt(p.poleWad, 1e18);
        assertGt(p.normalizationFactor, 0);
    }
}
