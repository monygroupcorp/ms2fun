// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Approves the whole balance but swaps a part of it; the remainder stays spendable.
contract BadOversized {
    address zRouter;
    address token;

    function convert(uint256 tokenAmount, uint256 minEthOut) internal returns (uint256 ethOut) {
        IERC20(token).forceApprove(zRouter, IERC20(token).balanceOf(address(this)));
        (, ethOut) = IzRouter(zRouter).swapV4(
            address(this), false, 3000, 60, token, address(0), tokenAmount, minEthOut, type(uint256).max
        );
    }
}
