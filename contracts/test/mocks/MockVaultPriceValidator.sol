// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IVaultPriceValidator } from "../../src/interfaces/IVaultPriceValidator.sol";

/// @notice Mock price validator for unit tests. Always passes validation.
contract MockVaultPriceValidator is IVaultPriceValidator {
    uint256 public fixedProportion = 5e17; // 50% default
    /// @notice ETH returned for 1e18 tokens (TWAP price). 0 = "no reliable source" (default).
    uint256 public ethPer1e18Tokens;

    function setFixedProportion(uint256 _proportion) external {
        fixedProportion = _proportion;
    }

    /// @notice Set the TWAP rate as ETH per 1e18 tokens (e.g. 1e15 = 0.001 ETH/token).
    function setEthPer1e18Tokens(uint256 rate) external {
        ethPer1e18Tokens = rate;
    }

    function calculateSwapProportion(address, int24, int24, address, bytes32) external view override returns (uint256) {
        return fixedProportion;
    }

    function calculateSwapProportionFromSqrtPrice(address, int24, int24, uint160, bool)
        external
        view
        override
        returns (uint256)
    {
        return fixedProportion;
    }

    // Mirrors the linear quote for the pinned-pool signature; pool/kind/window are ignored by the mock.
    function quoteEthForTokensVia(address, uint8, uint32, address, uint256 amount)
        external
        view
        override
        returns (uint256)
    {
        return amount * ethPer1e18Tokens / 1e18;
    }
}
