// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { Vm } from "forge-std/Vm.sol";
import { CREATEX } from "../../src/shared/CreateXConstants.sol";
import { CREATEX_BYTECODE } from "createx-forge/script/CreateX.d.sol";
import { DeployCore } from "../../script/DeployCore.sol";
import { SeedAnvil } from "../../script/SeedAnvil.s.sol";
import { SeedAnvilShared, ArtistEndowments, IEndowmentPayout } from "../../script/SeedAnvilShared.sol";
import { ERC1155Instance } from "../../src/factories/erc1155/ERC1155Instance.sol";
import { ERC404BondingInstance } from "../../src/factories/erc404/ERC404BondingInstance.sol";
import { MetadataResolverRouter } from "../../src/metadata/MetadataResolverRouter.sol";
import { ERC721AuctionInstance } from "../../src/factories/erc721/ERC721AuctionInstance.sol";
import { IAlignmentVault } from "../../src/interfaces/IAlignmentVault.sol";
import { IAlignmentRegistry } from "../../src/master/interfaces/IAlignmentRegistry.sol";
import { AlignmentRegistryV1 } from "../../src/master/AlignmentRegistryV1.sol";
import { LaunchManager } from "../../src/factories/erc404/LaunchManager.sol";
import { UniAlignmentVault } from "../../src/vaults/uni/UniAlignmentVault.sol";
import { UniAlignmentVaultFactory } from "../../src/vaults/uni/UniAlignmentVaultFactory.sol";
import { RevenueSplitLib } from "../../src/shared/libraries/RevenueSplitLib.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { AnvilFixedRouteQuoter } from "../../script/SeedAnvilShared.sol";
import { MockWETH, MockStataToken } from "../vaults/aave/AlignmentEndowmentVault.t.sol";

/// @dev The narrowest thing `AlignmentRegistryV1.setReferencePool` will accept as a Uniswap V3 price
///      authority: the pair it reports must be exactly `{token, weth}`, and `observe` must serve two
///      cumulatives over the requested window. Nothing reads the VALUES here — the registry probes
///      only that the pool answers — so this stands in for a real pool without pretending to price
///      anything. It exists because the reference-pool leg is a real precondition of the seed and a
///      suite that skipped it would leave the seed's only price authority unasserted.
contract MockV3ReferencePool {
    address public token0;
    address public token1;

    constructor(address a, address b) {
        (token0, token1) = a < b ? (a, b) : (b, a);
    }

    function observe(uint32[] calldata secondsAgos)
        external
        pure
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidity)
    {
        tickCumulatives = new int56[](secondsAgos.length);
        secondsPerLiquidity = new uint160[](secondsAgos.length);
    }
}

/// @dev Exposes SeedAnvil's own phase functions (unmodified, `internal`) to a test caller. Every
///      function here is a one-line forward — no seed logic is reproduced or re-derived. The two
///      resolution seams the real `run()` reads from disk/env (`_readMerkleGatingModule()`,
///      `vm.envUint("PRIVATE_KEY")`) are never invoked: identity is set directly on the inherited
///      storage, and the gating module address is passed in by the caller, who already deployed it
///      locally. Nothing here needs `forge script`, `deployments/anvil.json`, or a mainnet fork.
contract SeedModuleCoverageHarness is SeedAnvil {
    function setIdentity(uint256 pk) external {
        deployerKey = pk;
        deployer = vm.addr(pk);
        acct1 = vm.addr(ACCOUNT_1_KEY);
    }

    function seedErc1155(Deployed memory d) external returns (address c0, address c2) {
        return _seedErc1155(d);
    }

    function seedErc404PreOpen(Deployed memory d) external {
        _seedErc404PreOpen(d);
    }

    function seedErc404MidCurve(Deployed memory d) external {
        _seedErc404MidCurve(d);
    }

    function seedErc404ReadyToGraduate(Deployed memory d) external {
        _seedErc404ReadyToGraduate(d);
    }

    function seedErc404Stacked(Deployed memory d) external {
        _seedErc404Stacked(d);
    }

    function seedGatedErc1155(Deployed memory d, address merkleGating) external returns (address instance) {
        return _seedGatedErc1155(d, merkleGating);
    }

    function seedGatedErc404(Deployed memory d, address merkleGating) external returns (address instance) {
        return _seedGatedErc404(d, merkleGating);
    }

    function seedCultAlignmentLegs(Deployed memory d, address referencePool) external {
        _seedCultAlignmentLegs(d, referencePool);
    }

    function registerCatalogPresets(Deployed memory d) external {
        _registerCatalogPresets(d);
    }

    function seedCatalogFlagship(Deployed memory d) external {
        _seedCatalogFlagship(d);
    }

    function seedCatalogMidCurve(Deployed memory d) external {
        _seedCatalogMidCurve(d);
    }

    function seedCatalogSecondMidCurve(Deployed memory d) external {
        _seedCatalogSecondMidCurve(d);
    }

    function seedCatalogGraduate(Deployed memory d) external {
        _seedCatalogGraduate(d);
    }

    function seedCatalogAuction(Deployed memory d) external {
        _seedCatalogAuction(d);
    }

    function seedArtistEndowments(Deployed memory d) external {
        _seedArtistEndowments(d);
    }

    function seedCatalogEditions(Deployed memory d) external {
        _seedCatalogEditions(d);
    }

    /// @dev The seed's own pins, exposed so the suite reads them instead of restating them. A test
    ///      that hardcoded the token or the preset ids would keep passing while the seed moved.
    function alignmentTokenPin() external pure returns (address) {
        return CULT_TOKEN;
    }

    function catalogPresetIds() external pure returns (uint8 source, uint8[4] memory rows) {
        rows = [PRESET_SCHIZO, PRESET_PIXELADY, PRESET_BOREDMILADY, PRESET_LAWBSTERS];
        return (PRESET_SOURCE, rows);
    }

    function catalogRaises() external pure returns (uint256[4] memory) {
        return [SCHIZO_REAL_RAISE, PIXELADY_REAL_RAISE, BOREDMILADY_REAL_RAISE, LAWBSTERS_REAL_RAISE];
    }

    function catalogSupplies() external pure returns (uint256[4] memory) {
        return [SCHIZO_REAL_SUPPLY, PIXELADY_REAL_SUPPLY, BOREDMILADY_REAL_SUPPLY, LAWBSTERS_REAL_SUPPLY];
    }

    function catalogAuctionSupply() external pure returns (uint256) {
        return FIGMATA_REAL_SUPPLY;
    }

    /// @dev The per-piece art bases each roster curve was created with, in the same row order. Read
    ///      off the seed rather than restated here: a base that changed in the seed and not in the
    ///      suite would leave the art assertions checking a string nothing uses.
    function catalogPieceBases() external pure returns (string[4] memory) {
        return [ART_BASE_ARCTIC, ART_BASE_PIXELADY, ART_BASE_BOREDMILADY, ART_BASE_LAWBSTERS];
    }

    function artistSlugs() external pure returns (string[2] memory) {
        return [ArtistEndowments.PARADILF_SLUG, ArtistEndowments.PETRAVOICE_SLUG];
    }

    function catalogEditionSizes()
        external
        pure
        returns (uint256[3] memory supplies, uint256[3] memory freeAllocations)
    {
        supplies = [ANTI_SEEDED_SUPPLY, OEKAKI_SEEDED_SUPPLY, MILADY333_SEEDED_SUPPLY];
        freeAllocations = [ANTI_FREE_ALLOC, OEKAKI_FREE_ALLOC, MILADY333_FREE_ALLOC];
    }

    function catalogAcquireRoute() external pure returns (uint24 fee, int24 tickSpacing) {
        return (CULT_ACQUIRE_FEE, CULT_ACQUIRE_TICK_SPACING);
    }

    function catalogActors() external view returns (address second, address third) {
        return (acct1, vm.addr(PERSON_KEY));
    }
}

