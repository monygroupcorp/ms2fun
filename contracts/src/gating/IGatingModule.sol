// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IComponentModule } from "../interfaces/IComponentModule.sol";

/// @notice Controls which entry points the gating module is consulted for.
/// Set once at instance creation. Irreversible.
enum GatingScope {
    BOTH, // gates free mint claims AND paid buys (default)
    FREE_MINT_ONLY, // gates free mint claims only; paid buys are open
    PAID_ONLY // gates paid buys only; free mint claims are open FCFS
}

/// @notice Pluggable gating interface for ms2.fun instances (ERC404 and ERC1155).
/// address(0) means open gating — no module deployed.
/// Implementations are registered in ComponentRegistry under tag keccak256("gating").
interface IGatingModule is IComponentModule {
    /// @notice Returns (allowed, permanent).
    ///         When permanent == true, the caller MUST set gatingActive = false —
    ///         this module guarantees it will never block again.
    /// @param user      The buyer address.
    /// @param editionId Authoritative edition/curve id supplied by the calling instance. ERC1155
    ///                  instances pass the real edition; ERC404 (single curve) passes 0. Per-edition
    ///                  modules key their roots and claim accounting on this — the instance is the
    ///                  source of truth, so a proof for edition A cannot be replayed on edition B.
    /// @param amount    Token amount (not NFT count).
    /// @param openTime  Authoritative open timestamp for this entry point (edition.openTime for
    ///                  ERC1155, bondingOpenTime for ERC404). De-wrapped from `data` so `data` carries
    ///                  only the module payload — a bytes32[] merkle proof cannot be smuggled through the
    ///                  old abi.encode(payload, openTime) wrap.
    /// @param data      Module-specific payload — e.g. merkle (tierId, maxQty, proof), or a future
    ///                  ZK proof + public signals. Empty (`0x`) when the module needs no payload.
    function canMint(address user, uint256 editionId, uint256 amount, uint256 openTime, bytes calldata data)
        external
        returns (bool allowed, bool permanent);

    /// @notice Record a successful mint. Called by instance after canMint passes.
    /// @param user      The buyer address.
    /// @param editionId Authoritative edition/curve id (see canMint). 0 for ERC404.
    /// @param amount    Token amount minted.
    function onMint(address user, uint256 editionId, uint256 amount) external;
}
