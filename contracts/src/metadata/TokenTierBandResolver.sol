// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable } from "solady/auth/Ownable.sol";
import { LibString } from "solady/utils/LibString.sol";
import { IMetadataResolver } from "./IMetadataResolver.sol";
import { IMasterRegistry } from "../master/interfaces/IMasterRegistry.sol";

/// @title TokenTierBandResolver
/// @notice Static band→art metadata resolver for Token Tiers. A tier NFT is a coin DENOMINATION:
///         an id that sits in band N shows band N's art, unconditionally and forever. No threshold,
///         no balance read, no reveal — art does not move when holdings move.
/// @dev Singleton keyed by instance. Bands are sealed at create: the factory that registered this
///      instance wires the whole band table once via `initBands` (validating non-overlapping ascending
///      ranges), then it is frozen with no owner add/edit, since mutable rarity is a rug vector.
///      Auth is `masterRegistry.getInstanceInfo(inst).factory == msg.sender`: only the instance's own
///      registering factory, not any registered factory, which blocks a front-run of the seal on
///      deterministic CREATE3 addresses.
///
///      Band ids live above the instance's id ceiling (`idLimit`): DN404's auto-mint bounds emitted ids
///      to `[1..idLimit]`, so an ordinary buy never hands out a band id, which reserves them for the tier
///      mint path. The resolver does not enforce this; it only maps id ranges to art.
///
///      Holds no tier weights. The escrow math `(w_N − 1)·unit` lives on the instance, where the coin
///      accounting is; a copy here could drift.
contract TokenTierBandResolver is IMetadataResolver, Ownable {
    error NotRegisteredFactory();
    error AlreadySealed();
    error InvalidAddress();
    error InvalidRange(); // idEnd < idStart
    error RangesNotAscending(); // ranges must be strictly ascending and non-overlapping

    struct Band {
        uint256 idStart; // inclusive
        uint256 idEnd; // inclusive
        string baseURI; // band art base; resolves baseURI + id ("" => fall through to collection base)
    }

    IMasterRegistry public immutable masterRegistry;

    mapping(address => Band[]) public bands; // non-overlapping ascending ranges; order = precedence
    mapping(address => bool) public sealed_; // per instance, set-once

    string private _metadataURI;

    event BandsSealed(address indexed instance, uint256 count);

    constructor(address _masterRegistry) {
        if (_masterRegistry == address(0)) revert InvalidAddress();
        masterRegistry = IMasterRegistry(_masterRegistry);
        _initializeOwner(msg.sender);
    }

    /// @notice Wire and freeze the band table for `inst`. Registered-factory-only, set-once.
    /// @dev Ranges must be ascending and non-overlapping: bands[i].idEnd >= idStart and
    ///      bands[i+1].idStart > bands[i].idEnd.
    function initBands(address inst, Band[] calldata bs) external {
        if (masterRegistry.getInstanceInfo(inst).factory != msg.sender) revert NotRegisteredFactory();
        if (sealed_[inst]) revert AlreadySealed();

        uint256 len = bs.length;
        for (uint256 i; i < len; ++i) {
            if (bs[i].idEnd < bs[i].idStart) revert InvalidRange();
            if (i > 0 && bs[i].idStart <= bs[i - 1].idEnd) revert RangesNotAscending();
            bands[inst].push(bs[i]);
        }
        sealed_[inst] = true;
        emit BandsSealed(inst, len);
    }

    /// @inheritdoc IMetadataResolver
    /// @dev `holder` is ignored: band art is a property of the id, so the same id serves the same URI at
    ///      any balance.
    function resolve(
        address inst,
        uint256 id,
        address /*holder*/
    )
        external
        view
        override
        returns (string memory)
    {
        (bool found, Band memory b) = _bandForId(inst, id);
        if (!found) return ""; // common id → collection base
        // Blank band baseURI falls through to collection base; otherwise string.concat("", id) would
        // serve a bare "123", which is not a URI.
        if (bytes(b.baseURI).length == 0) return "";
        return string.concat(b.baseURI, LibString.toString(id));
    }

    /// @notice Number of bands configured for `inst`.
    function bandCount(address inst) external view returns (uint256) {
        return bands[inst].length;
    }

    // ── Internal ────────────────────────────────────────────────────────────────

    /// @dev Explicit (found, Band) with no idEnd==0 sentinel. O(bands).
    function _bandForId(address inst, uint256 id) internal view returns (bool, Band memory) {
        Band[] storage bs = bands[inst];
        uint256 len = bs.length;
        for (uint256 i; i < len; ++i) {
            if (id >= bs[i].idStart && id <= bs[i].idEnd) {
                return (true, bs[i]);
            }
        }
        Band memory none;
        return (false, none);
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
