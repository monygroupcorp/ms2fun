// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Script, console } from "forge-std/Script.sol";
import { Ownable } from "solady/auth/Ownable.sol";
import { MasterRegistryV1 } from "../src/master/MasterRegistryV1.sol";
import { ERC404Factory } from "../src/factories/erc404/ERC404Factory.sol";
import { UniTitheHookFactory } from "../src/factories/erc404/hooks/UniTitheHookFactory.sol";

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
///      HOOK OWNER IS NOT OWNERSHIP EITHER. `UniTitheHookFactory` stamps an owner into every
///      `UniAlignmentV4Hook` it deploys, and that owner holds `setLpFeeRate` and `rescueQueuedFees` on
///      the hook for the hook's whole life. The stamped value is the factory's `hookOwner`, which
///      `transferOwnership` does not move any more than it moves PROTOCOL_ROLE; it moves only via
///      `setHookOwner`, which `run()` calls (D6). Transferring the factory alone would hand governance
///      a factory that still stamps the deployer EOA onto every future hook.
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

    /// @dev Every network-dependent address the script reads, in one place. An absent variable reads
    ///      as `address(0)`, which each caller then interprets — "this network does not have one" for
    ///      the optional entries, and a failed run for `UNI_TITHE_HOOK_FACTORY` where the deployment
    ///      says one must exist.
    /// @dev `virtual` so `MigrateOwnershipHarness` can drive the absent-variable case. Forge runs the
    ///      test cases of a suite in parallel and never rolls a `vm.setEnv` back, so a test that blanked
    ///      a variable in its own body would blank it for whatever else happened to be running; the
    ///      override reads one name as unset for one harness instead. The body here is the behaviour
    ///      every real run gets — nothing overrides it off a test.
    function _optionalAddress(string memory name) internal view virtual returns (address) {
        return vm.envOr(name, address(0));
    }

    /// @dev Is the Uni rail configured on this network? `DeployCore` builds the tithe hook factory
    ///      under exactly one condition — `cfg.v4PoolManager` and `cfg.weth` both set — and that same
    ///      condition decides, in the same `if`, whether `MODULE_UNIV4_DEPLOYER` is the real
    ///      `LiquidityDeployerModule` or the metadata-only component stub. So the answer is already in
    ///      the migration's own required inputs and needs no new flag: the real module carries a
    ///      `v4PoolManager()` immutable and the stub carries no such function at all.
    function _uniRailConfigured() internal view returns (bool) {
        (bool ok, bytes memory ret) = vm.envAddress("MODULE_UNIV4_DEPLOYER").staticcall{ gas: 100_000 }(
            abi.encodeWithSignature("v4PoolManager()")
        );
        return ok && ret.length == 32 && abi.decode(ret, (address)) != address(0);
    }

    /// @dev The Uni-V4 swap-tithe hook factory. Conditionally required, which is the only reading that
    ///      is safe: a network with no Uni rail has no factory to migrate, and on a network that HAS one
    ///      an unset variable is not "nothing to do" — it silently drops the factory from the transfer
    ///      list, skips `setHookOwner`, skips the read-back, and lets the run print `ownership verified`
    ///      over a handover that left the deployer EOA stamped into every future graduation hook.
    function _uniTitheHookFactory() internal view returns (address factory) {
        factory = _optionalAddress("UNI_TITHE_HOOK_FACTORY");
        require(
            factory != address(0) || !_uniRailConfigured(),
            "MigrateOwnership: UNI_TITHE_HOOK_FACTORY unset on a network with the Uni rail configured"
        );
    }

    /// @dev Plain Solady Ownable contracts — single-step transferOwnership by the deployer.
    ///      Three tiers:
    ///        - REQUIRED (`envAddress`): contracts `DeployCore` creates on every network. A missing
    ///          env var fails the run loudly rather than silently leaving the contract behind.
    ///        - OPTIONAL (`_optionalAddress`): contracts a given network may not deploy — the
    ///          vault factories and the self-deployed router. Skipped when absent, so a partial deploy
    ///          does not turn into a reverting migration.
    ///        - CONDITIONALLY REQUIRED (`_uniTitheHookFactory`): absent on some networks, mandatory on
    ///          the rest, with the network itself deciding which. An unset variable is only "nothing to
    ///          migrate" where the deployment genuinely has no such contract; everywhere else it is a
    ///          contract dropped from the handover, and the run must fail rather than report success.
    ///      NOTE: MODULE_UNIV4_DEPLOYER / MODULE_ZAMM_DEPLOYER are required rather than optional —
    ///      `DeployCore` always sets both, either to the real liquidity-deployer module or to a
    ///      metadata-only component stub. Both flavors are plain `Ownable` and deployer-owned, so the
    ///      same single-step transfer covers either.
    function _plainOwnableContracts() internal view returns (address[] memory list) {
        address[] memory tmp = new address[](22);
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
        address uniVaultFactory = _optionalAddress("UNI_VAULT_FACTORY"); // D2
        address aaveVaultFactory = _optionalAddress("AAVE_VAULT_FACTORY"); // D2
        address zammVaultFactory = _optionalAddress("ZAMM_VAULT_FACTORY"); // D2
        // zRouter takes its owner as a constructor argument and exposes the same single-step
        // `transferOwnership(address)`, so it migrates like any other plain-Ownable contract. OPTIONAL
        // on purpose: only a network that SELF-DEPLOYS the router (`cfg.zrouter == address(0)` — Sepolia
        // and Anvil) leaves it deployer-owned. A network that reuses the canonical external singleton
        // (mainnet) does not own it, and the transfer would revert `Unauthorized()` — leave ZROUTER
        // unset there.
        address zrouter = _optionalAddress("ZROUTER");
        // The Uni-V4 swap-tithe hook factory. CONDITIONALLY REQUIRED rather than optional: `DeployCore`
        // only builds it where the Uni rail is configured — unlike MODULE_UNIV4_DEPLOYER, which always
        // exists in one flavor or the other, there is no stub here — so it is absent on some networks
        // and mandatory on the rest. `_uniTitheHookFactory` fails the run where the rail says it must
        // exist; `deployments/<net>.json` carries it under `contracts.UniTitheHookFactory`.
        address uniTitheHookFactory = _uniTitheHookFactory();
        if (uniVaultFactory != address(0)) tmp[n++] = uniVaultFactory;
        if (aaveVaultFactory != address(0)) tmp[n++] = aaveVaultFactory;
        if (zammVaultFactory != address(0)) tmp[n++] = zammVaultFactory;
        if (zrouter != address(0)) tmp[n++] = zrouter;
        if (uniTitheHookFactory != address(0)) tmp[n++] = uniTitheHookFactory;

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

        // D6 — the hook owner stamped into future graduation hooks. Not ownership: `setHookOwner` is
        // the only thing that moves it, and it must run while the deployer still owns the factory, so
        // it goes ahead of the single-step transfer below. Conditional for the same reason the list
        // entry is: a network with no Uni rail has no tithe hook factory to re-point, and a network
        // that has one cannot be allowed to skip this by leaving the variable unset.
        address titheHookFactory = _uniTitheHookFactory();
        if (titheHookFactory != address(0)) {
            UniTitheHookFactory(titheHookFactory).setHookOwner(timelock);
            console.log("UniTitheHookFactory hookOwner re-pointed to timelock");
        }

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

        // D5 — read the handover back. Every line above is a write whose failure mode is silence:
        // a `completeOwnershipHandover` that was never paired with a Phase-1 request, an env var
        // pointing at the wrong address, a contract added to `DeployCore` and never added to the
        // lists here. None of those revert on their own, and a deploy that skipped the handover
        // entirely is otherwise indistinguishable from one that completed it. This runs inside the
        // same broadcast, so a partial migration fails during simulation rather than landing.
        _verify(timelock);
    }

    /// @notice Assert the handover actually landed. Callable on its own against an already-migrated
    ///         deployment — `forge script MigrateOwnership --sig "verify()"` — so a runbook can tick
    ///         it as a step, and so the claim "ownership was handed over" is a thing somebody read
    ///         back rather than a thing somebody remembers doing.
    /// @dev    View and unbroadcast: it asserts, it never writes.
    function verify() external view {
        address timelock = vm.envAddress("TIMELOCK_ADDRESS");
        require(timelock != address(0), "MigrateOwnership: TIMELOCK_ADDRESS unset");
        _verify(timelock);
    }

    /// @dev The assertions themselves. Ordered to match `_migrate`, and every message names the
    ///      contract that failed so a partial migration says which step to re-run.
    function _verify(address timelock) internal view {
        // A governance owner is a contract — a Timelock or a Safe. An EOA here is the exact
        // mistake this entry exists to catch: it satisfies every `owner() == timelock` check
        // below while leaving the protocol under one key.
        require(timelock.code.length != 0, "MigrateOwnership: TIMELOCK_ADDRESS is an EOA, not a contract");

        address[] memory safeOwnable = _safeOwnableContracts();
        for (uint256 i; i < safeOwnable.length; i++) {
            require(
                Ownable(safeOwnable[i]).owner() == timelock,
                "MigrateOwnership: SafeOwnableUUPS owner is not the timelock"
            );
        }

        address[] memory plainOwnable = _plainOwnableContracts();
        for (uint256 i; i < plainOwnable.length; i++) {
            require(Ownable(plainOwnable[i]).owner() == timelock, "MigrateOwnership: Ownable owner is not the timelock");
        }

        // D3 read-back — the emergency revoker is the no-delay kill switch. Left on the deployer
        // EOA it is the one capability the handover was supposed to move and the one nothing else
        // would reveal, because every `owner()` above would still read correctly.
        require(
            MasterRegistryV1(vm.envAddress("MASTER_REGISTRY")).emergencyRevoker() == timelock,
            "MigrateOwnership: emergencyRevoker is not the timelock"
        );

        // D4 read-back — PROTOCOL_ROLE is not ownership and `transferOwnership` does not move it,
        // so it is the other capability a naive handover leaves behind. `transferProtocolRole`
        // removes it from the caller as it grants, so asserting the timelock holds it is enough.
        ERC404Factory factory = ERC404Factory(vm.envAddress("ERC404_FACTORY"));
        require(
            factory.hasAnyRole(timelock, factory.PROTOCOL_ROLE()),
            "MigrateOwnership: timelock does not hold PROTOCOL_ROLE on ERC404Factory"
        );

        // D6 read-back — `hookOwner` is the third capability `transferOwnership` leaves behind. Left
        // on the deployer EOA it does not show up in any `owner()` above, and the cost is not paid at
        // the handover but at every graduation after it: each hook stamped with the old value keeps
        // that key on its `setLpFeeRate` and `rescueQueuedFees` permanently.
        address titheHookFactory = _uniTitheHookFactory();
        if (titheHookFactory != address(0)) {
            require(
                UniTitheHookFactory(titheHookFactory).hookOwner() == timelock,
                "MigrateOwnership: UniTitheHookFactory hookOwner is not the timelock"
            );
        }

        console.log("ownership verified: every migrated contract, the revoker and PROTOCOL_ROLE are held by", timelock);
    }
}
