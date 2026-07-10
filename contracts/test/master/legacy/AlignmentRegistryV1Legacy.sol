// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { SafeOwnableUUPS } from "../../../src/shared/SafeOwnableUUPS.sol";
import { IAlignmentRegistry } from "../../../src/master/interfaces/IAlignmentRegistry.sol";

/**
 * @title AlignmentRegistryV1Legacy
 * @notice Byte-for-byte-layout copy of the AlignmentRegistryV1 implementation as it existed on
 *         origin/main BEFORE noesis-031 (i.e. WITHOUT the appended `acquireRoutes` mapping).
 * @dev Test-only fixture. It reproduces the exact pre-upgrade storage layout so the upgrade test can
 *      deploy a proxy on this "old" implementation, seed curated targets/assets/ambassadors/payouts,
 *      upgrade to the real (post-noesis-031) AlignmentRegistryV1, and assert every value reads back
 *      identical. Intentionally does NOT inherit IAlignmentRegistry so it is not forced to implement the
 *      new routing members — the whole point is that this frozen version predates them. The struct types
 *      are reused from IAlignmentRegistry so element layouts match the live contract exactly.
 */
contract AlignmentRegistryV1Legacy is SafeOwnableUUPS {
    error InvalidAddress();
    error InvalidTitle();
    error NoAssets();
    error TargetNotFound();

    // ── State (must mirror AlignmentRegistryV1 pre-noesis-031, in the same order) ──
    bool private _initialized;
    uint256 public nextAlignmentTargetId;
    mapping(uint256 => IAlignmentRegistry.AlignmentTarget) public alignmentTargets;
    mapping(uint256 => IAlignmentRegistry.AlignmentAsset[]) internal alignmentTargetAssets;
    mapping(uint256 => address[]) public alignmentTargetAmbassadors;
    mapping(uint256 => mapping(address => bool)) internal _isAmbassador;
    mapping(address => uint256[]) public tokenToTargetIds;
    mapping(uint256 => address) public communityPayout;

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
}
