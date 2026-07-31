// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { DeployCore } from "../../script/DeployCore.sol";
import { MigrateOwnership } from "../../script/MigrateOwnership.s.sol";
import { CREATEX } from "../../src/shared/CreateXConstants.sol";
import { CREATEX_BYTECODE } from "createx-forge/script/CreateX.d.sol";
import { MasterRegistryV1 } from "../../src/master/MasterRegistryV1.sol";
import { SafeOwnableUUPS } from "../../src/shared/SafeOwnableUUPS.sol";
import { Ownable } from "solady/auth/Ownable.sol";

/// @dev Test-only subclass exposing MigrateOwnership's env-driven categorization so it can be
///      asserted against the actual deployed addresses (executes the real script code paths).
contract MigrateOwnershipHarness is MigrateOwnership {
    function safeOwnable() external view returns (address[] memory) {
        return _safeOwnableContracts();
    }

    function plainOwnable() external view returns (address[] memory) {
        return _plainOwnableContracts();
    }
}

/// @notice Proves noesis-093: the two-step handover actually lands ownership on the timelock for
///         every SafeOwnableUUPS contract (D1) + the plain-Ownable D2 contracts, re-points the
///         emergency revoker (D3), and pins the pre-fix single-step revert as a regression.
///
///         The migration is a broadcast script (deployer key + env vars), so this test exercises the
///         exact on-chain operations MigrateOwnership.run() performs — Timelock `requestOwnershipHandover()`
///         then deployer `completeOwnershipHandover(timelock)` for SafeOwnableUUPS, single-step
///         `transferOwnership` for plain Ownable — against the real DeployCore output, plus asserts the
///         script's own env categorization via a harness subclass.
contract MigrateOwnershipTest is Test {
    address constant STETH = 0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84;
    address constant WSTETH = 0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0;
    address constant STUB_LINK = 0x779877A7B0D9E8603169DdbD7836e478b4624789;
    bytes constant RETURN_TRUE = hex"600160005260206000f3";

    DeployCore s;
    address deployer; // owner of all deployed contracts (DeployCore deploys with deployer = address(s))
    address timelock;

    function setUp() public {
        vm.etch(CREATEX, CREATEX_BYTECODE);
        vm.etch(STETH, RETURN_TRUE);
        vm.etch(WSTETH, RETURN_TRUE);
        vm.etch(STUB_LINK, RETURN_TRUE);

        s = new DeployCore();
        s.deploy(address(s), _testConfig());
        deployer = address(s);
        timelock = makeAddr("timelock");
    }

    // ── the 7 SafeOwnableUUPS contracts (two-step) + 1 plain-Ownable factory covered by the test cfg ──

    function _safeOwnable() internal view returns (address[] memory list) {
        list = new address[](7);
        list[0] = address(s.treasury());
        list[1] = address(s.queueManager());
        list[2] = address(s.queryAggregator());
        list[3] = address(s.globalMessageRegistry());
        list[4] = address(s.componentRegistry());
        list[5] = address(s.alignmentRegistry());
        list[6] = s.masterRegistry();
    }

    function _plainOwnable() internal view returns (address[] memory list) {
        list = new address[](3);
        list[0] = address(s.targetRequestRegistry());
        list[1] = address(s.uniVaultFactory());
        list[2] = address(s.cypherVaultFactory()); // Ownable as of noesis-094 — deployer-owned, single-step
    }

    /// @dev Replicates MigrateOwnership.run(): revoker re-point, two-step completes, single-step transfers.
    function _migrate() internal {
        address[] memory safe = _safeOwnable();
        address[] memory plain = _plainOwnable();
        address mr = s.masterRegistry(); // cache before any prank (an external getter would consume it)

        // Phase 1 (Timelock governance): the new owner requests the handover on each SafeOwnableUUPS.
        for (uint256 i; i < safe.length; i++) {
            vm.prank(timelock);
            Ownable(safe[i]).requestOwnershipHandover();
        }

        // Phase 2 (deployer): revoker re-point BEFORE master's handover completes, then complete all
        // handovers and single-step transfers.
        vm.prank(deployer);
        MasterRegistryV1(mr).setEmergencyRevoker(timelock);
        for (uint256 i; i < safe.length; i++) {
            vm.prank(deployer);
            Ownable(safe[i]).completeOwnershipHandover(timelock);
        }
        for (uint256 i; i < plain.length; i++) {
            vm.prank(deployer);
            Ownable(plain[i]).transferOwnership(timelock);
        }
    }

    // ── Pre-fix sanity: every SafeOwnableUUPS contract starts owned by the deployer ──────────────

    function test_preMigration_ownedByDeployer() public view {
        address[] memory safe = _safeOwnable();
        for (uint256 i; i < safe.length; i++) {
            assertEq(Ownable(safe[i]).owner(), deployer, "safe pre-owner");
        }
        assertEq(MasterRegistryV1(s.masterRegistry()).emergencyRevoker(), deployer, "revoker pre");
    }

    // ── D1 + D2: ownership actually lands on the timelock ────────────────────────────────────────

    function test_ownershipLandsOnTimelock() public {
        _migrate();

        address[] memory safe = _safeOwnable();
        for (uint256 i; i < safe.length; i++) {
            assertEq(Ownable(safe[i]).owner(), timelock, "safe owner -> timelock");
        }
        address[] memory plain = _plainOwnable();
        for (uint256 i; i < plain.length; i++) {
            assertEq(Ownable(plain[i]).owner(), timelock, "plain owner -> timelock");
        }
    }

    // ── D3: emergency revoker moved off the deployer EOA to the timelock ─────────────────────────

    function test_emergencyRevokerRepointed() public {
        _migrate();
        assertEq(MasterRegistryV1(s.masterRegistry()).emergencyRevoker(), timelock, "revoker -> timelock");
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
        address mr = s.masterRegistry(); // cache before the cheatcodes so they attach to the target call
        vm.prank(deployer);
        vm.expectRevert(Ownable.NoHandoverRequest.selector);
        Ownable(mr).completeOwnershipHandover(timelock);
    }

    // ── Script categorization: MASTER_REGISTRY is in the two-step set; env wiring is correct ─────

    function test_scriptCategorization() public {
        MigrateOwnershipHarness h = new MigrateOwnershipHarness();

        vm.setEnv("PROTOCOL_TREASURY", vm.toString(address(s.treasury())));
        vm.setEnv("FEATURED_QUEUE_MANAGER", vm.toString(address(s.queueManager())));
        vm.setEnv("QUERY_AGGREGATOR", vm.toString(address(s.queryAggregator())));
        vm.setEnv("GLOBAL_MESSAGE_REGISTRY", vm.toString(address(s.globalMessageRegistry())));
        vm.setEnv("COMPONENT_REGISTRY", vm.toString(address(s.componentRegistry())));
        vm.setEnv("ALIGNMENT_REGISTRY", vm.toString(address(s.alignmentRegistry())));
        vm.setEnv("MASTER_REGISTRY", vm.toString(s.masterRegistry()));
        vm.setEnv("TARGET_REQUEST_REGISTRY", vm.toString(address(s.targetRequestRegistry())));
        vm.setEnv("UNI_VAULT_FACTORY", vm.toString(address(s.uniVaultFactory())));
        vm.setEnv("CYPHER_VAULT_FACTORY", vm.toString(address(s.cypherVaultFactory())));

        address[] memory safe = h.safeOwnable();
        assertEq(safe.length, 7, "safe len");
        assertEq(safe[6], s.masterRegistry(), "master is the last two-step element");

        address[] memory plain = h.plainOwnable();
        assertEq(plain.length, 3, "plain len (uni + cypher present, aave/zamm absent this cfg)");
        assertEq(plain[0], address(s.targetRequestRegistry()), "plain[0]");
        assertEq(plain[1], address(s.uniVaultFactory()), "plain[1]");
        assertEq(plain[2], address(s.cypherVaultFactory()), "plain[2] cypher");
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
