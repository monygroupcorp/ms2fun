// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// The allowance is granted in one transaction and spent in another; between them it stands.
contract BadCrossTx {
    address zRouter;
    address token;

    function prepare(uint256 tokenAmount) external {
        IERC20(token).forceApprove(zRouter, tokenAmount);
    }

    function convert(uint256 tokenAmount, uint256 minEthOut) external returns (uint256 ethOut) {
        (, ethOut) = IzRouter(zRouter).swapV4(
            address(this), false, 3000, 60, token, address(0), tokenAmount, minEthOut, type(uint256).max
        );
    }
}
