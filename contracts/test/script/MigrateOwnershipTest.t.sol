// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { VmSafe } from "forge-std/Vm.sol";
import { DeployCore } from "../../script/DeployCore.sol";
import { MigrateOwnership } from "../../script/MigrateOwnership.s.sol";
import { CREATEX } from "../../src/shared/CreateXConstants.sol";
import { CREATEX_BYTECODE } from "createx-forge/script/CreateX.d.sol";
import { MasterRegistryV1 } from "../../src/master/MasterRegistryV1.sol";
import { SafeOwnableUUPS } from "../../src/shared/SafeOwnableUUPS.sol";
import { ERC404Factory } from "../../src/factories/erc404/ERC404Factory.sol";
import { Ownable } from "solady/auth/Ownable.sol";

/// @dev Test-only subclass exposing MigrateOwnership's env-driven categorization and its migration
///      body so both can be exercised as the real script code.
contract MigrateOwnershipHarness is MigrateOwnership {
    function safeOwnable() external view returns (address[] memory) {
        return _safeOwnableContracts();
    }

    function plainOwnable() external view returns (address[] memory) {
        return _plainOwnableContracts();
    }

    /// @dev `run()` minus the broadcast wrapper — the same `_migrate` the deployer broadcasts.
    function migrate(address timelock) external {
        _migrate(timelock);
    }
}

