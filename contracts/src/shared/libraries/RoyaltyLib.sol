// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title RoyaltyLib
/// @notice The one EIP-2981 arithmetic and the one cap, shared by every instance that answers
///         `royaltyInfo`. Two instances that each hand-rolled the basis-point maths would drift on
///         the cap first and on the rounding second, and a marketplace reads only the number.
/// @dev Deliberately NOT part of `RevenueSplitLib`. That library is the 1/19/80 alignment law, which
///      is a contract constant with no setter anywhere; a royalty is the opposite — creator-set,
///      creator-paid, and honored only by the marketplaces that choose to. Keeping them apart keeps
///      a reader from concluding the alignment tithe rides on resales. It does not: see
///      `docs/phases/vault-flavors.md` for where each family's secondary value actually goes.
library RoyaltyLib {
    /// @notice A royalty above `MAX_ROYALTY_BPS` was requested.
    error RoyaltyTooHigh(uint16 bps, uint16 maxBps);

    /// @notice ERC-165 interface id for EIP-2981 (`royaltyInfo(uint256,uint256)`).
    bytes4 internal constant INTERFACE_ID_ERC2981 = 0x2a55205a;

    /// @notice Ceiling on a creator-set royalty: 10%.
    /// @dev A cap exists because the rate is published to third parties that price against it. The
    ///      marketplaces that honor EIP-2981 at all refuse or silently clamp absurd rates, so an
    ///      uncapped field lets a creator set 100% and discover at the first resale that their work
    ///      is unsellable everywhere. 10% is the field's own ceiling — it is objkt's documented
    ///      example rate and the top of the band Manifold and OpenSea storefronts accept — so a
    ///      creator who maxes this out is still inside what every venue will quote.
    uint16 internal constant MAX_ROYALTY_BPS = 1000;

    /// @notice Revert unless `bps` is a settable royalty rate.
    /// @dev Zero is valid and is the default: it means "this collection asks for no royalty", which
    ///      is a position a creator may hold and is what every noesis collection deployed before
    ///      EIP-2981 landed continues to report.
    function validate(uint16 bps) internal pure {
        if (bps > MAX_ROYALTY_BPS) revert RoyaltyTooHigh(bps, MAX_ROYALTY_BPS);
    }

    /// @notice The EIP-2981 royalty owed on `salePrice` at `bps`.
    /// @dev Floor division, so the amount owed can never exceed `bps` of the sale. `salePrice` is
    ///      supplied by the caller and is not trusted; at the 10% cap the product overflows only
    ///      above ~1.1e73 ether, which is unreachable, and 0.8.x would revert rather than wrap.
    function amount(uint256 salePrice, uint16 bps) internal pure returns (uint256) {
        return (salePrice * bps) / 10_000;
    }
}
