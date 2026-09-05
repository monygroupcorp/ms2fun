// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Clearing a stale allowance grants nothing and must not be flagged.
contract OkResetToZero {
    address zRouter;
    address token;

    function clear() internal {
        IERC20(token).forceApprove(zRouter, 0);
    }
}
