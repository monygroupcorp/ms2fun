// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { SafeOwnableUUPS } from "../../../src/shared/SafeOwnableUUPS.sol";
import { IAlignmentRegistry } from "../../../src/master/interfaces/IAlignmentRegistry.sol";

/**
 * @title AlignmentRegistryV1Pre035
 * @notice Byte-for-byte-layout copy of the AlignmentRegistryV1 implementation as it existed on origin/main
 *         AFTER noesis-031 but BEFORE noesis-035 (i.e. WITH the appended `acquireRoutes` mapping as the last
 *         state var, but WITHOUT the newly-appended `referencePools` mapping and WITHOUT the `weth` immutable).
 * @dev Test-only fixture for the noesis-035 storage-layout proof. A proxy is deployed on this "old"
 *      implementation, seeded with curated targets/assets/ambassadors/payouts AND acquire routes, then
 *      upgraded to the real (post-noesis-035) AlignmentRegistryV1 (which appends `referencePools` after
 *      `acquireRoutes`). The proof asserts every pre-existing value — crucially `getAcquireRoute` — reads
 *      back identical. Intentionally does NOT inherit IAlignmentRegistry so it is not forced to implement the
 *      new reference-pool members; this frozen version predates them. Struct/enum types are reused from
 *      IAlignmentRegistry so element layouts match the live contract exactly. `weth` is an immutable on the
 *      live contract (impl bytecode, not storage), so its absence here does not change storage layout.
 */
contract AlignmentRegistryV1Pre035 is SafeOwnableUUPS {
    error InvalidAddress();
    error InvalidTitle();
    error NoAssets();
    error TargetNotFound();
    error TokenNotInTarget();
    error InvalidRoute();

    // ── State (must mirror AlignmentRegistryV1 post-noesis-031 / pre-noesis-035, in the same order) ──
    bool private _initialized;
    uint256 public nextAlignmentTargetId;
    mapping(uint256 => IAlignmentRegistry.AlignmentTarget) public alignmentTargets;
    mapping(uint256 => IAlignmentRegistry.AlignmentAsset[]) internal alignmentTargetAssets;
    mapping(uint256 => address[]) public alignmentTargetAmbassadors;
    mapping(uint256 => mapping(address => bool)) internal _isAmbassador;
    mapping(address => uint256[]) public tokenToTargetIds;
    mapping(uint256 => address) public communityPayout;
    // Last state var in the pre-noesis-035 layout.
    mapping(uint256 => mapping(address => IAlignmentRegistry.AcquireRoute)) internal acquireRoutes;

    constructor() {
        _initializeOwner(msg.sender);
    }

    function initialize(address _owner) public {
        if (_initialized) revert AlreadyInitialized();
        if (_owner == address(0)) revert InvalidAddress();
        _initialized = true;
        _setOwner(_owner);
    }

    function registerAlignmentTarget(
        string memory title,
        string memory description,
        string memory metadataURI,
        IAlignmentRegistry.AlignmentAsset[] memory assets
    ) external onlyOwner returns (uint256) {
        if (bytes(title).length == 0 || bytes(title).length > 256) {
            revert InvalidTitle();
        }
        if (assets.length == 0) revert NoAssets();

        uint256 targetId = ++nextAlignmentTargetId;
        alignmentTargets[targetId] = IAlignmentRegistry.AlignmentTarget({
            id: targetId,
            title: title,
            description: description,
            metadataURI: metadataURI,
            approvedAt: block.timestamp,
            active: true
        });

        for (uint256 i = 0; i < assets.length; i++) {
            if (assets[i].token == address(0)) revert InvalidAddress();
            alignmentTargetAssets[targetId].push(assets[i]);
            tokenToTargetIds[assets[i].token].push(targetId);
        }
        return targetId;
    }

    function addAmbassador(uint256 targetId, address ambassador) external onlyOwner {
        if (alignmentTargets[targetId].approvedAt == 0) revert TargetNotFound();
        if (ambassador == address(0)) revert InvalidAddress();
        _isAmbassador[targetId][ambassador] = true;
        alignmentTargetAmbassadors[targetId].push(ambassador);
    }

    function setCommunityPayout(uint256 targetId, address payout) external onlyOwner {
        if (alignmentTargets[targetId].approvedAt == 0) revert TargetNotFound();
        if (payout == address(0)) revert InvalidAddress();
        communityPayout[targetId] = payout;
    }

    /// @dev Mirrors the pre-noesis-035 `setAcquireRoute` so the proof can seed the `acquireRoutes` slot on the
    ///      old impl before upgrading.
    function setAcquireRoute(uint256 targetId, address token, IAlignmentRegistry.AcquireRoute calldata route)
        external
        onlyOwner
    {
        if (alignmentTargets[targetId].approvedAt == 0) revert TargetNotFound();
        if (!alignmentTargets[targetId].active) revert TargetNotFound();
        if (!_isTokenInTarget(targetId, token)) revert TokenNotInTarget();
        acquireRoutes[targetId][token] = route;
    }

    function getAcquireRoute(uint256 targetId, address token)
        external
        view
        returns (IAlignmentRegistry.AcquireRoute memory)
    {
        return acquireRoutes[targetId][token];
    }

    function _isTokenInTarget(uint256 targetId, address token) private view returns (bool) {
        IAlignmentRegistry.AlignmentAsset[] storage assets = alignmentTargetAssets[targetId];
        for (uint256 i = 0; i < assets.length; i++) {
            if (assets[i].token == token) return true;
        }
        return false;
    }
}