/// @notice Proves noesis-093 + noesis-192: the two-step handover lands ownership on the timelock for
///         every SafeOwnableUUPS contract (D1), the single-step transfers cover every plain-Ownable
///         contract DeployCore leaves with the deployer (D2), the emergency revoker is re-pointed
///         (D3), PROTOCOL_ROLE on the ERC404 factory moves with it (D4), and the pre-fix single-step
///         revert stays pinned as a regression.
///
///         The migration is a broadcast script (deployer key + env vars). `DeployCore` in this test
///         deploys as `address(s)`, a contract with no private key, so `run()` itself cannot be
///         invoked here. Instead the harness's runtime code is etched onto the deployer account and
///         `migrate()` is called there: the script's OWN `_migrate` body executes with `msg.sender`
///         equal to the deployer for every onward call, so the ordering (revoker re-point before the
///         master handover completes) and the env-driven coverage lists are the real ones rather
///         than a re-implementation.
contract MigrateOwnershipTest is Test {
    address constant STETH = 0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84;
    address constant WSTETH = 0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0;
    address constant STUB_LINK = 0x779877A7B0D9E8603169DdbD7836e478b4624789;
    bytes constant RETURN_TRUE = hex"600160005260206000f3";

    DeployCore s;
    address deployer; // owner of all deployed contracts (DeployCore deploys with deployer = address(s))
    address timelock;

    /// @dev Every contract created during `DeployCore.deploy` (state-diff recorded in setUp).
    address[] internal created;

    // Cached deployment addresses — the harness code is etched over `s` in `_migrate()`, after which
    // DeployCore's getters are no longer callable, so everything the assertions need is read up front.
    address internal masterRegistry;
    address internal treasury;
    address internal queueManager;
    address internal queryAggregator;
    address internal globalMessageRegistry;
    address internal componentRegistry;
    address internal alignmentRegistry;
    address internal targetRequestRegistry;
    address internal uniVaultFactory;
    address internal cypherVaultFactory;
    address internal launchManager;
    address internal curveParamsComputer;
    address internal erc404Factory;
    address internal deployBondEscrow;
    address internal erc1155Factory;
    address internal erc721Factory;
    address internal dynamicPricingModule;
    address internal moduleMerkleGating;
    address internal moduleUniV4Deployer;
    address internal moduleZAMMDeployer;
    address internal moduleCypherDeployer;
    address internal erc404StakingModule;
    address internal metadataResolverRouter;
    address internal metadataOverlayModule;
    address internal tokenTierBandResolver;

    // UUPS implementation accounts — see `_isStatedExclusion`.
    address internal masterRegistryImpl;
    address internal treasuryImpl;
    address internal queueManagerImpl;
    address internal globalMessageRegistryImpl;
    address internal alignmentRegistryImpl;
    address internal componentRegistryImpl;

    function setUp() public {
        vm.etch(CREATEX, CREATEX_BYTECODE);
        vm.etch(STETH, RETURN_TRUE);
        vm.etch(WSTETH, RETURN_TRUE);
        vm.etch(STUB_LINK, RETURN_TRUE);

        s = new DeployCore();

        // Record every account created by the deploy so the completeness gate can enumerate the
        // deployed set instead of trusting a hand-written mirror list.
        vm.startStateDiffRecording();
        s.deploy(address(s), _testConfig());
        VmSafe.AccountAccess[] memory accesses = vm.stopAndReturnStateDiff();
        for (uint256 i; i < accesses.length; i++) {
            if (accesses[i].kind == VmSafe.AccountAccessKind.Create && accesses[i].account != address(0)) {
                created.push(accesses[i].account);
            }
        }

        deployer = address(s);
        timelock = makeAddr("timelock");
        _cacheAddresses();
        _setScriptEnv();
    }

    function _cacheAddresses() internal {
        masterRegistry = s.masterRegistry();
        treasury = address(s.treasury());
        queueManager = address(s.queueManager());
        queryAggregator = address(s.queryAggregator());
        globalMessageRegistry = address(s.globalMessageRegistry());
        componentRegistry = address(s.componentRegistry());
        alignmentRegistry = address(s.alignmentRegistry());
        targetRequestRegistry = address(s.targetRequestRegistry());
        uniVaultFactory = address(s.uniVaultFactory());
        cypherVaultFactory = address(s.cypherVaultFactory());
        launchManager = address(s.launchManager());
        curveParamsComputer = address(s.curveParamsComputer());
        erc404Factory = address(s.erc404Factory());
        deployBondEscrow = address(s.deployBondEscrow());
        erc1155Factory = address(s.erc1155Factory());
        erc721Factory = address(s.erc721Factory());
        dynamicPricingModule = address(s.dynamicPricingModule());
        moduleMerkleGating = address(s.moduleMerkleGating());
        moduleUniV4Deployer = s.moduleUniV4Deployer();
        moduleZAMMDeployer = s.moduleZAMMDeployer();
        moduleCypherDeployer = s.moduleCypherDeployer();
        erc404StakingModule = address(s.erc404StakingModule());
        metadataResolverRouter = address(s.metadataResolverRouter());
        metadataOverlayModule = address(s.metadataOverlayModule());
        tokenTierBandResolver = address(s.tokenTierBandResolver());

        masterRegistryImpl = address(s.masterRegistryImpl());
        treasuryImpl = address(s.treasuryImpl());
        queueManagerImpl = address(s.queueManagerImpl());
        globalMessageRegistryImpl = address(s.globalMessageRegistryImpl());
        alignmentRegistryImpl = address(s.alignmentRegistryImpl());
        componentRegistryImpl = address(s.componentRegistryImpl());
    }

    /// @dev The env the script reads. Mirrors what the operator exports from the deployment JSON.
    function _setScriptEnv() internal {
        vm.setEnv("PROTOCOL_TREASURY", vm.toString(treasury));
        vm.setEnv("FEATURED_QUEUE_MANAGER", vm.toString(queueManager));
        vm.setEnv("QUERY_AGGREGATOR", vm.toString(queryAggregator));
        vm.setEnv("GLOBAL_MESSAGE_REGISTRY", vm.toString(globalMessageRegistry));
        vm.setEnv("COMPONENT_REGISTRY", vm.toString(componentRegistry));
        vm.setEnv("ALIGNMENT_REGISTRY", vm.toString(alignmentRegistry));
        vm.setEnv("MASTER_REGISTRY", vm.toString(masterRegistry));

        vm.setEnv("TARGET_REQUEST_REGISTRY", vm.toString(targetRequestRegistry));
        vm.setEnv("LAUNCH_MANAGER", vm.toString(launchManager));
        vm.setEnv("CURVE_PARAMS_COMPUTER", vm.toString(curveParamsComputer));
        vm.setEnv("ERC404_FACTORY", vm.toString(erc404Factory));
        vm.setEnv("DEPLOY_BOND_ESCROW", vm.toString(deployBondEscrow));
        vm.setEnv("ERC1155_FACTORY", vm.toString(erc1155Factory));
        vm.setEnv("ERC721_FACTORY", vm.toString(erc721Factory));
        vm.setEnv("DYNAMIC_PRICING_MODULE", vm.toString(dynamicPricingModule));
        vm.setEnv("MODULE_MERKLE_GATING", vm.toString(moduleMerkleGating));
        vm.setEnv("MODULE_UNIV4_DEPLOYER", vm.toString(moduleUniV4Deployer));
        vm.setEnv("MODULE_ZAMM_DEPLOYER", vm.toString(moduleZAMMDeployer));
        vm.setEnv("ERC404_STAKING_MODULE", vm.toString(erc404StakingModule));
        vm.setEnv("METADATA_RESOLVER_ROUTER", vm.toString(metadataResolverRouter));
        vm.setEnv("METADATA_OVERLAY_MODULE", vm.toString(metadataOverlayModule));
        vm.setEnv("TOKEN_TIER_BAND_RESOLVER", vm.toString(tokenTierBandResolver));

        // Optional — present in this config: uni + cypher vault factories. Aave/ZAMM factories and the
        // Cypher liquidity-deployer module are not deployed here, so their env vars stay unset.
        vm.setEnv("UNI_VAULT_FACTORY", vm.toString(uniVaultFactory));
        vm.setEnv("CYPHER_VAULT_FACTORY", vm.toString(cypherVaultFactory));
    }

    // ── the SafeOwnableUUPS (two-step) set covered by the test config ─────────────────────────────

    function _safeOwnable() internal view returns (address[] memory list) {
        list = new address[](7);
        list[0] = treasury;
        list[1] = queueManager;
        list[2] = queryAggregator;
        list[3] = globalMessageRegistry;
        list[4] = componentRegistry;
        list[5] = alignmentRegistry;
        list[6] = masterRegistry;
    }

    /// @dev Phase 1 (Timelock governance): the new owner requests the handover on each SafeOwnableUUPS.
    function _requestHandovers() internal {
        address[] memory safe = _safeOwnable();
        for (uint256 i; i < safe.length; i++) {
            vm.prank(timelock);
            Ownable(safe[i]).requestOwnershipHandover();
        }
    }

    /// @dev Phase 2 (deployer): runs the script's OWN `_migrate` body as the deployer. The harness's
    ///      runtime code is etched onto the deployer account so its onward calls carry `msg.sender ==
    ///      deployer`; a `prank` cannot do this, because it would only rewrite the sender of the call
    ///      INTO the harness, not the calls the harness makes. `_migrate` reads only env vars, so the
    ///      DeployCore storage it lands on top of is never touched.
    function _migrate() internal {
        MigrateOwnershipHarness impl = new MigrateOwnershipHarness();
        vm.etch(deployer, address(impl).code);
        MigrateOwnershipHarness(deployer).migrate(timelock);
    }

    // ── Pre-migration sanity: every SafeOwnableUUPS contract starts owned by the deployer ─────────

    function test_preMigration_ownedByDeployer() public view {
        address[] memory safe = _safeOwnable();
        for (uint256 i; i < safe.length; i++) {
            assertEq(Ownable(safe[i]).owner(), deployer, "safe pre-owner");
        }
        assertEq(MasterRegistryV1(masterRegistry).emergencyRevoker(), deployer, "revoker pre");
    }

    // ── D1 + D2: ownership actually lands on the timelock, driving the real script body ───────────

    function test_ownershipLandsOnTimelock() public {
        MigrateOwnershipHarness h = new MigrateOwnershipHarness();
        address[] memory safe = h.safeOwnable();
        address[] memory plain = h.plainOwnable();

        _requestHandovers();
        _migrate();

        for (uint256 i; i < safe.length; i++) {
            assertEq(Ownable(safe[i]).owner(), timelock, "safe owner -> timelock");
        }
        for (uint256 i; i < plain.length; i++) {
            assertEq(Ownable(plain[i]).owner(), timelock, "plain owner -> timelock");
        }
    }

    // ── D3: emergency revoker moved off the deployer EOA to the timelock ─────────────────────────

    function test_emergencyRevokerRepointed() public {
        _requestHandovers();
        _migrate();
        assertEq(MasterRegistryV1(masterRegistry).emergencyRevoker(), timelock, "revoker -> timelock");
    }

    // ── D4: PROTOCOL_ROLE is not carried by ownership and must move on its own ───────────────────

    function test_protocolRoleMovesToTimelock() public {
        uint256 role = ERC404Factory(erc404Factory).PROTOCOL_ROLE();
        assertTrue(ERC404Factory(erc404Factory).hasAnyRole(deployer, role), "deployer holds PROTOCOL_ROLE pre");

        _requestHandovers();
        _migrate();

        assertFalse(ERC404Factory(erc404Factory).hasAnyRole(deployer, role), "deployer PROTOCOL_ROLE cleared");
        assertTrue(ERC404Factory(erc404Factory).hasAnyRole(timelock, role), "timelock holds PROTOCOL_ROLE");
    }

    // ── Completeness gate: nothing DeployCore created is left with the deployer ──────────────────
    //
    // Enumerates every account created during `DeployCore.deploy` (recorded in setUp) rather than a
    // hand-written mirror list, so a contract added to DeployCore and not added to the migration
    // fails here. Anything still deployer-owned after the migration must be a stated exclusion.

    function test_migrationLeavesNoDeployerOwnedContract() public {
        _requestHandovers();
        _migrate();

        emit log_named_uint("contracts created by DeployCore.deploy", created.length);
        (address uncovered, uint256 checked) = _firstUncovered(created);
        assertEq(uncovered, address(0), "a DeployCore-created contract is still owned by the deployer");
        assertGt(checked, 20, "enumeration produced too few ownable contracts; the recording is not working");
    }

    /// @dev Guard on the guard ([[helm-vacuous-gates]]): the predicate above must reject a
    ///      deployer-owned contract that no list covers. Without this, a probe that silently fails
    ///      on every address would report a clean sweep.
    function test_completenessGate_rejectsAnUncoveredContract() public {
        _requestHandovers();
        _migrate();

        address stray = address(new UncoveredOwnable(deployer));
        address[] memory withStray = new address[](created.length + 1);
        for (uint256 i; i < created.length; i++) {
            withStray[i] = created[i];
        }
        withStray[created.length] = stray;

        (address uncovered,) = _firstUncovered(withStray);
        assertEq(uncovered, stray, "the completeness gate must flag an uncovered deployer-owned contract");
    }

    /// @dev The completeness predicate. Returns the first candidate still owned by the deployer that
    ///      is not a stated exclusion (address(0) when there is none), plus how many candidates
    ///      actually answered `owner()` — a collapsed probe would otherwise read as a clean sweep.
    function _firstUncovered(address[] memory candidates) internal view returns (address uncovered, uint256 checked) {
        for (uint256 i; i < candidates.length; i++) {
            address a = candidates[i];
            if (a == deployer) continue; // the deploy script account itself, not a protocol contract
            (bool ok, address owner_) = _tryOwner(a);
            if (!ok) continue; // no owner() — nothing to migrate
            checked++;
            if (owner_ != deployer) continue;
            if (_isStatedExclusion(a)) continue;
            if (uncovered == address(0)) uncovered = a;
        }
    }

    /// @dev The contracts deliberately left with the deployer, each for a reason stated here and in
    ///      MigrateOwnership's coverage note. Only the UUPS implementation accounts behind the CREATE3
    ///      proxies qualify: their owner powers are inert (`_authorizeUpgrade` is reachable only via
    ///      `upgradeToAndCall`, which Solady guards `onlyProxy`) and they hold no protocol state. The
    ///      proxies themselves are migrated.
    function _isStatedExclusion(address a) internal view returns (bool) {
        return a == masterRegistryImpl || a == treasuryImpl || a == queueManagerImpl || a == globalMessageRegistryImpl
            || a == alignmentRegistryImpl || a == componentRegistryImpl;
    }

    /// @dev Probe for Solady/OZ-style `owner()`. Gas-capped: the enumeration touches arbitrary
    ///      deployed code, and an unbounded probe lets one non-conforming fallback consume the run.
    function _tryOwner(address a) internal view returns (bool ok, address owner_) {
        if (a.code.length == 0) return (false, address(0));
        (bool success, bytes memory ret) = a.staticcall{ gas: 100_000 }(abi.encodeWithSignature("owner()"));
        if (!success || ret.length != 32) return (false, address(0));
        owner_ = abi.decode(ret, (address));
        return (true, owner_);
    }

    // ── Regression pin: the pre-fix path (single-step transferOwnership on a SafeOwnableUUPS) reverts ──

    function test_oldPath_transferOwnership_reverts() public {
        address[] memory safe = _safeOwnable();
        for (uint256 i; i < safe.length; i++) {
            vm.prank(deployer);
            vm.expectRevert(SafeOwnableUUPS.UseRequestOwnershipHandover.selector);
            Ownable(safe[i]).transferOwnership(timelock);
        }
    }

    // ── Interlock: completing without a prior Timelock request reverts (non-atomic safety) ───────

    function test_completeWithoutRequest_reverts() public {
        vm.prank(deployer);
        vm.expectRevert(Ownable.NoHandoverRequest.selector);
        Ownable(masterRegistry).completeOwnershipHandover(timelock);
    }

    // ── Script categorization: MASTER_REGISTRY is in the two-step set; env wiring is correct ─────

    function test_scriptCategorization() public {
        MigrateOwnershipHarness h = new MigrateOwnershipHarness();

        address[] memory safe = h.safeOwnable();
        assertEq(safe.length, 7, "safe len");
        assertEq(safe[6], masterRegistry, "master is the last two-step element");

        address[] memory plain = h.plainOwnable();
        // 15 required + uni and cypher vault factories (aave/zamm factories and the cypher
        // liquidity-deployer module are not deployed in this config).
        assertEq(plain.length, 17, "plain len");
        assertEq(plain[0], targetRequestRegistry, "plain[0]");
        assertEq(plain[1], launchManager, "plain[1]");
        assertEq(plain[2], curveParamsComputer, "plain[2]");
        assertEq(plain[3], erc404Factory, "plain[3]");
        assertEq(plain[4], deployBondEscrow, "plain[4]");
        assertEq(plain[5], erc1155Factory, "plain[5]");
        assertEq(plain[6], erc721Factory, "plain[6]");
        assertEq(plain[7], dynamicPricingModule, "plain[7]");
        assertEq(plain[8], moduleMerkleGating, "plain[8]");
        assertEq(plain[9], moduleUniV4Deployer, "plain[9]");
        assertEq(plain[10], moduleZAMMDeployer, "plain[10]");
        assertEq(plain[11], erc404StakingModule, "plain[11]");
        assertEq(plain[12], metadataResolverRouter, "plain[12]");
        assertEq(plain[13], metadataOverlayModule, "plain[13]");
        assertEq(plain[14], tokenTierBandResolver, "plain[14]");
        assertEq(plain[15], uniVaultFactory, "plain[15] uni");
        assertEq(plain[16], cypherVaultFactory, "plain[16] cypher");
        assertEq(moduleCypherDeployer, address(0), "cypher liquidity module absent in this config");
    }

    // ── config ───────────────────────────────────────────────────────────────────────────────────

    function _testConfig() internal returns (DeployCore.NetworkConfig memory cfg) {
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
        cfg.cypherPositionManager = address(1); // nonzero → DeployCore deploys the Ownable CypherAlignmentVaultFactory (noesis-094/112)
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
}

/// @dev Stand-in for "a contract someone adds to DeployCore and forgets to migrate".
contract UncoveredOwnable is Ownable {
    constructor(address owner_) {
        _initializeOwner(owner_);
    }
}
