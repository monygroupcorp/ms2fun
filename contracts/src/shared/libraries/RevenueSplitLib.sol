// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title RevenueSplitLib
/// @notice Revenue splits: `split` = 1/19/80 (DN404 graduation); `splitMint` = 1/80/19 (mints);
///         `carveAllowance` + `splitGraduation` = graduation with an optional tithed creator carve.
library RevenueSplitLib {
    struct Split {
        uint256 protocolCut; // 1%
        uint256 vaultCut;    // vault share
        uint256 remainder;   // creator/LP share
    }

    /// @notice 1/19/80 split (DN404/ERC404 graduation — vault 19%, remainder 80% to LP).
    /// @dev Protocol = amount / 100 (floor), vault = amount * 19 / 100 (floor),
    ///      remainder = amount - protocol - vault (absorbs rounding dust).
    function split(uint256 amount) internal pure returns (Split memory s) {
        s.protocolCut = amount / 100;
        s.vaultCut = (amount * 19) / 100;
        s.remainder = amount - s.protocolCut - s.vaultCut;
    }

    /// @notice Mint settlement split (ERC1155/ERC721): 1% protocol / 80% vault / 19% creator.
    /// @dev ADR-0003: mints route the heavy share to the (endowment) vault — the inverse of `split`'s
    ///      vault/creator weights. Same `Split` shape: `vaultCut` = 80%, `remainder` = creator's 19%.
    function splitMint(uint256 amount) internal pure returns (Split memory s) {
        s.protocolCut = amount / 100;
        s.vaultCut = (amount * 80) / 100;
        s.remainder = amount - s.protocolCut - s.vaultCut;
    }

    // ── Graduation carve-out ───────────────────────────────────────────────────

    /// @notice Progressive-bracket parameters for the creator carve allowance (income-tax shape,
    ///         inverted: the RATE falls as the raise grows). Owner-tunable at the factory.
    struct BracketParams {
        uint256 b1; // first bracket upper bound (wei), e.g. 4 ether
        uint256 b2; // second bracket upper bound (wei), >= b1, e.g. 20 ether
        uint16 r1;  // bps rate on raise in [0, b1], e.g. 5000
        uint16 r2;  // bps rate on raise in (b1, b2], e.g. 2500
        uint16 r3;  // bps rate on raise beyond b2, e.g. 1000
    }

    /// @notice Graduation payout with an optional creator carve. All parts sum to the raise exactly.
    struct GraduationSplit {
        uint256 protocolCut;  // 1% of raise + 1% of carve
        uint256 vaultCut;     // 19% of raise + 19% of carve
        uint256 creatorCut;   // 80% of carve (absorbs carve rounding dust)
        uint256 ethForPool;   // remainder → LP
        uint256 carveApplied; // effective (clamped) gross carve; creator+vault+protocol carve parts sum to this
    }

    /// @notice Protocol carve allowance for a given raise: progressive brackets, marginal-rate style.
    /// @dev allowance(R) = r1·min(R,b1) + r2·(min(R,b2)-b1)⁺ + r3·(R-b2)⁺, each term in bps.
    ///      Continuous at breakpoints and monotonically non-decreasing in R by construction.
    ///      Assumes b1 <= b2 (factory-validated).
    function carveAllowance(uint256 raise, BracketParams memory p) internal pure returns (uint256 allowance) {
        uint256 tier1 = raise < p.b1 ? raise : p.b1;
        allowance = (tier1 * p.r1) / 10000;
        if (raise > p.b1) {
            uint256 tier2 = (raise < p.b2 ? raise : p.b2) - p.b1;
            allowance += (tier2 * p.r2) / 10000;
        }
        if (raise > p.b2) {
            allowance += ((raise - p.b2) * p.r3) / 10000;
        }
    }

    /// @notice Graduation payout priority stack:
    ///         protocol 1% of raise → vault 19% of raise → pool up to `minPoolEth` floor →
    ///         tithed carve (80 creator / 19 vault / 1 protocol) → remainder to pool.
    /// @dev Vault + protocol are computed on the FULL raise (alignment not dilutable); the carve
    ///      comes only out of the LP 80. The pool floor is a carve-CLAMP, never a gate: when the
    ///      LP share can't reach the floor the carve is squeezed (to zero if needed) and the pool
    ///      takes everything — this function never reverts on a thin raise.
    function splitGraduation(uint256 raise, uint256 carveEth, uint256 minPoolEth)
        internal
        pure
        returns (GraduationSplit memory g)
    {
        Split memory base = split(raise);
        uint256 lp = base.remainder; // the 80
        uint256 headroom = lp > minPoolEth ? lp - minPoolEth : 0;
        uint256 carve = carveEth > headroom ? headroom : carveEth;

        // Tithe on the carved amount itself: even extraction feeds alignment.
        uint256 carveProtocol = carve / 100;
        uint256 carveVault = (carve * 19) / 100;

        g.protocolCut = base.protocolCut + carveProtocol;
        g.vaultCut = base.vaultCut + carveVault;
        g.creatorCut = carve - carveProtocol - carveVault;
        g.ethForPool = lp - carve;
        g.carveApplied = carve;
    }
}
