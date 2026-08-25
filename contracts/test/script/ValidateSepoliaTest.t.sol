// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { DeployCore } from "../../script/DeployCore.sol";
import { ValidateSepolia } from "../../script/ValidateSepolia.s.sol";
import { CREATEX } from "../../src/shared/CreateXConstants.sol";
import { CREATEX_BYTECODE } from "createx-forge/script/CreateX.d.sol";
import { MasterRegistryV1 } from "../../src/master/MasterRegistryV1.sol";
import { ComponentRegistry } from "../../src/registry/ComponentRegistry.sol";
import { ERC404Factory } from "../../src/factories/erc404/ERC404Factory.sol";
import { CurveParamsComputer } from "../../src/factories/erc404/CurveParamsComputer.sol";
import { MetadataOverlayModule } from "../../src/metadata/MetadataOverlayModule.sol";
import { FreeMintParams } from "../../src/interfaces/IFactoryTypes.sol";
import { GatingScope } from "../../src/gating/IGatingModule.sol";

/// @dev Runs the real `ValidateSepolia.run()` body against a locally deployed protocol. Only the
///      resolution seams are overridden — which registries to read, and which deployment record to
///      read — never a check. Every assertion under test is the script's own.
contract ValidateSepoliaHarness is ValidateSepolia {
    MasterRegistryV1 private immutable MASTER;
    ComponentRegistry private immutable COMPONENTS;
    string private record;

    constructor(MasterRegistryV1 master_, ComponentRegistry components_) {
        MASTER = master_;
        COMPONENTS = components_;
    }

    function setRecord(string memory record_) external {
        record = record_;
    }

    function _deploymentJson() internal view override returns (string memory) {
        return record;
    }

    function _masterRegistry() internal view override returns (MasterRegistryV1) {
        return MASTER;
    }

    function _componentRegistry() internal view override returns (ComponentRegistry) {
        return COMPONENTS;
    }
}

