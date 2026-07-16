// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { SafeOwnableUUPS } from "../shared/SafeOwnableUUPS.sol";
import { IAlignmentRegistry } from "./interfaces/IAlignmentRegistry.sol";
import { IAlgebraPool, IVolatilityOracle } from "../interfaces/algebra/IAlgebra.sol";

/// @notice Minimal Uniswap V3 pool surface the reference-pool setter probes. Hand-written (repo practice:
///         see the identical interface in `peripherals/UniswapVaultPriceValidator.sol`) rather than vendored.
///         `token0()/token1()` are ABI-identical on Algebra pools, so the Algebra probe reuses this cast.
interface IUniswapV3Pool {
    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s);
    function token0() external view returns (address);
    function token1() external view returns (address);
}

/**
 * @title AlignmentRegistryV1
 * @notice Manages alignment targets and ambassadors for the ms2.fun protocol
 * @dev UUPS upgradeable. Owner is the protocol Safe/Timelock.
 */
contract AlignmentRegistryV1 is SafeOwnableUUPS, IAlignmentRegistry {
    // ── Custom Errors ──
    error InvalidAddress();
    error InvalidTitle();
    error NoAssets();
    error TargetNotFound();
    error AmbassadorAlreadyAssigned();
    error NotAmbassador();
    error TokenNotInTarget();
    error InvalidRoute();
    error InvalidReferenceKind();
    error ReferencePoolUnusable();
    error ReferencePoolTokenMismatch();

    /// @notice Default TWAP window (seconds) used when a `ReferencePool.twapWindow` is left at 0.
    uint32 internal constant DEFAULT_TWAP_WINDOW = 1800;

    /// @notice Canonical WETH, injected at deploy. It is the mandatory counter-asset of every reference pool:
    ///         the anti-sandwich floor denominates in ETH, so a reference pool's other side MUST be WETH or its
    ///         TWAP is the wrong numeraire. An immutable lives in impl bytecode, NOT proxy storage — layout-safe.
    address public immutable weth;

    // ── State ──
    bool private _initialized;
    uint256 public nextAlignmentTargetId;
    mapping(uint256 => AlignmentTarget) public alignmentTargets;
    mapping(uint256 => AlignmentAsset[]) internal alignmentTargetAssets;
    mapping(uint256 => address[]) public alignmentTargetAmbassadors;
    mapping(uint256 => mapping(address => bool)) internal _isAmbassador;
    mapping(address => uint256[]) public tokenToTargetIds;
    mapping(uint256 => address) public communityPayout;

    // ── Appended storage (noesis-031) ──
    // MUST remain the LAST declared state var. Appending here keeps the layout of every var above
    // (_initialized … communityPayout) byte-for-byte identical, so existing curated targets behind the
    // UUPS proxy are preserved across the upgrade. See the storage-layout proof in AlignmentRegistryUpgrade.t.sol.
    mapping(uint256 => mapping(address => AcquireRoute)) internal acquireRoutes;

    // ── Appended storage (noesis-035) ──
    // MUST remain the LAST declared state var, strictly AFTER `acquireRoutes`. Appending here keeps the layout
    // of every var above (_initialized … acquireRoutes) byte-for-byte identical, so curated targets and routes
    // behind the UUPS proxy are preserved across the upgrade. See the storage-layout proof in
    // AlignmentRegistryReferencePoolUpgrade.t.sol. (`weth` is an immutable — impl bytecode, not storage.)
    mapping(uint256 => mapping(address => ReferencePool)) internal referencePools;

    /// @param _weth Canonical WETH address (the mandatory counter-asset of every reference pool). Stored as an
    ///        immutable, so it lives in impl bytecode and adds nothing to proxy storage.
    constructor(address _weth) {
        weth = _weth;
        _initializeOwner(msg.sender);
    }

    /**
     * @notice Initialize the contract with a single owner (the protocol Safe/Timelock)
     * @param _owner Address of the owner (Safe/Timelock)
     */
    function initialize(address _owner) public {
        if (_initialized) revert AlreadyInitialized();
        if (_owner == address(0)) revert InvalidAddress();

        _initialized = true;
        _setOwner(_owner);
    }

    // ============ Authorization ============

    /// @dev Passes if the caller is the owner OR an appointed ambassador of `targetId`. Ambassadors are trusted
    ///      with the SAFE metadata field of the target they represent (description/metadataURI) and nothing else —
    ///      fund- and price-authority setters (`setCommunityPayout`, `setAcquireRoute`, `setReferencePool`) stay
    ///      strictly `onlyOwner`. Reverts with `Unauthorized` (the same error `onlyOwner` uses) otherwise.
    modifier onlyOwnerOrAmbassador(uint256 targetId) {
        if (msg.sender != owner() && !_isAmbassador[targetId][msg.sender]) revert Unauthorized();
        _;
    }

    // ============ Alignment Target Functions ============

    function registerAlignmentTarget(
        string memory title,
        string memory description,
        string memory metadataURI,
        AlignmentAsset[] memory assets
    ) external override onlyOwner returns (uint256) {
        if (bytes(title).length == 0 || bytes(title).length > 256) revert InvalidTitle();
        if (assets.length == 0) revert NoAssets();

        uint256 targetId = ++nextAlignmentTargetId;

        alignmentTargets[targetId] = AlignmentTarget({
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

        emit AlignmentTargetRegistered(targetId, title);
        return targetId;
    }

    // slither-disable-next-line incorrect-equality,timestamp
    function getAlignmentTarget(uint256 targetId) external view override returns (AlignmentTarget memory) {
        if (alignmentTargets[targetId].approvedAt == 0) revert TargetNotFound();
        return alignmentTargets[targetId];
    }

    // slither-disable-next-line incorrect-equality,timestamp
    function getAlignmentTargetAssets(uint256 targetId) external view override returns (AlignmentAsset[] memory) {
        if (alignmentTargets[targetId].approvedAt == 0) revert TargetNotFound();
        return alignmentTargetAssets[targetId];
    }

    function isAlignmentTargetActive(uint256 targetId) external view override returns (bool) {
        return alignmentTargets[targetId].active;
    }

    function deactivateAlignmentTarget(uint256 targetId) external override onlyOwner {
        if (alignmentTargets[targetId].approvedAt == 0) revert TargetNotFound();
        alignmentTargets[targetId].active = false;
        emit AlignmentTargetDeactivated(targetId);
    }

    /// @dev Owner OR an appointed ambassador of `targetId` may update the target's description/metadataURI —
    ///      the SAFE metadata field an ambassador maintains for the community it represents. No other authority.
    function updateAlignmentTarget(uint256 targetId, string memory description, string memory metadataURI)
        external
        override
        onlyOwnerOrAmbassador(targetId)
    {
        if (alignmentTargets[targetId].approvedAt == 0) revert TargetNotFound();

        alignmentTargets[targetId].description = description;
        alignmentTargets[targetId].metadataURI = metadataURI;

        emit AlignmentTargetUpdated(targetId);
    }

    // ============ Ambassador Functions ============

    function addAmbassador(uint256 targetId, address ambassador) external override onlyOwner {
        if (alignmentTargets[targetId].approvedAt == 0) revert TargetNotFound();
        if (ambassador == address(0)) revert InvalidAddress();
        if (_isAmbassador[targetId][ambassador]) revert AmbassadorAlreadyAssigned();

        _isAmbassador[targetId][ambassador] = true;
        alignmentTargetAmbassadors[targetId].push(ambassador);

        emit AmbassadorAdded(targetId, ambassador);
    }

    function removeAmbassador(uint256 targetId, address ambassador) external override onlyOwner {
        if (!_isAmbassador[targetId][ambassador]) revert NotAmbassador();

        _isAmbassador[targetId][ambassador] = false;

        address[] storage ambassadors = alignmentTargetAmbassadors[targetId];
        for (uint256 i = 0; i < ambassadors.length; i++) {
            if (ambassadors[i] == ambassador) {
                ambassadors[i] = ambassadors[ambassadors.length - 1];
                ambassadors.pop();
                break;
            }
        }

        emit AmbassadorRemoved(targetId, ambassador);
    }

    function getAmbassadors(uint256 targetId) external view override returns (address[] memory) {
        return alignmentTargetAmbassadors[targetId];
    }

    function isAmbassador(uint256 targetId, address account) external view override returns (bool) {
        return _isAmbassador[targetId][account];
    }

    // ============ Token Lookup ============

    function isTokenInTarget(uint256 targetId, address token) external view override returns (bool) {
        AlignmentAsset[] storage assets = alignmentTargetAssets[targetId];
        for (uint256 i = 0; i < assets.length; i++) {
            if (assets[i].token == token) return true;
        }
        return false;
    }

    // ============ Community Payout ============

    /**
     * @notice Set the community payout address for an active alignment target
     * @param targetId ID of the alignment target
     * @param payout   Address that receives the community's share from the Aave endowment vault
     */
    function setCommunityPayout(uint256 targetId, address payout) external override onlyOwner {
        if (alignmentTargets[targetId].approvedAt == 0) revert TargetNotFound();
        if (!alignmentTargets[targetId].active) revert TargetNotFound();
        if (payout == address(0)) revert InvalidAddress();

        communityPayout[targetId] = payout;
        emit CommunityPayoutSet(targetId, payout);
    }

    /**
     * @notice Return the community payout address for a given alignment target
     * @param targetId ID of the alignment target
     */
    function getCommunityPayout(uint256 targetId) external view override returns (address) {
        return communityPayout[targetId];
    }

    // ============ Acquire Routing ============

    /**
     * @notice Set the owner-curated acquisition route for a target's token.
     * @dev Routing is governance data: a target knows where its own token trades, so the DAO/Safe curates it
     *      here rather than a vault creator supplying it. A creator-supplied route would be an attack surface
     *      (point a vault at an attacker pool, LP into it, drain), so this is `onlyOwner` with no other path.
     * @param targetId ID of the alignment target (must exist and be active)
     * @param token    Token that must already belong to the target
     * @param route    Venue classification + the compact params that venue's swap leg consumes
     */
    function setAcquireRoute(uint256 targetId, address token, AcquireRoute calldata route) external override onlyOwner {
        if (alignmentTargets[targetId].approvedAt == 0) revert TargetNotFound();
        if (!alignmentTargets[targetId].active) revert TargetNotFound();
        if (!_isTokenInTarget(targetId, token)) revert TokenNotInTarget();
        _validateRoute(route);

        acquireRoutes[targetId][token] = route;
        emit AcquireRouteSet(targetId, token, route.venue);
    }

    /**
     * @notice Return the acquisition route for a (target, token) pair.
     * @dev An unset pair returns `Venue.NONE` with zeroed params. Callers MUST treat `Venue.NONE` as
     *      "no route configured" and revert rather than fall back to any hardcoded pool (see noesis-031).
     */
    function getAcquireRoute(uint256 targetId, address token) external view override returns (AcquireRoute memory) {
        return acquireRoutes[targetId][token];
    }

    /// @dev Reject any route whose params are inconsistent with its venue. Governance-curated routes must be
    ///      well-formed: a malformed route (e.g. a UNI_V4 leg with fee 0) would misroute a DAO convert.
    function _validateRoute(AcquireRoute calldata route) private pure {
        if (route.venue == Venue.NONE) {
            // NONE clears the route; it must carry no params.
            if (route.fee != 0 || route.tickSpacing != 0 || route.feeOrHook != 0) revert InvalidRoute();
        } else if (route.venue == Venue.UNI_V4) {
            // Uni v4 pool key needs a real fee and tick spacing; feeOrHook is a ZAMM-only field.
            if (route.fee == 0 || route.tickSpacing == 0 || route.feeOrHook != 0) revert InvalidRoute();
        } else if (route.venue == Venue.ZAMM) {
            // ZAMM leg needs feeOrHook; the UNI_V4 fields must be empty.
            if (route.feeOrHook == 0 || route.fee != 0 || route.tickSpacing != 0) revert InvalidRoute();
        } else {
            // ALGEBRA derives its own pool and uses dynamic fees; it carries no params.
            if (route.fee != 0 || route.tickSpacing != 0 || route.feeOrHook != 0) revert InvalidRoute();
        }
    }

    /// @dev Internal mirror of `isTokenInTarget` so the setter can reuse the check without an external call.
    function _isTokenInTarget(uint256 targetId, address token) private view returns (bool) {
        AlignmentAsset[] storage assets = alignmentTargetAssets[targetId];
        for (uint256 i = 0; i < assets.length; i++) {
            if (assets[i].token == token) return true;
        }
        return false;
    }

    // ============ Reference Pool ============

    /**
     * @notice Pin the deep reference pool whose TWAP is the price authority for a `(targetId, token)` pair.
     * @dev Governance data: the anti-sandwich vault floor (noesis-037) reads this pool's own on-chain oracle
     *      TWAP — a price an attacker cannot move within a single transaction. A creator-supplied reference
     *      would let an adversary point the floor at a pool they control, so this is `onlyOwner` with no other
     *      path (mirrors `setAcquireRoute`). The setter has TEETH: it reverts unless the pool actually produces
     *      a TWAP over the window AND its pair is exactly `{token, weth}` — the fail-open floor (which today
     *      passes when the oracle can't price a thin/fresh token) is closed here.
     * @param targetId ID of the alignment target (must exist and be active)
     * @param token    Token that must already belong to the target
     * @param ref      Reference pool: `pool`, `kind` (0 = Uniswap V3, 1 = Algebra), `twapWindow` (0 => default)
     */
    function setReferencePool(uint256 targetId, address token, ReferencePool calldata ref) external override onlyOwner {
        if (alignmentTargets[targetId].approvedAt == 0) revert TargetNotFound();
        if (!alignmentTargets[targetId].active) revert TargetNotFound();
        if (!_isTokenInTarget(targetId, token)) revert TokenNotInTarget();
        if (ref.pool.code.length == 0) revert ReferencePoolUnusable();
        if (ref.kind > 1) revert InvalidReferenceKind();

        uint32 window = ref.twapWindow == 0 ? DEFAULT_TWAP_WINDOW : ref.twapWindow;
        if (ref.kind == 0) {
            _probeUniswapReference(ref.pool, token, window);
        } else {
            _probeAlgebraReference(ref.pool, token, window);
        }

        referencePools[targetId][token] = ref;
        emit ReferencePoolSet(targetId, token, ref.pool, ref.kind);
    }

    /**
     * @notice Return the reference pool for a `(target, token)` pair.
     * @dev An unset pair returns a zeroed struct (`pool == address(0)`); callers MUST treat that as
     *      "no reference configured" and NOT fall back to any hardcoded pool.
     */
    function getReferencePool(uint256 targetId, address token) external view override returns (ReferencePool memory) {
        return referencePools[targetId][token];
    }

    /// @dev Probe a Uniswap V3 reference pool: its pair must be `{token, weth}` and it must serve a TWAP over
    ///      the window. A pool that reverts on `observe` or returns fewer than two cumulatives is unusable.
    function _probeUniswapReference(address pool, address token, uint32 window) private view {
        if (!_isTokenWethPair(IUniswapV3Pool(pool).token0(), IUniswapV3Pool(pool).token1(), token)) {
            revert ReferencePoolTokenMismatch();
        }
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = window;
        secondsAgos[1] = 0;
        try IUniswapV3Pool(pool).observe(secondsAgos) returns (int56[] memory tickCumulatives, uint160[] memory) {
            if (tickCumulatives.length != 2) revert ReferencePoolUnusable();
        } catch {
            revert ReferencePoolUnusable();
        }
    }

    /// @dev Probe an Algebra reference pool: its pair must be `{token, weth}`, it must expose a volatility-oracle
    ///      plugin (`plugin() != 0`), and that oracle must serve a TWAP over the window. `token0()/token1()` are
    ///      ABI-identical to Uniswap's, so the pair read reuses the `IUniswapV3Pool` cast.
    function _probeAlgebraReference(address pool, address token, uint32 window) private view {
        if (!_isTokenWethPair(IUniswapV3Pool(pool).token0(), IUniswapV3Pool(pool).token1(), token)) {
            revert ReferencePoolTokenMismatch();
        }
        address oracle = IAlgebraPool(pool).plugin();
        if (oracle == address(0)) revert ReferencePoolUnusable();

        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = window;
        secondsAgos[1] = 0;
        try IVolatilityOracle(oracle).getTimepoints(secondsAgos) returns (
            int56[] memory tickCumulatives, uint88[] memory
        ) {
            if (tickCumulatives.length != 2) revert ReferencePoolUnusable();
        } catch {
            revert ReferencePoolUnusable();
        }
    }

    /// @dev True iff `{t0, t1}` is exactly `{token, weth}` in either order. The reference floor denominates in
    ///      ETH, so WETH MUST be one side — a non-WETH counter-asset would make the TWAP the wrong numeraire.
    function _isTokenWethPair(address t0, address t1, address token) private view returns (bool) {
        return (t0 == token && t1 == weth) || (t0 == weth && t1 == token);
    }
}
