// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { DN404Mirror } from "dn404/src/DN404Mirror.sol";
import { OwnableRoles } from "solady/auth/OwnableRoles.sol";
import { ReentrancyGuard } from "solady/utils/ReentrancyGuard.sol";
import { SafeTransferLib } from "solady/utils/SafeTransferLib.sol";
import { IMasterRegistry } from "../../master/interfaces/IMasterRegistry.sol";
import { FeatureUtils } from "../../master/libraries/FeatureUtils.sol";
import { IAlignmentVault } from "../../interfaces/IAlignmentVault.sol";
import { IFactory } from "../../interfaces/IFactory.sol";
import { ICurveComputer } from "../../interfaces/ICurveComputer.sol";
import { ERC404BondingInstance } from "./ERC404BondingInstance.sol";
import { ERC404BondingStorage, InvalidBand, BandIdOverflow } from "./ERC404BondingStorage.sol";
import { LaunchManager } from "./LaunchManager.sol";
import { IComponentRegistry } from "../../registry/interfaces/IComponentRegistry.sol";
import { FreeMintParams } from "../../interfaces/IFactoryTypes.sol";
import { GatingScope } from "../../gating/IGatingModule.sol";
import { ICreateX, CREATEX } from "../../shared/CreateXConstants.sol";
import { RevenueSplitLib } from "../../shared/libraries/RevenueSplitLib.sol";
import { MetadataResolverRouter } from "../../metadata/MetadataResolverRouter.sol";
import { TokenTierBandResolver } from "../../metadata/TokenTierBandResolver.sol";
import { MetadataOverlayModule } from "../../metadata/MetadataOverlayModule.sol";

/// @dev Minimal surface of the deploy-bond escrow the factory drives at create. The escrow is a
///      SEPARATE contract (holds the ETH) so the factory keeps its "holds no ETH" invariant.
interface IDeployBondEscrow {
    function bondAmount() external view returns (uint256);
    function postBond(address instance, address creator) external payable;
}

/**
 * @title ERC404Factory
 * @notice Deploys and registers ERC404 bonding token instances.
 *         Single responsibility: validate → deploy via CREATE3 → register.
 *         Protocol fees flow directly to treasury — no custody.
 *         Bonding curve params are derived from LaunchManager presets.
 */
