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
import { CurationRegistry } from "../src/registry/CurationRegistry.sol";
import { ProtocolTreasuryV1 } from "../src/treasury/ProtocolTreasuryV1.sol";
import { UniAlignmentVault } from "../src/vaults/uni/UniAlignmentVault.sol";
import { UniAlignmentVaultFactory } from "../src/vaults/uni/UniAlignmentVaultFactory.sol";
import { IZAMM, ZAMMAlignmentVault } from "../src/vaults/zamm/ZAMMAlignmentVault.sol";
import { ZAMMAlignmentVaultFactory } from "../src/vaults/zamm/ZAMMAlignmentVaultFactory.sol";
import { AlignmentEndowmentVaultFactory } from "../src/vaults/aave/AlignmentEndowmentVaultFactory.sol";
import { IStataToken } from "../src/vaults/aave/AlignmentEndowmentVault.sol";
import { UniswapVaultPriceValidator } from "../src/peripherals/UniswapVaultPriceValidator.sol";
import { IVaultPriceValidator } from "../src/interfaces/IVaultPriceValidator.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { IHooks } from "v4-core/interfaces/IHooks.sol";
import { ERC404Factory } from "../src/factories/erc404/ERC404Factory.sol";
import { DeployBondEscrow } from "../src/factories/erc404/DeployBondEscrow.sol";
import { ERC404BondingInstance } from "../src/factories/erc404/ERC404BondingInstance.sol";
import { ERC404BondingOps } from "../src/factories/erc404/ERC404BondingOps.sol";
import { LaunchManager } from "../src/factories/erc404/LaunchManager.sol";
import { LaunchPresets } from "./LaunchPresets.sol";
import { CurveParamsComputer } from "../src/factories/erc404/CurveParamsComputer.sol";
import { ERC404StakingModule } from "../src/factories/erc404/ERC404StakingModule.sol";
import { MetadataResolverRouter } from "../src/metadata/MetadataResolverRouter.sol";
import { MetadataOverlayModule } from "../src/metadata/MetadataOverlayModule.sol";
import { TokenTierBandResolver } from "../src/metadata/TokenTierBandResolver.sol";
import { ERC1155Factory } from "../src/factories/erc1155/ERC1155Factory.sol";
import { ERC1155Instance } from "../src/factories/erc1155/ERC1155Instance.sol";
import { DynamicPricingModule } from "../src/factories/erc1155/DynamicPricingModule.sol";
import { ERC721AuctionFactory } from "../src/factories/erc721/ERC721AuctionFactory.sol";
import { QueryAggregator } from "../src/query/QueryAggregator.sol";
import { zRouter, ChainConfig, mainnetChainConfig } from "../src/peripherals/zRouter.sol";
import { AlignmentHookSwapRouter } from "../src/peripherals/AlignmentHookSwapRouter.sol";
import { MerkleGatingModule } from "../src/gating/MerkleGatingModule.sol";
import { FeatureUtils } from "../src/master/libraries/FeatureUtils.sol";
import { MockComponentModule } from "../test/mocks/MockComponentModule.sol";
import { LiquidityDeployerModule } from "../src/factories/erc404/LiquidityDeployerModule.sol";
import { UniTitheHookFactory } from "../src/factories/erc404/hooks/UniTitheHookFactory.sol";
import { IPoolManager } from "v4-core/interfaces/IPoolManager.sol";
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
        bool deployZAMMVault;
        address communityPayout; // endowment community destination; address(0) = pinned on the registry after deploy
    }

    struct NetworkConfig {
        uint256 chainId;

        // External protocol addresses
        address weth;
        address v4PoolManager;
        address v3Factory;
        address v2Factory;

        // Vault AMM addresses — address(0) means that AMM isn't on this network, skip factory
        address zamm;
        address aaveStataToken; // Aave WETH StaticATokenV2 (waEthWETH); address(0) = no endowment vault
        // WETH the Aave endowment family wraps into before supplying `aaveStataToken`. The vault wraps
        // ETH with this token and the stataToken then pulls its own `asset()`, so the two must be the
        // same ERC-20 or every contribution reverts inside `stataToken.deposit`.
        //
        // address(0) defaults to `weth`: on mainnet and the anvil fork Aave's waEthWETH `asset()` is
        // canonical WETH. A network whose Aave market is fronted by its own test WETH (Sepolia) sets
        // it so the endowment family alone uses that token.
        //
        // Read into the factory's immutable at deploy: no per-vault caller input and no setter.
        // `deploy()` asserts `IStataToken(aaveStataToken).asset() == aaveWeth` before wiring it.
        address aaveWeth;

        // Pre-existing contracts — address(0) = deploy fresh
        address zrouter;
        // Chain bindings for a self-deployed zRouter (only read when `zrouter` is address(0)).
        // All zero (the mainnet and anvil-fork shape) deploys the router with `mainnetChainConfig()`.
        // A network that self-deploys the router off mainnet fills in every venue it has and leaves
        // address(0) for every venue it lacks, so an absent leg reverts instead of routing at a
        // mainnet address. `weth` != 0 marks the field as supplied.
        ChainConfig zrouterChain;
        address safe;

        // On-chain best-route quoter (`zQuoter.getQuotes`) wired into every vault factory so deployed
        // vaults acquire from the deepest venue instead of their fixed family pool. address(0) disables
        // best-route (fixed-pool fallback only).
        //
        // Every deployment wires a quoter; address(0) is a test shape. A network with a canonical
        // quoter points at it (`DeployMainnet.ZQUOTER`); a network with none brings its own
        // (`SepoliaRouteQuoter`, `AnvilFixedRouteQuoter`). Only the tests pinning the fallback leg
        // (`test/vaults/BestRouteFallbackPin.t.sol`) leave it 0.
        //
        // No address is baked in here: the right quoter is a property of the network. It cannot be
        // changed after deploy; see the `cfg.zQuoter == address(0)` check in `deploy()`. Operator input.
        address zQuoter;

        // CREATE3 salts for UUPS proxies
        bytes32 saltMasterRegistry;
        bytes32 saltTreasury;
        bytes32 saltQueueManager;
        bytes32 saltGlobalMsgReg;
        bytes32 saltAlignmentReg;
        bytes32 saltComponentReg;
        // Mixed into the per-target vault salts so repeated local re-deploys onto the same fork
        // don't CreateCollision. 0 gives deterministic vault addresses (production); DeployAnvil
        // sets block.timestamp.
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

        // Uni-V4 alignment-tithe hook parameters. Seeded onto the singleton LiquidityDeployerModule
        // at deploy and inert until a governed `setAlignmentHookFactory` selects a hook; the module
        // starts with `alignmentHookFactory == address(0)` (no hook, untaxed pool). Once enabled, every
        // graduation Uni pool bakes in a hook taking `hookFeeBips` of the ETH swap leg as the perpetual
        // alignment tithe, with `lpFeeRate` as the dynamic LP fee. `hookFeeBips` is immutable per
        // deployed hook. 0 leaves the tithe inert. Operator input.
        uint256 hookFeeBips;
        uint24 lpFeeRate;

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
    CurationRegistry public curationRegistry;

    // Infrastructure
    address public safe;
    zRouter public zrouter;
    UniswapVaultPriceValidator public priceValidator;

    // Vault factories
    UniAlignmentVaultFactory public uniVaultFactory;
    ZAMMAlignmentVaultFactory public zammVaultFactory;
    AlignmentEndowmentVaultFactory public aaveVaultFactory;

    // Deployed vault instances — indexed by target index
    address[] public uniVaults;
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
    TokenTierBandResolver public tokenTierBandResolver;
    ERC1155Instance public erc1155Impl;
    ERC1155Factory public erc1155Factory;
    DynamicPricingModule public dynamicPricingModule;
    ERC721AuctionFactory public erc721Factory;
    QueryAggregator public queryAggregator;

    // Real per-instance merkle-allowlist gating module (carries its own wizard metadata).
    MerkleGatingModule public moduleMerkleGating;
    // `address` (not a concrete type) so each slot can hold either the real LP deployer module or the
    // MockComponentModule stub, chosen per-network by whether that AMM's config is present.
    address public moduleUniV4Deployer;
    address public moduleZAMMDeployer;
    /// @notice The Uni-V4 alignment-tithe hook factory, registered under ALIGNMENT_HOOK but not
    ///         selected on the module. address(0) where Uni isn't configured on this network.
    address public uniTitheHookFactory;
    /// @notice Swap periphery for graduation pools whose key carries an alignment hook. address(0)
    ///         where Uni isn't configured on this network.
    /// @dev Deployed from source on every network. The aggregator at `zrouter` is a canonical
    ///      address on mainnet and self-deployed on a testnet, and its V4 entry point cannot name a
    ///      hook, so a hooked pool is untradeable through it. This router is ours on every chain, so
    ///      the trade a testnet rehearses is the trade mainnet runs.
    address public alignmentHookSwapRouter;

    // ───────────────────────────── Entry Point ──────────────────────────────

    /// @notice Deploy all protocol contracts for the given network config.
    ///         Callable from forge scripts (with broadcast) or tests (without).
    function deploy(address deployer, NetworkConfig memory cfg) public {
        // ── Deploy-time security-param asserts ───────────────────────────────
        // weth==0 silently disables the smartTransferETH WETH fallback system-wide: queueManager.setWeth
        // is unconditional and every vault/factory below takes cfg.weth raw.
        require(cfg.weth != address(0), "DeployCore: cfg.weth unset (disables WETH fallback)");
        // zQuoter==0 ships every vault factory with best-route acquisition disabled: every acquire
        // takes the fixed cfg.zrouterFee / cfg.zrouterTickSpacing pool, so a target whose depth is on
        // another tier is bought on the wrong one (the tier is a network-wide factory immutable).
        //
        // Every network this repo deploys supplies a quoter: mainnet the canonical one, Sepolia
        // `SepoliaRouteQuoter`, a local fork `AnvilFixedRouteQuoter`. No address is baked in here;
        // the right quoter is a property of the network.
        //
        // This warns rather than asserts because the fallback is a supported, tested path that deploys
        // through here (`test/vaults/BestRouteFallbackPin.t.sol` pins that a vault with no quoter still
        // converts). On a real network, reaching this branch means the config is wrong.
        //
        // It cannot be repaired after deploy. A factory takes `zQuoter` as a constructor immutable and
        // threads it into each vault at deployVault time; the vault's `setZQuoter` is onlyOwner, that
        // owner is the factory, and the factory exposes no passthrough. Fixing it means redeploying
        // the factories.
        if (cfg.zQuoter == address(0)) {
            console.log("WARNING: cfg.zQuoter == address(0) -> best-route acquisition DISABLED on all vault");
            console.log("         factories; every acquire uses the fixed zrouterFee/zrouterTickSpacing pool.");
            console.log("         Every network this repo deploys supplies a quoter, so on a real network this");
            console.log("         is a mis-filled config -- and no setter fixes it afterwards: the factories");
            console.log("         take it as a constructor immutable. Redeploy with cfg.zQuoter set.");
        }

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

        alignmentRegistryImpl = new AlignmentRegistryV1(cfg.weth, cfg.v3Factory);
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
        MasterRegistryV1(masterRegistry).setComponentRegistry(address(componentRegistry));

        // Ownerless, non-upgradeable account profile registry (ADR-0004) — no proxy, no init.
        profileRegistry = new ProfileRegistry();

        // Ownerless, non-upgradeable curation registry: a curation is published by anyone, for
        // nothing, so there is no owner to gate it and no fee to raise.
        curationRegistry = new CurationRegistry();

        // Alignment-target request intake (docs/phases/alignment-target-requests.md): standalone,
        // Ownable, escrows a refundable deposit while Pending. Owner is the deployer, handed to ADMIN
        // via the 2-step handover in deploy.ts. The parameters are owner-tunable.
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

        zrouter = cfg.zrouter != address(0)
            ? zRouter(payable(cfg.zrouter))
            : new zRouter(cfg.zrouterChain.weth != address(0) ? cfg.zrouterChain : mainnetChainConfig(), deployer);

        // ── Phase 4: Vault infrastructure ───────────────────────────────────

        // Self-guards with code.length checks when pools don't exist.
        priceValidator = new UniswapVaultPriceValidator(
            cfg.weth, cfg.v3Factory, cfg.v4PoolManager, cfg.priceDeviationBps, cfg.twapSeconds
        );

        uniVaultFactory = new UniAlignmentVaultFactory(
            cfg.weth,
            cfg.v4PoolManager,
            address(zrouter),
            cfg.zrouterFee,
            cfg.zrouterTickSpacing,
            address(treasury),
            IVaultPriceValidator(address(priceValidator)),
            alignmentRegistry,
            cfg.zQuoter // best-route quoter (address(0) = fixed-pool fallback only); OPERATOR INPUT
        );

        if (cfg.zamm != address(0)) {
            zammVaultFactory = new ZAMMAlignmentVaultFactory(
                cfg.zamm,
                address(zrouter),
                cfg.weth,
                address(treasury),
                IVaultPriceValidator(address(priceValidator)),
                alignmentRegistry,
                cfg.zQuoter // best-route quoter (address(0) = ZAMM fixed-pool fallback); OPERATOR INPUT
            );
        }

        // Aave endowment vault factory (ADR-0003), only where Aave's WETH stataToken exists.
        if (cfg.aaveStataToken != address(0)) {
            // The endowment family's WETH: `cfg.aaveWeth` when set, otherwise `cfg.weth`.
            address aaveWeth = cfg.aaveWeth == address(0) ? cfg.weth : cfg.aaveWeth;
            // The vault wraps ETH into `aaveWeth` and then calls `stataToken.deposit`, which pulls the
            // stataToken's own `asset()`. If those differ every contribution reverts, so the deploy
            // fails here instead.
            address stataAsset = IStataToken(cfg.aaveStataToken).asset();
            require(
                stataAsset == aaveWeth,
                "DeployCore: cfg.aaveWeth does not match the Aave stataToken's asset() (set cfg.aaveWeth)"
            );
            aaveVaultFactory = new AlignmentEndowmentVaultFactory(
                aaveWeth, cfg.aaveStataToken, address(treasury), masterRegistry, alignmentRegistry
            );
            // Registered and activated as an IFactory before the Phase-5 seed loop: the factory
            // self-registers each vault it deploys, so it must be an active registrar when it deploys
            // the seed vaults. `title` must pass MetadataUtils.isValidName (alphanumeric +
            // hyphen/underscore, no spaces), hence the hyphens.
            MasterRegistryV1(masterRegistry)
                .registerFactory(
                    address(aaveVaultFactory),
                    "AAVE",
                    "Aave-Endowment-Vault-Factory",
                    "Aave Endowment Vault",
                    "https://ms2.fun",
                    new bytes32[](0),
                    deployer
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

            // Aave endowment vault (ADR-0003): pin the target's community payout from config, then
            // deploy a per-target endowment vault clone. A zero payout is left unset and pinned on the
            // registry afterwards: the vault reads its sink live from there, so a pin made after deploy needs no
            // vault-side wiring, and the pin is write-once, so the deployer cannot redirect it. The
            // factory self-registers the vault with an on-chain-derived name and a hardcoded
            // metadataURI, crediting the deployer; a second registerVault would revert AlreadyRegistered.
            if (cfg.aaveStataToken != address(0)) {
                if (t.communityPayout != address(0)) {
                    alignmentRegistry.setCommunityPayout(targetId, t.communityPayout);
                }
                address aaveVault = aaveVaultFactory.deployVault(
                    _vaultSalt(cfg.chainId, i, "AAVE", cfg.saltNonce), t.token, targetId
                );
                aaveVaults.push(aaveVault);
            }

            if (t.deployUniVault) {
                bytes32 salt = _vaultSalt(cfg.chainId, i, "UNIv4", cfg.saltNonce);
                address vault = uniVaultFactory.deployVault(salt, t.token, targetId, IVaultPriceValidator(address(0)));
                // The V4 pool key makes the vault liquidity-ready (isLiquidityReady() true), so the
                // wizard offers the Uni venue. The factory owns the vault, so the key routes through
                // it. Native ETH is currency0 (address(0) sorts below any token), the alignment token
                // is currency1, and fee/tickSpacing come from the network's V4 config.
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

            if (t.deployZAMMVault && address(zammVaultFactory) != address(0)) {
                bytes32 salt = _vaultSalt(cfg.chainId, i, "ZAMM", cfg.saltNonce);
                // The ETH/alignmentToken ZAMM pool key is baked in at deploy (token0 = native ETH,
                // token1 = alignment token, feeOrHook from config) so the vault is liquidity-ready.
                // `ZAMMAlignmentVaultFactory.setVaultPoolKey` can rewire it while no liquidity exists.
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

        ERC404BondingOps erc404Ops = new ERC404BondingOps();
        erc404Impl = new ERC404BondingInstance(address(erc404Ops));
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

        // Deploy-bond escrow: standalone, holds the bond ETH so the factory keeps its "holds no ETH"
        // invariant. Owner is the deployer, handed to ADMIN via the deploy.ts handover. The bond
        // defaults to 0 (off).
        deployBondEscrow = new DeployBondEscrow(deployer, address(erc404Factory), address(treasury), cfg.weth);
        erc404Factory.setDeployBondEscrow(address(deployBondEscrow));

        // _deployAndInitialize checks isApprovedComponent(preset.curveComputer).
        componentRegistry.approveComponent(
            address(curveParamsComputer), bytes32("curve_computer"), "CurveParamsComputer"
        );

        // The protocol presets (NICHE / STANDARD / HYPE); the ladder is defined in `LaunchPresets`.
        for (uint256 i = 0; i < LaunchPresets.COUNT; i++) {
            launchManager.setPreset(i, LaunchPresets.preset(i, address(curveParamsComputer)));
        }

        // ── Phase 7: ERC1155Factory + DynamicPricingModule ───────────────────

        // Every collection is an EIP-1167 clone of this one implementation, fixed in the factory's
        // constructor. Its own constructor sets the initialized flag, so nobody can claim it.
        erc1155Impl = new ERC1155Instance();
        erc1155Factory = new ERC1155Factory(
            masterRegistry, address(globalMessageRegistry), address(componentRegistry), cfg.weth, address(erc1155Impl)
        );
        erc1155Factory.setProtocolTreasury(address(treasury));

        dynamicPricingModule = new DynamicPricingModule();
        componentRegistry.approveComponent(
            address(dynamicPricingModule), FeatureUtils.DYNAMIC_PRICING, "DynamicPricingModule"
        );
        erc1155Factory.setDynamicPricingModule(address(dynamicPricingModule));

        // ── Phase 7b: ComponentRegistry seeding — wizard-facing metadata stubs ─────
        // These MockComponentModules give the creation wizard metadata to display for each
        // selectable component. Users pass these addresses to createInstance; the real functional
        // modules are wired into factory internals.
        // Gating is the exception: a per-instance module the wizard passes through verbatim
        // (createInstance attaches it, mint calls canMint, the owner calls configureFor after
        // create), so the real gating module carries its own metadata.

        string memory merkleGatingMeta =
            "data:application/json,{\"name\":\"Merkle Allowlist Gating\",\"subtitle\":\"Allowlist \\u00b7 Merkle Tree\",\"description\":\"Upload a list of wallet addresses to restrict minting to an allowlist.\",\"configType\":\"merkle-allowlist-gating\"}";
        string memory uniV4Meta =
            "data:application/json,{\"name\":\"Uniswap V4 Deployer\",\"subtitle\":\"Uniswap V4 \\u00b7 Concentrated Liquidity\",\"description\":\"Deploy liquidity to a Uniswap V4 pool on graduation.\",\"configType\":\"launch-profile\"}";
        string memory zammMeta =
            "data:application/json,{\"name\":\"ZAMM Deployer\",\"subtitle\":\"ZAMM \\u00b7 Constant Product\",\"description\":\"Deploy liquidity to ZAMM on graduation.\",\"configType\":\"launch-profile\"}";

        // Merkle-allowlist gating module: per-instance, per-edition, quantity-capped allowlists.
        // The owner calls configureFor after create with the merkle roots.
        moduleMerkleGating = new MerkleGatingModule(masterRegistry);
        componentRegistry.approveComponent(address(moduleMerkleGating), FeatureUtils.GATING, "Merkle Allowlist Gating");
        moduleMerkleGating.setMetadataURI(merkleGatingMeta);

        // Uni-V4 + ZAMM: the real LP deployer modules are deployed where the AMM's config is present,
        // so graduation stands up a pool and the modules answer the pool-param getters (poolFee/
        // tickSpacing, feeOrHook) the embedded swap reads. Where the AMM isn't configured, a
        // metadata-only stub keeps the component approved for the wizard.
        if (cfg.v4PoolManager != address(0) && cfg.weth != address(0)) {
            LiquidityDeployerModule uniMod = new LiquidityDeployerModule(
                cfg.v4PoolManager, cfg.weth, cfg.zrouterFee, cfg.zrouterTickSpacing, masterRegistry
            );
            uniMod.setMetadataURI(uniV4Meta);
            // Seeds the module's alignment-hook fee config from NetworkConfig. `alignmentHookFactory`
            // stays address(0); selecting a hook is a governed `setAlignmentHookFactory` call.
            uniMod.setHookFeeBips(cfg.hookFeeBips);
            uniMod.setLpFeeRate(cfg.lpFeeRate);
            moduleUniV4Deployer = address(uniMod);

            // The Uni-V4 swap-tithe hook factory is registered under the ALIGNMENT_HOOK component tag
            // so a governed op can point the module's alignmentHookFactory at it; it is not selected.
            // PoolManager/WETH/masterRegistry are the factory's immutables; the per-graduation fee
            // data comes from the module at deployHook time.
            //
            // `deployer` is the factory's owner and its initial `hookOwner` (stamped into every hook
            // it deploys) because the governance Timelock is deployed by the separate
            // `DeployTimelock.s.sol`. `MigrateOwnership` moves both to the Timelock. `hookOwner` is
            // settable state, not an immutable, so the deployer key does not stay on `setLpFeeRate`
            // and `rescueQueuedFees` of every hook ever produced.
            UniTitheHookFactory titheFactory =
                new UniTitheHookFactory(IPoolManager(cfg.v4PoolManager), cfg.weth, deployer, masterRegistry);
            uniTitheHookFactory = address(titheFactory);
            componentRegistry.approveComponent(
                uniTitheHookFactory, FeatureUtils.ALIGNMENT_HOOK, "Uniswap V4 Alignment Tithe Hook"
            );

            // Deployed alongside the module, not behind the hook switch: the router must already exist
            // when the switch is thrown, or the first collection to graduate after it is untradeable.
            // It holds no funds and grants no allowances.
            alignmentHookSwapRouter = address(new AlignmentHookSwapRouter(cfg.v4PoolManager));
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

        // ERC404 staking module: the ERC404 factory wires it into instances created with staking
        // enabled; ValidateSepolia expects it approved as STAKING.
        erc404StakingModule = new ERC404StakingModule(masterRegistry);
        componentRegistry.approveComponent(address(erc404StakingModule), FeatureUtils.STAKING, "ERC404 Staking");
        // No configType, so the wizard auto-advances on selection.
        string memory stakingMeta =
            "data:application/json,{\"name\":\"Staking\",\"subtitle\":\"Stake \\u00b7 Earn Fees\",\"description\":\"Stake your tokens to earn a pro-rata share of trading fees.\"}";
        erc404StakingModule.setMetadataURI(stakingMeta);

        // ── Metadata-resolution stack (ADR-0006/0007) ─────────────────────────
        // Router (resolver slot), overlay (augmentation), tier (static band art). Each carries
        // its own wizard metadata; the ERC404 factory's metadata overload wires and seals them per instance.
        metadataResolverRouter = new MetadataResolverRouter(masterRegistry);
        metadataOverlayModule = new MetadataOverlayModule(masterRegistry);
        tokenTierBandResolver = new TokenTierBandResolver(masterRegistry);

        string memory resolverMeta =
            "data:application/json,{\"name\":\"Metadata Resolver\",\"subtitle\":\"Composable \\u00b7 Stacked Resolvers\",\"description\":\"Compose stacking metadata modules (overlay, tier) behind one resolver - first non-empty wins.\",\"configType\":\"metadata-resolver\"}";
        string memory overlayMeta =
            "data:application/json,{\"name\":\"Artist Overlay\",\"subtitle\":\"Augmentation \\u00b7 Commissions & Events\",\"description\":\"Artist-authored augmentation served over the base art: per-id commissions and cohort event waves, holder-selectable.\",\"configType\":\"metadata-overlay\"}";
        string memory tierMeta =
            "data:application/json,{\"name\":\"Token Tiers\",\"subtitle\":\"Denominations \\u00b7 Static Band Art\",\"description\":\"Id bands above the mintable supply carry their own art, unconditionally - a band id always shows its band's art. Frozen at launch.\",\"configType\":\"metadata-tier\"}";

        metadataResolverRouter.setMetadataURI(resolverMeta);
        metadataOverlayModule.setMetadataURI(overlayMeta);
        tokenTierBandResolver.setMetadataURI(tierMeta);

        componentRegistry.approveComponent(address(metadataResolverRouter), FeatureUtils.RESOLVER, "Metadata Resolver");
        componentRegistry.approveComponent(address(metadataOverlayModule), FeatureUtils.OVERLAY, "Artist Overlay");
        componentRegistry.approveComponent(address(tokenTierBandResolver), FeatureUtils.TIER, "Token Tiers");

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
                new bytes32[](0),
                address(0) // first-party platform factory, no external builder to credit
            );
        MasterRegistryV1(masterRegistry)
            .registerFactory(
                address(erc1155Factory),
                "ERC1155",
                "ERC1155-Edition-Factory",
                "ERC1155 Editions",
                "https://ms2.fun",
                new bytes32[](0),
                address(0) // first-party platform factory, no external builder to credit
            );
        MasterRegistryV1(masterRegistry)
            .registerFactory(
                address(erc721Factory),
                "ERC721",
                "ERC721-Auction-Factory",
                "ERC721 Auction",
                "https://ms2.fun",
                new bytes32[](0),
                address(0) // first-party platform factory, no external builder to credit
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
        vm.serializeAddress(c, "CurationRegistry", address(curationRegistry));
        vm.serializeAddress(c, "AlignmentTargetRequestRegistry", address(targetRequestRegistry));
        vm.serializeAddress(c, "QueryAggregator", address(queryAggregator));
        vm.serializeAddress(c, "zRouter", address(zrouter));
        // address(0) where this network has no best-route quoter: the vaults use their fixed tier.
        vm.serializeAddress(c, "zQuoter", cfg.zQuoter);
        vm.serializeAddress(c, "LaunchManager", address(launchManager));
        vm.serializeAddress(c, "CurveParamsComputer", address(curveParamsComputer));
        // The shared ERC-1155 collection implementation. Every collection is an EIP-1167 clone of
        // it, so a block explorer resolves each one's read/write surface from this contract's
        // verified source.
        vm.serializeAddress(c, "ERC1155Instance", address(erc1155Impl));
        // The ERC-404 counterpart: every bonding collection is an EIP-1167 clone of this contract, so
        // the explorer resolves its read/write surface from this one's verified source.
        vm.serializeAddress(c, "ERC404BondingInstance", address(erc404Impl));
        vm.serializeAddress(c, "DynamicPricingModule", address(dynamicPricingModule));
        vm.serializeAddress(c, "ModuleMerkleGating", address(moduleMerkleGating));
        vm.serializeAddress(c, "ModuleUniV4Deployer", address(moduleUniV4Deployer));
        vm.serializeAddress(c, "AlignmentHookSwapRouter", alignmentHookSwapRouter);
        // The Uni-V4 swap-tithe hook factory. `MigrateOwnership` reads it as `UNI_TITHE_HOOK_FACTORY`
        // to move the factory and, via `setHookOwner`, the owner stamped into every hook it deploys.
        // address(0) on a network with no Uni rail, as for `AlignmentHookSwapRouter`.
        vm.serializeAddress(c, "UniTitheHookFactory", uniTitheHookFactory);
        vm.serializeAddress(c, "ModuleZAMMDeployer", address(moduleZAMMDeployer));
        vm.serializeAddress(c, "ERC404StakingModule", address(erc404StakingModule));
        vm.serializeAddress(c, "MetadataResolverRouter", address(metadataResolverRouter));
        vm.serializeAddress(c, "MetadataOverlayModule", address(metadataOverlayModule));
        vm.serializeAddress(c, "TokenTierBandResolver", address(tokenTierBandResolver));
        vm.serializeAddress(c, "DeployBondEscrow", address(deployBondEscrow));
        // Seed-script pointers to the first Uni LP vault and the first Aave endowment vault, resolved
        // by family because the `vaults` array order shifts as LP families are enabled per network.
        vm.serializeAddress(c, "SeedUniVault", uniVaults.length > 0 ? uniVaults[0] : address(0));
        vm.serializeAddress(c, "SeedAaveVault", aaveVaults.length > 0 ? aaveVaults[0] : address(0));
        // The ZAMM LP family pointer, so the seed can bind instances across all three vault flavors.
        vm.serializeAddress(c, "SeedZammVault", zammVaults.length > 0 ? zammVaults[0] : address(0));
        string memory contracts = vm.serializeAddress(c, "UniswapVaultPriceValidator", address(priceValidator));

        // factories sub-object
        string memory f = "factories";
        vm.serializeAddress(f, "ERC404", address(erc404Factory));
        vm.serializeAddress(f, "ERC1155", address(erc1155Factory));
        vm.serializeAddress(f, "ERC721", address(erc721Factory));
        // Uniswap V4 alignment-vault factory: it owns every vault it deploys, so the per-vault
        // owner-only setters (`setVaultPoolKey`, `setVaultPriceValidator`) are reachable only through it.
        vm.serializeAddress(f, "UNI", address(uniVaultFactory));
        // Aave endowment vault factory, for the app's permissionless Yield-vault creation. Zero when
        // this network has no Aave stataToken.
        string memory factories = vm.serializeAddress(f, "AAVE", address(aaveVaultFactory));

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

    /// @dev Per-target vault CREATE3 salt. `nonce == 0` gives `keccak256(chainId, i, tag)`
    ///      (deterministic production addresses); a non-zero nonce (DeployAnvil passes
    ///      block.timestamp) gives a fresh salt so local re-deploys onto the same fork don't CreateCollision.
    function _vaultSalt(uint256 chainId, uint256 i, string memory tag, uint256 nonce) private pure returns (bytes32) {
        return nonce == 0 ? keccak256(abi.encode(chainId, i, tag)) : keccak256(abi.encode(chainId, i, tag, nonce));
    }
}
