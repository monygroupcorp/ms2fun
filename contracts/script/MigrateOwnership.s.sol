// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Script, console } from "forge-std/Script.sol";
import { Ownable } from "solady/auth/Ownable.sol";
import { MasterRegistryV1 } from "../src/master/MasterRegistryV1.sol";

/// @title MigrateOwnership
/// @notice Hands every deployer-owned protocol contract to the governance Timelock/Safe and
///         re-points the emergency revoker off the deployer EOA.
///
/// @dev THE HANDOVER IS TWO-PHASE AND NON-ATOMIC.
///
///      Two ownership models coexist in the protocol:
///        - Plain Solady `Ownable` (single-step): `transferOwnership(timelock)` by the current owner
///          (the deployer) lands ownership immediately. Used by MasterRegistryV1 and the plain-Ownable
///          factories / request registry.
///        - `SafeOwnableUUPS` (two-step handover): its `transferOwnership` unconditionally reverts
///          `UseRequestOwnershipHandover()`. Ownership moves only via Solady's handover, whose roles
///          are the REVERSE of a naive `transfer`:
///            1. the NEW owner (the Timelock) calls `requestOwnershipHandover()` — NO argument; the
///               caller registers ITSELF as the pending owner (valid 48h);
///            2. the CURRENT owner (the deployer) calls `completeOwnershipHandover(timelock)`.
///
///      Because the Timelock is a governance contract (no private key the deployer can broadcast as),
///      Phase 1 CANNOT be broadcast by this script — the Timelock must execute the requests itself.
///
///      OPERATOR FLOW:
///        Phase 1 (Timelock governance, FIRST): the Timelock executes `requestOwnershipHandover()` on
///          each SafeOwnableUUPS contract. Run `printRequestBatch()` (below) to emit the exact
///          target/selector calldata batch for the Safe/Timelock to execute.
///        Phase 2 (deployer, `run()`): completes the handovers, performs the single-step transfers,
///          and re-points the emergency revoker. Reverts `NoHandoverRequest()` on the first
///          SafeOwnableUUPS contract if Phase 1 has not been executed yet — this is a safety
///          interlock, not a bug.
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
    ///      Optional vault factories are pulled with `envOr(..., address(0))` and skipped when the
    ///      network did not deploy that AMM's factory.
    ///      NOTE: CypherAlignmentVaultFactory is intentionally absent — it is not Ownable (no owner
    ///      to migrate); the Cypher vaults it creates are governed via their own paths.
    function _plainOwnableContracts() internal view returns (address[] memory list) {
        address[] memory tmp = new address[](4);
        uint256 n;
        tmp[n++] = vm.envAddress("TARGET_REQUEST_REGISTRY"); // D2 — AlignmentTargetRequestRegistry
        address uniVaultFactory = vm.envOr("UNI_VAULT_FACTORY", address(0)); // D2
        address aaveVaultFactory = vm.envOr("AAVE_VAULT_FACTORY", address(0)); // D2
        address zammVaultFactory = vm.envOr("ZAMM_VAULT_FACTORY", address(0)); // D2
        if (uniVaultFactory != address(0)) tmp[n++] = uniVaultFactory;
        if (aaveVaultFactory != address(0)) tmp[n++] = aaveVaultFactory;
        if (zammVaultFactory != address(0)) tmp[n++] = zammVaultFactory;

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
    ///         transfers, and re-points the emergency revoker to the Timelock. Requires Phase 1
    ///         (Timelock requests) to have already executed for every SafeOwnableUUPS contract.
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address timelock = vm.envAddress("TIMELOCK_ADDRESS");
        require(timelock != address(0), "MigrateOwnership: TIMELOCK_ADDRESS unset");

        address masterRegistry = vm.envAddress("MASTER_REGISTRY");
        address[] memory safeOwnable = _safeOwnableContracts(); // MASTER_REGISTRY is the LAST element
        address[] memory plainOwnable = _plainOwnableContracts();

        vm.startBroadcast(deployerPrivateKey);

        // D3 — re-point the emergency revoker off the deployer EOA to the Timelock. Done BEFORE
        // masterRegistry's handover is completed, while the deployer still owns masterRegistry
        // (setEmergencyRevoker is onlyOwner). Keeps the instant no-delay revokeAgent kill-switch on
        // the same governance entity that ends up owning everything.
        MasterRegistryV1(masterRegistry).setEmergencyRevoker(timelock);
        console.log("emergencyRevoker re-pointed to timelock");

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

        vm.stopBroadcast();

        console.log("Migration complete. All migrated contracts now owned by timelock:", timelock);
    }
}
