// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {UltraAlignmentVault} from "../src/vaults/UltraAlignmentVault.sol";
import {ERC404Factory} from "../src/factories/erc404/ERC404Factory.sol";
import {ERC1155Factory} from "../src/factories/erc1155/ERC1155Factory.sol";

/**
 * @title DeployLocalPhase2
 * @notice Phase 2: Deploy factories and templates
 * @dev Assumes Phase 1 contracts (MasterRegistry, GlobalMessageRegistry) already deployed
 */
contract DeployLocalPhase2 is Script {
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

    function run() external {
        // Use Anvil's default unlocked account
        address deployer = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;

        // Load Phase 1 addresses from environment or use defaults
        address masterRegistry = vm.envOr("MASTER_REGISTRY", address(0xf69D69EEC78B08eaf48deAC029bF233C4918331F));
        address messageRegistry = vm.envOr("MESSAGE_REGISTRY", address(0x88B1d1c6F4E930efe66dc65EAC1331350C1a5745));

        console.log("=== Phase 2: Factory Deployment ===");
        console.log("Deployer:", deployer);
        console.log("MasterRegistry:", masterRegistry);
        console.log("");

        vm.startBroadcast(deployer);

        // 1. Deploy Vault Template
        console.log("1. Deploying UltraAlignmentVault template...");
        UltraAlignmentVault vaultTemplate = new UltraAlignmentVault(
            WETH,
            UNISWAP_V4_POOL_MANAGER,
            UNISWAP_V3_ROUTER,
            UNISWAP_V2_ROUTER,
            UNISWAP_V2_FACTORY,
            UNISWAP_V3_FACTORY,
            deployer // alignmentToken (using deployer as placeholder)
        );
        console.log("   UltraAlignmentVault:", address(vaultTemplate));

        // 2. Deploy ERC404Factory (without template for now - will be added in Phase 3)
        console.log("2. Deploying ERC404Factory...");
        console.log("   (Deferred: Requires complex ERC404 template)");
        address erc404Factory = address(0); // Placeholder

        // 3. Deploy ERC1155Factory (without template for now - will be added in Phase 3)
        console.log("3. Deploying ERC1155Factory...");
        console.log("   (Deferred: Requires ERC1155 template)");
        address erc1155Factory = address(0); // Placeholder

        vm.stopBroadcast();

        // 4. Write updated config file
        console.log("");
        console.log("=== Writing config file ===");
        _writeConfigFile(
            masterRegistry,
            messageRegistry,
            address(vaultTemplate),
            erc404Factory,
            erc1155Factory
        );

        console.log("");
        console.log("=== Phase 2 Complete ===");
        console.log("Next: Phase 3 will add instance templates and seeding");
    }

    function _writeConfigFile(
        address masterRegistry,
        address messageRegistry,
        address vaultTemplate,
        address erc404Factory,
        address erc1155Factory
    ) internal {
        string memory json = string(abi.encodePacked(
            '{\n',
            '  "generatedAt": "', vm.toString(block.timestamp), '",\n',
            '  "chainId": 1337,\n',
            '  "mode": "local-fork",\n',
            '  "contracts": {\n',
            '    "MasterRegistryV1": "', _toChecksumString(masterRegistry), '",\n',
            '    "GlobalMessageRegistry": "', _toChecksumString(messageRegistry), '",\n',
            '    "UltraAlignmentVault": "', _toChecksumString(vaultTemplate), '"'
        ));

        if (erc404Factory != address(0)) {
            json = string(abi.encodePacked(json, ',\n    "ERC404Factory": "', _toChecksumString(erc404Factory), '"'));
        }

        if (erc1155Factory != address(0)) {
            json = string(abi.encodePacked(json, ',\n    "ERC1155Factory": "', _toChecksumString(erc1155Factory), '"'));
        }

        json = string(abi.encodePacked(
            json,
            '\n  },\n',
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
            '  "_comment": "Phase 2: Added vault template. Factories and instances deferred to Phase 3."\n',
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
