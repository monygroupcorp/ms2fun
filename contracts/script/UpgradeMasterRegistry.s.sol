// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Script, console } from "forge-std/Script.sol";
import { MasterRegistryV1 } from "../src/master/MasterRegistryV1.sol";

/// @notice Upgrades the MasterRegistryV1 proxy of an EXISTING deployment to a freshly deployed
///         implementation, and optionally deactivates a superseded factory and revokes an instance.
///
///         The proxy address comes from the deployment record `DeploySepolia` wrote — it is not
///         pinned here, because a CREATE3 proxy address is a function of the salt set in use and a
///         redeploy runs a fresh salt set (a salt is single-use per deployer: CreateX reverts
///         `CreateCollision` once its proxy address carries code).
///
///         The two clean-up targets are per-run inputs rather than constants, because which factory
///         is superseded and which instance is being revoked differ on every run. Both are optional:
///         unset (or the zero address) skips that step.
///
///         Run with:
///         OLD_ERC404_FACTORY=0x... REVOKE_INSTANCE=0x... \
///         forge script script/UpgradeMasterRegistry.s.sol \
///           --account <keystore> \
///           --sender <the deployer named in the record> \
///           --rpc-url <sepolia-rpc> \
///           --broadcast --verify
contract UpgradeMasterRegistry is Script {
    /// @dev The deployment record the proxy address is read from.
    string constant DEPLOYMENT_PATH = "./deployments/sepolia.json";

    function run() public {
        string memory json = vm.readFile(DEPLOYMENT_PATH);
        address proxyAddr = vm.parseJsonAddress(json, ".contracts.MasterRegistry");
        require(proxyAddr != address(0), "MasterRegistry: deployment record holds the zero address");
        require(proxyAddr.code.length > 0, "MasterRegistry: no code at the address in the deployment record");
        MasterRegistryV1 proxy = MasterRegistryV1(proxyAddr);
        console.log("MasterRegistry proxy:", proxyAddr);

        address oldFactory = vm.envOr("OLD_ERC404_FACTORY", address(0));
        address revokeInstance = vm.envOr("REVOKE_INSTANCE", address(0));

        vm.startBroadcast();

        // 1. Deploy new implementation
        MasterRegistryV1 newImpl = new MasterRegistryV1();
        console.log("New implementation:", address(newImpl));

        // 2. Upgrade proxy
        proxy.upgradeToAndCall(address(newImpl), "");
        console.log("Proxy upgraded");

        // 3. Deactivate the superseded factory, when one was named
        if (oldFactory != address(0)) {
            proxy.deactivateFactory(oldFactory);
            console.log("Factory deactivated:", oldFactory);
        } else {
            console.log("OLD_ERC404_FACTORY unset - no factory deactivated");
        }

        // 4. Revoke the named instance, when one was named
        if (revokeInstance != address(0)) {
            proxy.revokeInstance(revokeInstance);
            console.log("Instance revoked:", revokeInstance);
        } else {
            console.log("REVOKE_INSTANCE unset - no instance revoked");
        }

        vm.stopBroadcast();
    }
}
