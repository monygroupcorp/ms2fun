// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { OwnableRoles } from "solady/auth/OwnableRoles.sol";
import { ReentrancyGuard } from "solady/utils/ReentrancyGuard.sol";
import { SafeTransferLib } from "solady/utils/SafeTransferLib.sol";
import { IMasterRegistry } from "../../master/interfaces/IMasterRegistry.sol";
import { FeatureUtils } from "../../master/libraries/FeatureUtils.sol";
import { IAlignmentVault } from "../../interfaces/IAlignmentVault.sol";
import { IFactory } from "../../interfaces/IFactory.sol";
import { ICurveComputer } from "../../interfaces/ICurveComputer.sol";
import { ERC404BondingInstance } from "./ERC404BondingInstance.sol";
import { LaunchManager } from "./LaunchManager.sol";
import { IComponentRegistry } from "../../registry/interfaces/IComponentRegistry.sol";
import { FreeMintParams } from "../../interfaces/IFactoryTypes.sol";
import { GatingScope } from "../../gating/IGatingModule.sol";
import { ICreateX, CREATEX } from "../../shared/CreateXConstants.sol";
import { RevenueSplitLib } from "../../shared/libraries/RevenueSplitLib.sol";
import { MetadataResolverRouter } from "../../metadata/MetadataResolverRouter.sol";
import { TierRevealModule } from "../../metadata/TierRevealModule.sol";
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
    struct MetadataConfig {
        address resolver; // instance modules[METADATA_RESOLVER] target
        address[] childResolvers; // router's ordered children (empty if no router)
        address overlay; // overlay module to initConfig (address(0) = skip)
        address tier; // tier module to initTiers (address(0) = skip)
        TierRevealModule.Tier[] tiers; // tier table (sealed at create)
        bool autoLatest; // overlay initial policy
        MetadataOverlayModule.Payout defaultPayout;
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
    /// @param metadataConfig Resolver pointer + router children + sealed tier/overlay config.
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
    ///      are registry-validated; the instance slot + router list + tier table + overlay config are
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
            TierRevealModule(cfg.tier).initTiers(instance, cfg.tiers);
        }
        if (cfg.overlay != address(0)) {
            if (!componentRegistry.isApprovedForTag(cfg.overlay, FeatureUtils.OVERLAY)) revert UnapprovedResolver();
            MetadataOverlayModule(cfg.overlay).initConfig(instance, cfg.autoLatest, cfg.defaultPayout);
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

        ERC404BondingInstance(payable(instance))
            .initialize(params.owner, params.vault, bonding, liquidityDeployer, gatingModule);
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
        ERC404BondingInstance(payable(instance))
            .initializeMetadata(params.name, params.symbol, params.styleUri, params.tokenBaseURI);
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
