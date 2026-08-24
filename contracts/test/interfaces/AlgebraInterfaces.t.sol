// test/interfaces/AlgebraInterfaces.t.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "forge-std/Test.sol";
import "../../src/interfaces/algebra/IAlgebra.sol";

contract AlgebraInterfacesTest is Test {
    function test_mintParamsHasDeployerField() public view {
        // Compile check: MintParams with deployer field compiles
        IAlgebraNFTPositionManager.MintParams memory p = IAlgebraNFTPositionManager.MintParams({
            token0: address(1),
            token1: address(2),
            deployer: address(0),
            tickLower: -887220,
            tickUpper: 887220,
            amount0Desired: 1e18,
            amount1Desired: 1e18,
            amount0Min: 0,
            amount1Min: 0,
            recipient: address(3),
            deadline: block.timestamp + 1
        });
    }

    function test_swapParamsHasLimitSqrtPrice() public view {
        IAlgebraSwapRouter.ExactInputSingleParams memory p = IAlgebraSwapRouter.ExactInputSingleParams({
            tokenIn: address(1),
            tokenOut: address(2),
            deployer: ALGEBRA_DEFAULT_DEPLOYER,
            recipient: address(3),
            deadline: block.timestamp + 1,
            amountIn: 1e18,
            amountOutMinimum: 0,
            limitSqrtPrice: 0
        });
        assertEq(p.limitSqrtPrice, 0);
        assertEq(p.deployer, address(0));
    }

    /// @notice The declared params tuple must hash to the selector the deployed Integral router exposes.
    /// @dev Selector-level pin, so a field added, removed, or reordered in `ExactInputSingleParams` fails
    ///      here in the default suite rather than at the counterparty. The live-bytecode half of this pin
    ///      (the selector is present on the deployed router; the seven-field V2 selector is not) lives in
    ///      `test/fork/CypherAlgebraSeamFork.t.sol`.
    function test_swapSelectorMatchesDeployedIntegralShape() public pure {
        assertEq(IAlgebraSwapRouter.exactInputSingle.selector, bytes4(0x1679c792));
        assertTrue(
            IAlgebraSwapRouter.exactInputSingle.selector
                != bytes4(keccak256("exactInputSingle((address,address,address,uint256,uint256,uint256,uint160))"))
        );
    }
}
