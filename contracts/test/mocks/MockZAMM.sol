// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Mock ZAMM for unit testing ZAMMAlignmentVault
/// Simulates addLiquidity/removeLiquidity/balanceOf/pools() without real math.
contract MockZAMM {
    struct PoolKey {
        uint256 id0;
        uint256 id1;
        address token0;
        address token1;
        uint256 feeOrHook;
    }

    struct Pool {
        uint112 reserve0;
        uint112 reserve1;
        uint32 blockTimestampLast;
        uint256 price0CumulativeLast;
        uint256 price1CumulativeLast;
        uint256 kLast;
        uint256 supply;
    }

    // Pool state by poolId
    mapping(uint256 => Pool) public pools;
    // ERC-6909 LP balances: owner => poolId => amount
    mapping(address => mapping(uint256 => uint256)) public lpBalances;

    // Configurable: how many LP shares to mint per addLiquidity call
    uint256 public lpToMint = 1000 ether;
    // Configurable: how much eth/token to return per removeLiquidity call
    uint256 public ethPerLp = 1e15; // 0.001 ETH per LP unit
    uint256 public tokenPerLp = 1e15;

    receive() external payable { }

    function balanceOf(address owner, uint256 id) external view returns (uint256) {
        return lpBalances[owner][id];
    }

    function setPool(uint256 poolId, uint112 reserve0, uint112 reserve1, uint256 supply) external {
        pools[poolId].reserve0 = reserve0;
        pools[poolId].reserve1 = reserve1;
        pools[poolId].supply = supply;
    }

    // Configurable swap output for swapExactIn
    uint256 public ethPerToken = 1e15; // 0.001 ETH per token

    function setLpToMint(uint256 amount) external {
        lpToMint = amount;
    }

    function setEthPerLp(uint256 amount) external {
        ethPerLp = amount;
    }

    function setTokenPerLp(uint256 amount) external {
        tokenPerLp = amount;
    }

    function setEthPerToken(uint256 amount) external {
        ethPerToken = amount;
    }

    /// @notice Simulates swapExactIn: pulls tokens from caller, sends ETH to `to`
    function swapExactIn(
        PoolKey calldata poolKey,
        uint256 amountIn,
        uint256,
        /*amountOutMin*/
        bool,
        /*zeroForOne*/
        address to,
        uint256 /*deadline*/
    )
        external
        returns (uint256 amountOut)
    {
        // Pull the non-ETH token from caller
        address token = poolKey.token0 != address(0) ? poolKey.token0 : poolKey.token1;
        if (token != address(0)) {
            IERC20(token).transferFrom(msg.sender, address(this), amountIn);
        }
        amountOut = amountIn * ethPerToken / 1 ether;
        if (amountOut > 0 && address(this).balance >= amountOut) {
            (bool ok,) = payable(to).call{ value: amountOut }("");
            require(ok, "MockZAMM: ETH transfer failed");
        }
    }

    /// @notice Simulates addLiquidity: accepts ETH + token, mints LP to `to`.
    /// @dev Binds the deposit to the pool's reserve ratio the way a constant-product AMM does: the
    ///      side that is scarce relative to the ratio caps the other, so the caller's `amountXDesired`
    ///      is an upper bound, not a promise. When the ETH side is capped, the unconsumed ETH is
    ///      refunded to the caller and shows up as a nonzero residual (`msg.value - amount0`). A pool
    ///      with an empty reserve on either side is still bootstrapping and takes both amounts whole.
    function addLiquidity(
        PoolKey calldata poolKey,
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256,
        /*amount0Min*/
        uint256,
        /*amount1Min*/
        address to,
        uint256 /*deadline*/
    ) external payable returns (uint256 amount0, uint256 amount1, uint256 liquidity) {
        uint256 pid_ = uint256(keccak256(abi.encode(poolKey)));
        uint256 res0 = pools[pid_].reserve0;
        uint256 res1 = pools[pid_].reserve1;
        if (res0 != 0 && res1 != 0) {
            uint256 amount1Optimal = amount0Desired * res1 / res0;
            if (amount1Optimal <= amount1Desired) {
                (amount0, amount1) = (amount0Desired, amount1Optimal);
            } else {
                (amount0, amount1) = (amount1Desired * res0 / res1, amount1Desired);
            }
        } else {
            (amount0, amount1) = (amount0Desired, amount1Desired);
        }
        liquidity = lpToMint;

        // Pull the token from caller
        if (poolKey.token1 != address(0)) {
            IERC20(poolKey.token1).transferFrom(msg.sender, address(this), amount1);
        }
        // ETH is sent as msg.value; refund the ratio-capped remainder. Real ZAMM refunds via a
        // full-gas call, so use one here too rather than a 2300-gas `transfer` that a receiving
        // contract's `receive()` could run out of gas in.
        if (msg.value > amount0) {
            (bool refunded,) = payable(msg.sender).call{ value: msg.value - amount0 }("");
            require(refunded, "MockZAMM: ETH refund failed");
        }

        lpBalances[to][pid_] += liquidity;

        // Update synthetic reserves
        pools[pid_].reserve0 += uint112(amount0);
        pools[pid_].reserve1 += uint112(amount1);
        pools[pid_].supply += liquidity;
    }

    /// @notice Simulates removeLiquidity: burns LP from caller, sends ETH+token to `to`
    function removeLiquidity(
        PoolKey calldata poolKey,
        uint256 liquidity,
        uint256,
        /*amount0Min*/
        uint256,
        /*amount1Min*/
        address to,
        uint256 /*deadline*/
    )
        external
        returns (uint256 amount0, uint256 amount1)
    {
        uint256 poolId = uint256(keccak256(abi.encode(poolKey)));
        require(lpBalances[msg.sender][poolId] >= liquidity, "insufficient LP");
        uint256 supplyBefore = pools[poolId].supply;
        lpBalances[msg.sender][poolId] -= liquidity;

        amount0 = liquidity * ethPerLp / 1 ether;
        amount1 = liquidity * tokenPerLp / 1 ether;

        // Burning LP withdraws a proportional slice of the reserves (constant-product behavior):
        // this keeps sqrt(k)/share intact and lets the vault's invariant detection converge across
        // harvests instead of re-detecting the same fee growth forever.
        if (supplyBefore > 0) {
            pools[poolId].reserve0 -= uint112(uint256(pools[poolId].reserve0) * liquidity / supplyBefore);
            pools[poolId].reserve1 -= uint112(uint256(pools[poolId].reserve1) * liquidity / supplyBefore);
        }
        pools[poolId].supply -= liquidity;

        // Send ETH via call (transfer only forwards 2300 gas, not enough for vault receive())
        if (amount0 > 0 && address(this).balance >= amount0) {
            (bool ok,) = payable(to).call{ value: amount0 }("");
            require(ok, "MockZAMM: ETH transfer failed");
        }
        // Send token
        if (amount1 > 0 && poolKey.token1 != address(0)) {
            IERC20(poolKey.token1).transfer(to, amount1);
        }
    }
}
