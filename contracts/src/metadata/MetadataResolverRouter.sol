// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "solady/auth/Ownable.sol";
import {IMetadataResolver} from "./IMetadataResolver.sol";
import {IMasterRegistry} from "../master/interfaces/IMasterRegistry.sol";

/// @title MetadataResolverRouter
/// @notice Composes an ordered list of child metadata resolvers behind one `IMetadataResolver`
///         pointer (ADR-0007). `resolve` returns the first non-empty child result (precedence =
///         list order), defensively try/catch'ing each child so a misbehaving resolver degrades
///         to the next rather than reverting.
/// @dev Singleton keyed by instance, holds no custody. The per-instance resolver list is SEALED
///      at construction: a *registered factory* wires it once via `initResolvers`, then it is
///      frozen — no owner mutation of the mechanism (ADR-0006 mutability principle). Auth is
///      `masterRegistry.isFactoryRegistered(msg.sender)` (NOT a hardcoded factory) so it survives
///      factory upgrades/multiple factory types AND blocks the seal-front-run on deterministic
///      CREATE3 instance addresses. `setMetadataURI` (IComponentModule self-description for the
///      wizard) is the only owner power and touches no per-instance state.
contract MetadataResolverRouter is IMetadataResolver, Ownable {
    error NotRegisteredFactory();
    error AlreadySealed();
    error InvalidAddress();

    IMasterRegistry public immutable masterRegistry;

    mapping(address => address[]) public resolvers;   // per instance, ordered by precedence
    mapping(address => bool)      public sealed_;      // per instance, set-once

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
        resolvers[inst] = rs;
        sealed_[inst] = true;
        emit ResolversSealed(inst, rs);
    }

    /// @inheritdoc IMetadataResolver
    function resolve(address inst, uint256 id, address holder)
        external
        view
        override
        returns (string memory)
    {
        address[] storage rs = resolvers[inst];
        uint256 len = rs.length;
        for (uint256 i; i < len; ++i) {
            // A high-level call to a code-less address reverts UNCATCHABLY on the extcodesize check,
            // so guard it explicitly — a revoked/self-destructed child must degrade, not brick.
            if (rs[i].code.length == 0) continue;
            // slither-disable-next-line calls-loop
            try IMetadataResolver(rs[i]).resolve(inst, id, holder) returns (string memory u) {
                if (bytes(u).length != 0) return u;   // first non-empty wins
            } catch {}                                 // defensive at the router too
        }
        return "";                                     // → instance falls back to base
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
