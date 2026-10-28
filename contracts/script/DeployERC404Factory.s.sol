// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Script, console } from "forge-std/Script.sol";
import { MasterRegistryV1 } from "../src/master/MasterRegistryV1.sol";
import { ERC404Factory } from "../src/factories/erc404/ERC404Factory.sol";
import { ERC404BondingInstance } from "../src/factories/erc404/ERC404BondingInstance.sol";
import { ERC404BondingOps } from "../src/factories/erc404/ERC404BondingOps.sol";

/// @notice Deploys a new ERC404BondingInstance implementation + ERC404Factory against an existing
///         deployment, wires the protocol treasury, and registers the factory in MasterRegistry.
///         A full protocol deploy is `DeploySepolia`.
///
///         Every protocol address is read from the deployment record `DeploySepolia` wrote, so the
///         script targets whichever deployment that file describes. No protocol address is pinned: a
///         CREATE3 proxy address is a function of the salt set in use, and a salt is single-use per
///         deployer (CreateX reverts `CreateCollision` once the proxy address carries code).
///
///         Run with:
///         forge script script/DeployERC404Factory.s.sol \
///           --account <keystore> \
///           --sender <the deployer named in the record> \
///           --rpc-url $SEPOLIA_RPC_URL \
///           --broadcast --verify
contract DeployERC404Factory is Script {
    /// @dev The deployment record this script reads every protocol address from.
    string constant DEPLOYMENT_PATH = "./deployments/sepolia.json";

    /// @dev Sepolia WETH9. A network fixture that `DeployCore` takes from the network config and
    ///      does not write to the record, so it is mirrored here from `cfg.weth` in `DeploySepolia.s.sol`.
    address constant WETH = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;

    function run() public {
        string memory json = vm.readFile(DEPLOYMENT_PATH);

        address masterRegistry = _recordAddress(json, ".contracts.MasterRegistry", "MasterRegistry");
        address globalMsgRegistry = _recordAddress(json, ".contracts.GlobalMessageRegistry", "GlobalMessageRegistry");
        address componentRegistry = _recordAddress(json, ".contracts.ComponentRegistry", "ComponentRegistry");
        address launchManager = _recordAddress(json, ".contracts.LaunchManager", "LaunchManager");
        address protocolTreasury = _recordAddress(json, ".contracts.ProtocolTreasury", "ProtocolTreasury");
        address deployer = vm.parseJsonAddress(json, ".deployer");
        require(deployer != address(0), "deployment record: deployer is the zero address");

        console.log("MasterRegistry:   ", masterRegistry);
        console.log("ComponentRegistry:", componentRegistry);
        console.log("LaunchManager:    ", launchManager);
        console.log("ProtocolTreasury: ", protocolTreasury);

        vm.startBroadcast();

        // 1. Implementation
        ERC404BondingOps ops = new ERC404BondingOps();
        ERC404BondingInstance impl = new ERC404BondingInstance(address(ops));
        console.log("ERC404BondingInstance impl:", address(impl));

        // 2. Factory
        ERC404Factory factory = new ERC404Factory(
            ERC404Factory.CoreConfig({
                implementation: address(impl), masterRegistry: masterRegistry, protocol: deployer, weth: WETH
            }),
            ERC404Factory.ModuleConfig({
                globalMessageRegistry: globalMsgRegistry,
                launchManager: launchManager,
                componentRegistry: componentRegistry
            })
        );
        console.log("ERC404Factory:", address(factory));

        factory.setProtocolTreasury(protocolTreasury);
        console.log("Treasury set");

        // 3. Register in MasterRegistry
        MasterRegistryV1(masterRegistry)
            .registerFactory(
                address(factory),
                "ERC404",
                "ERC404-Bonding-Curve-Factory",
                "ERC404 Bonding Curve",
                "https://ms2.fun",
                new bytes32[](0),
                address(0) // first-party platform factory, no external builder to credit
            );
        console.log("Factory registered");

        vm.stopBroadcast();
    }

    /// @dev A missing key reverts inside `parseJsonAddress`; a zero or codeless entry is rejected
    ///      here, so a record that cannot supply an address stops the run.
    function _recordAddress(string memory json, string memory key, string memory label)
        internal
        view
        returns (address addr)
    {
        addr = vm.parseJsonAddress(json, key);
        require(addr != address(0), string.concat(label, ": deployment record holds the zero address"));
        require(addr.code.length > 0, string.concat(label, ": no code at the address in the deployment record"));
    }
}
