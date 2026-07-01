// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {MasterRegistryV1} from "../src/master/MasterRegistryV1.sol";
import {IMasterRegistry} from "../src/master/interfaces/IMasterRegistry.sol";
import {ComponentRegistry} from "../src/registry/ComponentRegistry.sol";
import {LaunchManager} from "../src/factories/erc404/LaunchManager.sol";
import {FeatureUtils} from "../src/master/libraries/FeatureUtils.sol";

/// @notice Read-only validation script. Checks all Sepolia protocol config
///         required for the ERC404 creation flow to work end-to-end.
///
///         Run with:
///         forge script script/ValidateSepolia.s.sol --rpc-url $SEPOLIA_RPC_URL
contract ValidateSepolia is Script {

    // ── Addresses ─────────────────────────────────────────────────────────
    address constant MASTER_REGISTRY     = 0x00001152CBa5fDB16A0FAE780fFebD5b9dF8e7cF;
    address constant COMPONENT_REGISTRY  = 0x00001152Ed1bD8e76693cB775c79708275bBb2F3;
    address constant LAUNCH_MANAGER      = 0x354768153a0d3edC314D9f6baa2fd56a6961B449;
    address constant ERC404_FACTORY      = 0xE57B69D9e27C5559Ae632e1a7EE9a941262181ba;

    ComponentRegistry cr = ComponentRegistry(COMPONENT_REGISTRY);
    LaunchManager lm     = LaunchManager(LAUNCH_MANAGER);
    MasterRegistryV1 mr  = MasterRegistryV1(MASTER_REGISTRY);

    /// @dev One `vaults` entry as emitted by DeployCore. Foundry maps JSON keys to struct fields in
    ///      ALPHABETICAL key order: address, alignmentToken, targetId, type.
    struct VaultRecord {
        address vaultAddress;
        address alignmentToken;
        uint256 targetId;
        string  vaultType;
    }

    function run() public view {
        console.log("\n=== Sepolia Protocol Validation ===\n");

        _checkFactory();
        _checkComponentRegistry();
        _checkLaunchManager();
        _checkVaults();

        console.log("\n=== Done ===");
    }

    /// @notice Assert every deployed alignment vault is registered, self-reports the expected
    ///         `vaultType()` discriminator, and — for the LP families — is operationally
    ///         liquidity-ready (pool key + validator wired, O2). Reads the `vaults` array from the
    ///         deployment JSON, so it covers whichever families the network config enabled: Uni-only
    ///         today, and all four (Yield + Uni/ZAMM/Cypher LP) once Sepolia's config promotes them.
    /// @dev Targets the current DeployCore output where `.vaults` is a JSON-encoded STRING (mirrors
    ///      SeedAnvil). Run against a fresh `deployments/sepolia.json` from the current DeployCore.
    function _checkVaults() internal view {
        console.log("-- Alignment vaults --");
        string memory json = vm.readFile("./deployments/sepolia.json");
        string memory vaultsJson = vm.parseJsonString(json, ".vaults");
        VaultRecord[] memory vaults = abi.decode(vm.parseJson(vaultsJson), (VaultRecord[]));
        console.log("  total vaults:", vaults.length);

        for (uint256 i = 0; i < vaults.length; i++) {
            address v = vaults[i].vaultAddress;
            require(mr.isVaultRegistered(v), "vault not registered");

            string memory onchainType = _readString(v, "vaultType()");
            string memory expected = _expectedType(vaults[i].vaultType);
            require(
                keccak256(bytes(onchainType)) == keccak256(bytes(expected)),
                "vaultType mismatch"
            );

            bool lp = _endsWithLP(onchainType);
            if (lp) require(_readBool(v, "isLiquidityReady()"), "LP vault not liquidity-ready");

            console.log("    ", v);
            console.log("      type:", onchainType);
        }
        console.log("");
    }

    /// @dev Map the deploy JSON's short vault tag to the on-chain vaultType() string.
    function _expectedType(string memory tag) internal pure returns (string memory) {
        bytes32 h = keccak256(bytes(tag));
        if (h == keccak256("UNIv4"))  return "UniswapV4LP";
        if (h == keccak256("ZAMM"))   return "ZAMMLP";
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

    function _checkFactory() internal view {
        console.log("-- ERC404Factory --");
        bool registered = mr.isFactoryRegistered(ERC404_FACTORY);
        console.log("  registered in MasterRegistry:", registered);
        if (registered) {
            IMasterRegistry.FactoryInfo memory info = MasterRegistryV1(MASTER_REGISTRY).getFactoryInfoByAddress(ERC404_FACTORY);
            console.log("  active:", info.active);
            console.log("  factoryId:", info.factoryId);
        }
        console.log("");
    }

    function _checkComponentRegistry() internal view {
        console.log("-- ComponentRegistry --");

        address[] memory all = cr.getApprovedComponents();
        console.log("  total approved:", all.length);

        address[] memory liquidityDeployers = cr.getApprovedComponentsByTag(FeatureUtils.LIQUIDITY_DEPLOYER);
        console.log("  liquidity deployers:", liquidityDeployers.length);
        for (uint256 i = 0; i < liquidityDeployers.length; i++) {
            console.log("    ", liquidityDeployers[i]);
        }

        address[] memory gatingModules = cr.getApprovedComponentsByTag(FeatureUtils.GATING);
        console.log("  gating modules:", gatingModules.length);
        for (uint256 i = 0; i < gatingModules.length; i++) {
            console.log("    ", gatingModules[i]);
        }

        address[] memory curveComputers = cr.getApprovedComponentsByTag(bytes32("curve_computer"));
        console.log("  curve computers:", curveComputers.length);
        for (uint256 i = 0; i < curveComputers.length; i++) {
            console.log("    ", curveComputers[i]);
        }

        address[] memory stakingModules = cr.getApprovedComponentsByTag(FeatureUtils.STAKING);
        console.log("  staking modules:", stakingModules.length);
        for (uint256 i = 0; i < stakingModules.length; i++) {
            console.log("    ", stakingModules[i]);
        }

        // Metadata-resolution stack (ADR-0006/0007) — resolver router + overlay + tier
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
        address[] memory tiers = cr.getApprovedComponentsByTag(FeatureUtils.TIER);
        console.log("  tier modules:", tiers.length);
        for (uint256 i = 0; i < tiers.length; i++) {
            console.log("    ", tiers[i]);
        }
        require(resolvers.length > 0, "no metadata resolver approved");
        require(overlays.length > 0, "no overlay module approved");
        require(tiers.length > 0, "no tier module approved");
        console.log("");
    }

    function _checkLaunchManager() internal view {
        console.log("-- LaunchManager presets --");
        for (uint256 i = 0; i <= 2; i++) {
            LaunchManager.Preset memory preset = lm.getPreset(i);
            console.log("  preset", i);
            console.log("    active:", preset.active);
            console.log("    targetETH:", preset.targetETH);
            console.log("    curveComputer:", preset.curveComputer);
            bool curveApproved = preset.curveComputer != address(0) &&
                cr.isApprovedComponent(preset.curveComputer);
            console.log("    curveComputer approved:", curveApproved);
        }
        console.log("");
    }
}