/// @notice noesis-191. Two properties of the Sepolia validator, both of which the earlier
///         implementation left unenforced:
///
///           1. A check that gates `ERC404Factory.createInstance` must make the script exit
///              non-zero, not print `false` and return. The curve-computer check must also use the
///              tag-bound predicate the factory gates on, so a component approved under the wrong
///              tag fails the validator instead of reading green.
///           2. The nonce-derived addresses (`LaunchManager`, `ERC404Factory`) come from the
///              deployment record. A record that cannot supply one is a loud failure.
///
///         The mutation these tests are built around is executed end-to-end: with the curve
///         computer unapproved, `createInstance` reverts `UnapprovedCurveComputer` — so a validator
///         that only logs the condition reports a launch-capable deployment that cannot launch.
///
///         Vacuity check (vacuity-check): delete any `require` under test and the matching
///         `expectRevert` case fails, because `run()` completes.
contract ValidateSepoliaTest is Test {
    address constant STETH = 0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84;
    address constant WSTETH = 0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0;
    address constant STUB_LINK = 0x779877A7B0D9E8603169DdbD7836e478b4624789;
    bytes constant RETURN_TRUE = hex"600160005260206000f3";

    bytes32 constant CURVE_COMPUTER_TAG = bytes32("curve_computer");

    DeployCore s;
    ValidateSepoliaHarness validator;

    function setUp() public {
        vm.etch(CREATEX, CREATEX_BYTECODE);
        vm.etch(STETH, RETURN_TRUE);
        vm.etch(WSTETH, RETURN_TRUE);
        vm.etch(STUB_LINK, RETURN_TRUE);

        s = new DeployCore();
        s.deploy(address(s), _testConfig());

        validator = new ValidateSepoliaHarness(MasterRegistryV1(s.masterRegistry()), s.componentRegistry());
        validator.setRecord(_record(address(s.launchManager()), address(s.erc404Factory())));
    }

    // Mirrors test/script/DeployTest.t.sol so DeployCore runs exactly as it would on a real deploy
    // (sequential unguarded salts; no file I/O).
    function _testConfig() internal pure returns (DeployCore.NetworkConfig memory cfg) {
        DeployCore.AlignmentTargetConfig[] memory targets = new DeployCore.AlignmentTargetConfig[](1);
        targets[0] = DeployCore.AlignmentTargetConfig({
            token: STUB_LINK,
            symbol: "LINK",
            name: "Chainlink",
            description: "Test alignment target",
            deployUniVault: true,
            deployCypherVault: false,
            deployZAMMVault: false,
            communityPayout: address(0)
        });

        cfg.chainId = 1337;
        cfg.weth = STUB_LINK;
        cfg.v4PoolManager = address(1);
        cfg.v3Factory = address(0);
        cfg.v2Factory = address(0);
        cfg.cypherPositionManager = address(0);
        cfg.cypherRouter = address(0);
        cfg.zamm = address(0);
        cfg.zrouter = address(0);
        cfg.safe = address(0);
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
        cfg.alignmentTargets = targets;
        cfg.jsonOutputPath = "";
    }

    /// @dev A deployment record in the shape DeployCore emits, carrying only the keys the validator
    ///      reads. `vaults` is the JSON-encoded STRING the writer produces; the vault leg is covered
    ///      elsewhere, so this record declares none.
    function _record(address launchManager_, address factory_) internal pure returns (string memory) {
        return string.concat(
            '{"chainId":1337,',
            '"contracts":{"LaunchManager":"',
            vm.toString(launchManager_),
            '"},',
            '"factories":{"ERC404":"',
            vm.toString(factory_),
            '"},',
            '"vaults":"[]"}'
        );
    }

    /// @dev The deployer owns the ComponentRegistry after DeployCore. Cache the registry and the
    ///      component before pranking — an external getter would consume the prank.
    function _revoke(address component) internal {
        ComponentRegistry registry = s.componentRegistry();
        vm.prank(address(s));
        registry.revokeComponent(component);
    }

    function _approve(address component, bytes32 tag) internal {
        ComponentRegistry registry = s.componentRegistry();
        vm.prank(address(s));
        registry.approveComponent(component, tag, "CurveParamsComputer");
    }

    /// @dev Executes the real create path. `external` so `vm.expectRevert` binds to it rather than to
    ///      an incidental getter inside it. Reverts with `UnapprovedCurveComputer` when the curve
    ///      computer is not approved under the tag the factory requires.
    function createInstanceProbe() external returns (address) {
        ERC404Factory.MetadataConfig memory meta;
        meta.resolver = address(0);
        meta.childResolvers = new address[](0);
        meta.overlay = address(0);
        meta.tier = address(0);
        meta.tiers = new ERC404Factory.TierSpec[](0);
        meta.autoLatest = false;
        meta.defaultPayout = MetadataOverlayModule.Payout.ARTIST;

        ERC404Factory.CreateParams memory params = ERC404Factory.CreateParams({
            salt: bytes32(uint256(0xBEEF)),
            owner: address(this),
            nftCount: 10,
            presetId: 1, // active preset from DeployCore
            vault: s.uniVaults(0), // registry-validated alignment vault
            name: "validator-probe",
            symbol: "PROBE",
            styleUri: "",
            tokenBaseURI: "base/",
            stakingModule: address(0),
            declaredMaxAllowanceBps: 0
        });

        return s.erc404Factory()
            .createInstance(
                params,
                "ipfs://collection",
                s.moduleUniV4Deployer(),
                address(0),
                FreeMintParams({ allocation: 0, scope: GatingScope.BOTH }),
                meta
            );
    }

    // ── Baseline ──────────────────────────────────────────────────────────

    /// @dev The healthy deployment must pass, or every revert case below proves nothing.
    function test_healthyDeploymentPasses() public view {
        validator.run();
    }

    // ── Defect 1: the gating checks assert ────────────────────────────────

    /// @dev The mutation the finding derives, executed: with the curve computer unapproved, every
    ///      create reverts — and the validator now reverts with it instead of logging `false`.
    function test_curveComputerUnapproved_bricksCreateAndFailsTheValidator() public {
        _revoke(address(s.curveParamsComputer()));

        vm.expectRevert(ERC404Factory.UnapprovedCurveComputer.selector);
        this.createInstanceProbe();

        vm.expectRevert(bytes("no component approved under the curve_computer tag"));
        validator.run();
    }

    /// @dev The tag-agnostic predicate is strictly weaker. Approved under a different tag, the
    ///      component satisfies `isApprovedComponent` while the factory rejects it — so the
    ///      validator must gate on `isApprovedForTag`. This case is what fails if the check is
    ///      switched back to `isApprovedComponent`.
    function test_curveComputerApprovedUnderWrongTag_bricksCreateAndFailsTheValidator() public {
        address curve = address(s.curveParamsComputer());
        _revoke(curve);
        _approve(curve, bytes32("some_other_tag"));
        // Keep the curve_computer tag populated by a second, correctly tagged computer, so the
        // registry sweep passes and what fails is specifically the per-preset binding.
        _approve(address(new CurveParamsComputer(address(this))), CURVE_COMPUTER_TAG);

        // The weaker predicate reads green here; the one the factory gates on does not.
        assertTrue(s.componentRegistry().isApprovedComponent(curve), "tag-agnostic predicate reads approved");
        assertFalse(
            s.componentRegistry().isApprovedForTag(curve, CURVE_COMPUTER_TAG), "tag-bound predicate reads unapproved"
        );

        vm.expectRevert(ERC404Factory.UnapprovedCurveComputer.selector);
        this.createInstanceProbe();

        vm.expectRevert(bytes("preset 0: curve computer is not approved under the curve_computer tag"));
        validator.run();
    }

    /// @dev An approved liquidity deployer is an unconditional requirement of `_createInstance`.
    function test_noApprovedLiquidityDeployer_failsTheValidator() public {
        // The test config enables Uni and ZAMM deployers (Cypher is unconfigured, so undeployed).
        _revoke(s.moduleUniV4Deployer());
        _revoke(s.moduleZAMMDeployer());

        vm.expectRevert(bytes("no component approved under the LIQUIDITY_DEPLOYER tag"));
        validator.run();
    }

    // ── Defect 2: addresses come from the deployment record ───────────────

    /// @dev A record naming a contract that is not the registered factory — the shape a stale pinned
    ///      constant produces — must stop the run rather than report `registered: false` and return.
    function test_recordedFactoryNotRegistered_failsTheValidator() public {
        validator.setRecord(_record(address(s.launchManager()), address(s.componentRegistry())));

        vm.expectRevert(bytes("ERC404Factory in the deployment record is not registered in the MasterRegistry"));
        validator.run();
    }

    function test_recordHoldsZeroFactoryAddress_failsTheValidator() public {
        validator.setRecord(_record(address(s.launchManager()), address(0)));

        vm.expectRevert(bytes("ERC404Factory: deployment record holds the zero address"));
        validator.run();
    }

    function test_recordHoldsCodelessLaunchManager_failsTheValidator() public {
        validator.setRecord(_record(makeAddr("no-code"), address(s.erc404Factory())));

        vm.expectRevert(bytes("LaunchManager: no code at the address in the deployment record"));
        validator.run();
    }

    /// @dev A record missing the key entirely fails inside the JSON read, loudly.
    function test_recordMissingFactoryKey_failsTheValidator() public {
        validator.setRecord(
            '{"chainId":1337,"contracts":{"LaunchManager":"0x0000000000000000000000000000000000000001"},"vaults":"[]"}'
        );

        vm.expectRevert();
        validator.run();
    }

    /// @dev The superseded 2026-03-26 Sepolia record must still carry the keys the validator
    ///      resolves from, so the production path is not just a test-only shape. The live
    ///      `deployments/sepolia.json` is written by the deploy run and is not committed; this
    ///      historical record keeps the real-record shape under test until a new one lands.
    function test_sepoliaRecordCarriesTheKeysTheValidatorReads() public view {
        string memory json = vm.readFile("./deployments/superseded/2026-03-26/sepolia.json");
        assertTrue(vm.parseJsonAddress(json, ".contracts.LaunchManager") != address(0), "LaunchManager in record");
        assertTrue(vm.parseJsonAddress(json, ".factories.ERC404") != address(0), "ERC404 factory in record");
    }
}
