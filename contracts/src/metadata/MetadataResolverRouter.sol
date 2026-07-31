// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable } from "solady/auth/Ownable.sol";
import { IMetadataResolver } from "./IMetadataResolver.sol";
import { SafeResolverLib } from "./SafeResolverLib.sol";
import { IMasterRegistry } from "../master/interfaces/IMasterRegistry.sol";
import { IComponentRegistry } from "../registry/interfaces/IComponentRegistry.sol";
import { FeatureUtils } from "../master/libraries/FeatureUtils.sol";

/// @title MetadataResolverRouter
/// @notice Composes an ordered list of child metadata resolvers behind one `IMetadataResolver`
///         pointer (ADR-0007). `resolve` returns the first non-empty child result (precedence =
///         list order), defensively try/catch'ing each child so a misbehaving resolver degrades
///         to the next rather than reverting.
/// @dev Singleton keyed by instance, holds no custody. The per-instance resolver list is SEALED
///      at construction: the factory that registered THIS instance wires it once via `initResolvers`,
///      then it is frozen — no owner mutation of the mechanism (ADR-0006 mutability principle). Auth is
///      `masterRegistry.getInstanceInfo(inst).factory == msg.sender` — ONLY the instance's own
///      registering factory, not any registered factory (least privilege, D1). This survives factory
///      upgrades/multiple factory types AND blocks the seal-front-run on deterministic CREATE3 instance
///      addresses. `initResolvers` additionally self-validates each child against the ComponentRegistry
///      (resolver-family tag) so the trust invariant — every sealed child is an approved resolver — is
///      enforced HERE at the trust anchor, not only out-of-band in the caller (R2). `setMetadataURI`
///      (IComponentModule self-description for the wizard) is the only owner power and touches no
///      per-instance state.
contract MetadataResolverRouter is IMetadataResolver, Ownable {
    error NotRegisteredFactory();
    error AlreadySealed();
    error InvalidAddress();
    error UnapprovedResolver(); // a child is not an approved resolver-family component (R2)

    IMasterRegistry public immutable masterRegistry;

    mapping(address => address[]) public resolvers; // per instance, ordered by precedence
    mapping(address => bool) public sealed_; // per instance, set-once

    string private _metadataURI;

    event ResolversSealed(address indexed instance, address[] resolvers);

    constructor(address _masterRegistry) {
        if (_masterRegistry == address(0)) revert InvalidAddress();
        masterRegistry = IMasterRegistry(_masterRegistry);
        _initializeOwner(msg.sender);
    }

    /// @notice Wire the ordered child-resolver list for `inst`. Registered-factory-only, set-once.
    function initResolvers(address inst, address[] calldata rs) external {
        // Least privilege (D1): only the factory that registered THIS instance may seal its router
        // list, not any registered factory.
        if (masterRegistry.getInstanceInfo(inst).factory != msg.sender) revert NotRegisteredFactory();
        if (sealed_[inst]) revert AlreadySealed();
        // R2: enforce the trust invariant at the anchor. Each child must be an approved resolver-family
        // component in the ComponentRegistry BEFORE it is sealed, so an alternate/future factory that
        // skips its own pre-check cannot seal arbitrary children whose `resolve` returns attacker-chosen
        // strings. Defense-in-depth: the honest factory still pre-validates out-of-band.
        IComponentRegistry cr = masterRegistry.componentRegistry();
        uint256 len = rs.length;
        for (uint256 i; i < len; ++i) {
            if (!_isApprovedResolverFamily(cr, rs[i])) revert UnapprovedResolver();
        }
        resolvers[inst] = rs;
        sealed_[inst] = true;
        emit ResolversSealed(inst, rs);
    }

    /// @dev Resolver-family membership: approved under the RESOLVER, OVERLAY, or TIER tag. Mirrors
    ///      `ERC404Factory._isApprovedResolverFamily` so the router and factory agree on what a valid
    ///      child is (the registry stays type-agnostic; the family is composed here).
    function _isApprovedResolverFamily(IComponentRegistry cr, address component) private view returns (bool) {
        return cr.isApprovedForTag(component, FeatureUtils.RESOLVER)
            || cr.isApprovedForTag(component, FeatureUtils.OVERLAY) || cr.isApprovedForTag(component, FeatureUtils.TIER);
    }

    /// @inheritdoc IMetadataResolver
    function resolve(address inst, uint256 id, address holder) external view override returns (string memory) {
        address[] storage rs = resolvers[inst];
        uint256 len = rs.length;
        for (uint256 i; i < len; ++i) {
            // SafeResolverLib.tryResolve degrades EVERY hostile child class to `""`: a revert, a gas-bomb,
            // an ABI-undecodable success (the escape a plain try/catch misses — noesis-107), and a
            // code-less (revoked/self-destructed) child — so a bad child falls through to the next, never
            // bricks the read.
            (, string memory u) = SafeResolverLib.tryResolve(rs[i], inst, id, holder);
            if (bytes(u).length != 0) return u; // first non-empty wins
        }
        return ""; // → instance falls back to base
    }

    /// @notice Number of child resolvers wired for `inst` (frontend/indexer helper).
    function resolverCount(address inst) external view returns (uint256) {
        return resolvers[inst].length;
    }

    // ── IComponentModule self-description (wizard) ──────────────────────────────

    function metadataURI() external view override returns (string memory) {
        return _metadataURI;
    }

    function setMetadataURI(string calldata uri) external override onlyOwner {
        _metadataURI = uri;
        emit MetadataURIUpdated(uri);
    }
}
