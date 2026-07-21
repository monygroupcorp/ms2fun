// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title RevenueSplitLib
/// @notice Revenue splits: `split` = 1/19/80 (DN404 graduation); `splitMint` = 1/80/19 (mints);
///         `splitMintFor` = family-aware mint split; `carveAllowance` + `splitGraduation` =
///         graduation with an optional tithed creator carve.
library RevenueSplitLib {
    /// @notice A collection's mint proceeds route by its alignment vault's family, resolved from
    ///         `vaultType()`. A vaultType that matches neither the liquidity nor the yield set is a
    ///         deploy-config error and reverts loud rather than falling through to a default split.
    error UnknownVaultFamily(string vaultType);

    // Precomputed keccak of the recognized vaultType() literals. The strings are compile-time
    // constants, so hashing them once as `constant`s avoids recomputing four keccaks on every
    // settlement call in `isLiquidityFamily`.
    bytes32 private constant _HASH_UNISWAP_V4_LP = keccak256(bytes("UniswapV4LP"));
    bytes32 private constant _HASH_ZAMM_LP = keccak256(bytes("ZAMMLP"));
    bytes32 private constant _HASH_CYPHER_LP = keccak256(bytes("CypherLP"));
    bytes32 private constant _HASH_AAVE_ENDOWMENT = keccak256(bytes("AaveEndowment"));

    struct Split {
        uint256 protocolCut; // 1%
        uint256 vaultCut; // vault share
        uint256 remainder; // creator/LP share
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

    /// @notice Family-aware mint settlement split.
    /// @dev Liquidity-family collections flip the heavy leg to the creator (1% protocol / 19% vault /
    ///      80% creator — the same weights as `split`); yield-family (endowment) collections keep
    ///      `splitMint`'s 1/80/19 (the 80% is refundable principal). Delegating to the two existing
    ///      primitives keeps the yield path byte-identical to today and conserves value on both
    ///      branches (each primitive absorbs rounding dust into `remainder`).
    /// @param amount The settlement amount to split.
    /// @param liquidityFamily True for a liquidity-family vault, false for a yield-family vault.
    function splitMintFor(uint256 amount, bool liquidityFamily) internal pure returns (Split memory) {
        return liquidityFamily ? split(amount) : splitMint(amount);
    }

    /// @notice Classify an alignment vault's `vaultType()` string into its revenue-split family.
    /// @dev Liquidity set = {"UniswapV4LP","ZAMMLP","CypherLP"}; yield set = {"AaveEndowment"}.
    ///      keccak256 over the UTF-8 bytes is an exact, collision-free string match. An unrecognized
    ///      vaultType reverts `UnknownVaultFamily` — an unknown family is a deploy-config error caught
    ///      loud, never silently defaulted.
    /// @param vaultType The vault's self-reported `vaultType()`.
    /// @return liquidityFamily True for the liquidity set, false for the yield set; reverts otherwise.
    function isLiquidityFamily(string memory vaultType) internal pure returns (bool liquidityFamily) {
        bytes32 h = keccak256(bytes(vaultType));
        if (h == _HASH_UNISWAP_V4_LP || h == _HASH_ZAMM_LP || h == _HASH_CYPHER_LP) {
            return true;
        }
        if (h == _HASH_AAVE_ENDOWMENT) {
            return false;
        }
        revert UnknownVaultFamily(vaultType);
    }

    // ── Graduation carve-out ───────────────────────────────────────────────────

    /// @notice Progressive-bracket parameters for the creator carve allowance (income-tax shape,
    ///         inverted: the RATE falls as the raise grows). Owner-tunable at the factory.
    struct BracketParams {
        uint256 b1; // first bracket upper bound (wei), e.g. 4 ether
        uint256 b2; // second bracket upper bound (wei), >= b1, e.g. 20 ether
        uint16 r1; // bps rate on raise in [0, b1], e.g. 5000
        uint16 r2; // bps rate on raise in (b1, b2], e.g. 2500
        uint16 r3; // bps rate on raise beyond b2, e.g. 1000
    }

    /// @notice Graduation payout with an optional creator carve. All parts sum to the raise exactly.
    struct GraduationSplit {
        uint256 protocolCut; // 1% of raise + 1% of carve
        uint256 vaultCut; // 19% of raise + 19% of carve
        uint256 creatorCut; // 80% of carve (absorbs carve rounding dust)
        uint256 ethForPool; // remainder → LP
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
    /// @dev INVARIANT / FOOTGUN: with `minPoolEth = 0` this lib's own clamp only guarantees
    ///      `carve <= lp` — the pool can be starved to zero. `carveEth` MUST already be clamped to
    ///      the pool floor by the caller (as `ERC404Factory.effectiveCarveEth` does), OR a real
    ///      `minPoolEth` must be passed here. Passing a raw (unclamped) carve request with
    ///      `minPoolEth = 0` lets the carve consume the full LP 80 and starve the pool without this
    ///      function complaining. Today's deployers pass the factory's already-clamped carve with
    ///      `minPoolEth = 0`, so the real floor lives upstream in the factory — this note keeps that
    ///      precondition explicit for the next caller.
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
