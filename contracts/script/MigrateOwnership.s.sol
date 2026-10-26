// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Script, console } from "forge-std/Script.sol";
import { Ownable } from "solady/auth/Ownable.sol";
import { MasterRegistryV1 } from "../src/master/MasterRegistryV1.sol";
import { ERC404Factory } from "../src/factories/erc404/ERC404Factory.sol";
import { UniTitheHookFactory } from "../src/factories/erc404/hooks/UniTitheHookFactory.sol";

/// @dev The write-permission surface of a self-deployed best-route quoter (`SepoliaRouteQuoter`).
///      An interface rather than an import: the script migrates any quoter that gates its route
///      table on an operator, without a build dependency on a contract named after one testnet.
interface IOperatorGatedQuoter {
    function operator() external view returns (address);
    function setOperator(address newOperator) external;
}

/// @title MigrateOwnership
/// @notice Hands every deployer-owned protocol contract to the governance Timelock/Safe and
///         re-points the emergency revoker off the deployer EOA.
///
/// @dev The handover is two-phase and non-atomic.
///
///      Two ownership models coexist in the protocol:
///        - Plain Solady `Ownable` (single-step): `transferOwnership(timelock)` by the current owner
///          (the deployer) lands ownership immediately. Used by MasterRegistryV1 and the plain-Ownable
///          factories / modules / request registry. `ERC404Factory` is `OwnableRoles`, whose
///          `transferOwnership` is the same single-step call; see PROTOCOL_ROLE below.
///        - `SafeOwnableUUPS` (two-step handover): its `transferOwnership` unconditionally reverts
///          `UseRequestOwnershipHandover()`. Ownership moves only via Solady's handover, whose roles
///          are the reverse of a plain `transfer`:
///            1. the new owner (the Timelock) calls `requestOwnershipHandover()` with no argument; the
///               caller registers itself as the pending owner (valid 48h);
///            2. the current owner (the deployer) calls `completeOwnershipHandover(timelock)`.
///
///      Hook owner is not ownership. `UniTitheHookFactory` stamps an owner into every
///      `UniAlignmentV4Hook` it deploys, and that owner holds `setLpFeeRate` and `rescueQueuedFees` on
///      the hook for the hook's whole life. The stamped value is the factory's `hookOwner`, which
///      `transferOwnership` does not move; only `setHookOwner` does, which `run()` calls (D6).
///      Transferring the factory alone would leave a factory that still stamps the deployer EOA onto
///      every future hook.
///
///      The route quoter's operator is not ownership. A network with no canonical best-route quoter
///      deploys its own, and that contract gates `setRoute`/`clearRoute` on an `operator` set to the
///      deployer at construction. It has no owner, so it appears in no list above and no `owner()`
///      assertion; a migration that ignored it would report success over a route table the deployer
///      EOA can still rewrite. It moves via `setOperator`, which `run()` calls (D7), and its address
///      is read off the vault factory that uses it rather than from an environment variable that
///      could be left unset.
///
///      PROTOCOL_ROLE is not ownership. `ERC404Factory` gates its fee / treasury / carve-bracket
///      parameters on `PROTOCOL_ROLE`, which the constructor grants to the deployer alongside
///      ownership. The role does not follow `transferOwnership`, and the factory blocks
///      `grantRoles`/`revokeRoles` from moving it; only `transferProtocolRole` does, which `run()`
///      calls (D4).
///
///      The Timelock is a governance contract (no private key the deployer can broadcast as), so
///      Phase 1 cannot be broadcast by this script; the Timelock must execute the requests itself.
///
///      Operator flow:
///        Phase 1 (Timelock governance, first): the Timelock executes `requestOwnershipHandover()` on
///          each SafeOwnableUUPS contract. `printRequestBatch()` emits the exact target/selector
///          calldata batch for the Safe/Timelock to execute.
///        Phase 2 (deployer, `run()`): completes the handovers, performs the single-step transfers,
///          transfers PROTOCOL_ROLE, and re-points the emergency revoker, the stamped hook owner and
///          the route quoter's operator. Reverts `NoHandoverRequest()` on the first SafeOwnableUUPS
///          contract if Phase 1 has not been executed; this is a safety interlock.
///
///      Coverage. The single-step list below covers every plain-Ownable contract `DeployCore` creates
///      and leaves owned by the deployer. Not covered:
///        - The UUPS implementation contracts behind the CREATE3 proxies (`masterRegistryImpl`,
///          `queueManagerImpl`, `globalMessageRegistryImpl`, `alignmentRegistryImpl`,
///          `componentRegistryImpl`). Their constructors take ownership of the implementation account
///          itself, whose owner powers are inert: `_authorizeUpgrade` is only reachable through
///          `upgradeToAndCall`, which Solady guards `onlyProxy`, and the implementation account holds
///          no protocol state. Protocol state and upgrade authority live on the proxies, which are
///          migrated.
///        - Vaults created by the vault factories. Those are owned by their factory, not by the
///          deployer, and follow the factory's ownership.
///      `MigrateOwnershipTest.test_migrationLeavesNoDeployerOwnedContract` enumerates every contract
///      created during `DeployCore.deploy` and fails if anything outside that stated exclusion is
///      still deployer-owned after the migration.
contract MigrateOwnership is Script {
    /// @dev requestOwnershipHandover() selector: the Timelock-side (Phase 1) calldata.
    bytes4 internal constant REQUEST_HANDOVER_SELECTOR = bytes4(keccak256("requestOwnershipHandover()"));

    /// @dev SafeOwnableUUPS contracts: two-step handover (Timelock requests, deployer completes).
    ///      MASTER_REGISTRY is last so the emergency-revoker re-point (onlyOwner) runs while the
    ///      deployer still owns it.
    function _safeOwnableContracts() internal view returns (address[] memory list) {
        list = new address[](7);
        uint256 n;
        // Required core proxies, all SafeOwnableUUPS.
        list[n++] = vm.envAddress("PROTOCOL_TREASURY");
        list[n++] = vm.envAddress("FEATURED_QUEUE_MANAGER");
        list[n++] = vm.envAddress("QUERY_AGGREGATOR");
        list[n++] = vm.envAddress("GLOBAL_MESSAGE_REGISTRY");
        list[n++] = vm.envAddress("COMPONENT_REGISTRY");
        list[n++] = vm.envAddress("ALIGNMENT_REGISTRY"); // D2 — AlignmentRegistryV1 (SafeOwnableUUPS)
        list[n++] = vm.envAddress("MASTER_REGISTRY"); // completed last (see run()) — revoker re-point first
    }

    /// @dev Every network-dependent address the script reads. An absent variable reads as
    ///      `address(0)`, which each caller interprets: "this network does not have one" for the
    ///      optional entries, a failed run for `UNI_TITHE_HOOK_FACTORY` where the deployment says one
    ///      must exist.
    /// @dev `virtual` so `MigrateOwnershipHarness` can drive the absent-variable case: forge runs the
    ///      test cases of a suite in parallel and never rolls a `vm.setEnv` back, so the override reads
    ///      one name as unset for one harness instead. Only tests override it.
    function _optionalAddress(string memory name) internal view virtual returns (address) {
        return vm.envOr(name, address(0));
    }

    /// @dev Is the Uni rail configured on this network? `DeployCore` builds the tithe hook factory
    ///      under one condition, `cfg.v4PoolManager` and `cfg.weth` both set, and that same `if`
    ///      decides whether `MODULE_UNIV4_DEPLOYER` is the real `LiquidityDeployerModule` or the
    ///      metadata-only stub. The real module carries a `v4PoolManager()` immutable and the stub
    ///      has no such function.
    function _uniRailConfigured() internal view returns (bool) {
        (bool ok, bytes memory ret) = vm.envAddress("MODULE_UNIV4_DEPLOYER").staticcall{ gas: 100_000 }(
            abi.encodeWithSignature("v4PoolManager()")
        );
        return ok && ret.length == 32 && abi.decode(ret, (address)) != address(0);
    }

    /// @dev The Uni-V4 swap-tithe hook factory. Conditionally required: a network with no Uni rail has
    ///      no factory to migrate, but on a network that has one an unset variable would silently drop
    ///      the factory from the transfer list, skip `setHookOwner` and the read-back, and let the run
    ///      print `ownership verified` over a handover that left the deployer EOA stamped into every
    ///      future graduation hook.
    function _uniTitheHookFactory() internal view returns (address factory) {
        factory = _optionalAddress("UNI_TITHE_HOOK_FACTORY");
        require(
            factory != address(0) || !_uniRailConfigured(),
            "MigrateOwnership: UNI_TITHE_HOOK_FACTORY unset on a network with the Uni rail configured"
        );
    }

    /// @dev D7: the best-route quoter, where this network deployed its own rather than pointing at a
    ///      canonical one. Returns `address(0)` when there is nothing to migrate.
    ///
    ///      It takes no environment variable. Every vault factory carries `cfg.zQuoter` as a public
    ///      immutable, so the address is read off a contract that uses it and cannot be mistyped or
    ///      left unset. That matters here because the quoter's operator is invisible to every
    ///      `owner()` assertion in `_verify`: an unset variable would read as "no quoter" and the
    ///      migration would report success over a route table the deployer EOA can still write.
    ///
    ///      The ABI decides whether a quoter is ours, not an address list. The canonical upstream
    ///      quoter (`MainnetAddresses.ZQUOTER`) is a stateless lens with no operator and no setter,
    ///      so the staticcall below fails and the step is skipped. A quoter that answers `operator()`
    ///      was deployed for this protocol, and its route-table permission is a deployer capability.
    function _operatorGatedQuoter() internal view returns (address) {
        address[2] memory factories = [_optionalAddress("UNI_VAULT_FACTORY"), _optionalAddress("ZAMM_VAULT_FACTORY")];
        for (uint256 i; i < factories.length; i++) {
            if (factories[i] == address(0)) continue;
            (bool ok, bytes memory ret) = factories[i].staticcall{ gas: 100_000 }(abi.encodeWithSignature("zQuoter()"));
            if (!ok || ret.length != 32) continue;
            address quoter = abi.decode(ret, (address));
            if (quoter == address(0)) continue; // best-route acquisition disabled on this network
            (bool gated, bytes memory op) = quoter.staticcall{ gas: 100_000 }(abi.encodeWithSignature("operator()"));
            if (!gated || op.length != 32) continue; // canonical upstream lens — no operator to move
            if (abi.decode(op, (address)) == address(0)) continue;
            return quoter;
        }
        return address(0);
    }

    /// @dev Plain Solady Ownable contracts: single-step transferOwnership by the deployer.
    ///      Three tiers:
    ///        - Required (`envAddress`): contracts `DeployCore` creates on every network. A missing
    ///          env var fails the run rather than leaving the contract behind.
    ///        - Optional (`_optionalAddress`): contracts a given network may not deploy (the vault
    ///          factories and the self-deployed router). Skipped when absent.
    ///        - Conditionally required (`_uniTitheHookFactory`): absent on some networks, mandatory on
    ///          the rest, with the network deciding which; an unset variable where the deployment has
    ///          one is a contract dropped from the handover, so the run fails.
    ///      MODULE_UNIV4_DEPLOYER / MODULE_ZAMM_DEPLOYER are required: `DeployCore` always sets both,
    ///      to the real liquidity-deployer module or a metadata-only stub. Both flavors are plain
    ///      `Ownable` and deployer-owned.
    function _plainOwnableContracts() internal view returns (address[] memory list) {
        address[] memory tmp = new address[](22);
        uint256 n;

        // ── Required: created by DeployCore on every network ──
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

        // ── Optional: network-dependent ──
        address uniVaultFactory = _optionalAddress("UNI_VAULT_FACTORY"); // D2
        address aaveVaultFactory = _optionalAddress("AAVE_VAULT_FACTORY"); // D2
        address zammVaultFactory = _optionalAddress("ZAMM_VAULT_FACTORY"); // D2
        // zRouter takes its owner as a constructor argument and exposes the same single-step
        // `transferOwnership(address)`. Optional: only a network that self-deploys the router
        // (`cfg.zrouter == address(0)`: Sepolia and Anvil) leaves it deployer-owned. On a network that
        // reuses the canonical external singleton (mainnet) the transfer would revert
        // `Unauthorized()`, so ZROUTER is left unset.
        address zrouter = _optionalAddress("ZROUTER");
        // The Uni-V4 swap-tithe hook factory is conditionally required: `DeployCore` builds it only
        // where the Uni rail is configured, with no stub, so it is absent on some networks and
        // mandatory on the rest. `_uniTitheHookFactory` fails the run where the rail says it must
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
    ///         request the ownership handover of each SafeOwnableUUPS contract.
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
    ///         transfers, transfers PROTOCOL_ROLE, and re-points the emergency revoker, the stamped
    ///         hook owner and the route quoter's operator to the Timelock. Requires the Phase 1
    ///         requests to have executed for every SafeOwnableUUPS contract.
    function run() external {
        address timelock = vm.envAddress("TIMELOCK_ADDRESS");
        require(timelock != address(0), "MigrateOwnership: TIMELOCK_ADDRESS unset");

        // No argument: forge supplies the signer from `--account <keystore>` (or `--ledger`), so the
        // deployer key is never in this process's environment.
        vm.startBroadcast();
        _migrate(timelock);
        vm.stopBroadcast();

        console.log("Migration complete. All migrated contracts now owned by timelock:", timelock);
    }

    /// @dev The migration itself, separate from the broadcast wrapper so tests drive this code as the
    ///      deployer. Every caller must already be (or be broadcasting as) the deployer.
    function _migrate(address timelock) internal {
        address masterRegistry = vm.envAddress("MASTER_REGISTRY");
        address[] memory safeOwnable = _safeOwnableContracts(); // MASTER_REGISTRY is the LAST element
        address[] memory plainOwnable = _plainOwnableContracts();

        // D3: re-point the emergency revoker to the Timelock before masterRegistry's handover
        // completes, while the deployer still owns it (setEmergencyRevoker is onlyOwner). This keeps
        // the no-delay revokeAgent kill-switch on the governance entity that owns everything.
        MasterRegistryV1(masterRegistry).setEmergencyRevoker(timelock);
        console.log("emergencyRevoker re-pointed to timelock");

        // D4: PROTOCOL_ROLE on the ERC404 factory gates the bonding-fee, treasury, bond-escrow and
        // carve-bracket setters, and `transferOwnership` does not move it. Runs while the deployer
        // still holds the role.
        ERC404Factory(vm.envAddress("ERC404_FACTORY")).transferProtocolRole(timelock);
        console.log("ERC404Factory PROTOCOL_ROLE transferred to timelock");

        // D6: the hook owner stamped into future graduation hooks. Only `setHookOwner` moves it, and
        // it must run while the deployer still owns the factory, so it precedes the single-step
        // transfer below. Conditional like the list entry: a network with no Uni rail has no factory
        // to re-point, and one that has it cannot skip this by leaving the variable unset.
        address titheHookFactory = _uniTitheHookFactory();
        if (titheHookFactory != address(0)) {
            UniTitheHookFactory(titheHookFactory).setHookOwner(timelock);
            console.log("UniTitheHookFactory hookOwner re-pointed to timelock");
        }

        // D7: the best-route quoter's route table. The quoter has no owner, and `setRoute`/`clearRoute`
        // are gated on `operator`, which nothing above moves; `_verify`'s `owner()` sweep would not
        // notice it. Skipped where the network points at a canonical upstream quoter, which has no
        // operator.
        address quoter = _operatorGatedQuoter();
        if (quoter != address(0)) {
            // A step already taken is skipped, so a re-run after a partially-landed migration reaches
            // the read-back. The current operator is not checked against the deployer because this
            // script cannot name it: under `vm.startBroadcast()` the broadcasting account replaces
            // the sender of onward calls only, so `msg.sender` here is whoever invoked `run()`. An
            // operator that is neither surfaces as the quoter's own `NotOperator()` on the next line.
            if (IOperatorGatedQuoter(quoter).operator() != timelock) {
                IOperatorGatedQuoter(quoter).setOperator(timelock);
                console.log("route quoter operator re-pointed to timelock ->", quoter);
            }
        }

        // D1: complete the two-step handover for each SafeOwnableUUPS contract. Reverts
        // NoHandoverRequest() if the Timelock has not run Phase 1. MASTER_REGISTRY is last, so its
        // handover completes after the revoker re-point.
        for (uint256 i; i < safeOwnable.length; i++) {
            Ownable(safeOwnable[i]).completeOwnershipHandover(timelock);
            console.log("SafeOwnableUUPS handover completed ->", safeOwnable[i]);
        }

        // D2: single-step transfer for each plain-Ownable contract.
        for (uint256 i; i < plainOwnable.length; i++) {
            Ownable(plainOwnable[i]).transferOwnership(timelock);
            console.log("Ownable transferred ->", plainOwnable[i]);
        }

        // D5: read the handover back. The writes above fail silently when an env var points at the
        // wrong address or a contract added to `DeployCore` is missing from the lists here, and a
        // skipped handover is otherwise indistinguishable from a completed one. It runs inside the
        // same broadcast, so a partial migration fails during simulation.
        _verify(timelock);
    }

    /// @notice Assert the handover actually landed. Callable on its own against an already-migrated
    ///         deployment: `forge script MigrateOwnership --sig "verify()"`.
    /// @dev    View and unbroadcast: it asserts, it never writes.
    function verify() external view {
        address timelock = vm.envAddress("TIMELOCK_ADDRESS");
        require(timelock != address(0), "MigrateOwnership: TIMELOCK_ADDRESS unset");
        _verify(timelock);
    }

    /// @dev The assertions, in `_migrate` order; each message names the contract that failed.
    function _verify(address timelock) internal view {
        // A governance owner is a contract (Timelock or Safe). An EOA would satisfy every
        // `owner() == timelock` check below while leaving the protocol under one key.
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

        // D3 read-back: the emergency revoker is the no-delay kill switch; every `owner()` above
        // would read correctly with it still on the deployer EOA.
        require(
            MasterRegistryV1(vm.envAddress("MASTER_REGISTRY")).emergencyRevoker() == timelock,
            "MigrateOwnership: emergencyRevoker is not the timelock"
        );

        // D4 read-back: `transferOwnership` does not move PROTOCOL_ROLE. `transferProtocolRole`
        // removes it from the caller as it grants, so asserting the timelock holds it is enough.
        ERC404Factory factory = ERC404Factory(vm.envAddress("ERC404_FACTORY"));
        require(
            factory.hasAnyRole(timelock, factory.PROTOCOL_ROLE()),
            "MigrateOwnership: timelock does not hold PROTOCOL_ROLE on ERC404Factory"
        );

        // D6 read-back: `hookOwner` shows in no `owner()` above, and each hook stamped with the old
        // value keeps that key on its `setLpFeeRate` and `rescueQueuedFees` permanently.
        address titheHookFactory = _uniTitheHookFactory();
        if (titheHookFactory != address(0)) {
            require(
                UniTitheHookFactory(titheHookFactory).hookOwner() == timelock,
                "MigrateOwnership: UniTitheHookFactory hookOwner is not the timelock"
            );
        }

        // D7 read-back: the route table's write permission. The quoter appears in no ownership list,
        // so every assertion above passes over a route table the deployer can still rewrite.
        address quoter = _operatorGatedQuoter();
        if (quoter != address(0)) {
            require(
                IOperatorGatedQuoter(quoter).operator() == timelock,
                "MigrateOwnership: route quoter operator is not the timelock"
            );
        }

        console.log("ownership verified: every migrated contract, the revoker and PROTOCOL_ROLE are held by", timelock);
    }
}
