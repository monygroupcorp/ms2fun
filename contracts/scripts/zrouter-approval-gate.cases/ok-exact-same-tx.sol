// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// The shape both alignment vaults use: approve the exact amount, swap it in the same function.
contract OkExactSameTx {
    address zRouter;
    address token;

    function convert(uint256 tokenAmount, uint256 minEthOut) internal returns (uint256 ethOut) {
        IERC20(token).forceApprove(zRouter, tokenAmount);
        (, ethOut) = IzRouter(zRouter).swapV4(
            address(this), false, 3000, 60, token, address(0), tokenAmount, minEthOut, type(uint256).max
        );
    }
}