contract ERC404Factory is OwnableRoles, ReentrancyGuard, IFactory {
    uint256 public constant PROTOCOL_ROLE = _ROLE_0; // 1 << 0 = 1

    /// @dev Infrastructure only — no AMM-specific addresses.
    struct CoreConfig {
        address implementation;
        address masterRegistry;
        address protocol;
        address weth;
    }

    /// @dev Module addresses.
    struct ModuleConfig {
        address globalMessageRegistry;
        address componentRegistry;
        address launchManager;
    }

    /// @notice Parameters for instance creation.
    struct CreateParams {
        bytes32 salt;
        string name;
        string symbol;
        string styleUri;
        string tokenBaseURI; // NFT base URI for tokenURI(tokenId); independent of the project metadataURI
        address owner;
        address vault;
        uint256 nftCount;
        uint8 presetId;
        address stakingModule; // address(0) = staking not available for this instance
        // Fraction (bps, <= 10000) of the protocol carve allowance this creator may ever take at
        // graduation. IMMUTABLE per instance — a disclosure buyers can price in before the first buy.
        uint16 declaredMaxAllowanceBps;
    }

    /// @notice Metadata-resolution stack config (ADR-0006/0007). Empty (resolver == address(0)) = feature off.
    /// @dev `resolver` is what the instance's METADATA_RESOLVER slot points at — a MetadataResolverRouter
    ///      (then `childResolvers` is its ordered list) or a single resolver module (then childResolvers
    ///      empty). `overlay`/`tier` are the concrete module addresses to seal per-instance config on
    ///      (address(0) = skip that module). Everything is registry-validated, wired once, then frozen.
    /// @dev `tiers` is the SINGLE source of truth for Token Tiers. The creator supplies the economic
    ///      ladder once and the factory derives every id range from it, sealing the instance's ladder
    ///      (`initTierBands`) and the resolver's art table (`initBands`) from the SAME derived ranges —
    ///      so the two tables cannot describe different ids. Non-empty is REQUIRED whenever `tier` is
    ///      set: a tier module wired with no ladder is an instance whose tier ops are permanent no-ops.
    struct MetadataConfig {
        address resolver; // instance modules[METADATA_RESOLVER] target
        address[] childResolvers; // router's ordered children (empty if no router)
        address overlay; // overlay module to initConfig (address(0) = skip)
        address tier; // tier module to initBands (address(0) = skip)
        TierSpec[] tiers; // the economic ladder; id ranges are DERIVED from it (sealed at create)
        bool autoLatest; // overlay initial policy
        MetadataOverlayModule.Payout defaultPayout;
    }

    /// @notice One rung of the Token Tiers ladder, as the creator supplies it. Id ranges are never
    ///         hand-typed — `_wireMetadata` packs them contiguously above the instance's id ceiling.
    struct TierSpec {
        /// @dev Denomination: this tier's NFT is worth `weight` coin units. Must be >= 2 and strictly
        ///      increasing across the list (enforced by the instance's `initTierBands` seal).
        uint32 weight;
        /// @dev How many ids this tier has. 0 => the maximum, `idLimit / weight`. A value above that
        ///      maximum is CLAMPED to it, never rejected. Below it the tier is deliberately scarce:
        ///      it can sell out (`BandExhausted`) while coin remains, and reopens on `mintDown`.
        uint32 count;
        /// @dev Band art prefix; resolves to `baseURI + id`. "" => fall through to the collection base.
        string baseURI;
    }

    bytes32 internal constant METADATA_RESOLVER = keccak256("metadata.resolver");

    // slither-disable-next-line immutable-states
    IMasterRegistry public masterRegistry;
    address public immutable globalMessageRegistry;
    // slither-disable-next-line immutable-states
    address public implementation;

    address public protocolTreasury;
    address public weth;
    uint256 public bondingFeeBps = 100; // 1% default

    /// @notice Refundable deploy-bond escrow (N12 lever). address(0) OR its `bondAmount() == 0`
    ///         means the lever is OFF and create behaves byte-identically to today.
    address public deployBondEscrow;

    // ── Graduation-carve params (read LIVE by instances at graduation) ────────
    /// @notice Minimum ETH the LP pool must keep at graduation. A carve-CLAMP, never a
    ///         graduation gate: thin raises still graduate, the floor only eats carve headroom.
    uint256 public minPoolEth = 1 ether;
    /// @dev Progressive carve-allowance brackets: 50% of first 4 ETH, 25% of next 16, 10% beyond 20.
    RevenueSplitLib.BracketParams internal _carveBrackets =
        RevenueSplitLib.BracketParams({ b1: 4 ether, b2: 20 ether, r1: 5000, r2: 2500, r3: 1000 });

    LaunchManager public immutable launchManager;
    IComponentRegistry public immutable componentRegistry;

    bytes32[] internal _features = [FeatureUtils.GATING, FeatureUtils.LIQUIDITY_DEPLOYER, FeatureUtils.STAKING];

    event InstanceCreated(
        address indexed instance, address indexed creator, string name, string symbol, address indexed vault
    );
    event VaultCapabilityWarning(address indexed vault, bytes32 indexed capability);
    error ProtocolRoleNotTransferable();
    error InvalidAddress();
    error InvalidImplementation();
    error InvalidGlobalMessageRegistry();
    error InvalidLaunchManager();
    error InvalidComponentRegistry();
    error InvalidNftCount();
    error InvalidName();
    error InvalidSymbol();
    error InvalidOwner();
    error VaultRequired();
    error VaultMustBeContract();
    error UnapprovedVault();
    error NameAlreadyTaken();
    error FreeMintAllocationExceedsNftCount();
    error UnapprovedLiquidityDeployer();
    error UnapprovedGatingModule();
    error UnapprovedStakingModule();
    error UnapprovedCurveComputer();
    error UnapprovedResolver();
    error MaxBondingFeeExceeded();
    error NotAuthorizedAgent();
    error InvalidDeclaredMaxAllowance();
    error InvalidBracketParams();
    error InsufficientBond();
    /// @notice ERC404 + endowment is not a selectable pairing (rth ruling 2026-08-05). ERC404
    ///         graduation splits with `RevenueSplitLib.split` (flat 1/19/80) and is family-blind, so
    ///         an endowment vault's yield leg would bypass the stakers the endowment exists to fund.
    ///         Refused at create-time rather than made family-aware downstream.
    error EndowmentVaultNotSupported();

    event ProtocolTreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event DeployBondEscrowUpdated(address indexed oldEscrow, address indexed newEscrow);
    event BondingFeeUpdated(uint256 newBps);
    event MinPoolEthUpdated(uint256 newMinPoolEth);
    event CarveBracketsUpdated(uint256 b1, uint256 b2, uint16 r1, uint16 r2, uint16 r3);
    event DeclaredMaxAllowance(address indexed instance, uint16 declaredMaxAllowanceBps);

    constructor(CoreConfig memory core, ModuleConfig memory modules) {
        if (core.implementation == address(0)) revert InvalidImplementation();
        if (core.protocol == address(0)) revert InvalidAddress();
        if (core.weth == address(0)) revert InvalidAddress();
        if (modules.globalMessageRegistry == address(0)) revert InvalidGlobalMessageRegistry();
        if (modules.launchManager == address(0)) revert InvalidLaunchManager();
        if (modules.componentRegistry == address(0)) revert InvalidComponentRegistry();
        _initializeOwner(core.protocol);
        _grantRoles(core.protocol, PROTOCOL_ROLE);
        implementation = core.implementation;
        masterRegistry = IMasterRegistry(core.masterRegistry);
        weth = core.weth;
        globalMessageRegistry = modules.globalMessageRegistry;
        launchManager = LaunchManager(modules.launchManager);
        componentRegistry = IComponentRegistry(modules.componentRegistry);
    }

    /// @notice Transfer PROTOCOL_ROLE to a new address.
    function transferProtocolRole(address newProtocol) external onlyRoles(PROTOCOL_ROLE) {
        if (newProtocol == address(0)) revert InvalidAddress();
        _removeRoles(msg.sender, PROTOCOL_ROLE);
        _grantRoles(newProtocol, PROTOCOL_ROLE);
    }

    /// @dev Prevent owner from granting/revoking PROTOCOL_ROLE via base OwnableRoles.
    function grantRoles(address user, uint256 roles) public payable override onlyOwner {
        if (roles & PROTOCOL_ROLE != 0) revert ProtocolRoleNotTransferable();
        super.grantRoles(user, roles);
    }

    /// @dev Prevent owner from granting/revoking PROTOCOL_ROLE via base OwnableRoles.
    function revokeRoles(address user, uint256 roles) public payable override onlyOwner {
        if (roles & PROTOCOL_ROLE != 0) revert ProtocolRoleNotTransferable();
        super.revokeRoles(user, roles);
    }

    /// @notice Create an instance with a caller-supplied liquidity deployer and optional gating module.
    ///         Any ETH forwarded goes directly to treasury — factory holds no ETH.
    /// @dev The gating module is attached (address(0) = open); its config is authored post-create by the
    ///      owner via the module's own typed setter — the factory does not thread module config at create.
    function createInstance(
        CreateParams calldata params,
        string calldata metadataURI,
        address liquidityDeployer,
        address gatingModule,
        FreeMintParams calldata freeMint
    ) external payable nonReentrant returns (address instance) {
        MetadataConfig memory emptyMeta;
        return _createInstance(params, metadataURI, liquidityDeployer, gatingModule, freeMint, emptyMeta);
    }

    /// @notice Create an instance and wire a metadata-resolution stack (ADR-0006/0007) in the same tx.
    /// @param metadataConfig Resolver pointer + router children + sealed band/overlay config.
    ///        Empty (resolver == address(0)) leaves the instance with no metadata augmentation.
    function createInstance(
        CreateParams calldata params,
        string calldata metadataURI,
        address liquidityDeployer,
        address gatingModule,
        FreeMintParams calldata freeMint,
        MetadataConfig calldata metadataConfig
    ) external payable nonReentrant returns (address instance) {
        return _createInstance(params, metadataURI, liquidityDeployer, gatingModule, freeMint, metadataConfig);
    }

    function _createInstance(
        CreateParams calldata params,
        string calldata metadataURI,
        address liquidityDeployer,
        address gatingModule,
        FreeMintParams calldata freeMint,
        MetadataConfig memory metadataConfig
    ) private returns (address instance) {
        if (gatingModule != address(0)) {
            if (!componentRegistry.isApprovedForTag(gatingModule, FeatureUtils.GATING)) {
                revert UnapprovedGatingModule();
            }
        }
        if (params.stakingModule != address(0)) {
            if (!componentRegistry.isApprovedForTag(params.stakingModule, FeatureUtils.STAKING)) {
                revert UnapprovedStakingModule();
            }
        }

        // Route creation ETH. Deploy-bond lever (N12) is OFF when no escrow is wired or its
        // bondAmount is 0 → forward everything to treasury exactly as before (factory holds no ETH).
        // When ON: hold the bond, forward only the excess now; the bond is escrowed after the
        // instance address is known (see `escrow.postBond` below — the instance is the bond key).
        uint256 bondAmt = deployBondEscrow == address(0) ? 0 : IDeployBondEscrow(deployBondEscrow).bondAmount();
        if (bondAmt == 0) {
            // Lever off — byte-identical to prior behavior.
            if (msg.value > 0 && protocolTreasury != address(0)) {
                SafeTransferLib.safeTransferETH(protocolTreasury, msg.value);
            }
        } else {
            if (msg.value < bondAmt) revert InsufficientBond();
            uint256 excess = msg.value - bondAmt;
            if (excess > 0 && protocolTreasury != address(0)) {
                SafeTransferLib.safeTransferETH(protocolTreasury, excess);
            }
        }

        // Validate params
        if (params.nftCount == 0) revert InvalidNftCount();
        if (bytes(params.name).length == 0) revert InvalidName();
        if (bytes(params.symbol).length == 0) revert InvalidSymbol();
        if (params.owner == address(0)) revert InvalidOwner();
        if (params.vault == address(0)) revert VaultRequired();
        if (params.vault.code.length == 0) revert VaultMustBeContract();
        // Registry-gate the alignment vault at create-time. The 19% graduation vaultCut (the
        // CULT-alignment tithe) must only ever flow to a vault the master registry has
        // registered/alignment-validated — a code.length check alone lets the tithe be redirected
        // to an unregistered contract. Vaults are NOT componentRegistry components; the authority
        // is masterRegistry.isVaultRegistered (mirrors migrateVault's registry gate).
        if (!masterRegistry.isVaultRegistered(params.vault)) revert UnapprovedVault();
        _rejectEndowmentVault(params.vault);
        if (params.declaredMaxAllowanceBps > 10000) revert InvalidDeclaredMaxAllowance();

        // Agent-on-behalf-of check
        bool agentCreated = false;
        if (msg.sender != params.owner) {
            if (!masterRegistry.isAgent(msg.sender)) revert NotAuthorizedAgent();
            agentCreated = true;
        }

        if (masterRegistry.isNameTaken(params.name)) revert NameAlreadyTaken();
        if (freeMint.allocation >= params.nftCount) revert FreeMintAllocationExceedsNftCount();

        // Validate liquidity deployer
        if (!componentRegistry.isApprovedForTag(liquidityDeployer, FeatureUtils.LIQUIDITY_DEPLOYER)) {
            revert UnapprovedLiquidityDeployer();
        }

        // Soft vault capability check — YIELD_GENERATION is expected for ERC404 staking rewards
        try IAlignmentVault(payable(params.vault)).supportsCapability(keccak256("YIELD_GENERATION")) returns (
            bool supported
        ) {
            if (!supported) emit VaultCapabilityWarning(params.vault, keccak256("YIELD_GENERATION"));
        } catch {
            emit VaultCapabilityWarning(params.vault, keccak256("YIELD_GENERATION"));
        }

        instance = _deployAndInitialize(params, metadataURI, liquidityDeployer, gatingModule, freeMint, agentCreated);
        // Escrow the held bond now that the instance address (the bond key) exists. Lever off ⇒
        // bondAmt == 0 ⇒ no escrow interaction, so this is a no-op on the current create path.
        if (bondAmt > 0) {
            IDeployBondEscrow(deployBondEscrow).postBond{ value: bondAmt }(instance, params.owner);
        }
        masterRegistry.registerInstance(instance, address(this), params.owner, params.name, metadataURI, params.vault);
        // Staking wired after registration — module's enableStaking checks isRegisteredInstance
        if (params.stakingModule != address(0)) {
            ERC404BondingInstance(payable(instance)).initializeStaking(params.stakingModule);
        }
        // Gating module is attached at create (see _deployAndInitialize); its config is authored
        // post-create by the owner via the module's own typed setter. The factory threads no gating
        // config at create — the generic gating slot must not bake in any one module's config shape.
        // Metadata-resolution stack — its OWN wiring path (NOT routed through gatingModule).
        // Empty config (resolver == address(0)) = feature off.
        _wireMetadata(instance, metadataConfig);
        emit DeclaredMaxAllowance(instance, params.declaredMaxAllowanceBps);
        emit InstanceCreated(instance, params.owner, params.name, params.symbol, params.vault);
    }

    /// @dev Validate (registry) and seal the metadata-resolution stack onto `instance`. All pointers
    ///      are registry-validated; the instance slot + router list + band table + overlay config are
    ///      each wired exactly once here, then frozen (sealed mechanism — no owner setter).
    function _wireMetadata(address instance, MetadataConfig memory cfg) private {
        if (cfg.resolver == address(0)) return; // feature off

        // Resolver slot accepts any resolver-family module (a MetadataResolverRouter or a single
        // resolver/overlay/tier module used directly), matching the MetadataConfig docstring. The
        // family check still rejects a gating/staking/liquidity module in the slot (the actual hole).
        if (!_isApprovedResolverFamily(cfg.resolver)) revert UnapprovedResolver();
        ERC404BondingInstance(payable(instance)).initModule(METADATA_RESOLVER, cfg.resolver);

        // Router children (precedence order), validated + sealed. Empty when resolver is a single module.
        if (cfg.childResolvers.length > 0) {
            for (uint256 i = 0; i < cfg.childResolvers.length; i++) {
                if (!_isApprovedResolverFamily(cfg.childResolvers[i])) revert UnapprovedResolver();
            }
            MetadataResolverRouter(cfg.resolver).initResolvers(instance, cfg.childResolvers);
        }

        // Per-module sealed config.
        if (cfg.tier != address(0)) {
            if (!componentRegistry.isApprovedForTag(cfg.tier, FeatureUtils.TIER)) revert UnapprovedResolver();
            // A tier module with no ladder produces an instance whose `tierBands` is empty, which the
            // instance's gas short-circuit reads as "opted out of tiers" — mintUp/mintDown/escrow and
            // the burn-safety hook all become permanent no-ops, and the ladder seal is create-only so
            // nobody can repair it afterwards. That state must not be constructible.
            if (cfg.tiers.length == 0) revert InvalidBand();

            // Derive every id range ONCE, then seal the ladder and the art table from the same list.
            (ERC404BondingStorage.TierBand[] memory ladder, TokenTierBandResolver.Band[] memory art) =
                _deriveTierBands(instance, cfg.tiers);

            // Ladder first: the economics are what make the art meaningful, and a rejected ladder must
            // not leave a sealed art table behind on a create that reverts anyway.
            ERC404BondingInstance(payable(instance)).initTierBands(ladder);
            // No minBalance guard here any more: Token Tiers art is static and unconditional, so
            // there is no threshold that a zero value could defeat. Range sanity (ascending,
            // non-overlapping, idEnd >= idStart) is validated by the resolver at seal.
            TokenTierBandResolver(cfg.tier).initBands(instance, art);
        }
        if (cfg.overlay != address(0)) {
            if (!componentRegistry.isApprovedForTag(cfg.overlay, FeatureUtils.OVERLAY)) revert UnapprovedResolver();
            MetadataOverlayModule(cfg.overlay).initConfig(instance, cfg.autoLatest, cfg.defaultPayout);
        }
    }

    /// @dev Derive the Token Tiers id ranges from the creator's ladder, and return them in BOTH shapes:
    ///      the instance's economic `TierBand[]` and the resolver's art `Band[]`. One derivation, two
    ///      consumers — that is what makes it impossible for the art table and the ladder to disagree.
    ///
    ///      Geometry: `idLimit = maxSupply / unit` is the ordinary id ceiling (the same value the
    ///      instance's `initTierBands` recomputes for its own bound). Bands pack CONTIGUOUSLY ascending
    ///      from `idLimit + 1`, so every band id is above the ordinary space and therefore unreachable
    ///      by DN404's auto-mint. Each tier's size is `min(count, idLimit / weight)`, with `count == 0`
    ///      meaning the maximum — a caller asking for more than the coin supply could back is clamped,
    ///      not rejected, while a smaller `count` is an intentional scarce tier.
    ///
    ///      ALL ARITHMETIC IS `uint256` AND EVERY RANGE IS REJECTED BEFORE NARROWING. Bands pack ABOVE
    ///      `idLimit`, and DN404 permits an `idLimit` as high as `0xfffffffe`, so a derived `idEnd`
    ///      genuinely exceeds `uint32` on a large supply. A bare `uint32(...)` cast would truncate
    ///      silently and wrap the band back DOWN into the ordinary id space — handing auto-mintable ids
    ///      to the tier path and sealing a band OTHER than the one derived here, the worst outcome
    ///      available on this path. So `idEnd > type(uint32).max` reverts `BandIdOverflow` before any
    ///      assignment into `TierBand`'s `uint32` fields. This is the only live uint32 rejection in the
    ///      system: at the seal the bound is structural (the `idEnd` field is itself `uint32`), so the
    ///      check can only matter here. `idEnd >= idStart` always, so checking `idEnd` alone covers the
    ///      whole range.
    ///
    ///      `weight == 0` is caught by the zero-size rule rather than by a bare division: `idLimit / 0`
    ///      would panic (0x12) before the seal could raise `InvalidBand`. The `weight >= 2` and
    ///      strictly-increasing rules are NOT duplicated here — the seal owns them, and duplicating a
    ///      money-code invariant is how the two copies drift.
    function _deriveTierBands(address instance, TierSpec[] memory tiers)
        private
        view
        returns (ERC404BondingStorage.TierBand[] memory ladder, TokenTierBandResolver.Band[] memory art)
    {
        ERC404BondingInstance inst = ERC404BondingInstance(payable(instance));
        uint256 idLimit = inst.maxSupply() / inst.unit();

        uint256 n = tiers.length;
        ladder = new ERC404BondingStorage.TierBand[](n);
        art = new TokenTierBandResolver.Band[](n);

        uint256 prevEnd = idLimit; // bands start strictly above the ordinary id space
        for (uint256 i = 0; i < n; i++) {
            uint32 weight = tiers[i].weight;
            uint256 maxSize = weight == 0 ? 0 : idLimit / uint256(weight);
            uint256 count = tiers[i].count;
            uint256 size = count == 0 || count > maxSize ? maxSize : count;
            if (size == 0) revert InvalidBand();

            uint256 idStart = prevEnd + 1;
            uint256 idEnd = idStart + size - 1;
            // Reject BEFORE narrowing. `idEnd >= idStart`, so bounding `idEnd` bounds the whole range.
            if (idEnd > type(uint32).max) revert BandIdOverflow();

            ladder[i] =
                ERC404BondingStorage.TierBand({ idStart: uint32(idStart), idEnd: uint32(idEnd), weight: weight });
            art[i] = TokenTierBandResolver.Band({ idStart: idStart, idEnd: idEnd, baseURI: tiers[i].baseURI });
            prevEnd = idEnd;
        }
    }

    /// @dev Resolver-family membership: an approved component tagged RESOLVER, OVERLAY, or TIER.
    ///      The resolver slot and its child resolvers accept any of these (a router or a single
    ///      resolver/overlay/tier module used directly). Membership is composed here in the factory
    ///      (over three tag-scoped registry reads) so the registry stays type-agnostic.
    function _isApprovedResolverFamily(address component) private view returns (bool) {
        return componentRegistry.isApprovedForTag(component, FeatureUtils.RESOLVER)
            || componentRegistry.isApprovedForTag(component, FeatureUtils.OVERLAY)
            || componentRegistry.isApprovedForTag(component, FeatureUtils.TIER);
    }

    /// @dev Create-time family gate: refuse an endowment-family alignment vault for an ERC404.
    ///      ERC404 graduation uses the family-BLIND `RevenueSplitLib.split` (1/19/80), so an
    ///      `AaveEndowment` vault paired here would route today's yield down a path that bypasses
    ///      the stakers the endowment is meant to fund. rth's ruling (2026-08-05): refuse the
    ///      pairing at create rather than make the graduation split family-aware.
    ///
    ///      FAILS OPEN on anything that is not a positively-decoded endowment string: an unknown
    ///      `vaultType()`, a reverting one, or one returning undecodable data all CREATE FINE.
    ///      Only the master registry curates which vaults may be used at all; this gate exists to
    ///      exclude one known-bad family, never to brick a future, legitimately-registered type.
    ///
    ///      Hence a raw `staticcall` + a fully guarded decode rather than the `try
    ///      IAlignmentVault(...).vaultType() returns (string memory)` shape used by the capability
    ///      probe below: `try…returns` catches a REVERT but NOT a return-data DECODE failure — the
    ///      decode happens in the caller's frame, so malformed return data bubbles out of the
    ///      `catch` and would brick the create. Decoding by hand behind explicit bounds is the only
    ///      way to honour "fail open" against a hostile/buggy vault.
    function _rejectEndowmentVault(address vault) private view {
        (bool ok, bytes memory ret) = vault.staticcall(abi.encodeCall(IAlignmentVault.vaultType, ()));
        // A single dynamic return value is ABI-encoded as: [0x00..0x1f] head offset,
        // [offset..offset+0x1f] byte length, then `length` bytes of payload right-padded to a
        // 32-byte multiple. So the shortest well-formed encoding (an empty string) is 64 bytes.
        if (!ok || ret.length < 64) return;

        uint256 head;
        uint256 len;
        assembly ("memory-safe") {
            head := mload(add(ret, 0x20)) // the head word: offset to the string's length word
            len := mload(add(ret, 0x40)) // the word at offset 0x20 — the length, if canonical
        }
        uint256 payload = ret.length - 64; // safe: `ret.length >= 64` checked above

        // Each bound rules out a distinct way `abi.decode` could revert (an unavoidable revert,
        // since it happens in THIS frame — see the fail-open contract above):
        //   head == 0x20  — the offset is the canonical one for a lone dynamic return. Rules out a
        //                   dangling/oversized offset pointing past the buffer, and pins that `len`
        //                   was read from the right word.
        //   len <= payload — the declared length fits in the bytes actually returned. Rules out a
        //                   huge/adversarial length, and (evaluated first, short-circuiting) keeps
        //                   `len + 31` below from overflowing.
        //   payload >= padded(len) — the payload word-count is present in full. Rules out a
        //                   truncated final word.
        if (head != 0x20 || len > payload || payload < ((len + 31) / 32) * 32) return;

        if (RevenueSplitLib.isEndowmentFamily(abi.decode(ret, (string)))) revert EndowmentVaultNotSupported();
    }

    function _deployAndInitialize(
        CreateParams calldata params,
        string calldata metadataURI,
        address liquidityDeployer,
        address gatingModule,
        FreeMintParams calldata freeMint,
        bool agentCreated
    ) private returns (address instance) {
        // Fetch preset and validate its curve computer
        LaunchManager.Preset memory preset = launchManager.getPreset(params.presetId);
        // DeployCore approves the curve computer under the raw literal tag bytes32("curve_computer")
        // (NOT keccak256) — mirror that exactly so the real deploy path still passes.
        if (!componentRegistry.isApprovedForTag(preset.curveComputer, bytes32("curve_computer"))) {
            revert UnapprovedCurveComputer();
        }

        uint256 unit = preset.unitPerNFT * 1e18;
        uint256 curveNftCount = params.nftCount - freeMint.allocation;
        ERC404BondingInstance.BondingParams memory bonding = ERC404BondingInstance.BondingParams({
            maxSupply: params.nftCount * unit,
            unit: unit,
            liquidityReserveBps: preset.liquidityReserveBps,
            declaredMaxAllowanceBps: params.declaredMaxAllowanceBps,
            curve: ICurveComputer(preset.curveComputer)
                .computeCurveParams(curveNftCount, preset.targetETH, preset.unitPerNFT, preset.liquidityReserveBps)
        });

        // Deploy EIP-1167 minimal proxy via CREATE3.
        // Bind salt to msg.sender to prevent front-running.
        bytes memory proxyCreationCode = abi.encodePacked(
            hex"3d602d80600a3d3981f3363d3d373d3d3d363d73", implementation, hex"5af43d82803e903d91602b57fd5bf3"
        );
        bytes32 senderBoundSalt = keccak256(abi.encodePacked(msg.sender, params.salt));
        instance = ICreateX(CREATEX).deployCreate3(senderBoundSalt, proxyCreationCode);

        // The DN404 mirror is deployed HERE, not inside the instance: `new` is a CREATE, so the
        // mirror's ~3.1KB of creation code would otherwise have to live inline in the instance's
        // runtime bytecode — and the instance is the contract fighting the EIP-170 limit. Deployer
        // is `address(this)`, which is exactly what `_initializeDN404` links with (`caller()`).
        // Constructed inline at the call site on purpose: clone + initialize are atomic within this
        // function, so no external caller can ever supply a clone's mirror. Do not hoist.
        ERC404BondingInstance(payable(instance))
            .initialize(
                params.owner,
                params.vault,
                bonding,
                liquidityDeployer,
                gatingModule,
                address(new DN404Mirror(address(this)))
            );
        ERC404BondingInstance(payable(instance))
            .initializeProtocol(
                ERC404BondingInstance.ProtocolParams({
                    globalMessageRegistry: globalMessageRegistry,
                    protocolTreasury: protocolTreasury,
                    masterRegistry: address(masterRegistry),
                    bondingFeeBps: bondingFeeBps,
                    weth: weth
                })
            );
        // `metadataURI` is the create call's COLLECTION URI — the very string handed to
        // `masterRegistry.registerInstance` in `_createInstance`. Until noesis-085 it was never given to
        // the instance, which is exactly the drift QueryAggregator's §6 read-through was fighting: the
        // registry held the only copy and nothing could correct it. It now lands in the instance's
        // ERC-7572 `contractURI`. `params.tokenBaseURI` stays what it always was — the per-token base for
        // `tokenURI` — and keeps going to `metadataURI`. Two arguments, two slots, two meanings.
        ERC404BondingInstance(payable(instance))
            .initializeMetadata(params.name, params.symbol, params.styleUri, params.tokenBaseURI, metadataURI);
        ERC404BondingInstance(payable(instance)).initializeFreeMint(freeMint.allocation, freeMint.scope);
        if (agentCreated) {
            ERC404BondingInstance(payable(instance)).setAgentDelegationFromFactory();
        }
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    function setProtocolTreasury(address _treasury) external onlyRoles(PROTOCOL_ROLE) {
        if (_treasury == address(0)) revert InvalidAddress();
        address old = protocolTreasury;
        protocolTreasury = _treasury;
        emit ProtocolTreasuryUpdated(old, _treasury);
    }

    /// @notice Wire (or unwire) the deploy-bond escrow. address(0) disables the lever. When set, the
    ///         bond is only actually charged once the escrow's `bondAmount` is nonzero.
    function setDeployBondEscrow(address _escrow) external onlyRoles(PROTOCOL_ROLE) {
        address old = deployBondEscrow;
        deployBondEscrow = _escrow;
        emit DeployBondEscrowUpdated(old, _escrow);
    }

    function setWeth(address _weth) external onlyRoles(PROTOCOL_ROLE) {
        if (_weth == address(0)) revert InvalidAddress();
        weth = _weth;
    }

    function setBondingFeeBps(uint256 _bps) external onlyRoles(PROTOCOL_ROLE) {
        if (_bps > 300) revert MaxBondingFeeExceeded();
        bondingFeeBps = _bps;
        emit BondingFeeUpdated(_bps);
    }

    /// @notice Set the graduation pool floor. A carve-clamp only — NEVER blocks graduation.
    function setMinPoolEth(uint256 _minPoolEth) external onlyRoles(PROTOCOL_ROLE) {
        minPoolEth = _minPoolEth;
        emit MinPoolEthUpdated(_minPoolEth);
    }

    /// @notice Set the progressive carve-allowance brackets (market regimes change).
    function setCarveBrackets(RevenueSplitLib.BracketParams calldata p) external onlyRoles(PROTOCOL_ROLE) {
        if (p.b1 > p.b2 || p.r1 > 10000 || p.r2 > 10000 || p.r3 > 10000) revert InvalidBracketParams();
        // Marginal rate must fall (or hold) as the raise grows — the documented income-tax-inverted
        // shape (r1 >= r2 >= r3). Guards against a PROTOCOL_ROLE holder inverting design intent so
        // larger raises carve a higher marginal rate.
        if (p.r1 < p.r2 || p.r2 < p.r3) revert InvalidBracketParams();
        _carveBrackets = p;
        emit CarveBracketsUpdated(p.b1, p.b2, p.r1, p.r2, p.r3);
    }

    /// @notice Current carve-allowance bracket params (UI reads them for the wizard/admin previews).
    function carveBracketParams() external view returns (RevenueSplitLib.BracketParams memory) {
        return _carveBrackets;
    }

    /// @notice Effective creator-carve ETH for a graduation. Called LIVE by instances at
    ///         graduation (and by their previewCarve view) — the bracket/floor math lives here
    ///         because the DN404 instance has no EIP-170 headroom, and living here means
    ///         owner-tuned regime changes apply to every future graduation.
    /// @dev effective = min(request, allowance(raise) × declaredMax / 10000, headroom above the
    ///      pool floor). The floor is a carve-CLAMP, never a graduation gate.
    function effectiveCarveEth(uint256 raise, uint256 declaredMaxBps, uint256 carveRequestBps)
        external
        view
        returns (uint256 carveEth)
    {
        if (raise == 0 || declaredMaxBps == 0 || carveRequestBps == 0) return 0;

        uint256 allowanceEth = RevenueSplitLib.carveAllowance(raise, _carveBrackets);
        uint256 effBps = carveRequestBps < declaredMaxBps ? carveRequestBps : declaredMaxBps;
        if (effBps > 10000) effBps = 10000;
        carveEth = (allowanceEth * effBps) / 10000;

        // Clamp to the headroom the LP 80 has above the pool floor.
        uint256 lpShare = RevenueSplitLib.split(raise).remainder;
        uint256 floor_ = minPoolEth;
        uint256 headroom = lpShare > floor_ ? lpShare - floor_ : 0;
        if (carveEth > headroom) carveEth = headroom;
    }

    // ── IFactory ─────────────────────────────────────────────────────────────

    function protocol() external view returns (address) {
        return owner();
    }

    function features() external view returns (bytes32[] memory) {
        return _features;
    }

    function requiredFeatures() external pure returns (bytes32[] memory) {
        bytes32[] memory req = new bytes32[](1);
        req[0] = FeatureUtils.LIQUIDITY_DEPLOYER;
        return req;
    }

    // ── Utilities ────────────────────────────────────────────────────────────

    /// @notice Preview the deterministic address for a given (creator, salt) pair.
    function computeInstanceAddress(address creator, bytes32 salt) external view returns (address) {
        bytes32 senderBoundSalt = keccak256(abi.encodePacked(creator, salt));
        bytes32 guardedSalt = keccak256(abi.encodePacked(uint256(uint160(address(this))), senderBoundSalt));
        return ICreateX(CREATEX).computeCreate3Address(guardedSalt, CREATEX);
    }
}
