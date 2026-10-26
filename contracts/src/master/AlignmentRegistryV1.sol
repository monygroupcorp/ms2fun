// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { SafeOwnableUUPS } from "../shared/SafeOwnableUUPS.sol";
import { IAlignmentRegistry } from "./interfaces/IAlignmentRegistry.sol";
import { MetadataUtils } from "../shared/libraries/MetadataUtils.sol";

/// @notice Minimal Uniswap V3 pool surface the reference-pool setter probes. Hand-written (repo practice:
///         see the identical interface in `peripherals/UniswapVaultPriceValidator.sol`) rather than vendored.
interface IUniswapV3Pool {
    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s);
    function token0() external view returns (address);
    function token1() external view returns (address);
    /// @dev Read from the candidate, which is untrusted: it is only a lookup key into the canonical
    ///      factory, whose answer decides. A candidate that lies about its fee tier names a different
    ///      pool, which fails the identity check.
    function fee() external view returns (uint24);
}

/// @notice The canonical Uniswap V3 factory surface, used to prove a candidate pool's PROVENANCE.
/// @dev Hand-written; the identical interface lives in `peripherals/UniswapVaultPriceValidator.sol`.
interface IUniswapV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
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
    /// @notice The candidate is shaped like a pool but the canonical factory does not name it.
    error ReferencePoolNotCanonical();
    /// @notice No canonical factory is configured for this reference kind on this deployment.
    error ReferenceKindUnavailable();
    error ReferenceTwapWindowTooShort(uint32 window, uint32 minimum);
    error InvalidMetadataURI();
    error CommunityPayoutAlreadySet();
    error CommunityPayoutNotSet();

    // ── Events ──
    /// @notice A caller asked the protocol to deploy a curated vault for `token` under `targetId`.
    /// @dev Declared on the implementation, not `IAlignmentRegistry`: the request surface is an ask, not part
    ///      of the registry's consumed read/write contract. Informational only: it grants no authority and
    ///      creates no vault.
    event VaultRequested(uint256 indexed targetId, address indexed token, address indexed requester);

    /// @notice Default TWAP window (seconds) used when a `ReferencePool.twapWindow` is left at 0.
    uint32 internal constant DEFAULT_TWAP_WINDOW = 1800;

    /// @notice Shortest TWAP window a reference pool may be pinned over.
    /// @dev The pin is the vaults' only real price floor, quoted as "a price an attacker cannot move within
    ///      a single transaction". Only the window's length contributes to that: a one-second window
    ///      averages over at most one block, so the average is a spot read and the floor is as manipulable
    ///      as the pool. The setter's other checks (factory provenance, the pair, that the oracle answers)
    ///      say which pool is read and do not bound this.
    ///
    ///      300 seconds spans ~25 mainnet blocks, so an attacker holding the price away from the market pays
    ///      the arbitrage for every one of them. It is a floor under a governance mistake, not a claim that
    ///      300 is deep enough for any pair; depth is the pinning owner's judgement.
    uint32 internal constant MIN_TWAP_WINDOW = 300;

    /// @notice Canonical WETH, injected at deploy. It is the mandatory counter-asset of every reference pool:
    ///         the anti-sandwich floor denominates in ETH, so a reference pool's other side MUST be WETH or its
    ///         TWAP is the wrong numeraire. Immutable: lives in impl bytecode, not proxy storage.
    address public immutable weth;

    /// @notice Canonical Uniswap V3 factory, injected at deploy. A kind-0 reference pool is accepted only if
    ///         THIS factory names it for the pair and fee tier the candidate reports. `address(0)` means the
    ///         venue is not on this network and no kind-0 pool can be pinned, matching the deploy config's
    ///         "address(0) means that AMM isn't here" convention. Immutable: impl bytecode, not proxy storage.
    address public immutable v3Factory;

    // ── State ──
    bool private _initialized;
    uint256 public nextAlignmentTargetId;
    mapping(uint256 => AlignmentTarget) public alignmentTargets;
    mapping(uint256 => AlignmentAsset[]) internal alignmentTargetAssets;
    mapping(uint256 => address[]) public alignmentTargetAmbassadors;
    mapping(uint256 => mapping(address => bool)) internal _isAmbassador;
    mapping(address => uint256[]) public tokenToTargetIds;
    mapping(uint256 => address) public communityPayout;

    // ── Appended storage ──
    // Storage is append-only behind the UUPS proxy: new vars go after the last one so every var above keeps
    // its slot. Layout pinned by AlignmentRegistryUpgrade.t.sol.
    mapping(uint256 => mapping(address => AcquireRoute)) internal acquireRoutes;

    // Appended after `acquireRoutes`; layout pinned by AlignmentRegistryReferencePoolUpgrade.t.sol.
    mapping(uint256 => mapping(address => ReferencePool)) internal referencePools;

    /// @param _weth Canonical WETH address (the mandatory counter-asset of every reference pool). Stored as an
    ///        immutable, so it lives in impl bytecode and adds nothing to proxy storage.
    /// @param _v3Factory Canonical Uniswap V3 factory; `address(0)` disables kind-0 references entirely.
    /// @dev Both are immutables (impl bytecode, not proxy storage), so neither moves a storage slot; the
    ///      property is pinned by `AlignmentRegistryReferencePoolUpgrade.t.sol`.
    constructor(address _weth, address _v3Factory) {
        weth = _weth;
        v3Factory = _v3Factory;
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
    ///      fund- and price-authority setters (`setCommunityPayout`, `setAcquireRoute`, `setReferencePool`) are
    ///      strictly `onlyOwner`, and `rotateCommunityPayout` answers only to the address the payout already
    ///      points at. Reverts with `Unauthorized` (the same error `onlyOwner` uses) otherwise.
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
        // An empty metadataURI is legal (a metadata-less target is representable), so the scheme allowlist
        // applies only to a non-empty value. Differs from MasterRegistryV1, which requires a URI.
        if (bytes(metadataURI).length != 0 && !MetadataUtils.isValidURI(metadataURI)) revert InvalidMetadataURI();
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

    /// @notice True iff `token` belongs to ANY currently-active alignment target.
    /// @dev Exact reverse lookup for the request registry's dup guard: it scans every target the token is
    ///      registered under (`tokenToTargetIds[token]`), not just index 0, so a token whose first target is
    ///      inactive but a later one is active is still reported active.
    function hasActiveTarget(address token) external view returns (bool) {
        uint256[] storage ids = tokenToTargetIds[token];
        for (uint256 i = 0; i < ids.length; i++) {
            if (alignmentTargets[ids[i]].active) return true;
        }
        return false;
    }

    /// @notice Signal interest in a curated vault for `(targetId, token)`. Anyone may ask; only the owner deploys.
    /// @dev    A vault's family, price validator, pool and acquisition route are all chosen by the owner at
    ///         deploy time, so a request carries an ask and no parameter from the requester. The pair is
    ///         validated before the event: the target must be active and `token` must already belong to it.
    ///
    ///         Stateless: log indexing serves the signal, so there is no pending-request storage and
    ///         requests are not deduplicated on-chain.
    /// @param targetId ID of the alignment target (must be active)
    /// @param token    Token that must already belong to the target
    function requestVault(uint256 targetId, address token) external {
        if (!alignmentTargets[targetId].active) revert TargetNotFound();
        if (!_isTokenInTarget(targetId, token)) revert TokenNotInTarget();

        emit VaultRequested(targetId, token, msg.sender);
    }

    /// @notice Deactivate an approved alignment target. Owner only, and permanent.
    /// @dev    `active` is set true once, at approval, and this is the only writer that clears it. There is no
    ///         reactivate path: a withdrawn target cannot be quietly restored; recovery is a new target.
    ///
    ///         Gated by `active = false`: `isAlignmentTargetActive` and `hasActiveTarget` (read by the
    ///         request registry's dup guard) stop reporting the target, and the owner-only writers that
    ///         require an active target, `setAcquireRoute` and `setReferencePool`, revert `TargetNotFound`.
    ///         Already-stored config is left in place.
    ///
    ///         Ambassador spending is gated without clearing appointments: `isAmbassador` still answers true,
    ///         `ambassadorCount` still counts them, and `updateAlignmentTarget` keeps working. An endowment
    ///         vault's `execute` reads `isAlignmentTargetActive` alongside `isAmbassador` and reverts
    ///         `TargetDecurated` once this clears, which freezes every ambassador's discretionary deploy at
    ///         once. A frozen corpus is not stranded: the vault's `releaseCorpusToCommunity` delivers it to
    ///         the community's own sink.
    ///
    ///         Not gated by `active = false`:
    ///          - `setCommunityPayout`. A de-curated target's vaults may still hold an accrued community cut
    ///            whose only exit resolves the payout from this registry, so the sink stays settable (once,
    ///            since it is write-once) while that money exists.
    ///          - `rotateCommunityPayout`. A pinned payout stays movable by the address holding it, so
    ///            de-curation cannot freeze a sink at an address the community has lost.
    function deactivateAlignmentTarget(uint256 targetId) external override onlyOwner {
        if (alignmentTargets[targetId].approvedAt == 0) revert TargetNotFound();
        alignmentTargets[targetId].active = false;
        emit AlignmentTargetDeactivated(targetId);
    }

    /// @dev Owner or an appointed ambassador of `targetId` may update the target's description/metadataURI,
    ///      the safe metadata field an ambassador maintains for its community. No other authority.
    function updateAlignmentTarget(uint256 targetId, string memory description, string memory metadataURI)
        external
        override
        onlyOwnerOrAmbassador(targetId)
    {
        if (alignmentTargets[targetId].approvedAt == 0) revert TargetNotFound();
        // Empty clears the URI and is legal; a non-empty one must satisfy the scheme allowlist.
        if (bytes(metadataURI).length != 0 && !MetadataUtils.isValidURI(metadataURI)) revert InvalidMetadataURI();

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

    /// @notice How many ambassadors are currently appointed on `targetId`.
    /// @dev    Appointments survive de-curation (the spending power does not), so this is the number of seats
    ///         that keep metadata authority and the number of `removeAmbassador` calls that end it.
    function ambassadorCount(uint256 targetId) external view override returns (uint256) {
        return alignmentTargetAmbassadors[targetId].length;
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
     * @notice Pin the community payout address for an approved alignment target, write-once.
     * @dev    The owner pins a target's payout exactly once, zero to nonzero; every later call reverts
     *         `CommunityPayoutAlreadySet`. Once pinned, no function on this registry or on any vault reading
     *         it moves it for anyone but the address holding it. That holds for this contract and the
     *         vaults' read of it, subject to two calls that reach past this function and each leave their
     *         own event on their own address:
     *
     *         (i) This registry is UUPS and `_authorizeUpgrade` is `onlyOwner`, so the owner can replace the
     *         implementation. On-chain that is `Upgraded` on this address.
     *
     *         (ii) `MasterRegistryV1.setAlignmentRegistry` is a bare `onlyOwner` address write, and
     *         `AlignmentEndowmentVault._targetSink()` resolves `masterRegistry.alignmentRegistry()` live at
     *         send time, so one call re-points payout, ambassador and curation for every endowment clone
     *         without touching this contract. On-chain that is `AlignmentRegistrySet` on `MasterRegistryV1`.
     *
     *         A monitor must watch both. The three liquidity vault families are not reached by (ii): they
     *         pin their own `alignmentRegistry` at `initialize` and have no setter for it. Both registries
     *         are `SafeOwnableUUPS` owned by the same timelock (`script/MigrateOwnership.s.sol`), so (ii)
     *         grants no capability beyond (i). Narrowing either is a governance change on the owner.
     *
     *         There is no owner-side correction path: a lever that fixes a mistyped first address is the
     *         redirect capability under another name. A wrong first address is permanent from the owner's
     *         side; the address itself can move the payout with `rotateCommunityPayout`, and otherwise the
     *         recovery is a new curated target.
     *
     *         Not gated on `active`. Every alignment vault accrues the target's cut and pays it out only
     *         through this registry's answer, to a sink the caller cannot choose; a target de-curated before
     *         its payout was pinned would otherwise seal that accrued ETH permanently, since
     *         `deactivateAlignmentTarget` is one-way. Pinning on a de-curated target does not restore
     *         curation and opens no redirect surface. `approvedAt` is still required.
     * @param targetId ID of the alignment target
     * @param payout   Address that receives the community's share from this target's alignment vaults
     */
    function setCommunityPayout(uint256 targetId, address payout) external override onlyOwner {
        if (alignmentTargets[targetId].approvedAt == 0) revert TargetNotFound();
        if (payout == address(0)) revert InvalidAddress();
        if (communityPayout[targetId] != address(0)) revert CommunityPayoutAlreadySet();

        communityPayout[targetId] = payout;
        emit CommunityPayoutSet(targetId, payout);
    }

    /**
     * @notice Move a community's payout onward. Callable only by the address currently receiving it.
     * @dev    Neither the owner nor an ambassador can move the payout; authority is the current sink, so the
     *         caller already receives the funds and gains nothing by calling.
     *
     *         Not gated on `alignmentTargets[targetId].active`: the pinned sink keeps receiving whatever the
     *         vaults still hold, and gating on `active` would let the owner freeze the payout by
     *         deactivating the target.
     * @param targetId  ID of the alignment target (must already have a payout pinned)
     * @param newPayout Address that receives the community's share from here on
     */
    function rotateCommunityPayout(uint256 targetId, address newPayout) external override {
        address current = communityPayout[targetId];
        if (current == address(0)) revert CommunityPayoutNotSet();
        if (msg.sender != current) revert Unauthorized();
        if (newPayout == address(0)) revert InvalidAddress();

        communityPayout[targetId] = newPayout;
        emit CommunityPayoutRotated(targetId, current, newPayout);
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
     * @dev Routing is governance data curated by the owner, not supplied by a vault creator: a
     *      creator-supplied route would let a vault be pointed at an attacker pool, so this is `onlyOwner`
     *      with no other path.
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
     *      "no route configured" and revert rather than fall back to any hardcoded pool.
     */
    function getAcquireRoute(uint256 targetId, address token) external view override returns (AcquireRoute memory) {
        return acquireRoutes[targetId][token];
    }

    /// @dev Reject any route whose params are inconsistent with its venue; a malformed route (e.g. a UNI_V4
    ///      leg with fee 0) would misroute a DAO convert.
    function _validateRoute(AcquireRoute calldata route) private pure {
        if (route.venue == Venue.NONE) {
            // NONE clears the route; it must carry no params.
            if (route.fee != 0 || route.tickSpacing != 0 || route.feeOrHook != 0) revert InvalidRoute();
        } else if (route.venue == Venue.UNI_V4) {
            // Uni v4 pool key needs a real fee and tick spacing; feeOrHook is a ZAMM-only field.
            if (route.fee == 0 || route.tickSpacing == 0 || route.feeOrHook != 0) revert InvalidRoute();
        } else {
            // ZAMM leg needs feeOrHook; the UNI_V4 fields must be empty. A word outside the enum reverts
            // in the ABI decode before it reaches here.
            if (route.feeOrHook == 0 || route.fee != 0 || route.tickSpacing != 0) revert InvalidRoute();
        }
    }

    /// @dev Internal mirror of `isTokenInTarget`.
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
     * @dev Governance data: the anti-sandwich vault floor reads this pool's own on-chain oracle TWAP, a
     *      price an attacker cannot move within a single transaction. A creator-supplied reference would
     *      let an adversary point the floor at a pool they control, so this is `onlyOwner` with no other
     *      path (mirrors `setAcquireRoute`). It reverts unless the canonical factory for the kind names
     *      this exact pool, its pair is exactly `{token, weth}`, and it produces a TWAP over the window.
     *
     *      "Deep" in the name is an instruction to the owner, not a property the code checks: a canonical
     *      pool can still be thin or freshly seeded. What is enforced is origin; depth is the pinning
     *      owner's judgement.
     *
     *      The one magnitude enforced is the window, which must be at least `MIN_TWAP_WINDOW`: origin says
     *      which pool is read, and only the window's length says over how long.
     * @param targetId ID of the alignment target (must exist and be active)
     * @param token    Token that must already belong to the target
     * @param ref      Reference pool: `pool`, `kind` (0 = Uniswap V3, the only accepted value), `twapWindow`
     *                 (0 => `DEFAULT_TWAP_WINDOW`, resolved here and stored, so what is read back is the
     *                 window this pool was proved over and never a bare `0`)
     */
    function setReferencePool(uint256 targetId, address token, ReferencePool calldata ref) external override onlyOwner {
        if (alignmentTargets[targetId].approvedAt == 0) revert TargetNotFound();
        if (!alignmentTargets[targetId].active) revert TargetNotFound();
        if (!_isTokenInTarget(targetId, token)) revert TokenNotInTarget();
        if (ref.pool.code.length == 0) revert ReferencePoolUnusable();
        if (ref.kind != 0) revert InvalidReferenceKind();

        uint32 window = ref.twapWindow == 0 ? DEFAULT_TWAP_WINDOW : ref.twapWindow;
        // Checked on the resolved window, so the `0` shorthand meets the same floor as an explicit value.
        if (window < MIN_TWAP_WINDOW) revert ReferenceTwapWindowTooShort(window, MIN_TWAP_WINDOW);
        _probeUniswapReference(ref.pool, token, window);

        // Store the window that was proved, never the caller's `0`: a zero would otherwise resolve against
        // `DEFAULT_TWAP_WINDOW` here and against the price validator's `twapSecondsAgo` at read time. The
        // reader must ask for the window the prover used; a pool with 1800s of history pinned under a
        // validator configured at 3600 would otherwise pin cleanly and then revert `ReferenceTwapUnavailable`
        // in the vault's floor path.
        referencePools[targetId][token] = ReferencePool({ pool: ref.pool, kind: ref.kind, twapWindow: window });
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

    /// @dev Probe a Uniswap V3 reference pool: the canonical factory must NAME it, its pair must be
    ///      `{token, weth}`, and it must serve a TWAP over the window. A pool that reverts on `observe` or
    ///      returns fewer than two cumulatives is unusable.
    function _probeUniswapReference(address pool, address token, uint32 window) private view {
        address t0 = IUniswapV3Pool(pool).token0();
        address t1 = IUniswapV3Pool(pool).token1();
        if (!_isTokenWethPair(t0, t1, token)) revert ReferencePoolTokenMismatch();
        _requireCanonicalUniswapPool(pool, t0, t1);

        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = window;
        secondsAgos[1] = 0;
        try IUniswapV3Pool(pool).observe(secondsAgos) returns (int56[] memory tickCumulatives, uint160[] memory) {
            if (tickCumulatives.length != 2) revert ReferencePoolUnusable();
        } catch {
            revert ReferencePoolUnusable();
        }
    }

    /**
     * @dev Prove a kind-0 candidate is a pool the CANONICAL Uniswap V3 factory deployed, not merely a contract
     *      shaped like one. Everything the candidate reports — `token0`, `token1`, `fee` — is attacker-chosen
     *      if the candidate is attacker-authored, so none of it is trusted on its own; it is used only as a
     *      lookup key, and `getPool` returning THIS address is the single fact that decides. A forgery names
     *      either nothing (`address(0)`) or the genuine pool, and both fail the identity check.
     *
     *      It does not prove depth: a real factory-minted pool can still be thin, fresh, or seeded by the
     *      party being priced. Depth is the owner's judgement; the code guarantees the TWAP is read from a
     *      pool the venue made.
     */
    function _requireCanonicalUniswapPool(address pool, address t0, address t1) private view {
        if (v3Factory == address(0)) revert ReferenceKindUnavailable();
        if (IUniswapV3Factory(v3Factory).getPool(t0, t1, IUniswapV3Pool(pool).fee()) != pool) {
            revert ReferencePoolNotCanonical();
        }
    }

    /// @dev True iff `{t0, t1}` is exactly `{token, weth}` in either order. The reference floor denominates in
    ///      ETH, so WETH MUST be one side — a non-WETH counter-asset would make the TWAP the wrong numeraire.
    function _isTokenWethPair(address t0, address t1, address token) private view returns (bool) {
        return (t0 == token && t1 == weth) || (t0 == weth && t1 == token);
    }
}
