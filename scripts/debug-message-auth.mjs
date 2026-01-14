#!/usr/bin/env node
/**
 * Debug Message Authorization
 *
 * Checks if ERC1155 instances are authorized in GlobalMessageRegistry
 * and authorizes them if needed.
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
    // Try forge output first
    const forgePath = path.join(__dirname, '..', 'contracts', 'out', `${name}.sol`, `${name}.json`);
    if (fs.existsSync(forgePath)) {
        const abiData = JSON.parse(fs.readFileSync(forgePath, 'utf8'));
        return abiData.abi || abiData;
    }

    // Fallback to abi directory
    const abiPath = path.join(__dirname, '..', 'contracts', 'abi', `${name}.json`);
    const abiData = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
    return abiData.abi || abiData;
}

async function main() {
    console.log('='.repeat(60));
    console.log('Message Authorization Debug');
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

    const messageRegistryAddress = config.contracts.GlobalMessageRegistry;
    console.log(`GlobalMessageRegistry: ${messageRegistryAddress}`);
    console.log();

    // Load GlobalMessageRegistry
    const messageRegistryABI = loadABI('GlobalMessageRegistry');
    const messageRegistry = new ethers.Contract(
        messageRegistryAddress,
        messageRegistryABI,
        signer
    );

    // Check all ERC1155 instances
    console.log('Checking ERC1155 instances...');
    console.log('-'.repeat(60));

    const instances = config.instances.erc1155 || [];

    if (instances.length === 0) {
        console.log('No ERC1155 instances found in config');
        return;
    }

    let needsAuthorization = [];

    for (const instance of instances) {
        const address = instance.address;
        const name = instance.name;

        console.log(`\nInstance: ${name}`);
        console.log(`Address: ${address}`);

        try {
            const isAuthorized = await messageRegistry.isAuthorized(address);
            console.log(`Authorized: ${isAuthorized ? '✓ YES' : '✗ NO'}`);

            if (!isAuthorized) {
                needsAuthorization.push({ address, name });
            }
        } catch (error) {
            console.error(`Error checking authorization: ${error.message}`);
        }
    }

    console.log();
    console.log('='.repeat(60));

    if (needsAuthorization.length === 0) {
        console.log('✓ All instances are authorized!');
        return;
    }

    console.log(`Found ${needsAuthorization.length} instance(s) that need authorization`);
    console.log();
    console.log('Authorizing instances...');
    console.log('-'.repeat(60));

    for (const instance of needsAuthorization) {
        console.log(`\nAuthorizing ${instance.name} (${instance.address})...`);

        try {
            const tx = await messageRegistry.authorizeInstance(instance.address);
            console.log(`Transaction sent: ${tx.hash}`);

            const receipt = await tx.wait();
            console.log(`✓ Authorized! (Block: ${receipt.blockNumber})`);
        } catch (error) {
            console.error(`✗ Failed to authorize: ${error.message}`);

            // Show more details if available
            if (error.error && error.error.message) {
                console.error(`  Reason: ${error.error.message}`);
            }
        }
    }

    console.log();
    console.log('='.repeat(60));
    console.log('Done!');
    console.log();
    console.log('You can now mint with messages.');
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('❌ Error:', error.message);
        console.error(error);
        process.exit(1);
    });
