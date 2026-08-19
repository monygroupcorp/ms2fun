// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { Vm } from "forge-std/Vm.sol";
import { CREATEX } from "../../src/shared/CreateXConstants.sol";
import { CREATEX_BYTECODE } from "createx-forge/script/CreateX.d.sol";
import { DeployCore } from "../../script/DeployCore.sol";
import { SeedAnvil } from "../../script/SeedAnvil.s.sol";
import { SeedAnvilShared } from "../../script/SeedAnvilShared.sol";
import { ERC1155Instance } from "../../src/factories/erc1155/ERC1155Instance.sol";
import { ERC404BondingInstance } from "../../src/factories/erc404/ERC404BondingInstance.sol";
import { MetadataResolverRouter } from "../../src/metadata/MetadataResolverRouter.sol";
import { MockWETH, MockStataToken } from "../vaults/aave/AlignmentEndowmentVault.t.sol";

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
    address internal prism; // stacked metadata: zamm vault + zamm deployer + resolver/overlay/tier
    address internal sigil; // gated (noesis-357)

    function setUp() public {
        vm.etch(CREATEX, CREATEX_BYTECODE);

        deployer = vm.addr(DEPLOYER_KEY);
        vm.deal(deployer, 1000 ether);

        MockWETH weth = new MockWETH();
        MockStataToken stata = new MockStataToken(address(weth));

        s = new DeployCore();
        // DeployCore's OWN post-deploy setup (e.g. queueManager.setWeth) runs with msg.sender ==
        // address(s), so the registries it owns must be owned by address(s) too - matching the
        // established pattern in DeployTest/ValidateSepoliaTest/VaultFlavorsTest. `deployer` (the
        // seed's own identity, below) is unrelated: every seed call this suite drives is
        // permissionless (createInstance, rentFeatured, setProfile, receiveContribution).
        s.deploy(address(s), _config(address(weth), address(stata)));

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
        merkleGating = address(s.moduleMerkleGating());

        harness = new SeedModuleCoverageHarness();
        vm.deal(address(harness), 1000 ether);
        harness.setIdentity(DEPLOYER_KEY);

        (c0, c2) = harness.seedErc1155(d);

        vm.recordLogs();
        harness.seedErc404PreOpen(d);
        ember = _oneInstance(address(d.erc404), ERC404_INSTANCE_CREATED);

        vm.recordLogs();
        harness.seedErc404MidCurve(d);
        vapor = _oneInstance(address(d.erc404), ERC404_INSTANCE_CREATED);

        vm.recordLogs();
        harness.seedErc404ReadyToGraduate(d);
        (cinder, molten) = _twoInstances(address(d.erc404), ERC404_INSTANCE_CREATED);

        vm.recordLogs();
        harness.seedErc404Stacked(d);
        prism = _oneInstance(address(d.erc404), ERC404_INSTANCE_CREATED);

        veil = harness.seedGatedErc1155(d, merkleGating);
        sigil = harness.seedGatedErc404(d, merkleGating);
    }

    // ── gatingModule: currently zero at every ungated site; must go non-zero somewhere ──

    function test_gatingModule_atLeastOneInstanceWiresAModule() public view {
        address[] memory ungatedErc1155 = new address[](1);
        ungatedErc1155[0] = c2;
        address[] memory ungatedErc404 = new address[](5);
        ungatedErc404[0] = ember;
        ungatedErc404[1] = vapor;
        ungatedErc404[2] = cinder;
        ungatedErc404[3] = molten;
        ungatedErc404[4] = prism;

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
        // The baseline family (c2, ember, vapor, cinder, molten, prism) must stay open — a gate that
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

    // ── helpers ──

    function _config(address weth, address stata) internal pure returns (DeployCore.NetworkConfig memory cfg) {
        DeployCore.AlignmentTargetConfig[] memory targets = new DeployCore.AlignmentTargetConfig[](1);
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

    /// @dev Pulls the single `InstanceCreated` log a phase call emitted from `factory`, by selector -
    ///      never by counting all logs, so an unrelated event in the same call cannot be mistaken for
    ///      the instance address.
    function _oneInstance(address factory, bytes32 selector) internal returns (address instance) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == factory && logs[i].topics[0] == selector) {
                instance = address(uint160(uint256(logs[i].topics[1])));
                found++;
            }
        }
        require(found == 1, "coverage harness: expected exactly one InstanceCreated log");
    }

    /// @dev Same as `_oneInstance`, for a phase that creates two instances in one call - order
    ///      preserved (first log = first return value).
    function _twoInstances(address factory, bytes32 selector) internal returns (address first, address second) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == factory && logs[i].topics[0] == selector) {
                address instance = address(uint160(uint256(logs[i].topics[1])));
                if (found == 0) first = instance;
                else if (found == 1) second = instance;
                found++;
            }
        }
        require(found == 2, "coverage harness: expected exactly two InstanceCreated logs");
    }
}
