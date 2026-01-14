#!/usr/bin/env node
/**
 * Debug Auto-Authorization
 *
 * Verifies that instances from approved factories are recognized
 * by the GlobalMessageRegistry's auto-authorization system
 */

import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const ANVIL_RPC = 'http://127.0.0.1:8545';

// Load ABIs from Forge output
function loadABI(name) {
    const forgePath = path.join(__dirname, '..', 'contracts', 'out', `${name}.sol`, `${name}.json`);
    if (fs.existsSync(forgePath)) {
        const abiData = JSON.parse(fs.readFileSync(forgePath, 'utf8'));
        return abiData.abi || abiData;
    }
    throw new Error(`ABI not found for ${name}`);
}

async function main() {
    console.log('='.repeat(60));
    console.log('Auto-Authorization Debug');
    console.log('='.repeat(60));
    console.log();

    // Connect to Anvil
    const provider = new ethers.providers.JsonRpcProvider(ANVIL_RPC);

    // Use default Anvil account (deployer)
    const privateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
    const signer = new ethers.Wallet(privateKey, provider);

    console.log(`Connected to Anvil`);
    console.log(`Signer address: ${signer.address}`);
    console.log();

    // Load contract addresses
    const configPath = path.join(__dirname, '..', 'src', 'config', 'contracts.local.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    const masterRegistryAddress = config.contracts.MasterRegistryV1;
    const messageRegistryAddress = config.contracts.GlobalMessageRegistry;
    const erc1155FactoryAddress = config.contracts.ERC1155Factory;

    console.log(`MasterRegistry: ${masterRegistryAddress}`);
    console.log(`GlobalMessageRegistry: ${messageRegistryAddress}`);
    console.log(`ERC1155Factory: ${erc1155FactoryAddress}`);
    console.log();

    // Load contracts
    const masterRegistryABI = loadABI('MasterRegistryV1');
    const messageRegistryABI = loadABI('GlobalMessageRegistry');

    const masterRegistry = new ethers.Contract(
        masterRegistryAddress,
        masterRegistryABI,
        signer
    );

    const messageRegistry = new ethers.Contract(
        messageRegistryAddress,
        messageRegistryABI,
        signer
    );

    // Check ERC1155 instances
    console.log('Checking ERC1155 instances...');
    console.log('-'.repeat(60));

    const instances = config.instances.erc1155 || [];

    if (instances.length === 0) {
        console.log('❌ No ERC1155 instances found in config');
        return;
    }

    for (const instance of instances) {
        const address = instance.address;
        const name = instance.name;

        console.log(`\n📦 Instance: ${name}`);
        console.log(`   Address: ${address}`);

        try {
            // Check if MasterRegistry has the isInstanceFromApprovedFactory method
            console.log('\n   Testing MasterRegistry.isInstanceFromApprovedFactory()...');
            const isFromApprovedFactory = await masterRegistry.isInstanceFromApprovedFactory(address);
            console.log(`   Result: ${isFromApprovedFactory ? '✓ YES' : '✗ NO'}`);

            if (!isFromApprovedFactory) {
                console.log('   ⚠️  Instance is NOT recognized as being from approved factory!');

                // Try to get factory info
                try {
                    const factoryAddress = await masterRegistry.getInstanceFactory(address);
                    console.log(`   Factory address: ${factoryAddress}`);

                    // Check if that factory is registered
                    const factoryInfo = await masterRegistry.getFactoryInfo(factoryAddress);
                    console.log(`   Factory registered: ${factoryInfo.isRegistered || factoryInfo[0]}`);
                } catch (err) {
                    console.log(`   ⚠️  Could not get factory info: ${err.message}`);
                }
            }

            // Test if we can call addMessage
            console.log('\n   Testing GlobalMessageRegistry.addMessage()...');

            // Create a test packed data
            const packedData = ethers.BigNumber.from(0); // Minimal packed data for test

            try {
                // This will revert if not authorized, but we just want to see the error
                await messageRegistry.callStatic.addMessage(
                    address,        // instance
                    signer.address, // sender
                    packedData,     // packed data
                    "test message"  // message
                );
                console.log('   ✓ addMessage would succeed (authorized)');
            } catch (error) {
                if (error.message.includes('Not from approved factory')) {
                    console.log('   ✗ addMessage would fail: Not from approved factory');
                } else {
                    console.log(`   ⚠️  addMessage error: ${error.message}`);
                }
            }

        } catch (error) {
            console.error(`   ❌ Error checking instance: ${error.message}`);
        }
    }

    console.log();
    console.log('='.repeat(60));
    console.log('Debug complete');
    console.log('='.repeat(60));
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('❌ Error:', error.message);
        console.error(error);
        process.exit(1);
    });