/// @title SeedModuleCoverageTest (noesis-358)
/// @notice Module coverage is a property of `SeedAnvil.s.sol` that nobody could read without
///         re-deriving it (noesis-357's census). This suite runs the seed's own phase functions —
///         unmodified, via `SeedModuleCoverageHarness`, never `forge script` — against a protocol
///         deployed locally through `DeployCore` (the same no-fork pattern `VaultFlavorsTest` and
///         `ValidateSepoliaTest` already use), then reads the RESULTING on-chain wiring back off the
///         created instances. Every assertion below is the seed's real configuration, not a
///         hand-maintained restatement of it: change what a phase function passes as a module
///         address and the corresponding assertion here moves with it, because both read the same
///         instance state.
///
///         PromotionBadges is a deliberate exclusion, not a coverage gap: it is PARKED pre-testnet
///         (`DeployCore.sol`'s "DEFERRAL NOTE"), carries no `CreateParams` slot in any factory, and
///         is guarded separately by `test/script/PromotionBadgesNotDeployed.t.sol`. It has no slot
///         here because the seed has no slot for it.
contract SeedModuleCoverageTest is Test {
    address constant STUB_ZAMM = address(0xADD0);
    address constant STUB_CYPHER_PM = address(0xADD1);
    address constant STUB_CYPHER_ROUTER = address(0xADD2);
    address constant STUB_CYPHER_FACTORY = address(0xADD4);
    uint256 constant DEPLOYER_KEY = 0xD59;

    bytes32 constant ERC1155_INSTANCE_CREATED = keccak256("InstanceCreated(address,address,string,address)");
    bytes32 constant ERC404_INSTANCE_CREATED = keccak256("InstanceCreated(address,address,string,string,address)");

    DeployCore internal s;
    SeedModuleCoverageHarness internal harness;
    SeedAnvilShared.Deployed internal d;
    address internal deployer;
    address internal merkleGating;

    // ── ERC1155 instances ──
    address internal c0; // neon-drift: aave vault, LIMITED_FIXED/UNLIMITED/LIMITED_DYNAMIC editions
    address internal c2; // ghost-mint: uni vault, free-claim edition
    address internal veil; // gated (noesis-357)

    // ── ERC404 instances ──
    address internal ember; // preopen: cypher vault + cypher deployer, ungated, no staking
    address internal vapor; // mid-curve: uni vault + uni deployer + staking module
    address internal cinder; // ready-to-graduate: uni vault + uni deployer
    address internal molten; // ready-to-graduate: zamm vault + zamm deployer
    address internal quench; // ready-to-graduate: cypher vault + cypher deployer
    address internal prism; // stacked metadata: zamm vault + zamm deployer + resolver/overlay/tier
    address internal sigil; // gated (noesis-357)

    // ── the alignment catalog roster ──
    address internal schizo; // flagship curve: real supply, real raise, the target's own uni vault
    address internal pixelady; // mid-curve exemplar: same vault, no maturity time
    address internal figmata; // ERC721 auction bound to the target's own Aave endowment vault
    address internal anti; // truncated free-mint-at-scale edition
    address internal oekaki; // truncated mixed free/paid edition
    address internal milady333; // truncated zero-revenue edition
    address internal boredmilady; // second mid-curve row
    address internal lawbsters; // small row: bought out in phase 2, graduation left uncrossed
    address internal paradilf; // artist endowment collection (target 3)
    address internal petravoice; // artist endowment collection (target 4)
    address internal referencePool;
    address internal cultToken;

    function setUp() public {
        vm.etch(CREATEX, CREATEX_BYTECODE);

        deployer = vm.addr(DEPLOYER_KEY);
        vm.deal(deployer, 1000 ether);

        // Built first: the suite reads the seed's own pins off it rather than restating them.
        harness = new SeedModuleCoverageHarness();
        vm.deal(address(harness), 100_000 ether);
        harness.setIdentity(DEPLOYER_KEY);
        cultToken = harness.alignmentTokenPin();

        MockWETH weth = new MockWETH();
        MockStataToken stata = new MockStataToken(address(weth));

        // The catalog roster binds to a SECOND alignment target, and it resolves that target's vaults
        // by matching the token address the seed carries as a constant. So the suite has to make that
        // exact address a real ERC20 locally — otherwise the roster would have to be tested against a
        // token it does not actually use, which is the kind of near-miss this suite exists to catch.
        vm.etch(cultToken, address(new MockWETH()).code);

        // Fixture tokens for the two artist targets. Registry paperwork only: an endowment vault's
        // `alignmentToken` exists to satisfy `registerVault`, and the vault never touches it.
        address[2] memory artistTokens = [address(new MockWETH()), address(new MockWETH())];

        s = new DeployCore();
        // DeployCore's OWN post-deploy setup (e.g. queueManager.setWeth) runs with msg.sender ==
        // address(s), so the registries it owns must be owned by address(s) too - matching the
        // established pattern in DeployTest/ValidateSepoliaTest/VaultFlavorsTest. `deployer` (the
        // seed's own identity, below) is unrelated: every seed call this suite drives is
        // permissionless (createInstance, rentFeatured, setProfile, receiveContribution).
        s.deploy(address(s), _config(address(weth), address(stata), cultToken, artistTokens));

        d.erc1155 = s.erc1155Factory();
        d.erc721 = s.erc721Factory();
        d.erc404 = s.erc404Factory();
        d.profiles = s.profileRegistry();
        d.queue = s.queueManager();
        d.messages = s.globalMessageRegistry();
        d.vault = s.uniVaults(0);
        d.zammVault = s.zammVaults(0);
        d.cypherVault = s.cypherVaults(0);
        d.endowmentVault = s.aaveVaults(0);
        d.stakingModule = address(s.erc404StakingModule());
        d.zammDeployer = s.moduleZAMMDeployer();
        d.uniDeployer = s.moduleUniV4Deployer();
        d.cypherDeployer = s.moduleCypherDeployer();
        d.resolverRouter = address(s.metadataResolverRouter());
        d.overlay = address(s.metadataOverlayModule());
        d.tier = address(s.tokenTierBandResolver());
        d.alignmentRegistry = address(s.alignmentRegistry());
        d.master = s.masterRegistry();
        d.launchManager = address(s.launchManager());
        d.uniVaultFactory = address(s.uniVaultFactory());
        // The second target's own vaults — the ones the seed resolves out of the deployment file by
        // matching the alignment token. Index 1 because the target loop deploys one vault per family
        // per target in config order, and asserting they are NOT the first target's is the point:
        // binding a catalog instance to the wrong target's vault is silent and tithes the wrong
        // community, which no amount of rendering would reveal.
        d.cultUniVault = s.uniVaults(1);
        d.cultAaveVault = s.aaveVaults(1);
        d.cultTargetId = 2;
        // The artist targets' endowment vaults — third and fourth in the per-target loop's order.
        d.paradilfVault = s.aaveVaults(2);
        d.petravoiceVault = s.aaveVaults(3);
        merkleGating = address(s.moduleMerkleGating());

        // The seed performs owner-only writes on the launch presets, the alignment registry and the
        // vault factory. On a real deployment the deployer still holds all three at seed time; here
        // DeployCore was driven by this suite's harness contract, so the same three are handed to the
        // seed's identity before it runs. Mirrors the live ordering rather than working around it.
        vm.prank(address(s));
        LaunchManager(d.launchManager).transferOwnership(deployer);
        vm.prank(address(s));
        UniAlignmentVaultFactory(d.uniVaultFactory).transferOwnership(deployer);
        // The registries are UUPS proxies that force the two-step handover, which the NEW owner must
        // initiate — the same flow deploy.ts performs against the live chain.
        vm.prank(deployer);
        AlignmentRegistryV1(d.alignmentRegistry).requestOwnershipHandover();
        vm.prank(address(s));
        AlignmentRegistryV1(d.alignmentRegistry).completeOwnershipHandover(deployer);

        (c0, c2) = harness.seedErc1155(d);

        vm.recordLogs();
        harness.seedErc404PreOpen(d);
        ember = _oneInstance(address(d.erc404), ERC404_INSTANCE_CREATED);

        vm.recordLogs();
        harness.seedErc404MidCurve(d);
        vapor = _oneInstance(address(d.erc404), ERC404_INSTANCE_CREATED);

        vm.recordLogs();
        harness.seedErc404ReadyToGraduate(d);
        // One graduate-ready instance per LP venue, in the seed's own creation order.
        address[] memory ready = _instances(address(d.erc404), ERC404_INSTANCE_CREATED, 3);
        cinder = ready[0];
        molten = ready[1];
        quench = ready[2];

        vm.recordLogs();
        harness.seedErc404Stacked(d);
        prism = _oneInstance(address(d.erc404), ERC404_INSTANCE_CREATED);

        veil = harness.seedGatedErc1155(d, merkleGating);
        sigil = harness.seedGatedErc404(d, merkleGating);

        // ── the alignment catalog roster ──
        (address secondActor, address thirdActor) = harness.catalogActors();
        vm.deal(secondActor, 1000 ether);
        vm.deal(thirdActor, 1000 ether);

        referencePool = address(new MockV3ReferencePool(cultToken, address(weth)));
        harness.seedCultAlignmentLegs(d, referencePool);
        harness.registerCatalogPresets(d);

        vm.recordLogs();
        harness.seedCatalogFlagship(d);
        schizo = _oneInstance(address(d.erc404), ERC404_INSTANCE_CREATED);

        vm.recordLogs();
        harness.seedCatalogMidCurve(d);
        pixelady = _oneInstance(address(d.erc404), ERC404_INSTANCE_CREATED);

        vm.recordLogs();
        harness.seedCatalogSecondMidCurve(d);
        boredmilady = _oneInstance(address(d.erc404), ERC404_INSTANCE_CREATED);

        vm.recordLogs();
        harness.seedCatalogGraduate(d);
        lawbsters = _oneInstance(address(d.erc404), ERC404_INSTANCE_CREATED);

        vm.recordLogs();
        harness.seedCatalogAuction(d);
        figmata = _oneInstance(address(d.erc721), ERC1155_INSTANCE_CREATED);

        vm.recordLogs();
        harness.seedArtistEndowments(d);
        address[] memory artistRows = _instances(address(d.erc721), ERC1155_INSTANCE_CREATED, 2);
        paradilf = artistRows[0];
        petravoice = artistRows[1];

        vm.recordLogs();
        harness.seedCatalogEditions(d);
        address[] memory tranche = _instances(address(d.erc1155), ERC1155_INSTANCE_CREATED, 3);
        anti = tranche[0];
        oekaki = tranche[1];
        milady333 = tranche[2];
    }

    // ── gatingModule: currently zero at every ungated site; must go non-zero somewhere ──

    function test_gatingModule_atLeastOneInstanceWiresAModule() public view {
        address[] memory ungatedErc1155 = new address[](1);
        ungatedErc1155[0] = c2;
        address[] memory ungatedErc404 = new address[](6);
        ungatedErc404[0] = ember;
        ungatedErc404[1] = vapor;
        ungatedErc404[2] = cinder;
        ungatedErc404[3] = molten;
        ungatedErc404[4] = quench;
        ungatedErc404[5] = prism;

        uint256 total = ungatedErc1155.length + ungatedErc404.length + 2; // + veil, sigil
        uint256 wired;

        for (uint256 i = 0; i < ungatedErc1155.length; i++) {
            if (address(ERC1155Instance(payable(ungatedErc1155[i])).gatingModule()) != address(0)) wired++;
        }
        for (uint256 i = 0; i < ungatedErc404.length; i++) {
            if (address(ERC404BondingInstance(payable(ungatedErc404[i])).gatingModule()) != address(0)) wired++;
        }
        if (address(ERC1155Instance(payable(veil)).gatingModule()) != address(0)) wired++;
        if (address(ERC404BondingInstance(payable(sigil)).gatingModule()) != address(0)) wired++;

        assertGt(wired, 0, string.concat("gating: 0 of ", vm.toString(total), " instances wire a module"));
        // The baseline family (c2, ember, vapor, cinder, molten, quench, prism) must stay open — a gate that
        // is non-vacuous by accident (everything gated) would hide a regression the other way.
        assertLt(wired, total, "gating: every instance is gated - the ungated baseline is gone");
    }

    // ── stakingModule: seeded on vapor-mid, nowhere else in this sample ──

    function test_stakingModule_atLeastOneInstanceWiresIt() public view {
        uint256 wired;
        if (address(ERC404BondingInstance(payable(ember)).stakingModule()) != address(0)) wired++;
        if (address(ERC404BondingInstance(payable(vapor)).stakingModule()) != address(0)) wired++;

        assertGt(wired, 0, "staking: 0 of 2 instances wire a module");
        assertEq(
            address(ERC404BondingInstance(payable(vapor)).stakingModule()),
            d.stakingModule,
            "staking: vapor-mid is not wired to the deployed staking module"
        );
    }

    // ── liquidityDeployer: all three families (uniV4, ZAMM, cypher) must appear ──

    function test_liquidityDeployer_allThreeFamiliesAppear() public view {
        assertEq(
            address(ERC404BondingInstance(payable(vapor)).liquidityDeployer()),
            d.uniDeployer,
            "liquidityDeployer: uniV4 deployer not found on vapor-mid"
        );
        assertEq(
            address(ERC404BondingInstance(payable(ember)).liquidityDeployer()),
            d.cypherDeployer,
            "liquidityDeployer: cypher deployer not found on ember-preopen"
        );
        assertEq(
            address(ERC404BondingInstance(payable(molten)).liquidityDeployer()),
            d.zammDeployer,
            "liquidityDeployer: ZAMM deployer not found on molten-ready"
        );
        assertEq(
            address(ERC404BondingInstance(payable(quench)).liquidityDeployer()),
            d.cypherDeployer,
            "liquidityDeployer: cypher deployer not found on quench-ready"
        );
    }

    // ── metadata resolver / overlay / tier: seeded on prism-stacked ──

    function test_metadataStack_resolverOverlayTier_wiredOnStacked() public view {
        ERC404BondingInstance b = ERC404BondingInstance(payable(prism));
        assertEq(
            b.modules(keccak256("metadata.resolver")),
            d.resolverRouter,
            "metadata: prism-stacked has no resolver router wired"
        );

        MetadataResolverRouter router = MetadataResolverRouter(d.resolverRouter);
        assertEq(router.resolverCount(prism), 2, "metadata: prism-stacked router does not carry both children");
        assertEq(router.resolvers(prism, 0), d.overlay, "metadata: overlay is not the router's first child");
        assertEq(router.resolvers(prism, 1), d.tier, "metadata: tier is not the router's second child");
    }

    // ── vault flavor: all four families (aave, uni, zamm, cypher) must appear ──

    function test_vaultFlavor_allFourFamiliesAppear() public view {
        assertEq(
            address(ERC1155Instance(payable(c0)).vault()),
            d.endowmentVault,
            "vault: aave endowment vault not found on neon-drift"
        );
        assertEq(address(ERC1155Instance(payable(c2)).vault()), d.vault, "vault: uni vault not found on ghost-mint");
        assertEq(
            address(ERC404BondingInstance(payable(ember)).vault()),
            d.cypherVault,
            "vault: cypher vault not found on ember-preopen"
        );
        assertEq(
            address(ERC404BondingInstance(payable(molten)).vault()),
            d.zammVault,
            "vault: ZAMM vault not found on molten-ready"
        );
        assertEq(
            address(ERC404BondingInstance(payable(quench)).vault()),
            d.cypherVault,
            "vault: cypher vault not found on quench-ready"
        );
    }

    // ── ERC-1155 pricing model: UNLIMITED, LIMITED_FIXED, LIMITED_DYNAMIC must all appear ──

    function test_pricingModel_allThreeRegimesAppear() public view {
        (,,,,,, ERC1155Instance.PricingModel fixedModel,,) = ERC1155Instance(payable(c0)).editions(1);
        (,,,,,, ERC1155Instance.PricingModel unlimitedModel,,) = ERC1155Instance(payable(c0)).editions(2);
        (,, uint256 dynBasePrice,,,, ERC1155Instance.PricingModel dynamicModel, uint256 dynRate,) =
            ERC1155Instance(payable(c0)).editions(3);

        assertEq(
            uint8(fixedModel),
            uint8(ERC1155Instance.PricingModel.LIMITED_FIXED),
            "pricing: edition 1 is not LIMITED_FIXED"
        );
        assertEq(
            uint8(unlimitedModel), uint8(ERC1155Instance.PricingModel.UNLIMITED), "pricing: edition 2 is not UNLIMITED"
        );
        assertEq(
            uint8(dynamicModel),
            uint8(ERC1155Instance.PricingModel.LIMITED_DYNAMIC),
            "pricing: edition 3 is not LIMITED_DYNAMIC"
        );
        assertGt(dynBasePrice, 0, "pricing: LIMITED_DYNAMIC edition has no base price");
        assertGt(dynRate, 0, "pricing: LIMITED_DYNAMIC edition has a zero rate - a flat curve wearing the label");
    }

    // ── free-mint allocation: non-zero somewhere ──

    function test_freeMintAllocation_nonZeroSomewhere() public view {
        assertGt(
            ERC404BondingInstance(payable(sigil)).freeMintAllocation(), 0, "free-mint: sigil-gate carries no allocation"
        );
    }

    // ── the alignment catalog roster ──
    //
    // These six instances are not variations on the invented ones: each restates a real collection's
    // measured supply and revenue, and the seed's entire claim is that a visitor can check the
    // arithmetic on chain. What that makes checkable HERE is narrower and worth stating: this suite
    // asserts the WIRING those figures depend on — which vault a row tithes into, which curve preset
    // it was armed against, whether the truncation is recorded next to the real figure. It does not
    // and cannot check that the figures themselves are the measured ones; that lives in the catalog
    // the plan cites, and no test can substitute for it.

    /// @dev Every catalog row must bind to the SECOND alignment target's own vaults. This is the
    ///      failure that renders perfectly: bound to the first target's vault a row still trades,
    ///      still tithes and still shows a vault panel — it simply pays the wrong community. The
    ///      assertion that the two vaults are DIFFERENT is what stops this from passing vacuously on
    ///      a one-target deployment.
    function test_catalogRoster_bindsTheAlignmentTargetsOwnVaults() public view {
        assertTrue(d.cultUniVault != d.vault, "catalog: the two targets share a uni vault - binding is untestable");
        assertTrue(
            d.cultAaveVault != d.endowmentVault,
            "catalog: the two targets share an endowment vault - binding is untestable"
        );

        assertEq(
            address(UniAlignmentVault(payable(d.cultUniVault)).alignmentToken()),
            cultToken,
            "catalog: the resolved uni vault is not bound to the roster's token"
        );
        assertEq(
            address(ERC404BondingInstance(payable(schizo)).vault()),
            d.cultUniVault,
            "catalog: the flagship tithes into the wrong target's vault"
        );
        assertEq(
            address(ERC404BondingInstance(payable(pixelady)).vault()),
            d.cultUniVault,
            "catalog: the mid-curve row tithes into the wrong target's vault"
        );
        assertEq(
            address(ERC721AuctionInstance(payable(figmata)).vault()),
            d.cultAaveVault,
            "catalog: the auction row is not bound to the target's endowment vault"
        );
        assertEq(
            address(ERC1155Instance(payable(anti)).vault()), d.cultUniVault, "catalog: an edition row binds elsewhere"
        );
        assertEq(
            address(ERC1155Instance(payable(oekaki)).vault()), d.cultUniVault, "catalog: an edition row binds elsewhere"
        );
        assertEq(
            address(ERC1155Instance(payable(milady333)).vault()),
            d.cultUniVault,
            "catalog: an edition row binds elsewhere"
        );
        assertEq(
            address(ERC404BondingInstance(payable(boredmilady)).vault()),
            d.cultUniVault,
            "catalog: the second mid-curve row tithes into the wrong target's vault"
        );
        assertEq(
            address(ERC404BondingInstance(payable(lawbsters)).vault()),
            d.cultUniVault,
            "catalog: the graduate row tithes into the wrong target's vault"
        );
    }

    /// @dev EVERY CURVE ROW IS SITTING ON THE PRESET THE SEED REGISTERED FOR IT, and was created at
    ///      the supply that preset was chosen for.
    ///
    ///      THIS IS A WIRING ASSERTION, NOT AN ACCURACY ONE. The roster's figures are illustrative and
    ///      nothing here claims otherwise — what is checked is that the preset the seed armed is the
    ///      preset the instance got, and that a row did not quietly fall back to the protocol preset
    ///      or to the ten-piece default. Both of those failures deploy, trade and render correctly.
    ///
    ///      Everything except the raise is asserted to be the PROTOCOL preset's value, which is what
    ///      keeps a catalog curve a production curve resized rather than a differently-shaped one.
    function test_catalogRoster_everyCurveSitsOnThePresetTheSeedArmed() public view {
        (uint8 sourceId, uint8[4] memory presetIds) = harness.catalogPresetIds();
        uint256[4] memory raises = harness.catalogRaises();
        uint256[4] memory supplies = harness.catalogSupplies();
        address[4] memory rows = [schizo, pixelady, boredmilady, lawbsters];

        LaunchManager lm = LaunchManager(d.launchManager);
        LaunchManager.Preset memory std = lm.getPreset(sourceId);

        for (uint256 i = 0; i < rows.length; i++) {
            LaunchManager.Preset memory got = lm.getPreset(presetIds[i]);
            assertEq(got.targetETH, raises[i], "catalog: a preset is not armed at the raise the seed registered");
            assertTrue(got.targetETH != std.targetETH, "catalog: a catalog preset is just the protocol preset again");
            assertEq(got.unitPerNFT, std.unitPerNFT, "catalog: a preset changed more than the raise");
            assertEq(got.liquidityReserveBps, std.liquidityReserveBps, "catalog: a preset's LP reserve drifted");
            assertEq(got.curveComputer, std.curveComputer, "catalog: a preset uses another curve computer");

            ERC404BondingInstance row = ERC404BondingInstance(payable(rows[i]));
            assertEq(
                row.maxSupply(),
                supplies[i] * row.unit(),
                "catalog: a row was created at something other than the supply its preset was chosen for"
            );
            // The invented instances are ten pieces each; a roster row that quietly fell back to that
            // default would still deploy, still trade and still look right on a card.
            assertGt(row.maxSupply(), 10 * row.unit(), "catalog: a row fell back to the default supply");
        }

        // THE GRADUATE POSTURE IS ON THE SMALL ROW. It is the only row whose whole curve the seed can
        // afford to buy, which is what makes the graduate action live rather than advertised — and the
        // large rows must NOT carry a maturity time, or they advertise an action they cannot fund.
        assertGt(
            ERC404BondingInstance(payable(lawbsters)).bondingMaturityTime(),
            0,
            "catalog: the small row carries no maturity time - the graduate action never unlocks"
        );
        assertEq(
            ERC404BondingInstance(payable(schizo)).bondingMaturityTime(),
            0,
            "catalog: the flagship still advertises a graduate action it is not filled for"
        );
        assertLt(
            ERC404BondingInstance(payable(lawbsters)).maxSupply(),
            ERC404BondingInstance(payable(schizo)).maxSupply(),
            "catalog: the graduate row is not the small one"
        );
    }

    /// @dev THE 80% ENDOWMENT IS EXPRESSIBLE IN EXACTLY ONE PLACE, and this is the assertion that
    ///      says so. The split is selected by the bound vault's FAMILY, and the endowment branch is
    ///      reachable only from a settlement path — so the auction row bound to the endowment vault
    ///      splits 80/19/1 while every curve row, bound to a liquidity-family vault, splits 1/19/80
    ///      and cannot be reshaped into the other. Asserting the family alone would be weaker: the
    ///      split each family actually produces is checked here too.
    function test_catalogAuction_isTheOnlyRowThatCanExpressTheEndowment() public view {
        string memory endowmentType = IAlignmentVault(payable(d.cultAaveVault)).vaultType();
        string memory liquidityType = IAlignmentVault(payable(d.cultUniVault)).vaultType();
        assertFalse(
            RevenueSplitLib.isLiquidityFamily(endowmentType), "catalog: the auction row's vault is a liquidity vault"
        );
        assertTrue(
            RevenueSplitLib.isLiquidityFamily(liquidityType), "catalog: the curve rows' vault is not a liquidity vault"
        );

        RevenueSplitLib.Split memory endowed = RevenueSplitLib.splitMintFor(1 ether, false);
        RevenueSplitLib.Split memory aligned = RevenueSplitLib.splitMintFor(1 ether, true);
        assertEq(endowed.vaultCut, 0.8 ether, "catalog: the endowment family no longer routes 80% to the vault");
        assertEq(aligned.vaultCut, 0.19 ether, "catalog: the liquidity family no longer routes 19% to the vault");
    }

    /// @dev The editions are TRUNCATED, and the truncation is the one thing that must never be
    ///      readable as the size of the collection the row is an example of. So each row carries both
    ///      numbers — the on-chain supply the fork holds and the example supply beside it — plus the
    ///      statement that the example figures are illustrative. A surface reading either number alone
    ///      gets a coherent but different answer, which is why neither is allowed to be the only one
    ///      present, and why the basis rides along with them.
    function test_catalogEditions_carryBothTheSeededAndTheExampleSupply() public view {
        (uint256[3] memory supplies, uint256[3] memory freeAllocations) = harness.catalogEditionSizes();
        address[3] memory rows = [anti, oekaki, milady333];

        for (uint256 i = 0; i < rows.length; i++) {
            ERC1155Instance row = ERC1155Instance(payable(rows[i]));
            (,,, uint256 supply,, string memory metadataURI,,,) = row.editions(1);
            assertEq(supply, supplies[i], "catalog: an edition was not cut to its seeded size");
            assertEq(
                row.freeMintAllocation(1),
                freeAllocations[i],
                "catalog: an edition's free allocation does not stand in for its real free/paid split"
            );
            assertTrue(
                _contains(metadataURI, "\"exampleSupply\":\""),
                "catalog: an edition does not record the supply it is an example of"
            );
            assertTrue(
                _contains(metadataURI, "\"truncation\":\""),
                "catalog: an edition does not record how far it was truncated"
            );
            assertTrue(
                _contains(metadataURI, "\"figureBasis\":\"illustrative"),
                "catalog: an edition presents its figures without saying they are illustrative"
            );
            // The seeded size must actually BE a truncation. An edition cut to its real size would
            // satisfy every assertion above while making the recorded ratio a lie.
            assertLt(supply, 333, "catalog: an edition is not smaller than the smallest real collection");
        }
    }

    /// @dev BOTH registry legs, and the vault's own pool key, which is a third thing that looks like
    ///      the same thing. An unset acquire route reads as `Venue.NONE` and callers are required to
    ///      refuse rather than fall back to a hardcoded pool; an unset reference pool leaves the
    ///      anti-sandwich floor with no authority to read.
    ///
    ///      The last assertion is the load-bearing one: the FIRST target's vault must still sit on the
    ///      deployment-wide default tier. That is what makes the retune per-vault rather than a
    ///      network-wide change wearing a per-vault label — and a network-wide change would move the
    ///      other target's vault and every graduating curve's launch venue with it.
    function test_catalogTarget_bothRegistryLegsAndAPerVaultPoolKey() public view {
        (uint24 fee, int24 tickSpacing) = harness.catalogAcquireRoute();
        IAlignmentRegistry reg = IAlignmentRegistry(d.alignmentRegistry);

        IAlignmentRegistry.AcquireRoute memory route = reg.getAcquireRoute(d.cultTargetId, cultToken);
        assertEq(uint8(route.venue), uint8(IAlignmentRegistry.Venue.UNI_V4), "catalog: acquire route is not UNI_V4");
        assertEq(route.fee, fee, "catalog: acquire route is on the wrong fee tier");
        assertEq(route.tickSpacing, tickSpacing, "catalog: acquire route tick spacing drifted");

        IAlignmentRegistry.ReferencePool memory ref = reg.getReferencePool(d.cultTargetId, cultToken);
        assertEq(ref.pool, referencePool, "catalog: no reference pool is pinned for the roster's token");

        (Currency c0, Currency c1, uint24 vaultFee, int24 vaultSpacing,) =
            UniAlignmentVault(payable(d.cultUniVault)).v4PoolKey();
        assertEq(Currency.unwrap(c0), address(0), "catalog: the vault's pool key is not native-ETH-first");
        assertEq(Currency.unwrap(c1), cultToken, "catalog: the vault's pool key is not paired with the token");
        assertEq(vaultFee, fee, "catalog: the vault still LPs into the deployment-default fee tier");
        assertEq(vaultSpacing, tickSpacing, "catalog: the vault's tick spacing drifted");

        (,, uint24 otherFee, int24 otherSpacing,) = UniAlignmentVault(payable(d.vault)).v4PoolKey();
        assertTrue(otherFee != fee, "catalog: the retune moved the OTHER target's vault - it is not per-vault");
        assertTrue(otherSpacing != tickSpacing, "catalog: the retune moved the other target's tick spacing");
    }

    /// @dev The acquisition ROUTE PIN must answer for the roster's token and for nothing else. The
    ///      second half is the one that matters: the quoter is threaded into EVERY vault factory at
    ///      construction, so a pin that answered broadly would silently re-route the other alignment
    ///      target's vault — and a re-route that succeeds looks identical to no change at all until
    ///      the day its pool is the wrong one.
    function test_acquireRoutePin_answersForTheRosterTokenAndNothingElse() public {
        AnvilFixedRouteQuoter quoter = new AnvilFixedRouteQuoter(cultToken);

        (AnvilFixedRouteQuoter.Quote memory pinned, AnvilFixedRouteQuoter.Quote[] memory all) =
            quoter.getQuotes(false, address(0), cultToken, 1 ether);
        assertGt(pinned.amountOut, 0, "route pin: the roster's token gets no route");
        assertEq(all.length, 1, "route pin: the roster's token gets no route list");
        assertEq(pinned.amountIn, 1 ether, "route pin: the quote does not carry the requested size");

        // THE EXECUTED VENUE MUST BE THE CURATED ONE. The registry curates `Venue.UNI_V4` on the
        // 1%/200 tier and the vault LPs into that same tier, but the venue the buy actually executes
        // on is decided HERE and nowhere else — `BestRouteAcquirer._tryBestRoute` switches on
        // `best.source`, so a pin naming a different AMM sends the convert to a pool the registry
        // never curated while every registry read-back above still passes. The fee is asserted
        // alongside it because the source alone does not pick a pool: the acquirer multiplies
        // `feeBps` by 100 for the V4 fee and maps 100 bps to tick spacing 200, which is the tier the
        // seed's depth deposit fills. Move either half and this goes red.
        assertEq(
            uint8(pinned.source),
            uint8(AnvilFixedRouteQuoter.AMM.UNI_V4),
            "route pin: the executed venue is not the curated UNI_V4 one"
        );
        assertEq(pinned.feeBps, 100, "route pin: the quote does not resolve to the curated 1% tier");

        // Every other pair degrades to the vault's own fixed-pool fallback.
        (AnvilFixedRouteQuoter.Quote memory other, AnvilFixedRouteQuoter.Quote[] memory none) =
            quoter.getQuotes(false, address(0), address(0xBEEF), 1 ether);
        assertEq(other.amountOut, 0, "route pin: an unpinned token was given a route");
        assertEq(none.length, 0, "route pin: an unpinned token was given a route list");

        // Token-in must be native ETH: the acquirer only ever asks ETH -> token, and answering a
        // token-in pair would put the pin in front of a swap it was never measured against.
        (AnvilFixedRouteQuoter.Quote memory wrongIn,) = quoter.getQuotes(false, address(0xBEEF), cultToken, 1 ether);
        assertEq(wrongIn.amountOut, 0, "route pin: answered a non-ETH input");
    }

    // ── THE ART, THE ARTISTS, AND WHAT THE COPY IS ALLOWED TO SAY ──

    /// @dev THE PRIMARY ACCEPTANCE TEST: every roster curve composes a piece pointer that resolves.
    ///
    ///      A row whose economics are perfect and whose pieces render as blank tiles is a failed seed,
    ///      and the failure is quiet — a base missing its trailing slash addresses `<cid>7` instead of
    ///      `<cid>/7`, and one carrying two produces `//7`, which some gateways serve and some do not.
    ///      Neither shows up anywhere except in the composed string, which is why the composition is
    ///      what is asserted rather than the base alone.
    ///
    ///      Content-addressed is required, not preferred: a base pointing at somebody's web server
    ///      makes this fork's art depend on their uptime and points our demo traffic at their host.
    function test_catalogArt_everyRowComposesAResolvablePointer() public view {
        string[4] memory bases = harness.catalogPieceBases();
        address[4] memory rows = [schizo, pixelady, boredmilady, lawbsters];

        for (uint256 i = 0; i < rows.length; i++) {
            bytes memory base = bytes(bases[i]);
            assertGt(base.length, 8, "art: a roster row carries no per-piece base");
            assertTrue(_startsWith(bases[i], "ipfs://"), "art: a roster row's base is not content-addressed");
            assertEq(base[base.length - 1], bytes1("/"), "art: a roster row's base has no trailing slash");
            assertTrue(base[base.length - 2] != bytes1("/"), "art: a roster row's base ends in a double slash");

            // The composed pointer, read off the instance rather than recomputed from the same string
            // twice: `metadataURI` IS the per-piece base the token concatenates against.
            ERC404BondingInstance row = ERC404BondingInstance(payable(rows[i]));
            assertEq(row.metadataURI(), bases[i], "art: a row's on-chain base is not the one the seed passed");
            assertEq(
                string.concat(row.metadataURI(), "7"),
                string.concat(bases[i], "7"),
                "art: a row does not compose its piece pointer to the intended string"
            );
        }

        // The two auction families carry their URIs per piece rather than composing them, so the
        // queued record is where the pointer lives. A queued piece with an empty URI is a piece that
        // mints with no art at all.
        address[3] memory auctions = [figmata, paradilf, petravoice];
        for (uint256 i = 0; i < auctions.length; i++) {
            (, string memory uri,,,,,,) = ERC721AuctionInstance(payable(auctions[i])).auctions(1);
            assertTrue(_startsWith(uri, "ipfs://"), "art: an auction row queued a piece that is not content-addressed");
            assertFalse(_contains(uri, "//1"), "art: an auction row queued a piece behind a double slash");
        }
    }

    /// @dev THE ARTIST ENDOWMENTS ARE REAL, NOT DECORATIVE.
    ///
    ///      Four things, and each is a different way for this to render perfectly while demonstrating
    ///      nothing: the target must exist as its own alignment target (not a relabelled community
    ///      one), the vault must pay the artist's DERIVED FIXTURE address, the collection must be
    ///      bound to THAT vault rather than to a sibling, and the vault must be an endowment rather
    ///      than a liquidity vault — because the 80% leg is selected by the bound vault's family and
    ///      a liquidity vault would silently split 1/19/80 instead.
    function test_artistEndowments_areOwnTargetsThatPayTheArtist() public view {
        string[2] memory slugs = harness.artistSlugs();
        address[2] memory vaults = [d.paradilfVault, d.petravoiceVault];
        address[2] memory rows = [paradilf, petravoice];

        assertTrue(vaults[0] != vaults[1], "artist: both artists share one endowment vault");
        assertTrue(vaults[0] != d.cultAaveVault, "artist: an artist target reuses the community endowment vault");
        assertTrue(vaults[1] != d.endowmentVault, "artist: an artist target reuses the first target's vault");

        for (uint256 i = 0; i < rows.length; i++) {
            assertEq(
                IEndowmentPayout(vaults[i]).communityPayout(),
                ArtistEndowments.payout(slugs[i]),
                "artist: the endowment pays somewhere other than the artist's derived fixture address"
            );
            assertEq(
                address(ERC721AuctionInstance(payable(rows[i])).vault()),
                vaults[i],
                "artist: the collection is bound to another vault - it would endow somebody else"
            );
            assertFalse(
                RevenueSplitLib.isLiquidityFamily(IAlignmentVault(payable(vaults[i])).vaultType()),
                "artist: the endowment vault is a liquidity vault - the 80% leg is not selected"
            );
        }

        // The payout is DERIVED, so it is reproducible across reseeds and belongs to nobody. Asserting
        // it is non-zero is what stops the endowment from crystallizing yield it cannot deliver.
        assertTrue(ArtistEndowments.payout(slugs[0]) != address(0), "artist: a derived payout is the zero address");
        assertTrue(
            ArtistEndowments.payout(slugs[0]) != ArtistEndowments.payout(slugs[1]),
            "artist: both artists derive the same payout address"
        );
    }

    /// @dev THE COPY SAYS WHAT THE ROSTER IS AND DOES NOT SAY WHAT IT IS NOT.
    ///
    ///      The roster presents EXAMPLES. It does not argue that the collections it echoes owe anybody
    ///      a share of what they took, and it does not present its figures as measurements. Both of
    ///      those are easy to reintroduce by writing one sentence, which is why this is a test rather
    ///      than a comment: the framing is a decision, and a decision that only lives in prose gets
    ///      rewritten by the next person who finds the prose inconvenient.
    function test_catalogCopy_presentsExamplesRatherThanAClaim() public view {
        address[3] memory editions = [anti, oekaki, milady333];
        for (uint256 i = 0; i < editions.length; i++) {
            (,,,,, string memory uri,,,) = ERC1155Instance(payable(editions[i])).editions(1);
            _assertNoWithdrawnFraming(uri);
            assertTrue(
                _contains(uri, "illustrative"),
                "catalog: an edition's metadata does not say its figures are illustrative"
            );
        }

        address[3] memory auctions = [figmata, paradilf, petravoice];
        for (uint256 i = 0; i < auctions.length; i++) {
            _assertNoWithdrawnFraming(ERC721AuctionInstance(payable(auctions[i])).contractURI());
        }

        // The two artist rows must say plainly that they are demonstrations, because they are the two
        // that name people. A fixture presented without the word is a claim about somebody.
        assertTrue(
            _contains(ERC721AuctionInstance(payable(paradilf)).contractURI(), "fixture"),
            "artist: the row does not state that its payout and token are fixtures"
        );
        assertTrue(
            _contains(ERC721AuctionInstance(payable(petravoice)).contractURI(), "fixture"),
            "artist: the row does not state that its payout and token are fixtures"
        );
    }

    /// @dev The framings the roster has withdrawn, checked as strings. Grepping for the words is
    ///      coarser than reading the sentence, and that is the point: the words are cheap to avoid and
    ///      expensive to reintroduce by accident.
    function _assertNoWithdrawnFraming(string memory uri) internal pure {
        assertFalse(_contains(uri, "would have gone"), "copy: a row still argues a counterfactual tithe");
        assertFalse(_contains(uri, "tithe"), "copy: a row still frames the alignment as a tithe");
        // Space-delimited on purpose: the bare stems are substrings of "escrowed", which is the word
        // the endowment rows are built on, and a guard that reds on the correct copy gets deleted.
        assertFalse(_contains(uri, " owes "), "copy: a row still argues that a collection owes somebody");
        assertFalse(_contains(uri, " owed "), "copy: a row still argues that a collection owed somebody");
        assertFalse(_contains(uri, "descended from"), "copy: a row still frames the collection as a derivative");
        assertTrue(_contains(uri, "illustrative"), "copy: a row presents figures without saying they are illustrative");
    }

    function _startsWith(string memory haystack, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(haystack);
        bytes memory n = bytes(needle);
        if (n.length > h.length) return false;
        for (uint256 i = 0; i < n.length; i++) {
            if (h[i] != n[i]) return false;
        }
        return true;
    }

    /// @dev Naive substring search. Only used on short metadata strings in assertions.
    function _contains(string memory haystack, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(haystack);
        bytes memory n = bytes(needle);
        if (n.length == 0 || n.length > h.length) return false;
        for (uint256 i = 0; i + n.length <= h.length; i++) {
            bool hit = true;
            for (uint256 j = 0; j < n.length; j++) {
                if (h[i + j] != n[j]) {
                    hit = false;
                    break;
                }
            }
            if (hit) return true;
        }
        return false;
    }

    // ── helpers ──

    /// @dev TWO alignment targets, because the catalog roster's whole binding rule is "this target's
    ///      own vaults, not the first one's". A single-target config would make that rule vacuous —
    ///      every vault would be both — so the second target is what gives the binding assertions
    ///      something to be wrong about.
    function _config(address weth, address stata, address second, address[2] memory artistTokens)
        internal
        pure
        returns (DeployCore.NetworkConfig memory cfg)
    {
        DeployCore.AlignmentTargetConfig[] memory targets = new DeployCore.AlignmentTargetConfig[](4);
        targets[0] = DeployCore.AlignmentTargetConfig({
            token: weth,
            symbol: "WETH",
            name: "Wrapped Ether",
            description: "Test alignment target",
            deployUniVault: true,
            deployCypherVault: true,
            deployZAMMVault: true,
            communityPayout: address(0)
        });
        targets[1] = DeployCore.AlignmentTargetConfig({
            token: second,
            symbol: "PIN",
            name: "Catalog-Alignment-Target",
            description: "The target the catalog roster binds to",
            deployUniVault: true,
            deployCypherVault: true,
            deployZAMMVault: true,
            communityPayout: address(0)
        });
        // The two ARTIST targets. Endowment-only — no LP vault, because an endowment has no liquidity
        // leg — and each carries a payout, which the community targets above deliberately leave unset.
        // Without a payout the artist rows could not assert the one thing that distinguishes an
        // endowment that pays an artist from one that pays nobody.
        targets[2] = DeployCore.AlignmentTargetConfig({
            token: artistTokens[0],
            symbol: ArtistEndowments.PARADILF_SYMBOL,
            name: ArtistEndowments.PARADILF_TITLE,
            description: "Artist endowment target (fixture)",
            deployUniVault: false,
            deployCypherVault: false,
            deployZAMMVault: false,
            communityPayout: ArtistEndowments.payout(ArtistEndowments.PARADILF_SLUG)
        });
        targets[3] = DeployCore.AlignmentTargetConfig({
            token: artistTokens[1],
            symbol: ArtistEndowments.PETRAVOICE_SYMBOL,
            name: ArtistEndowments.PETRAVOICE_TITLE,
            description: "Artist endowment target (fixture)",
            deployUniVault: false,
            deployCypherVault: false,
            deployZAMMVault: false,
            communityPayout: ArtistEndowments.payout(ArtistEndowments.PETRAVOICE_SLUG)
        });

        cfg.chainId = 1337;
        cfg.weth = weth;
        cfg.v4PoolManager = address(1);
        cfg.cypherPositionManager = STUB_CYPHER_PM;
        cfg.cypherRouter = STUB_CYPHER_ROUTER;
        cfg.cypherAlgebraFactory = STUB_CYPHER_FACTORY;
        cfg.zamm = STUB_ZAMM;
        cfg.aaveStataToken = stata;
        cfg.saltMasterRegistry = bytes32(uint256(1));
        cfg.saltTreasury = bytes32(uint256(2));
        cfg.saltQueueManager = bytes32(uint256(3));
        cfg.saltGlobalMsgReg = bytes32(uint256(4));
        cfg.saltAlignmentReg = bytes32(uint256(5));
        cfg.saltComponentReg = bytes32(uint256(6));
        cfg.priceDeviationBps = 1000;
        cfg.twapSeconds = 1800;
        cfg.zrouterFee = 3000;
        cfg.zrouterTickSpacing = 60;
        cfg.zammFeeOrHook = 100;
        cfg.alignmentTargets = targets;
        cfg.jsonOutputPath = "";
    }

    /// @dev Pulls the `InstanceCreated` logs a phase call emitted from `factory`, by selector -
    ///      never by counting all logs, so an unrelated event in the same call cannot be mistaken for
    ///      an instance address. `expected` is exact: a phase that grows or loses an instance fails
    ///      here rather than silently returning a short or mis-ordered set. Log order is preserved
    ///      (first log = index 0), which is the seed's own creation order within the phase.
    function _instances(address factory, bytes32 selector, uint256 expected)
        internal
        returns (address[] memory instances)
    {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        instances = new address[](expected);
        uint256 found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == factory && logs[i].topics[0] == selector) {
                if (found < expected) instances[found] = address(uint160(uint256(logs[i].topics[1])));
                found++;
            }
        }
        require(
            found == expected,
            string.concat(
                "coverage harness: expected exactly ",
                vm.toString(expected),
                " InstanceCreated logs, saw ",
                vm.toString(found)
            )
        );
    }

    /// @dev Convenience wrapper for the single-instance phases.
    function _oneInstance(address factory, bytes32 selector) internal returns (address instance) {
        return _instances(factory, selector, 1)[0];
    }
}
