// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Script, console } from "forge-std/Script.sol";
import { MasterRegistryV1 } from "../src/master/MasterRegistryV1.sol";
import { IMasterRegistry } from "../src/master/interfaces/IMasterRegistry.sol";
import { ComponentRegistry } from "../src/registry/ComponentRegistry.sol";
import { LaunchManager } from "../src/factories/erc404/LaunchManager.sol";
import { LaunchPresets } from "./LaunchPresets.sol";
import { FeatureUtils } from "../src/master/libraries/FeatureUtils.sol";

/// @notice Read-only validation script. Checks all Sepolia protocol config
///         required for the ERC404 creation flow to work end-to-end.
///
///         Run with:
///         forge script script/ValidateSepolia.s.sol --rpc-url $SEPOLIA_RPC_URL
contract ValidateSepolia is Script {
    // ── Addresses ─────────────────────────────────────────────────────────
    // Every protocol address this script interrogates is read from the deployment record the deploy
    // run wrote; none is pinned. The CREATE3 proxies (MasterRegistry, ComponentRegistry) are
    // stable only for a fixed salt set, and a salt is single-use per deployer (CreateX reverts
    // `CreateCollision` once the proxy address carries code), so a redeploy lands on fresh
    // addresses. LaunchManager and ERC404Factory are deployed with plain `new` in `DeployCore` and
    // are nonce-derived.
    string constant DEPLOYMENT_PATH = "./deployments/sepolia.json";

    /// @dev Sepolia. The external-dependency block below asserts against addresses that only exist
    ///      on this chain, so it runs only when the script is pointed at a Sepolia RPC.
    uint256 constant SEPOLIA_CHAIN_ID = 11155111;

    /// @dev ZAMM V1. A CREATE2 singleton whose address is chain-independent by convention, which
    ///      does not guarantee it is deployed on a given chain. Source: `DeploySepolia.s.sol`
    ///      (`cfg.zamm`); `DeployCore` does not write it to the deployment record, so it is mirrored
    ///      here. zRouter is in the record (`.contracts.zRouter`) and is read from there.
    address constant ZAMM_V1 = 0x000000000000040470635EB91b7CE4D132D616eD;

    /// @dev The tag `ERC404Factory` requires of a preset's curve computer: the raw literal bytes
    ///      `bytes32("curve_computer")`, not a keccak hash. Matches `ERC404Factory` and the
    ///      `approveComponent` call in `DeployCore`.
    bytes32 constant CURVE_COMPUTER_TAG = bytes32("curve_computer");

    /// @dev One `vaults` entry as emitted by DeployCore. Foundry maps JSON keys to struct fields in
    ///      ALPHABETICAL key order: address, alignmentToken, targetId, type.
    struct VaultRecord {
        address vaultAddress;
        address alignmentToken;
        uint256 targetId;
        string vaultType;
    }

    /// @notice Asserts every condition that gates `ERC404Factory.createInstance`, so a misconfigured
    ///         deployment exits non-zero; the logs are the operator-facing report.
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
    // `virtual` so a test can point the validator at a locally deployed protocol and an in-memory
    // deployment record.

    /// @dev The deployment record the addresses and the vault list are read from.
    function _deploymentJson() internal view virtual returns (string memory) {
        return vm.readFile(DEPLOYMENT_PATH);
    }

    function _masterRegistry() internal view virtual returns (MasterRegistryV1) {
        return MasterRegistryV1(_recordAddress(_deploymentJson(), ".contracts.MasterRegistry", "MasterRegistry"));
    }

    function _componentRegistry() internal view virtual returns (ComponentRegistry) {
        return ComponentRegistry(_recordAddress(_deploymentJson(), ".contracts.ComponentRegistry", "ComponentRegistry"));
    }

    /// @dev Read one address out of the deployment record. A missing key reverts inside
    ///      `parseJsonAddress`; a zero or codeless entry is rejected here. A record that cannot
    ///      supply an address stops the run.
    function _recordAddress(string memory json, string memory key, string memory label)
        internal
        view
        returns (address addr)
    {
        addr = vm.parseJsonAddress(json, key);
        require(addr != address(0), string.concat(label, ": deployment record holds the zero address"));
        require(addr.code.length > 0, string.concat(label, ": no code at the address in the deployment record"));
    }

    /// @notice Assert every deployed alignment vault is registered, reports the expected
    ///         `vaultType()`, and, for the LP families, is liquidity-ready (pool key + validator
    ///         wired).
    /// @dev Reads the `vaults` array from the deployment JSON, so it covers whichever families the
    ///      network config enabled. `.vaults` is a JSON-encoded string in the DeployCore output
    ///      (as in SeedAnvil).
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
    /// @dev ZAMM and zRouter are third-party CREATE2 singletons pinned by address, unlike the
    ///      protocol contracts the deployment record implies. If either is codeless on the target
    ///      chain, call sites decode empty returndata and revert: every `BestRouteAcquirer` leg, the
    ///      fixed-pool fallback for an alignment-vault acquisition, and every graduated ERC-404
    ///      swap. Fork tests inherit mainnet state, where both exist, so only the live chain
    ///      exposes it.
    ///
    ///      Chain-gated: these are Sepolia addresses, and this block is the only part of the script
    ///      that reads state outside the deployment record. Off Sepolia it logs that it was skipped.
    function _checkExternalDependencies(string memory json) internal view {
        console.log("-- External dependencies --");
        if (block.chainid != SEPOLIA_CHAIN_ID) {
            console.log("  skipped: not running against Sepolia (chainid", block.chainid, ")");
            console.log("");
            return;
        }

        // zRouter comes from the record, so the check matches the address wired into the launch
        // deployers and vault factories.
        _checkExternalDep(_recordAddress(json, ".contracts.zRouter", "zRouter"), "zRouter");
        _checkExternalDep(ZAMM_V1, "ZAMM V1");
        // `SepoliaRouteQuoter` is deployed by `DeploySepolia`, not a third-party singleton. A
        // codeless address here does not fail loudly: `BestRouteAcquirer` degrades every acquire
        // to the fixed pool and the best-route path silently never runs.
        _checkExternalDep(_recordAddress(json, ".contracts.zQuoter", "zQuoter"), "zQuoter (best-route)");
        console.log("");
    }

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
        return "AaveEndowment"; // the "AaveEndowment" tag is the on-chain string
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

    /// @dev True when `target` exposes `bandCount(address)` returning a uint256, the
    ///      TokenTierBandResolver fingerprint. The length is checked before decoding because a
    ///      return-data decode failure is not catchable by try/catch.
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

        // Metadata-resolution stack: resolver router, overlay, tier bands
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
        // The TIER tag must carry the static band resolver (TokenTierBandResolver), not a
        // balance-conditional reveal module. `bandCount(address)` discriminates them.
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

    /// @dev `getPreset` reverts `PresetNotActive` on an inactive preset, so the read asserts
    ///      activity. The curve-computer binding uses `isApprovedForTag`, the predicate the factory
    ///      gates on; `isApprovedComponent` is weaker (no `componentTag[c] == tag`), so a component
    ///      approved under another tag passes it while every `createInstance` reverts
    ///      `UnapprovedCurveComputer`.
    ///
    ///      The economics are asserted against `LaunchPresets`, the ladder this repo ships. A preset
    ///      is read once at create and written into the instance's bonding params, so a chain on a
    ///      different rung still creates collections, permanently capped by that rung's
    ///      `unitPerNFT`, and `setPreset` cannot reach them afterwards.
    function _checkLaunchManager(address launchManagerAddr) internal view {
        console.log("-- LaunchManager presets --");
        console.log("  address:", launchManagerAddr);
        LaunchManager lm = LaunchManager(launchManagerAddr);
        ComponentRegistry cr = _componentRegistry();

        for (uint256 i = 0; i < LaunchPresets.COUNT; i++) {
            LaunchManager.Preset memory preset = lm.getPreset(i);
            LaunchManager.Preset memory shipped = LaunchPresets.preset(i, preset.curveComputer);
            console.log("  preset", i);
            console.log("    active:", preset.active);
            console.log("    targetETH:", preset.targetETH);
            console.log("    unitPerNFT:", preset.unitPerNFT);
            console.log("    max pieces a collection may have:", LaunchPresets.maxNftSupply(preset.unitPerNFT));
            console.log("    liquidityReserveBps:", preset.liquidityReserveBps);
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
            require(
                preset.unitPerNFT == shipped.unitPerNFT,
                string.concat(
                    "preset ",
                    vm.toString(i),
                    ": on-chain unitPerNFT is ",
                    vm.toString(preset.unitPerNFT),
                    " (a ceiling of ",
                    vm.toString(LaunchPresets.maxNftSupply(preset.unitPerNFT)),
                    " pieces), but this repo ships ",
                    vm.toString(shipped.unitPerNFT),
                    " (",
                    vm.toString(LaunchPresets.maxNftSupply(shipped.unitPerNFT)),
                    " pieces). The owner must setPreset before any collection is created under it."
                )
            );
            require(
                preset.targetETH == shipped.targetETH,
                string.concat(
                    "preset ",
                    vm.toString(i),
                    ": on-chain targetETH is ",
                    vm.toString(preset.targetETH),
                    ", but this repo ships ",
                    vm.toString(shipped.targetETH)
                )
            );
            require(
                preset.liquidityReserveBps == shipped.liquidityReserveBps,
                string.concat(
                    "preset ",
                    vm.toString(i),
                    ": on-chain liquidityReserveBps is ",
                    vm.toString(preset.liquidityReserveBps),
                    ", but this repo ships ",
                    vm.toString(shipped.liquidityReserveBps)
                )
            );
        }
        console.log("");
    }
}

