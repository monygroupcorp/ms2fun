#!/usr/bin/env node
/**
 * Test Mint with Message
 *
 * Actually mints an edition with a message to test the full flow
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
    console.log('Test Mint with Message');
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

    const instances = config.instances.erc1155 || [];
    if (instances.length === 0) {
        console.log('❌ No ERC1155 instances found');
        return;
    }

    const instanceAddress = instances[0].address;
    const instanceName = instances[0].name;

    console.log(`Instance: ${instanceName}`);
    console.log(`Address: ${instanceAddress}`);
    console.log();

    // Load instance contract
    const erc1155InstanceABI = loadABI('ERC1155Instance');
    const instance = new ethers.Contract(
        instanceAddress,
        erc1155InstanceABI,
        signer
    );

    // Try to mint edition 1 with a message
    console.log('Attempting to mint Edition 1 with message...');
    console.log('Message: "Test message from debug script"');
    console.log();

    try {
        const editionId = 1;
        const amount = 1;
        const message = "Test message from debug script";

        // Calculate cost
        const cost = await instance.calculateMintCost(editionId, amount);
        console.log(`Cost: ${ethers.utils.formatEther(cost)} ETH`);

        // Attempt mint
        const tx = await instance.mint(
            editionId,
            amount,
            message,
            { value: cost }
        );

        console.log(`Transaction sent: ${tx.hash}`);
        console.log('Waiting for confirmation...');

        const receipt = await tx.wait();
        console.log(`✓ Transaction confirmed! Block: ${receipt.blockNumber}`);
        console.log();

        // Check if message was stored
        const messageRegistryAddress = config.contracts.GlobalMessageRegistry;
        const messageRegistryABI = loadABI('GlobalMessageRegistry');
        const messageRegistry = new ethers.Contract(
            messageRegistryAddress,
            messageRegistryABI,
            provider
        );

        const messageCount = await messageRegistry.getMessageCount();
        console.log(`Total messages in registry: ${messageCount}`);

        if (messageCount > 0) {
            const recentMessages = await messageRegistry.getRecentMessages(1);
            const latestMessage = recentMessages[0];
            console.log();
            console.log('Latest message:');
            console.log(`  Instance: ${latestMessage.instance}`);
            console.log(`  Sender: ${latestMessage.sender}`);
            console.log(`  Message: "${latestMessage.message}"`);
        }

        console.log();
        console.log('='.repeat(60));
        console.log('✓ Mint with message successful!');
        console.log('='.repeat(60));

    } catch (error) {
        console.error('❌ Mint failed!');
        console.error();
        console.error('Error:', error.message);

        if (error.error && error.error.message) {
            console.error('Reason:', error.error.message);
        }

        // Try to decode revert reason
        if (error.error && error.error.data) {
            console.error('Revert data:', error.error.data);
        }

        console.error();
        console.error('Full error:');
        console.error(error);
        process.exit(1);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('❌ Error:', error.message);
        console.error(error);
        process.exit(1);
    });
