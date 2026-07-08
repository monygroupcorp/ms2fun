// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable } from "solady/auth/Ownable.sol";
import { LibString } from "solady/utils/LibString.sol";
import { IMetadataResolver } from "./IMetadataResolver.sol";
import { IMasterRegistry } from "../master/interfaces/IMasterRegistry.sol";

/// @dev Minimal reads the tier module needs off an ERC404 instance.
interface ITierInstance {
    function balanceOf(address holder) external view returns (uint256);
    function stakingModule() external view returns (address);
}

/// @dev The staking singleton's public `stakedBalance` mapping (not on the minimal staking interface).
interface IStakedBalanceReader {
    function stakedBalance(address instance, address holder) external view returns (uint256);
}

/// @title TierRevealModule
/// @notice Rarity-by-ownership metadata resolver (ADR-0007, Reading B). An id in a configured tier
///         range reveals its rare art only while the holder's *effective holdings*
///         (`balanceOf + stakedBalance`) clear the tier threshold; otherwise the locked art (or ""
///         to fall through to collection base) shows. Pure conditional reveal — zero allocation,
///         zero custody, DN404-native.
/// @dev Singleton keyed by instance. Tier config is SEALED at construction: a *registered factory*
///      wires the full tier table once via `initTiers` (validating non-overlapping ascending ranges),
///      then it is frozen — no owner add/edit. Mutable rarity = rug. The reveal stays dynamic
///      (tracks live balances); the rules do not. Auth = `masterRegistry.isFactoryRegistered`
///      (shared singleton, upgrade-safe, blocks the seal-front-run on deterministic CREATE3 addresses).
contract TierRevealModule is IMetadataResolver, Ownable {
    error NotRegisteredFactory();
    error AlreadySealed();
    error InvalidAddress();
    error InvalidRange(); // idEnd < idStart
    error RangesNotAscending(); // ranges must be strictly ascending and non-overlapping

    struct Tier {
        uint256 idStart; // inclusive
        uint256 idEnd; // inclusive
        uint256 minBalance; // effective-holdings threshold, in token units (e.g. 10 * unit)
        string baseURI; // revealed art base; resolves baseURI + id
        string lockedURI; // held-but-under-threshold ("" => fall through to collection base)
    }

    IMasterRegistry public immutable masterRegistry;

    mapping(address => Tier[]) public tiers; // non-overlapping ascending ranges; order = precedence
    mapping(address => bool) public sealed_; // per instance, set-once

    string private _metadataURI;

    event TiersSealed(address indexed instance, uint256 count);

    constructor(address _masterRegistry) {
        if (_masterRegistry == address(0)) revert InvalidAddress();
        masterRegistry = IMasterRegistry(_masterRegistry);
        _initializeOwner(msg.sender);
    }

    /// @notice Wire and freeze the tier table for `inst`. Registered-factory-only, set-once.
    /// @dev Ranges must be ascending and non-overlapping: tiers[i].idEnd >= idStart and
    ///      tiers[i+1].idStart > tiers[i].idEnd.
    function initTiers(address inst, Tier[] calldata ts) external {
        // Least privilege (D1): only the factory that registered THIS instance may seal its tiers,
        // not any registered factory.
        if (masterRegistry.getInstanceInfo(inst).factory != msg.sender) revert NotRegisteredFactory();
        if (sealed_[inst]) revert AlreadySealed();

        uint256 len = ts.length;
        for (uint256 i; i < len; ++i) {
            if (ts[i].idEnd < ts[i].idStart) revert InvalidRange();
            if (i > 0 && ts[i].idStart <= ts[i - 1].idEnd) revert RangesNotAscending();
            tiers[inst].push(ts[i]);
        }
        sealed_[inst] = true;
        emit TiersSealed(inst, len);
    }

    /// @inheritdoc IMetadataResolver
    function resolve(address inst, uint256 id, address holder) external view override returns (string memory) {
        (bool found, Tier memory t) = _tierForId(inst, id);
        if (!found) return ""; // common id → collection base

        // Holder address(0) (unminted): eff = 0 < any positive threshold → lockedURI path. No special-case.
        uint256 eff = ITierInstance(inst).balanceOf(holder) + _stakedOf(inst, holder);
        if (eff >= t.minBalance) {
            return string.concat(t.baseURI, LibString.toString(id)); // revealed
        }
        return t.lockedURI; // "" => base/common look (teaser if set)
    }

    /// @notice Number of tiers configured for `inst`.
    function tierCount(address inst) external view returns (uint256) {
        return tiers[inst].length;
    }

    // ── Internal ────────────────────────────────────────────────────────────────

    /// @dev Explicit (found, Tier) — no idEnd==0 sentinel (H6). O(tiers); ranges capped at config.
    function _tierForId(address inst, uint256 id) internal view returns (bool, Tier memory) {
        Tier[] storage ts = tiers[inst];
        uint256 len = ts.length;
        for (uint256 i; i < len; ++i) {
            if (id >= ts[i].idStart && id <= ts[i].idEnd) {
                return (true, ts[i]);
            }
        }
        Tier memory none;
        return (false, none);
    }

    function _stakedOf(address inst, address holder) internal view returns (uint256) {
        address sm = ITierInstance(inst).stakingModule();
        if (sm == address(0)) return 0;
        return IStakedBalanceReader(sm).stakedBalance(inst, holder);
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
