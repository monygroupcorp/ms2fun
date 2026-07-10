// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Script, console } from "forge-std/Script.sol";
import { MasterRegistryV1 } from "../src/master/MasterRegistryV1.sol";
import { MasterRegistry } from "../src/master/MasterRegistry.sol";
import { AlignmentRegistryV1 } from "../src/master/AlignmentRegistryV1.sol";
import { IAlignmentRegistry } from "../src/master/interfaces/IAlignmentRegistry.sol";
import { FeaturedQueueManager } from "../src/master/FeaturedQueueManager.sol";
import { AlignmentTargetRequestRegistry } from "../src/master/AlignmentTargetRequestRegistry.sol";
import { GlobalMessageRegistry } from "../src/registry/GlobalMessageRegistry.sol";
import { ComponentRegistry } from "../src/registry/ComponentRegistry.sol";
import { ProfileRegistry } from "../src/registry/ProfileRegistry.sol";
import { ProtocolTreasuryV1 } from "../src/treasury/ProtocolTreasuryV1.sol";
import { UniAlignmentVault } from "../src/vaults/uni/UniAlignmentVault.sol";
import { UniAlignmentVaultFactory } from "../src/vaults/uni/UniAlignmentVaultFactory.sol";
import { CypherAlignmentVault } from "../src/vaults/cypher/CypherAlignmentVault.sol";
import { CypherAlignmentVaultFactory } from "../src/vaults/cypher/CypherAlignmentVaultFactory.sol";
import { IZAMM, ZAMMAlignmentVault } from "../src/vaults/zamm/ZAMMAlignmentVault.sol";
import { ZAMMAlignmentVaultFactory } from "../src/vaults/zamm/ZAMMAlignmentVaultFactory.sol";
import { AlignmentEndowmentVaultFactory } from "../src/vaults/aave/AlignmentEndowmentVaultFactory.sol";
import { UniswapVaultPriceValidator } from "../src/peripherals/UniswapVaultPriceValidator.sol";
import { IVaultPriceValidator } from "../src/interfaces/IVaultPriceValidator.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { IHooks } from "v4-core/interfaces/IHooks.sol";
import { ERC404Factory } from "../src/factories/erc404/ERC404Factory.sol";
import { DeployBondEscrow } from "../src/factories/erc404/DeployBondEscrow.sol";
import { ERC404BondingInstance } from "../src/factories/erc404/ERC404BondingInstance.sol";
import { LaunchManager } from "../src/factories/erc404/LaunchManager.sol";
import { CurveParamsComputer } from "../src/factories/erc404/CurveParamsComputer.sol";
import { ERC404StakingModule } from "../src/factories/erc404/ERC404StakingModule.sol";
import { MetadataResolverRouter } from "../src/metadata/MetadataResolverRouter.sol";
import { MetadataOverlayModule } from "../src/metadata/MetadataOverlayModule.sol";
import { TierRevealModule } from "../src/metadata/TierRevealModule.sol";
import { ERC1155Factory } from "../src/factories/erc1155/ERC1155Factory.sol";
import { DynamicPricingModule } from "../src/factories/erc1155/DynamicPricingModule.sol";
import { ERC721AuctionFactory } from "../src/factories/erc721/ERC721AuctionFactory.sol";
import { QueryAggregator } from "../src/query/QueryAggregator.sol";
import { zRouter } from "../src/peripherals/zRouter.sol";
import { PasswordTierGatingModule } from "../src/gating/PasswordTierGatingModule.sol";
import { MerkleGatingModule } from "../src/gating/MerkleGatingModule.sol";
import { FeatureUtils } from "../src/master/libraries/FeatureUtils.sol";
import { MockComponentModule } from "../test/mocks/MockComponentModule.sol";
import { LiquidityDeployerModule } from "../src/factories/erc404/LiquidityDeployerModule.sol";
import { ZAMMLiquidityDeployerModule } from "../src/factories/erc404zamm/ZAMMLiquidityDeployerModule.sol";
import { MockSafe } from "../test/mocks/MockSafe.sol";
import { ICreateX, CREATEX } from "../src/shared/CreateXConstants.sol";

