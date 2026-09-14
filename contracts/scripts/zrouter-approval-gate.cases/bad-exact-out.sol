// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Exact-out does not pull swapAmount, so an approval sized to it is the wrong size.
contract BadExactOut {
    address zRouter;
    address token;

    function convert(uint256 tokenAmount, uint256 maxIn) internal returns (uint256 ethOut) {
        IERC20(token).forceApprove(zRouter, tokenAmount);
        (, ethOut) = IzRouter(zRouter).swapVZ(
            address(this), true, 30, token, address(0), 0, 0, tokenAmount, maxIn, type(uint256).max
        );
    }
}
