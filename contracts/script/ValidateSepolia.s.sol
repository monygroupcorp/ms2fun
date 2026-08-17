// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Script, console } from "forge-std/Script.sol";
import { MasterRegistryV1 } from "../src/master/MasterRegistryV1.sol";
import { IMasterRegistry } from "../src/master/interfaces/IMasterRegistry.sol";
import { ComponentRegistry } from "../src/registry/ComponentRegistry.sol";
import { LaunchManager } from "../src/factories/erc404/LaunchManager.sol";
import { FeatureUtils } from "../src/master/libraries/FeatureUtils.sol";

/// @notice Read-only validation script. Checks all Sepolia protocol config
///         required for the ERC404 creation flow to work end-to-end.
///
///         Run with:
///         forge script script/ValidateSepolia.s.sol --rpc-url $SEPOLIA_RPC_URL
contract ValidateSepolia is Script {
    // ── Addresses ─────────────────────────────────────────────────────────
    // The asymmetry below is deliberate.
    //
    // MasterRegistry and ComponentRegistry are CREATE3 proxies whose addresses are fixed by the
    // vanity salts in `DeploySepolia.s.sol` — a redeploy with the same salt lands on the same
    // address, so these are genuinely constants and stay pinned here.
    address constant MASTER_REGISTRY = 0x00001152CBa5fDB16A0FAE780fFebD5b9dF8e7cF;
    address constant COMPONENT_REGISTRY = 0x00001152Ed1bD8e76693cB775c79708275bBb2F3;

    // LaunchManager and ERC404Factory are deployed with plain `new` in `DeployCore`, so their
    // addresses are nonce-derived and move on every redeploy. Pinning them makes the validator
    // interrogate a contract that is not the deployed one. They are read from the deployment
    // record instead — the same source `_checkVaults` already reads.
    string constant DEPLOYMENT_PATH = "./deployments/sepolia.json";

    /// @dev Sepolia. The external-dependency block below asserts against addresses that only exist
    ///      on this chain, so it runs only when the script is pointed at a Sepolia RPC.
    uint256 constant SEPOLIA_CHAIN_ID = 11155111;

    /// @dev ZAMM V1. A CREATE2 singleton, so the address is chain-independent BY CONVENTION — which
    ///      is a claim about the deployer's intent, not a guarantee that the deploy happened on any
    ///      given chain. Single source: `DeploySepolia.s.sol` (`cfg.zamm`); `DeployCore` consumes it
    ///      directly and does not write it to the deployment record, so it is mirrored here. zRouter
    ///      IS written to the record (`.contracts.zRouter`) and is read from there instead.
    address constant ZAMM_V1 = 0x000000000000040470635EB91b7CE4D132D616eD;

    /// @dev The tag `ERC404Factory` requires of a preset's curve computer: the RAW literal bytes
    ///      `bytes32("curve_computer")`, not a keccak hash. Mirrors `ERC404Factory` and the
    ///      `approveComponent` call in `DeployCore` exactly.
    bytes32 constant CURVE_COMPUTER_TAG = bytes32("curve_computer");

    /// @dev One `vaults` entry as emitted by DeployCore. Foundry maps JSON keys to struct fields in
    ///      ALPHABETICAL key order: address, alignmentToken, targetId, type.
    struct VaultRecord {
        address vaultAddress;
        address alignmentToken;
        uint256 targetId;
        string vaultType;
    }

    /// @notice Every check below that gates `ERC404Factory.createInstance` is an assertion, not a
    ///         log line: a misconfigured deployment must make this script exit non-zero. The logs
    ///         stay because they are what an operator reads on deploy day.
    function run() public view {
        console.log("\n=== Sepolia Protocol Validation ===\n");

        string memory json = _deploymentJson();
        address factory = _recordAddress(json, ".factories.ERC404", "ERC404Factory");
        address launchManagerAddr = _recordAddress(json, ".contracts.LaunchManager", "LaunchManager");

        _checkFactory(factory);
        _checkComponentRegistry();
        _checkLaunchManager(launchManagerAddr);
        _checkVaults(json);
        _checkExternalDependencies(json);

        console.log("\n=== Done ===");
    }

    // ── Resolution seams ──────────────────────────────────────────────────
    // `virtual` so a test can point the validator at a locally deployed protocol and at an
    // in-memory deployment record. Production behaviour is the default implementation.

    /// @dev The deployment record the nonce-derived addresses and the vault list are read from.
    function _deploymentJson() internal view virtual returns (string memory) {
        return vm.readFile(DEPLOYMENT_PATH);
    }

    function _masterRegistry() internal view virtual returns (MasterRegistryV1) {
        return MasterRegistryV1(MASTER_REGISTRY);
    }

    function _componentRegistry() internal view virtual returns (ComponentRegistry) {
        return ComponentRegistry(COMPONENT_REGISTRY);
    }

    /// @dev Read one address out of the deployment record. A missing key reverts inside
    ///      `parseJsonAddress`; a zero or codeless entry is rejected here. All three are loud —
    ///      a record that cannot supply an address must stop the run, not degrade it to a log line.
    function _recordAddress(string memory json, string memory key, string memory label)
        internal
        view
        returns (address addr)
    {
        addr = vm.parseJsonAddress(json, key);
        require(addr != address(0), string.concat(label, ": deployment record holds the zero address"));
        require(addr.code.length > 0, string.concat(label, ": no code at the address in the deployment record"));
    }

    /// @notice Assert every deployed alignment vault is registered, self-reports the expected
    ///         `vaultType()` discriminator, and — for the LP families — is operationally
    ///         liquidity-ready (pool key + validator wired, O2). Reads the `vaults` array from the
    ///         deployment JSON, so it covers whichever families the network config enabled: Uni-only
    ///         today, and all four (Yield + Uni/ZAMM/Cypher LP) once Sepolia's config promotes them.
    /// @dev Targets the current DeployCore output where `.vaults` is a JSON-encoded STRING (mirrors
    ///      SeedAnvil). Run against a fresh `deployments/sepolia.json` from the current DeployCore.
    function _checkVaults(string memory json) internal view {
        console.log("-- Alignment vaults --");
        string memory vaultsJson = vm.parseJsonString(json, ".vaults");
        VaultRecord[] memory vaults = abi.decode(vm.parseJson(vaultsJson), (VaultRecord[]));
        console.log("  total vaults:", vaults.length);

        for (uint256 i = 0; i < vaults.length; i++) {
            address v = vaults[i].vaultAddress;
            require(_masterRegistry().isVaultRegistered(v), "vault not registered");

            string memory onchainType = _readString(v, "vaultType()");
            string memory expected = _expectedType(vaults[i].vaultType);
            require(keccak256(bytes(onchainType)) == keccak256(bytes(expected)), "vaultType mismatch");

            bool lp = _endsWithLP(onchainType);
            if (lp) require(_readBool(v, "isLiquidityReady()"), "LP vault not liquidity-ready");

            console.log("    ", v);
            console.log("      type:", onchainType);
        }
        console.log("");
    }

    /// @notice Assert the two external singletons the deployment routes through — ZAMM and zRouter —
    ///         actually carry code on the chain being validated.
    /// @dev Everything else this script checks is protocol we deployed, so its existence is implied by
    ///      the deployment record. ZAMM and zRouter are not: they are third-party CREATE2 singletons
    ///      pinned by address. If either is codeless on the target chain, the call sites decode empty
    ///      returndata and revert — every `BestRouteAcquirer` leg and the fixed-pool fallback for an
    ///      alignment-vault acquisition, and every graduated ERC-404 swap. Fork tests inherit mainnet
    ///      state, where both are populated by construction, so the condition is only observable
    ///      against the live chain. Asserting it here turns it into a deploy-time refusal.
    ///
    ///      Chain-gated: these are Sepolia addresses, and this block is the only part of the script
    ///      that reads state outside the deployment record. Off Sepolia (local EVM, unit tests) it
    ///      logs that it did not run rather than asserting against addresses that cannot be there.
    function _checkExternalDependencies(string memory json) internal view {
        console.log("-- External dependencies --");
        if (block.chainid != SEPOLIA_CHAIN_ID) {
            console.log("  skipped: not running against Sepolia (chainid", block.chainid, ")");
            console.log("");
            return;
        }

        // zRouter comes from the record, so the check cannot drift from the address the deployment
        // actually wired into the launch deployers and vault factories.
        _checkExternalDep(_recordAddress(json, ".contracts.zRouter", "zRouter"), "zRouter");
        _checkExternalDep(ZAMM_V1, "ZAMM V1");
        console.log("");
    }

    /// @dev States what it checked: a passing run prints the address and its code size.
    function _checkExternalDep(address dep, string memory label) internal view {
        console.log(string.concat("  ", label, ":"), dep);
        console.log("    code size:", dep.code.length);
        require(dep.code.length > 0, string.concat(label, ": no code at the pinned address on this chain"));
    }

    /// @dev Map the deploy JSON's short vault tag to the on-chain vaultType() string.
    function _expectedType(string memory tag) internal pure returns (string memory) {
        bytes32 h = keccak256(bytes(tag));
        if (h == keccak256("UNIv4")) return "UniswapV4LP";
        if (h == keccak256("ZAMM")) return "ZAMMLP";
        if (h == keccak256("CYPHER")) return "CypherLP";
        return "AaveEndowment"; // "AaveEndowment" tag passes through unchanged
    }

    function _endsWithLP(string memory s) internal pure returns (bool) {
        bytes memory b = bytes(s);
        return b.length >= 2 && b[b.length - 2] == "L" && b[b.length - 1] == "P";
    }

    function _readString(address target, string memory sig) internal view returns (string memory) {
        (bool ok, bytes memory ret) = target.staticcall(abi.encodeWithSignature(sig));
        require(ok, "vault read failed");
        return abi.decode(ret, (string));
    }

    function _readBool(address target, string memory sig) internal view returns (bool) {
        (bool ok, bytes memory ret) = target.staticcall(abi.encodeWithSignature(sig));
        require(ok, "vault read failed");
        return abi.decode(ret, (bool));
    }

    /// @dev True when `target` exposes `bandCount(address)` returning a uint256 — the
    ///      TokenTierBandResolver fingerprint. Guarded decode (not try/catch): a return-data decode
    ///      failure is NOT catchable by try/catch, so check the length before decoding.
    function _isBandResolver(address target) internal view returns (bool) {
        (bool ok, bytes memory ret) = target.staticcall(abi.encodeWithSignature("bandCount(address)", address(0)));
        return ok && ret.length == 32;
    }

    /// @dev Registration and the active flag both gate instance creation through the MasterRegistry,
    ///      so both are assertions.
    function _checkFactory(address factory) internal view {
        console.log("-- ERC404Factory --");
        console.log("  address:", factory);
        MasterRegistryV1 mr = _masterRegistry();

        bool registered = mr.isFactoryRegistered(factory);
        console.log("  registered in MasterRegistry:", registered);
        require(registered, "ERC404Factory in the deployment record is not registered in the MasterRegistry");

        IMasterRegistry.FactoryInfo memory info = mr.getFactoryInfoByAddress(factory);
        console.log("  active:", info.active);
        console.log("  factoryId:", info.factoryId);
        require(info.active, "ERC404Factory is registered but not active");
        console.log("");
    }

    function _checkComponentRegistry() internal view {
        console.log("-- ComponentRegistry --");
        ComponentRegistry cr = _componentRegistry();

        address[] memory all = cr.getApprovedComponents();
        console.log("  total approved:", all.length);

        address[] memory liquidityDeployers = cr.getApprovedComponentsByTag(FeatureUtils.LIQUIDITY_DEPLOYER);
        console.log("  liquidity deployers:", liquidityDeployers.length);
        for (uint256 i = 0; i < liquidityDeployers.length; i++) {
            console.log("    ", liquidityDeployers[i]);
        }
        // Unconditional gate: `_createInstance` requires the supplied liquidity deployer be approved
        // under this tag, with no address(0) opt-out. An empty set means no launch can succeed.
        require(liquidityDeployers.length > 0, "no component approved under the LIQUIDITY_DEPLOYER tag");

        // GATING and STAKING below are per-launch opt-ins — `_createInstance` only checks them when
        // the creator selects a module, so an empty set is a valid deployment and stays a log line.
        address[] memory gatingModules = cr.getApprovedComponentsByTag(FeatureUtils.GATING);
        console.log("  gating modules:", gatingModules.length);
        for (uint256 i = 0; i < gatingModules.length; i++) {
            console.log("    ", gatingModules[i]);
        }

        address[] memory curveComputers = cr.getApprovedComponentsByTag(CURVE_COMPUTER_TAG);
        console.log("  curve computers:", curveComputers.length);
        for (uint256 i = 0; i < curveComputers.length; i++) {
            console.log("    ", curveComputers[i]);
        }
        // Unconditional gate: every create resolves a preset's curve computer through this tag.
        // The per-preset binding is asserted in `_checkLaunchManager`.
        require(curveComputers.length > 0, "no component approved under the curve_computer tag");

        address[] memory stakingModules = cr.getApprovedComponentsByTag(FeatureUtils.STAKING);
        console.log("  staking modules:", stakingModules.length);
        for (uint256 i = 0; i < stakingModules.length; i++) {
            console.log("    ", stakingModules[i]);
        }

        // Metadata-resolution stack (ADR-0006/0007) — resolver router + overlay + tier bands
        address[] memory resolvers = cr.getApprovedComponentsByTag(FeatureUtils.RESOLVER);
        console.log("  metadata resolvers:", resolvers.length);
        for (uint256 i = 0; i < resolvers.length; i++) {
            console.log("    ", resolvers[i]);
        }
        address[] memory overlays = cr.getApprovedComponentsByTag(FeatureUtils.OVERLAY);
        console.log("  overlay modules:", overlays.length);
        for (uint256 i = 0; i < overlays.length; i++) {
            console.log("    ", overlays[i]);
        }
        // The TIER tag must carry the STATIC band resolver (TokenTierBandResolver), never the
        // retired TierRevealModule — a balance-conditional reveal is the wrong product. Probe for
        // `bandCount(address)`: TierRevealModule has no such selector, so this discriminates them.
        address[] memory tiers = cr.getApprovedComponentsByTag(FeatureUtils.TIER);
        console.log("  tier modules:", tiers.length);
        for (uint256 i = 0; i < tiers.length; i++) {
            console.log("    ", tiers[i]);
            require(_isBandResolver(tiers[i]), "approved TIER module is not a band resolver");
        }
        require(resolvers.length > 0, "no metadata resolver approved");
        require(overlays.length > 0, "no overlay module approved");
        require(tiers.length > 0, "no tier module approved");
        console.log("");
    }

    /// @dev `getPreset` reverts `PresetNotActive` on an inactive preset, so preset activity is already
    ///      asserted by the read itself. What is asserted here is the curve-computer binding, and it
    ///      uses `isApprovedForTag` — the predicate the factory actually gates on. `isApprovedComponent`
    ///      is strictly weaker (`isApproved[c]` alone, without `componentTag[c] == tag`), so a component
    ///      approved under some other tag satisfies it while every `createInstance` reverts
    ///      `UnapprovedCurveComputer`.
    function _checkLaunchManager(address launchManagerAddr) internal view {
        console.log("-- LaunchManager presets --");
        console.log("  address:", launchManagerAddr);
        LaunchManager lm = LaunchManager(launchManagerAddr);
        ComponentRegistry cr = _componentRegistry();

        for (uint256 i = 0; i <= 2; i++) {
            LaunchManager.Preset memory preset = lm.getPreset(i);
            console.log("  preset", i);
            console.log("    active:", preset.active);
            console.log("    targetETH:", preset.targetETH);
            console.log("    curveComputer:", preset.curveComputer);
            require(
                preset.curveComputer != address(0),
                string.concat("preset ", vm.toString(i), ": curve computer is unset")
            );
            bool curveApproved = cr.isApprovedForTag(preset.curveComputer, CURVE_COMPUTER_TAG);
            console.log("    curveComputer approved for curve_computer tag:", curveApproved);
            require(
                curveApproved,
                string.concat(
                    "preset ", vm.toString(i), ": curve computer is not approved under the curve_computer tag"
                )
            );
        }
        console.log("");
    }
}