/// @title DeployCore
/// @notice Single source of truth for protocol deployment across all networks.
///         Extend this contract and inject a NetworkConfig to deploy to any network.
///         Never calls vm.envOr — all config comes through the struct.
contract DeployCore is Script {
    // ─────────────────────────── Config Structs ────────────────────────────

    struct AlignmentTargetConfig {
        address token;
        string symbol;
        string name;
        string description;
        bool deployUniVault;
        bool deployCypherVault;
        bool deployZAMMVault;
        address communityPayout; // endowment community destination; address(0) = set later, off-chain
    }

    struct NetworkConfig {
        uint256 chainId;

        // External protocol addresses
        address weth;
        address v4PoolManager;
        address v3Factory;
        address v2Factory;

        // Vault AMM addresses — address(0) means that AMM isn't on this network, skip factory
        address cypherPositionManager;
        address cypherRouter;
        address zamm;
        address aaveStataToken; // Aave WETH StaticATokenV2 (waEthWETH); address(0) = no endowment vault

        // Pre-existing contracts — address(0) = deploy fresh
        address zrouter;
        address safe;

        // CREATE3 salts for UUPS proxies
        bytes32 saltMasterRegistry;
        bytes32 saltTreasury;
        bytes32 saltQueueManager;
        bytes32 saltGlobalMsgReg;
        bytes32 saltAlignmentReg;
        bytes32 saltComponentReg;
        // Mixed into the per-target VAULT salts so repeated local re-deploys onto the same fork
        // don't CreateCollision. Production callers leave it 0 → deterministic vault addresses;
        // DeployAnvil sets it to block.timestamp (matching the UUPS-proxy salt pattern above).
        uint256 saltNonce;

        // Price validator params
        uint256 priceDeviationBps;
        uint32 twapSeconds;

        // Vault pool params (used for UniAlignmentVault V4 pool key per target)
        uint24 zrouterFee;
        int24 zrouterTickSpacing;
        // ZAMM pool fee/hook selector — baked into each ZAMM vault's pool key at deploy so the
        // ETH/alignmentToken ZAMM pool is wired (matches the feeOrHook the vault swaps/LPs against).
        uint256 zammFeeOrHook;

        // One or more alignment targets — each can have 1-3 vault types
        AlignmentTargetConfig[] alignmentTargets;

        // Output path for deployments JSON — empty string = skip (test mode)
        string jsonOutputPath;
    }

    // ───────────────────────── Deployed State (public for test access) ──────

    // Core proxies
    address public masterRegistry;
    MasterRegistryV1 public masterRegistryImpl;
    ProtocolTreasuryV1 public treasury;
    ProtocolTreasuryV1 public treasuryImpl;
    FeaturedQueueManager public queueManager;
    FeaturedQueueManager public queueManagerImpl;
    GlobalMessageRegistry public globalMessageRegistry;
    GlobalMessageRegistry public globalMessageRegistryImpl;
    AlignmentRegistryV1 public alignmentRegistry;
    AlignmentRegistryV1 public alignmentRegistryImpl;
    AlignmentTargetRequestRegistry public targetRequestRegistry;
    ComponentRegistry public componentRegistry;
    ComponentRegistry public componentRegistryImpl;
    ProfileRegistry public profileRegistry;

    // Infrastructure
    address public safe;
    zRouter public zrouter;
    UniswapVaultPriceValidator public priceValidator;

    // Vault factories
    UniAlignmentVaultFactory public uniVaultFactory;
    CypherAlignmentVaultFactory public cypherVaultFactory;
    ZAMMAlignmentVaultFactory public zammVaultFactory;
    AlignmentEndowmentVaultFactory public aaveVaultFactory;

    // Deployed vault instances — indexed by target index
    address[] public uniVaults;
    address[] public cypherVaults;
    address[] public zammVaults;
    address[] public aaveVaults;
    uint256[] public alignmentTargetIds;

    // Project factories
    ERC404Factory public erc404Factory;
    DeployBondEscrow public deployBondEscrow;
    ERC404BondingInstance public erc404Impl;
    LaunchManager public launchManager;
    CurveParamsComputer public curveParamsComputer;
    ERC404StakingModule public erc404StakingModule;
    MetadataResolverRouter public metadataResolverRouter;
    MetadataOverlayModule public metadataOverlayModule;
    TierRevealModule public tierRevealModule;
    ERC1155Factory public erc1155Factory;
    DynamicPricingModule public dynamicPricingModule;
    ERC721AuctionFactory public erc721Factory;
    PasswordTierGatingModule public passwordTierGatingModule;
    QueryAggregator public queryAggregator;

    // Real per-instance merkle-allowlist gating module (carries its own wizard metadata).
    MerkleGatingModule public moduleMerkleGating;
    // `address` (not a concrete type) so each slot can hold either the real LP deployer module or the
    // MockComponentModule stub, chosen per-network by whether that AMM's config is present.
    address public moduleUniV4Deployer;
    address public moduleZAMMDeployer;
    address public moduleCypherDeployer;

    // ───────────────────────────── Entry Point ──────────────────────────────

    /// @notice Deploy all protocol contracts for the given network config.
    ///         Callable from forge scripts (with broadcast) or tests (without).
    function deploy(address deployer, NetworkConfig memory cfg) public {
        // ── Phase 1: Protocol proxies (CREATE3) ─────────────────────────────

        masterRegistryImpl = new MasterRegistryV1();
        {
            bytes memory initData = abi.encodeWithSignature("initialize(address)", deployer);
            bytes memory proxyInitCode = abi.encodePacked(
                type(MasterRegistry).creationCode, abi.encode(address(masterRegistryImpl), initData)
            );
            masterRegistry = ICreateX(CREATEX).deployCreate3(cfg.saltMasterRegistry, proxyInitCode);
        }

        treasuryImpl = new ProtocolTreasuryV1();
        treasury = ProtocolTreasuryV1(
            payable(_deployProxyCreate3(
                    address(treasuryImpl), cfg.saltTreasury, abi.encodeWithSignature("initialize(address)", deployer)
                ))
        );
        if (cfg.v4PoolManager != address(0)) treasury.setV4PoolManager(cfg.v4PoolManager);
        if (cfg.weth != address(0)) treasury.setWETH(cfg.weth);

        queueManagerImpl = new FeaturedQueueManager();
        queueManager = FeaturedQueueManager(
            payable(_deployProxyCreate3(
                    address(queueManagerImpl),
                    cfg.saltQueueManager,
                    abi.encodeWithSignature("initialize(address,address)", masterRegistry, deployer)
                ))
        );
        queueManager.setWeth(cfg.weth);

        globalMessageRegistryImpl = new GlobalMessageRegistry();
        globalMessageRegistry = GlobalMessageRegistry(
            _deployProxyCreate3(
                address(globalMessageRegistryImpl),
                cfg.saltGlobalMsgReg,
                abi.encodeWithSignature("initialize(address,address)", deployer, masterRegistry)
            )
        );

        alignmentRegistryImpl = new AlignmentRegistryV1(cfg.weth);
        alignmentRegistry = AlignmentRegistryV1(
            _deployProxyCreate3(
                address(alignmentRegistryImpl),
                cfg.saltAlignmentReg,
                abi.encodeWithSignature("initialize(address)", deployer)
            )
        );

        componentRegistryImpl = new ComponentRegistry();
        componentRegistry = ComponentRegistry(
            _deployProxyCreate3(
                address(componentRegistryImpl),
                cfg.saltComponentReg,
                abi.encodeWithSignature("initialize(address)", deployer)
            )
        );

        MasterRegistryV1(masterRegistry).setAlignmentRegistry(address(alignmentRegistry));

        // Ownerless, non-upgradeable account profile registry (ADR-0004) — no proxy, no init.
        profileRegistry = new ProfileRegistry();

        // Alignment-target request intake (docs/phases/alignment-target-requests.md) — standalone,
        // Ownable, escrows a refundable deposit while Pending. Owner = deployer (handed to ADMIN via
        // the 2-step handover in deploy.ts). Defaults are owner-tunable post-deploy.
        targetRequestRegistry = new AlignmentTargetRequestRegistry(
            deployer,
            IAlignmentRegistry(address(alignmentRegistry)),
            address(treasury),
            0.05 ether, // requestDeposit
            50, // maxPending
            30 days // requestTTL
        );

        // ── Phase 2: Safe ────────────────────────────────────────────────────

        safe = cfg.safe != address(0) ? cfg.safe : address(new MockSafe());

        // ── Phase 3: zRouter ─────────────────────────────────────────────────

        zrouter = cfg.zrouter != address(0) ? zRouter(payable(cfg.zrouter)) : new zRouter();

        // ── Phase 4: Vault infrastructure ───────────────────────────────────

        // Always deploy — self-guards with code.length checks when pools don't exist
        priceValidator = new UniswapVaultPriceValidator(
            cfg.weth, cfg.v2Factory, cfg.v3Factory, cfg.v4PoolManager, cfg.priceDeviationBps, cfg.twapSeconds
        );

        uniVaultFactory = new UniAlignmentVaultFactory(
            cfg.weth,
            cfg.v4PoolManager,
            address(zrouter),
            cfg.zrouterFee,
            cfg.zrouterTickSpacing,
            IVaultPriceValidator(address(priceValidator)),
            alignmentRegistry,
            address(0) // zQuoter: best-route disabled at deploy; wire a chain-specific zQuoter via setZQuoter
        );

        if (cfg.cypherPositionManager != address(0)) {
            CypherAlignmentVault cypherImpl = new CypherAlignmentVault();
            cypherVaultFactory =
                new CypherAlignmentVaultFactory(address(cypherImpl), IVaultPriceValidator(address(priceValidator)));
        }

        if (cfg.zamm != address(0)) {
            zammVaultFactory = new ZAMMAlignmentVaultFactory(
                cfg.zamm,
                address(zrouter),
                address(treasury),
                IVaultPriceValidator(address(priceValidator)),
                alignmentRegistry,
                address(0)
            );
        }

        // Aave endowment vault factory (ADR-0003) — only where Aave's WETH stataToken exists.
        if (cfg.aaveStataToken != address(0)) {
            aaveVaultFactory = new AlignmentEndowmentVaultFactory(
                cfg.weth, cfg.aaveStataToken, address(treasury), masterRegistry, alignmentRegistry
            );
        }

        // ── Phase 5: Alignment targets + vault instances ─────────────────────

        for (uint256 i = 0; i < cfg.alignmentTargets.length; i++) {
            AlignmentTargetConfig memory t = cfg.alignmentTargets[i];

            IAlignmentRegistry.AlignmentAsset[] memory assets = new IAlignmentRegistry.AlignmentAsset[](1);
            assets[0] = IAlignmentRegistry.AlignmentAsset({
                token: t.token, symbol: t.symbol, info: t.description, metadataURI: ""
            });

            uint256 targetId = alignmentRegistry.registerAlignmentTarget(t.name, t.description, "", assets);
            alignmentTargetIds.push(targetId);

            // Aave endowment vault (ADR-0003): set the target's community payout (from config — no
            // placeholder baked into this cross-network script), then deploy + register a per-target
            // endowment vault clone. A zero payout is left unset (configured later, off-chain).
            if (cfg.aaveStataToken != address(0)) {
                if (t.communityPayout != address(0)) {
                    alignmentRegistry.setCommunityPayout(targetId, t.communityPayout);
                }
                address aaveVault = aaveVaultFactory.deployVault(
                    _vaultSalt(cfg.chainId, i, "AAVE", cfg.saltNonce), t.token, targetId
                );
                MasterRegistryV1(masterRegistry)
                    .registerVault(
                        aaveVault,
                        deployer,
                        string.concat(t.symbol, " Aave Endowment Vault"),
                        "https://ms2.fun",
                        targetId
                    );
                aaveVaults.push(aaveVault);
            }

            if (t.deployUniVault) {
                bytes32 salt = _vaultSalt(cfg.chainId, i, "UNIv4", cfg.saltNonce);
                address vault = uniVaultFactory.deployVault(salt, t.token, targetId, IVaultPriceValidator(address(0)));
                // Operational LP wiring (T2): set the V4 pool key so the vault can actually LP.
                // The factory owns the vault, so the key routes through the factory. Native ETH is
                // currency0 (address(0) < any token → ordering holds); the alignment token is
                // currency1; fee/tickSpacing come from the network's V4 config. This flips the
                // vault's isLiquidityReady() → true so the wizard offers the Uni venue.
                uniVaultFactory.setVaultPoolKey(
                    vault,
                    PoolKey({
                        currency0: Currency.wrap(address(0)),
                        currency1: Currency.wrap(t.token),
                        fee: cfg.zrouterFee,
                        tickSpacing: cfg.zrouterTickSpacing,
                        hooks: IHooks(address(0))
                    })
                );
                MasterRegistryV1(masterRegistry)
                    .registerVault(
                        vault, deployer, string.concat(t.symbol, " UNIv4 Vault"), "https://ms2.fun", targetId
                    );
                uniVaults.push(vault);
            }

            if (t.deployCypherVault && address(cypherVaultFactory) != address(0)) {
                bytes32 salt = _vaultSalt(cfg.chainId, i, "CYPHER", cfg.saltNonce);
                address vault = address(
                    cypherVaultFactory.createVault(
                        salt,
                        cfg.cypherPositionManager,
                        cfg.cypherRouter,
                        cfg.weth,
                        t.token,
                        address(treasury),
                        address(0)
                    )
                );
                MasterRegistryV1(masterRegistry)
                    .registerVault(
                        vault, deployer, string.concat(t.symbol, " Cypher Vault"), "https://ms2.fun", targetId
                    );
                cypherVaults.push(vault);
            }

            if (t.deployZAMMVault && address(zammVaultFactory) != address(0)) {
                bytes32 salt = _vaultSalt(cfg.chainId, i, "ZAMM", cfg.saltNonce);
                // Operational LP wiring (T2): bake the real ETH/alignmentToken ZAMM pool key at
                // deploy (token0 = native ETH = address(0), token1 = alignment token, feeOrHook from
                // config) so the vault is liquidity-ready immediately. (Post-deploy re-wiring is also
                // available via ZAMMAlignmentVaultFactory.setVaultPoolKey while no liquidity exists.)
                IZAMM.PoolKey memory poolKey = IZAMM.PoolKey({
                    id0: 0, id1: 0, token0: address(0), token1: t.token, feeOrHook: cfg.zammFeeOrHook
                });
                address vault = zammVaultFactory.deployVault(salt, t.token, targetId, poolKey);
                MasterRegistryV1(masterRegistry)
                    .registerVault(vault, deployer, string.concat(t.symbol, " ZAMM Vault"), "https://ms2.fun", targetId);
                zammVaults.push(vault);
            }
        }

        // ── Phase 6: ERC404Factory ───────────────────────────────────────────

        erc404Impl = new ERC404BondingInstance();
        launchManager = new LaunchManager(deployer);
        curveParamsComputer = new CurveParamsComputer(deployer);

        erc404Factory = new ERC404Factory(
            ERC404Factory.CoreConfig({
                implementation: address(erc404Impl), masterRegistry: masterRegistry, protocol: deployer, weth: cfg.weth
            }),
            ERC404Factory.ModuleConfig({
                globalMessageRegistry: address(globalMessageRegistry),
                launchManager: address(launchManager),
                componentRegistry: address(componentRegistry)
            })
        );
        erc404Factory.setProtocolTreasury(address(treasury));

        // Deploy-bond escrow (N12) — standalone, holds the bond ETH so the factory keeps its
        // "holds no ETH" invariant. Owner = deployer (handed to ADMIN via the deploy.ts handover).
        // Lever ships OFF (bondAmount defaults 0) → create is byte-identical to today.
        deployBondEscrow = new DeployBondEscrow(deployer, address(erc404Factory), address(treasury));
        erc404Factory.setDeployBondEscrow(address(deployBondEscrow));

        // CurveParamsComputer must be approved — _deployAndInitialize checks isApprovedComponent(preset.curveComputer)
        componentRegistry.approveComponent(
            address(curveParamsComputer), bytes32("curve_computer"), "CurveParamsComputer"
        );

        // Hardcoded protocol presets — NICHE / STANDARD / HYPE
        launchManager.setPreset(
            0,
            LaunchManager.Preset({
                targetETH: 5 ether,
                unitPerNFT: 1_000_000_000,
                liquidityReserveBps: 1000,
                curveComputer: address(curveParamsComputer),
                active: true
            })
        );
        launchManager.setPreset(
            1,
            LaunchManager.Preset({
                targetETH: 25 ether,
                unitPerNFT: 1_000_000,
                liquidityReserveBps: 1000,
                curveComputer: address(curveParamsComputer),
                active: true
            })
        );
        launchManager.setPreset(
            2,
            LaunchManager.Preset({
                targetETH: 50 ether,
                unitPerNFT: 1_000,
                liquidityReserveBps: 1000,
                curveComputer: address(curveParamsComputer),
                active: true
            })
        );

        // ── Phase 7: ERC1155Factory + DynamicPricingModule ───────────────────

        erc1155Factory =
            new ERC1155Factory(masterRegistry, address(globalMessageRegistry), address(componentRegistry), cfg.weth);
        erc1155Factory.setProtocolTreasury(address(treasury));

        dynamicPricingModule = new DynamicPricingModule();
        componentRegistry.approveComponent(
            address(dynamicPricingModule), FeatureUtils.DYNAMIC_PRICING, "DynamicPricingModule"
        );
        erc1155Factory.setDynamicPricingModule(address(dynamicPricingModule));

        passwordTierGatingModule = new PasswordTierGatingModule(masterRegistry);
        componentRegistry.approveComponent(
            address(passwordTierGatingModule), FeatureUtils.GATING, "Password Tier Gating"
        );

        // ── Phase 7b: ComponentRegistry seeding — wizard-facing metadata stubs ─────
        // These MockComponentModules give the frontend creation wizard metadata to
        // display for each selectable component. Users pass these addresses to
        // createInstance; the real functional modules are wired into factory internals.
        // EXCEPTION: gating is a per-instance module the wizard passes through verbatim
        // (createInstance stores it, mint calls canMint, create/admin call configureFor),
        // so the REAL PasswordTierGatingModule carries the password-tier metadata directly —
        // there is no mock stand-in for it.

        string memory passwordGatingMeta =
            "data:application/json,{\"name\":\"Password Tier Gating\",\"subtitle\":\"Password \\u00b7 Tiered Access\",\"description\":\"Set one or more passwords, each unlocking a different tier of access or pricing.\",\"configType\":\"password-tier-gating\"}";
        string memory merkleGatingMeta =
            "data:application/json,{\"name\":\"Merkle Allowlist Gating\",\"subtitle\":\"Allowlist \\u00b7 Merkle Tree\",\"description\":\"Upload a list of wallet addresses to restrict minting to an allowlist.\",\"configType\":\"merkle-allowlist-gating\"}";
        string memory uniV4Meta =
            "data:application/json,{\"name\":\"Uniswap V4 Deployer\",\"subtitle\":\"Uniswap V4 \\u00b7 Concentrated Liquidity\",\"description\":\"Deploy liquidity to a Uniswap V4 pool on graduation.\",\"configType\":\"launch-profile\"}";
        string memory zammMeta =
            "data:application/json,{\"name\":\"ZAMM Deployer\",\"subtitle\":\"ZAMM \\u00b7 Constant Product\",\"description\":\"Deploy liquidity to ZAMM on graduation.\",\"configType\":\"launch-profile\"}";
        string memory cypherMeta =
            "data:application/json,{\"name\":\"Cypher Deployer\",\"subtitle\":\"Cypher \\u00b7 Concentrated Liquidity\",\"description\":\"Deploy liquidity to Cypher on graduation.\",\"configType\":\"launch-profile\"}";

        // Real module carries its own wizard metadata (configType drives the password-tier form).
        passwordTierGatingModule.setMetadataURI(passwordGatingMeta);

        // Real merkle-allowlist gating module: per-instance, per-edition, quantity-capped allowlists.
        // The wizard passes its address to createInstance verbatim; the owner calls configureFor
        // post-create with the merkle roots. Carries its own configType metadata ("merkle-allowlist-gating").
        moduleMerkleGating = new MerkleGatingModule(masterRegistry);
        componentRegistry.approveComponent(address(moduleMerkleGating), FeatureUtils.GATING, "Merkle Allowlist Gating");
        moduleMerkleGating.setMetadataURI(merkleGatingMeta);

        // Uni-V4 + ZAMM: deploy the REAL LP deployer modules where the AMM's config is present (the
        // mainnet fork + live networks), so graduation actually stands up a pool and the modules
        // answer their pool-param getters (poolFee/tickSpacing, feeOrHook) the embedded swap reads.
        // Fall back to the metadata-only stub where the AMM isn't configured (keeps the component
        // approved for the wizard without a live venue). Real modules carry their own metadataURI().
        if (cfg.v4PoolManager != address(0) && cfg.weth != address(0)) {
            LiquidityDeployerModule uniMod = new LiquidityDeployerModule(
                cfg.v4PoolManager, cfg.weth, cfg.zrouterFee, cfg.zrouterTickSpacing, masterRegistry
            );
            uniMod.setMetadataURI(uniV4Meta);
            moduleUniV4Deployer = address(uniMod);
        } else {
            moduleUniV4Deployer = address(new MockComponentModule(deployer, uniV4Meta));
        }
        componentRegistry.approveComponent(moduleUniV4Deployer, FeatureUtils.LIQUIDITY_DEPLOYER, "Uniswap V4 Deployer");

        if (cfg.zamm != address(0)) {
            ZAMMLiquidityDeployerModule zammMod =
                new ZAMMLiquidityDeployerModule(cfg.zamm, cfg.zammFeeOrHook, masterRegistry);
            zammMod.setMetadataURI(zammMeta);
            moduleZAMMDeployer = address(zammMod);
        } else {
            moduleZAMMDeployer = address(new MockComponentModule(deployer, zammMeta));
        }
        componentRegistry.approveComponent(moduleZAMMDeployer, FeatureUtils.LIQUIDITY_DEPLOYER, "ZAMM Deployer");

        // Cypher/Algebra stays the stub for now — the embedded-swap Cypher path is a fast-follow
        // (link-out), and the real module needs an Algebra factory address not yet in the config.
        moduleCypherDeployer = address(new MockComponentModule(deployer, cypherMeta));
        componentRegistry.approveComponent(moduleCypherDeployer, FeatureUtils.LIQUIDITY_DEPLOYER, "Cypher Deployer");

        // ERC404 staking module (functional, not a stub) — the ERC404 factory wires this into
        // instances created with staking enabled; ValidateSepolia expects it approved as STAKING.
        erc404StakingModule = new ERC404StakingModule(masterRegistry);
        componentRegistry.approveComponent(address(erc404StakingModule), FeatureUtils.STAKING, "ERC404 Staking");

        // ── Metadata-resolution stack (ADR-0006/0007) — functional modules, not stubs ─────
        // Router (resolver slot), overlay (augmentation), tier (rarity-by-ownership). Each carries
        // its own wizard metadata; the ERC404 factory's metadata overload wires + seals them per instance.
        metadataResolverRouter = new MetadataResolverRouter(masterRegistry);
        metadataOverlayModule = new MetadataOverlayModule(masterRegistry);
        tierRevealModule = new TierRevealModule(masterRegistry);

        string memory resolverMeta =
            "data:application/json,{\"name\":\"Metadata Resolver\",\"subtitle\":\"Composable \\u00b7 Stacked Resolvers\",\"description\":\"Compose stacking metadata modules (overlay, tier) behind one resolver - first non-empty wins.\",\"configType\":\"metadata-resolver\"}";
        string memory overlayMeta =
            "data:application/json,{\"name\":\"Artist Overlay\",\"subtitle\":\"Augmentation \\u00b7 Commissions & Events\",\"description\":\"Artist-authored augmentation served over the base art: per-id commissions and cohort event waves, holder-selectable.\",\"configType\":\"metadata-overlay\"}";
        string memory tierMeta =
            "data:application/json,{\"name\":\"Rarity Tiers\",\"subtitle\":\"Rarity \\u00b7 Hold-to-Reveal\",\"description\":\"Id-range tiers reveal rarer art only while the holder's effective holdings clear a threshold. Frozen at launch.\",\"configType\":\"metadata-tier\"}";

        metadataResolverRouter.setMetadataURI(resolverMeta);
        metadataOverlayModule.setMetadataURI(overlayMeta);
        tierRevealModule.setMetadataURI(tierMeta);

        componentRegistry.approveComponent(address(metadataResolverRouter), FeatureUtils.RESOLVER, "Metadata Resolver");
        componentRegistry.approveComponent(address(metadataOverlayModule), FeatureUtils.OVERLAY, "Artist Overlay");
        componentRegistry.approveComponent(address(tierRevealModule), FeatureUtils.TIER, "Rarity Tiers");

        // ── Phase 8: ERC721AuctionFactory ────────────────────────────────────

        erc721Factory = new ERC721AuctionFactory(masterRegistry, address(globalMessageRegistry), cfg.weth);
        erc721Factory.setProtocolTreasury(address(treasury));

        // ── Phase 9: QueryAggregator ─────────────────────────────────────────

        queryAggregator = new QueryAggregator();
        queryAggregator.initialize(masterRegistry, address(queueManager), address(globalMessageRegistry), deployer);

        // ── Phase 10: MasterRegistry wiring ──────────────────────────────────

        MasterRegistryV1(masterRegistry)
            .registerFactory(
                address(erc404Factory),
                "ERC404",
                "ERC404-Bonding-Curve-Factory",
                "ERC404 Bonding Curve",
                "https://ms2.fun",
                new bytes32[](0)
            );
        MasterRegistryV1(masterRegistry)
            .registerFactory(
                address(erc1155Factory),
                "ERC1155",
                "ERC1155-Edition-Factory",
                "ERC1155 Editions",
                "https://ms2.fun",
                new bytes32[](0)
            );
        MasterRegistryV1(masterRegistry)
            .registerFactory(
                address(erc721Factory),
                "ERC721",
                "ERC721-Auction-Factory",
                "ERC721 Auction",
                "https://ms2.fun",
                new bytes32[](0)
            );

        MasterRegistryV1(masterRegistry).setEmergencyRevoker(deployer);
        queueManager.setProtocolTreasury(address(treasury));

        // ── Phase 11: JSON output ────────────────────────────────────────────
        if (bytes(cfg.jsonOutputPath).length > 0) {
            _writeDeploymentJson(deployer, cfg);
        }
    }

    function _writeDeploymentJson(address deployer, NetworkConfig memory cfg) internal {
        // contracts sub-object
        string memory c = "contracts";
        vm.serializeAddress(c, "MasterRegistry", masterRegistry);
        vm.serializeAddress(c, "ProtocolTreasury", address(treasury));
        vm.serializeAddress(c, "FeaturedQueueManager", address(queueManager));
        vm.serializeAddress(c, "GlobalMessageRegistry", address(globalMessageRegistry));
        vm.serializeAddress(c, "AlignmentRegistry", address(alignmentRegistry));
        vm.serializeAddress(c, "ComponentRegistry", address(componentRegistry));
        vm.serializeAddress(c, "ProfileRegistry", address(profileRegistry));
        vm.serializeAddress(c, "AlignmentTargetRequestRegistry", address(targetRequestRegistry));
        vm.serializeAddress(c, "QueryAggregator", address(queryAggregator));
        vm.serializeAddress(c, "zRouter", address(zrouter));
        vm.serializeAddress(c, "LaunchManager", address(launchManager));
        vm.serializeAddress(c, "CurveParamsComputer", address(curveParamsComputer));
        vm.serializeAddress(c, "DynamicPricingModule", address(dynamicPricingModule));
        vm.serializeAddress(c, "PasswordTierGatingModule", address(passwordTierGatingModule));
        vm.serializeAddress(c, "ModuleMerkleGating", address(moduleMerkleGating));
        vm.serializeAddress(c, "ModuleUniV4Deployer", address(moduleUniV4Deployer));
        vm.serializeAddress(c, "ModuleZAMMDeployer", address(moduleZAMMDeployer));
        vm.serializeAddress(c, "ModuleCypherDeployer", address(moduleCypherDeployer));
        vm.serializeAddress(c, "ERC404StakingModule", address(erc404StakingModule));
        vm.serializeAddress(c, "MetadataResolverRouter", address(metadataResolverRouter));
        vm.serializeAddress(c, "MetadataOverlayModule", address(metadataOverlayModule));
        vm.serializeAddress(c, "TierRevealModule", address(tierRevealModule));
        vm.serializeAddress(c, "DeployBondEscrow", address(deployBondEscrow));
        // Convenience pointers for the seed script — the first Uni LP vault and the first Aave
        // endowment vault, resolved by family rather than by a fragile index into the `vaults`
        // array (whose ordering shifts as LP families are enabled/disabled per network).
        vm.serializeAddress(c, "SeedUniVault", uniVaults.length > 0 ? uniVaults[0] : address(0));
        vm.serializeAddress(c, "SeedAaveVault", aaveVaults.length > 0 ? aaveVaults[0] : address(0));
        // ZAMM + Cypher LP families — same family-resolved convenience pointers so the seed can bind
        // instances across all four vault flavors (the wizard offers all four; the seed demonstrates them).
        vm.serializeAddress(c, "SeedZammVault", zammVaults.length > 0 ? zammVaults[0] : address(0));
        vm.serializeAddress(c, "SeedCypherVault", cypherVaults.length > 0 ? cypherVaults[0] : address(0));
        string memory contracts = vm.serializeAddress(c, "UniswapVaultPriceValidator", address(priceValidator));

        // factories sub-object
        string memory f = "factories";
        vm.serializeAddress(f, "ERC404", address(erc404Factory));
        vm.serializeAddress(f, "ERC1155", address(erc1155Factory));
        string memory factories = vm.serializeAddress(f, "ERC721", address(erc721Factory));

        // uniswap sub-object
        string memory u = "uniswap";
        vm.serializeAddress(u, "v4PoolManager", cfg.v4PoolManager);
        vm.serializeAddress(u, "v3Factory", cfg.v3Factory);
        string memory uniswap = vm.serializeAddress(u, "v2Factory", cfg.v2Factory);

        // vaults array — build as JSON string manually
        string memory vaultsJson = "[";
        bool firstVault = true;
        for (uint256 i = 0; i < uniVaults.length; i++) {
            if (!firstVault) vaultsJson = string.concat(vaultsJson, ",");
            firstVault = false;
            vaultsJson = string.concat(
                vaultsJson,
                '{"address":"',
                vm.toString(uniVaults[i]),
                '","type":"UNIv4","alignmentToken":"',
                vm.toString(cfg.alignmentTargets[i].token),
                '","targetId":',
                vm.toString(alignmentTargetIds[i]),
                "}"
            );
        }
        for (uint256 i = 0; i < cypherVaults.length; i++) {
            if (!firstVault) vaultsJson = string.concat(vaultsJson, ",");
            firstVault = false;
            vaultsJson = string.concat(
                vaultsJson,
                '{"address":"',
                vm.toString(cypherVaults[i]),
                '","type":"CYPHER","alignmentToken":"',
                vm.toString(cfg.alignmentTargets[i].token),
                '","targetId":',
                vm.toString(alignmentTargetIds[i]),
                "}"
            );
        }
        for (uint256 i = 0; i < zammVaults.length; i++) {
            if (!firstVault) vaultsJson = string.concat(vaultsJson, ",");
            firstVault = false;
            vaultsJson = string.concat(
                vaultsJson,
                '{"address":"',
                vm.toString(zammVaults[i]),
                '","type":"ZAMM","alignmentToken":"',
                vm.toString(cfg.alignmentTargets[i].token),
                '","targetId":',
                vm.toString(alignmentTargetIds[i]),
                "}"
            );
        }
        for (uint256 i = 0; i < aaveVaults.length; i++) {
            if (!firstVault) vaultsJson = string.concat(vaultsJson, ",");
            firstVault = false;
            vaultsJson = string.concat(
                vaultsJson,
                '{"address":"',
                vm.toString(aaveVaults[i]),
                '","type":"AaveEndowment","alignmentToken":"',
                vm.toString(cfg.alignmentTargets[i].token),
                '","targetId":',
                vm.toString(alignmentTargetIds[i]),
                "}"
            );
        }
        vaultsJson = string.concat(vaultsJson, "]");

        // root object
        string memory root = "root";
        vm.serializeUint(root, "chainId", cfg.chainId);
        vm.serializeAddress(root, "deployer", deployer);
        vm.serializeString(root, "contracts", contracts);
        vm.serializeString(root, "factories", factories);
        vm.serializeString(root, "uniswap", uniswap);
        vm.serializeString(root, "instances", "[]");
        string memory json = vm.serializeString(root, "vaults", vaultsJson);

        vm.writeJson(json, cfg.jsonOutputPath);
        console.log("Deployment JSON written to:", cfg.jsonOutputPath);
    }

    // ─────────────────────────── Internal Helpers ───────────────────────────

    /// @dev Deploy an ERC1967 proxy via CREATE3, atomically initializing it.
    function _deployProxyCreate3(address impl, bytes32 salt, bytes memory initData) internal returns (address) {
        bytes memory proxyInitCode = abi.encodePacked(type(MasterRegistry).creationCode, abi.encode(impl, initData));
        return ICreateX(CREATEX).deployCreate3(salt, proxyInitCode);
    }

    /// @dev Per-target vault CREATE3 salt. `nonce == 0` reproduces the original
    ///      `keccak256(chainId, i, tag)` EXACTLY (production addresses unchanged); a non-zero nonce
    ///      (DeployAnvil passes block.timestamp) yields a fresh salt so local re-deploys onto the
    ///      same fork don't CreateCollision.
    function _vaultSalt(uint256 chainId, uint256 i, string memory tag, uint256 nonce) private pure returns (bytes32) {
        return nonce == 0 ? keccak256(abi.encode(chainId, i, tag)) : keccak256(abi.encode(chainId, i, tag, nonce));
    }
}
