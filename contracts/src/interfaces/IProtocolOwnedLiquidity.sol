// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { PoolKey } from "v4-core/types/PoolKey.sol";

/// @notice The surface of `ProtocolOwnedLiquidityV1` an approved deployer module calls to fund a
///         registered instance's POL position on that instance's behalf.
interface IProtocolOwnedLiquidity {
    /// @param instance The registered instance this POL position belongs to.
    function receivePOL(
        address instance,
        PoolKey calldata poolKey,
        int24 tickLower,
        int24 tickUpper,
        uint256 amount0,
        uint256 amount1
    ) external payable;
}
