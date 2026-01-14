// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {MasterRegistryV1} from "../src/master/MasterRegistryV1.sol";
import {MasterRegistry} from "../src/master/MasterRegistry.sol";
import {GlobalMessageRegistry} from "../src/registry/GlobalMessageRegistry.sol";
import {UltraAlignmentVault} from "../src/vaults/UltraAlignmentVault.sol";

contract DeployLocal is Script {
    // Mainnet addresses (available on fork)
    address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;

    // Uniswap V4 (Mainnet)
    address constant UNISWAP_V4_POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address constant UNISWAP_V4_POSITION_MANAGER = 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e;
    address constant UNISWAP_V4_QUOTER = 0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203;

    // Uniswap V3
    address constant UNISWAP_V3_ROUTER = 0xE592427A0AEce92De3Edee1F18E0157C05861564;
    address constant UNISWAP_V3_FACTORY = 0x1F98431c8aD98523631AE4a59f267346ea31F984;

    // Uniswap V2
    address constant UNISWAP_V2_ROUTER = 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D;
    address constant UNISWAP_V2_FACTORY = 0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f;

    // Mock EXEC token for local testing (we'll use deployer as placeholder)
    address execToken;

    function run() external {
        // Use Anvil's default unlocked account
        address deployer = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;

        vm.startBroadcast(deployer);

        // For local testing, use deployer address as EXEC token placeholder
        execToken = deployer;

        console.log("=== Deploying MS2Fun Contracts ===");
        console.log("Deployer:", deployer);
        console.log("");

        // 1. Deploy MasterRegistry (with proxy)
        console.log("1. Deploying MasterRegistry...");
        MasterRegistryV1 masterImpl = new MasterRegistryV1();
        bytes memory masterInitData = abi.encodeWithSelector(
            MasterRegistryV1.initialize.selector,
            execToken,
            deployer
        );
        MasterRegistry masterProxy = new MasterRegistry(address(masterImpl), masterInitData);
        address masterRegistry = address(masterProxy);
        console.log("   MasterRegistryV1:", masterRegistry);

        // 2. Deploy GlobalMessageRegistry
        console.log("2. Deploying GlobalMessageRegistry...");
        GlobalMessageRegistry messageRegistry = new GlobalMessageRegistry(deployer, masterRegistry);
        console.log("   GlobalMessageRegistry:", address(messageRegistry));

        // 3. Deploy Governance contracts (auto-deployed by MasterRegistry)
        console.log("3. Governance contracts...");
        console.log("   (Auto-deployed by MasterRegistry initialization)");

        // 4. Additional contracts (deferred to later phases)
        console.log("4. Additional contracts...");
        console.log("   (Deferred: Vault, factories require EXEC token and complex templates)");

        vm.stopBroadcast();

        // 5. Write config file
        console.log("");
        console.log("=== Writing config file ===");
        _writeConfigFile(
            masterRegistry,
            address(messageRegistry)
        );

        console.log("");
        console.log("=== Deployment Complete (Phase 1) ===");
        console.log("Next: Deploy EXEC token, then vaults and factories");
    }

    function _writeConfigFile(
        address masterRegistry,
        address messageRegistry
    ) internal {
        string memory json = string(abi.encodePacked(
            '{\n',
            '  "generatedAt": "', vm.toString(block.timestamp), '",\n',
            '  "chainId": 1337,\n',
            '  "mode": "local-fork",\n',
            '  "contracts": {\n',
            '    "MasterRegistryV1": "', _toChecksumString(masterRegistry), '",\n',
            '    "GlobalMessageRegistry": "', _toChecksumString(messageRegistry), '"\n',
            '  },\n',
            '  "uniswap": {\n',
            '    "v4PoolManager": "0x000000000004444c5dc75cB358380D2e3dE08A90",\n',
            '    "v4PositionManager": "0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e",\n',
            '    "v3Router": "0xE592427A0AEce92De3Edee1F18E0157C05861564",\n',
            '    "v2Router": "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",\n',
            '    "weth": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"\n',
            '  },\n',
            '  "instances": {\n',
            '    "erc404": [],\n',
            '    "erc1155": []\n',
            '  },\n',
            '  "vaults": [],\n',
            '  "testAccounts": {\n',
            '    "owner": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",\n',
            '    "trader": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",\n',
            '    "collector": "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",\n',
            '    "governance": "0x90F79bf6EB2c4f870365E785982E1f101E93b906"\n',
            '  },\n',
            '  "_comment": "Phase 1: Core infrastructure. Uniswap V4 addresses included for reference."\n',
            '}'
        ));

        // Write to frontend config directory
        vm.writeFile("../src/config/contracts.local.json", json);
        console.log("   Config written to: src/config/contracts.local.json");
    }

    function _toChecksumString(address addr) internal pure returns (string memory) {
        return vm.toString(addr);
    }
}
