// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Script, console } from "forge-std/Script.sol";
import { Ownable } from "solady/auth/Ownable.sol";
import { MasterRegistryV1 } from "../src/master/MasterRegistryV1.sol";
import { ERC404Factory } from "../src/factories/erc404/ERC404Factory.sol";

/// @title MigrateOwnership
/// @notice Hands every deployer-owned protocol contract to the governance Timelock/Safe and
///         re-points the emergency revoker off the deployer EOA.
///
/// @dev THE HANDOVER IS TWO-PHASE AND NON-ATOMIC.
///
///      Two ownership models coexist in the protocol:
///        - Plain Solady `Ownable` (single-step): `transferOwnership(timelock)` by the current owner
///          (the deployer) lands ownership immediately. Used by MasterRegistryV1 and the plain-Ownable
///          factories / modules / request registry. `ERC404Factory` is `OwnableRoles`, whose
///          `transferOwnership` is the same single-step call — but see PROTOCOL_ROLE below.
///        - `SafeOwnableUUPS` (two-step handover): its `transferOwnership` unconditionally reverts
///          `UseRequestOwnershipHandover()`. Ownership moves only via Solady's handover, whose roles
///          are the REVERSE of a naive `transfer`:
///            1. the NEW owner (the Timelock) calls `requestOwnershipHandover()` — NO argument; the
///               caller registers ITSELF as the pending owner (valid 48h);
///            2. the CURRENT owner (the deployer) calls `completeOwnershipHandover(timelock)`.
///
///      PROTOCOL_ROLE IS NOT OWNERSHIP. `ERC404Factory` gates its fee / treasury / carve-bracket
///      parameters on `PROTOCOL_ROLE`, which the constructor grants to the deployer alongside
///      ownership. The role does not follow `transferOwnership`, and the factory deliberately blocks
///      `grantRoles`/`revokeRoles` from moving it; it moves only via `transferProtocolRole`, which
///      `run()` calls (D4).
///
///      Because the Timelock is a governance contract (no private key the deployer can broadcast as),
///      Phase 1 CANNOT be broadcast by this script — the Timelock must execute the requests itself.
///
///      OPERATOR FLOW:
///        Phase 1 (Timelock governance, FIRST): the Timelock executes `requestOwnershipHandover()` on
///          each SafeOwnableUUPS contract. Run `printRequestBatch()` (below) to emit the exact
///          target/selector calldata batch for the Safe/Timelock to execute.
///        Phase 2 (deployer, `run()`): completes the handovers, performs the single-step transfers,
///          transfers PROTOCOL_ROLE, and re-points the emergency revoker. Reverts `NoHandoverRequest()`
///          on the first SafeOwnableUUPS contract if Phase 1 has not been executed yet — this is a
///          safety interlock, not a bug.
///
///      COVERAGE. The single-step list below covers every plain-Ownable contract `DeployCore` creates
///      and leaves owned by the deployer. Deliberately NOT covered:
///        - The UUPS *implementation* contracts behind the CREATE3 proxies (`masterRegistryImpl`,
///          `queueManagerImpl`, `globalMessageRegistryImpl`, `alignmentRegistryImpl`,
///          `componentRegistryImpl`). Their constructors take ownership of the implementation account
///          itself, whose owner powers are inert: `_authorizeUpgrade` is only reachable through
///          `upgradeToAndCall`, which Solady guards `onlyProxy`, and the implementation account holds
///          no protocol state. Protocol state and upgrade authority live on the proxies, which ARE
///          migrated.
///        - Vaults created by the vault factories. Those are owned by their factory, not by the
///          deployer, and follow the factory's ownership.
///      `MigrateOwnershipTest.test_migrationLeavesNoDeployerOwnedContract` enumerates every contract
///      created during `DeployCore.deploy` and fails if anything outside that stated exclusion is
///      still deployer-owned after the migration.
contract MigrateOwnership is Script {
    /// @dev requestOwnershipHandover() selector — the Timelock-side (Phase 1) calldata.
    bytes4 internal constant REQUEST_HANDOVER_SELECTOR = bytes4(keccak256("requestOwnershipHandover()"));

    /// @dev SafeOwnableUUPS contracts — two-step handover (Timelock requests, deployer completes).
    ///      MASTER_REGISTRY is included and completed LAST in `run()` so the emergency-revoker
    ///      re-point (onlyOwner) can run while the deployer still owns it.
    function _safeOwnableContracts() internal view returns (address[] memory list) {
        list = new address[](7);
        uint256 n;
        // Required core proxies — all SafeOwnableUUPS on origin/main.
        list[n++] = vm.envAddress("PROTOCOL_TREASURY");
        list[n++] = vm.envAddress("FEATURED_QUEUE_MANAGER");
        list[n++] = vm.envAddress("QUERY_AGGREGATOR");
        list[n++] = vm.envAddress("GLOBAL_MESSAGE_REGISTRY");
        list[n++] = vm.envAddress("COMPONENT_REGISTRY");
        list[n++] = vm.envAddress("ALIGNMENT_REGISTRY"); // D2 — AlignmentRegistryV1 (SafeOwnableUUPS)
        list[n++] = vm.envAddress("MASTER_REGISTRY"); // completed last (see run()) — revoker re-point first
    }

    /// @dev Plain Solady Ownable contracts — single-step transferOwnership by the deployer.
    ///      Two tiers:
    ///        - REQUIRED (`envAddress`): contracts `DeployCore` creates on every network. A missing
    ///          env var fails the run loudly rather than silently leaving the contract behind.
    ///        - OPTIONAL (`envOr(..., address(0))`): contracts a given network may not deploy — the
    ///          vault factories and the Cypher liquidity-deployer module. Skipped when absent, so a
    ///          partial deploy does not turn into a reverting migration.
    ///      NOTE: CypherAlignmentVaultFactory joins the plain-Ownable set as of noesis-094, which made
    ///      it `Ownable` (Solady, deployer-owned) with owner-only validator/deviation passthroughs; its
    ///      admin is migrated to the Timelock here like the other single-step vault factories.
    ///      NOTE: MODULE_UNIV4_DEPLOYER / MODULE_ZAMM_DEPLOYER are required rather than optional —
    ///      `DeployCore` always sets both, either to the real liquidity-deployer module or to a
    ///      metadata-only component stub. Both flavors are plain `Ownable` and deployer-owned, so the
    ///      same single-step transfer covers either.
    function _plainOwnableContracts() internal view returns (address[] memory list) {
        address[] memory tmp = new address[](20);
        uint256 n;

        // ── Required — created by DeployCore on every network ──
        tmp[n++] = vm.envAddress("TARGET_REQUEST_REGISTRY"); // D2 — AlignmentTargetRequestRegistry
        tmp[n++] = vm.envAddress("LAUNCH_MANAGER"); // setPreset — launch presets for every future launch
        tmp[n++] = vm.envAddress("CURVE_PARAMS_COMPUTER"); // setCurveWeights — bonding-curve shape
        tmp[n++] = vm.envAddress("ERC404_FACTORY"); // OwnableRoles; PROTOCOL_ROLE moves separately (D4)
        tmp[n++] = vm.envAddress("DEPLOY_BOND_ESCROW"); // release() over escrowed ETH + bond params
        tmp[n++] = vm.envAddress("ERC1155_FACTORY");
        tmp[n++] = vm.envAddress("ERC721_FACTORY");
        tmp[n++] = vm.envAddress("DYNAMIC_PRICING_MODULE");
        tmp[n++] = vm.envAddress("MODULE_MERKLE_GATING");
        tmp[n++] = vm.envAddress("MODULE_UNIV4_DEPLOYER"); // setAlignmentHookFactory — the tithe switch
        tmp[n++] = vm.envAddress("MODULE_ZAMM_DEPLOYER");
        tmp[n++] = vm.envAddress("ERC404_STAKING_MODULE");
        tmp[n++] = vm.envAddress("METADATA_RESOLVER_ROUTER");
        tmp[n++] = vm.envAddress("METADATA_OVERLAY_MODULE");
        tmp[n++] = vm.envAddress("TOKEN_TIER_BAND_RESOLVER");

        // ── Optional — network-dependent ──
        address uniVaultFactory = vm.envOr("UNI_VAULT_FACTORY", address(0)); // D2
        address aaveVaultFactory = vm.envOr("AAVE_VAULT_FACTORY", address(0)); // D2
        address zammVaultFactory = vm.envOr("ZAMM_VAULT_FACTORY", address(0)); // D2
        address cypherVaultFactory = vm.envOr("CYPHER_VAULT_FACTORY", address(0)); // D2 — Ownable as of noesis-094
        address cypherModule = vm.envOr("MODULE_CYPHER_DEPLOYER", address(0)); // only where Cypher is configured
        if (uniVaultFactory != address(0)) tmp[n++] = uniVaultFactory;
        if (aaveVaultFactory != address(0)) tmp[n++] = aaveVaultFactory;
        if (zammVaultFactory != address(0)) tmp[n++] = zammVaultFactory;
        if (cypherVaultFactory != address(0)) tmp[n++] = cypherVaultFactory;
        if (cypherModule != address(0)) tmp[n++] = cypherModule;

        list = new address[](n);
        for (uint256 i; i < n; i++) {
            list[i] = tmp[i];
        }
    }

    /// @notice Phase 1 helper (no broadcast). Emits the calldata the Timelock/Safe must execute to
    ///         request the ownership handover of each SafeOwnableUUPS contract. Feed each
    ///         (target, calldata) pair into the Safe/Timelock batch, then run `run()` as the deployer.
    function printRequestBatch() external view {
        address[] memory safeOwnable = _safeOwnableContracts();
        console.log("=== Phase 1: Timelock/Safe must execute these calls FIRST ===");
        console.log("selector requestOwnershipHandover():");
        console.logBytes4(REQUEST_HANDOVER_SELECTOR);
        for (uint256 i; i < safeOwnable.length; i++) {
            console.log("  target:", safeOwnable[i]);
            console.log("  calldata:");
            console.logBytes(abi.encodeWithSelector(REQUEST_HANDOVER_SELECTOR));
        }
        console.log("After the Timelock executes the above, run MigrateOwnership.run() as the deployer.");
    }

    /// @notice Phase 2 (deployer). Completes the two-step handovers, performs the single-step
    ///         transfers, transfers PROTOCOL_ROLE, and re-points the emergency revoker to the
    ///         Timelock. Requires Phase 1 (Timelock requests) to have already executed for every
    ///         SafeOwnableUUPS contract.
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address timelock = vm.envAddress("TIMELOCK_ADDRESS");
        require(timelock != address(0), "MigrateOwnership: TIMELOCK_ADDRESS unset");

        vm.startBroadcast(deployerPrivateKey);
        _migrate(timelock);
        vm.stopBroadcast();

        console.log("Migration complete. All migrated contracts now owned by timelock:", timelock);
    }

    /// @dev The migration itself, factored out of the broadcast wrapper so the test suite can drive
    ///      THIS code as the deployer rather than re-implementing the sequence. Every caller must
    ///      already be (or be broadcasting as) the deployer.
    function _migrate(address timelock) internal {
        address masterRegistry = vm.envAddress("MASTER_REGISTRY");
        address[] memory safeOwnable = _safeOwnableContracts(); // MASTER_REGISTRY is the LAST element
        address[] memory plainOwnable = _plainOwnableContracts();

        // D3 — re-point the emergency revoker off the deployer EOA to the Timelock. Done BEFORE
        // masterRegistry's handover is completed, while the deployer still owns masterRegistry
        // (setEmergencyRevoker is onlyOwner). Keeps the instant no-delay revokeAgent kill-switch on
        // the same governance entity that ends up owning everything.
        MasterRegistryV1(masterRegistry).setEmergencyRevoker(timelock);
        console.log("emergencyRevoker re-pointed to timelock");

        // D4 — PROTOCOL_ROLE on the ERC404 factory. Separate from ownership: it gates the bonding-fee,
        // treasury, bond-escrow and carve-bracket setters, and `transferOwnership` does not move it.
        // Done while the deployer still holds the role.
        ERC404Factory(vm.envAddress("ERC404_FACTORY")).transferProtocolRole(timelock);
        console.log("ERC404Factory PROTOCOL_ROLE transferred to timelock");

        // D1 — complete the two-step handover for each SafeOwnableUUPS contract. Reverts
        // NoHandoverRequest() if the Timelock has not run Phase 1 (requestOwnershipHandover) yet.
        // MASTER_REGISTRY is the last element, so its handover completes AFTER the revoker re-point.
        for (uint256 i; i < safeOwnable.length; i++) {
            Ownable(safeOwnable[i]).completeOwnershipHandover(timelock);
            console.log("SafeOwnableUUPS handover completed ->", safeOwnable[i]);
        }

        // D2 — single-step transfer for each plain-Ownable contract.
        for (uint256 i; i < plainOwnable.length; i++) {
            Ownable(plainOwnable[i]).transferOwnership(timelock);
            console.log("Ownable transferred ->", plainOwnable[i]);
        }
    }
}
