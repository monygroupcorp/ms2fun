// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IGatingModule } from "./IGatingModule.sol";
import { IMerkleGatingModule, MerkleConfig } from "./IMerkleGatingModule.sol";
import { IMasterRegistry } from "../master/interfaces/IMasterRegistry.sol";
import { Ownable } from "solady/auth/Ownable.sol";
import { MerkleProofLib } from "solady/utils/MerkleProofLib.sol";

/// @title MerkleGatingModule
/// @notice Singleton gating module for per-edition, quantity-capped merkle allowlists. Gates BOTH the
///         free-mint and paid-buy entry points (subject to the instance's GatingScope). State is keyed
///         by the calling instance address (msg.sender), then by editionId — ERC1155 forwards the real
///         edition, ERC404 forwards 0 (single curve).
///
/// @dev  Leaf construction (MUST stay byte-identical to app/src/lib/merkle.ts, extended from
///       address-only to (address, maxQty)):
///
///           inner = keccak256(abi.encode(address user, uint256 maxQty))   // 64-byte ABI preimage
///           leaf  = keccak256(bytes.concat(inner))                        // double-hash (32-byte domain)
///
///       Internal nodes use Solady's commutative / sorted-pair keccak (MerkleProofLib). The off-chain
///       builder sorts leaves and pairs; only the 32-byte root is stored on-chain. Phase 2's merkle.ts
///       MUST match this exactly.
///
///       Proof is delivered inside `IGatingModule.canMint`'s `bytes calldata data` and therefore decodes
///       to MEMORY, so verification uses `MerkleProofLib.verify` (the memory variant) rather than
///       `verifyCalldata` — same algorithm, same roots; a calldata proof array cannot be recovered from
///       an abi-encoded `bytes` blob.
///
///       Tier model: `roots[instance][editionId]` holds one root per tier and `tierOpenTimes` the
///       matching absolute open timestamps. A single-gate allowlist is one tier. A user provable in
///       multiple tiers submits the proof for whichever tier grants the most generous maxQty; raising a
///       user's maxQty via a new root lets a previously-capped user claim the delta (intended
///       re-allocation lever). Cumulative claims per (instance, edition, user) are capped at the proven
///       maxQty.
contract MerkleGatingModule is IGatingModule, IMerkleGatingModule, Ownable {
    // ── Errors ─────────────────────────────────────────────────────────────────

    error LengthMismatch();
    error EmptyRootSet();
    error ZeroRoot();
    error InvalidTier();
    error TierNotOpen();
    error InvalidProof();
    error QtyCapExceeded();

    // ── Immutables ─────────────────────────────────────────────────────────────

    IMasterRegistry public immutable masterRegistry;

    // ── Metadata ───────────────────────────────────────────────────────────────

    string private _metadataURI;

    constructor(address _masterRegistry) {
        masterRegistry = IMasterRegistry(_masterRegistry);
        _initializeOwner(msg.sender);
    }

    // ── State (keyed by instance = msg.sender) ─────────────────────────────────

    /// @notice True once an instance has authored its first edition config (gates auth on updates).
    mapping(address instance => bool) public configured;
    /// @notice One merkle root per tier, per edition.
    mapping(address instance => mapping(uint256 editionId => bytes32[])) private _roots;
    /// @notice Absolute unix open timestamp per tier, per edition (parallel to _roots).
    mapping(address instance => mapping(uint256 editionId => uint256[])) private _tierOpenTimes;
    /// @notice Cumulative claimed amount per (instance, edition, user), across all tiers of that edition.
    mapping(address instance => mapping(uint256 editionId => mapping(address user => uint256))) public claimed;

    // ── Configuration ──────────────────────────────────────────────────────────

    /// @notice Configure or update the merkle allowlist for ONE edition of `instance`.
    /// @dev Initial configuration (first edition ever configured for the instance) may be authored by
    ///      the factory that registered this specific instance OR by the instance owner. Post-create
    ///      by the owner is the expected path: factories attach a gating module without threading its
    ///      config, so the owner configures it in a follow-up tx. Every subsequent call (further
    ///      editions, or updates) must come from the instance owner.
    function configureFor(address instance, MerkleConfig calldata config) external override {
        if (!configured[instance]) {
            if (
                masterRegistry.getInstanceInfo(instance).factory != msg.sender
                    && msg.sender != Ownable(instance).owner()
            ) {
                revert Unauthorized();
            }
        } else {
            if (msg.sender != Ownable(instance).owner()) revert Unauthorized();
        }

        if (config.roots.length != config.tierOpenTimes.length) revert LengthMismatch();
        if (config.roots.length == 0) revert EmptyRootSet();
        for (uint256 i = 0; i < config.roots.length; i++) {
            if (config.roots[i] == bytes32(0)) revert ZeroRoot();
        }

        configured[instance] = true;
        _roots[instance][config.editionId] = config.roots;
        _tierOpenTimes[instance][config.editionId] = config.tierOpenTimes;
    }

    // ── IGatingModule ──────────────────────────────────────────────────────────

    /// @dev msg.sender is the calling instance. `openTime` (the edition/bonding open timestamp) is
    ///      unused here: tier phasing uses absolute `tierOpenTimes` configured directly. The parameter
    ///      is part of the shared IGatingModule interface (the password module consumes it).
    /// @param data abi.encode(uint256 tierId, uint256 maxQty, bytes32[] proof)
    ///             tierId: which tier's root to prove against · maxQty: the per-user cap encoded in the
    ///             leaf · proof: merkle proof for leaf(user, maxQty) against roots[.. ][tierId].
    // slither-disable-next-line timestamp
    function canMint(address user, uint256 editionId, uint256 amount, uint256, bytes calldata data)
        external
        override
        returns (bool allowed, bool permanent)
    {
        (uint256 tierId, uint256 maxQty, bytes32[] memory proof) = abi.decode(data, (uint256, uint256, bytes32[]));

        bytes32[] storage editionRoots = _roots[msg.sender][editionId];
        if (tierId >= editionRoots.length) revert InvalidTier();
        if (block.timestamp < _tierOpenTimes[msg.sender][editionId][tierId]) revert TierNotOpen();

        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(user, maxQty))));
        if (!MerkleProofLib.verify(proof, editionRoots[tierId], leaf)) revert InvalidProof();

        if (claimed[msg.sender][editionId][user] + amount > maxQty) revert QtyCapExceeded();

        allowed = true;
        permanent = false; // never self-deactivates — allowlist stays enforced
    }

    /// @dev msg.sender is the calling instance. Increments the edition-scoped cumulative claim.
    function onMint(address user, uint256 editionId, uint256 amount) external override {
        claimed[msg.sender][editionId][user] += amount;
    }

    // ── Views ──────────────────────────────────────────────────────────────────

    function getRoots(address instance, uint256 editionId) external view returns (bytes32[] memory) {
        return _roots[instance][editionId];
    }

    function getTierOpenTimes(address instance, uint256 editionId) external view returns (uint256[] memory) {
        return _tierOpenTimes[instance][editionId];
    }

    // ── IComponentModule ───────────────────────────────────────────────────────

    function metadataURI() external view override returns (string memory) {
        return _metadataURI;
    }

    function setMetadataURI(string calldata uri) external override onlyOwner {
        _metadataURI = uri;
        emit MetadataURIUpdated(uri);
    }
}
