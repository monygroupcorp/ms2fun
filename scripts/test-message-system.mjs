#!/usr/bin/env node
/**
 * Test Message System
 *
 * Tests the end-to-end message functionality:
 * 1. Connects to Anvil testnet
 * 2. Gets GlobalMessageRegistry address from MasterRegistry
 * 3. Queries recent messages
 * 4. Displays messages with unpacked metadata
 *
 * Usage: node scripts/test-message-system.mjs
 */

import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const ANVIL_RPC = 'http://127.0.0.1:8545';
const CHAIN_ID = 1337;

// Load ABIs
function loadABI(name) {
    const abiPath = path.join(__dirname, '..', 'contracts', 'abi', `${name}.json`);
    const abiData = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
    return abiData.abi || abiData;
}

// GlobalMessagePacking utility (matches contract implementation)
class GlobalMessagePacking {
    static unpack(packedData) {
        const bn = ethers.BigNumber.from(packedData);

        // Extract fields (reverse of packing order)
        const amount = bn.and(ethers.BigNumber.from('0xFFFFFFFFFFFFFFFFFFFFFFFF')); // uint96
        const contextId = bn.shr(96).and(ethers.BigNumber.from('0xFFFFFFFF')); // uint32
        const actionType = bn.shr(128).and(ethers.BigNumber.from('0xFF')); // uint8
        const factoryType = bn.shr(136).and(ethers.BigNumber.from('0xFF')); // uint8
        const timestamp = bn.shr(144).and(ethers.BigNumber.from('0xFFFFFFFF')); // uint32

        return {
            timestamp: timestamp.toNumber(),
            factoryType: factoryType.toNumber(),
            actionType: actionType.toNumber(),
            contextId: contextId.toNumber(),
            amount: amount.toString()
        };
    }

    static getFactoryTypeName(type) {
        const types = {
            0: 'Unknown',
            1: 'ERC1155',
            2: 'ERC404',
            3: 'Vault',
            4: 'Governance'
        };
        return types[type] || `Type ${type}`;
    }

    static getActionTypeName(type) {
        const types = {
            0: 'Unknown',
            1: 'Mint',
            2: 'Burn',
            3: 'Transfer',
            4: 'Deposit',
            5: 'Withdraw',
            6: 'Vote',
            7: 'Propose'
        };
        return types[type] || `Action ${type}`;
    }
}

async function main() {
    console.log('='.repeat(60));
    console.log('Message System Test');
    console.log('='.repeat(60));
    console.log();

    // Connect to Anvil
    console.log(`Connecting to Anvil at ${ANVIL_RPC}...`);
    const provider = new ethers.providers.JsonRpcProvider(ANVIL_RPC);

    // Verify connection
    const network = await provider.getNetwork();
    console.log(`✓ Connected to network (chainId: ${network.chainId})`);
    console.log();

    // Load MasterRegistry
    const masterRegistryABI = loadABI('MasterRegistryV1');

    // Get contract addresses from local config
    const configPath = path.join(__dirname, '..', 'src', 'config', 'contracts.local.json');
    if (!fs.existsSync(configPath)) {
        console.error('❌ Contract config not found. Please deploy contracts first.');
        console.error('   Expected: src/config/contracts.local.json');
        process.exit(1);
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const masterRegistryAddress = config.contracts.MasterRegistryV1;

    console.log(`MasterRegistry: ${masterRegistryAddress}`);

    const masterRegistry = new ethers.Contract(
        masterRegistryAddress,
        masterRegistryABI,
        provider
    );

    // Get GlobalMessageRegistry address
    console.log('Fetching GlobalMessageRegistry address...');
    const messageRegistryAddress = await masterRegistry.getGlobalMessageRegistry();
    console.log(`GlobalMessageRegistry: ${messageRegistryAddress}`);
    console.log();

    // Load GlobalMessageRegistry
    const messageRegistryABI = loadABI('GlobalMessageRegistry');
    const messageRegistry = new ethers.Contract(
        messageRegistryAddress,
        messageRegistryABI,
        provider
    );

    // Get total message count
    console.log('Querying message count...');
    const totalMessages = await messageRegistry.getMessageCount();
    console.log(`Total messages: ${totalMessages}`);
    console.log();

    if (totalMessages.eq(0)) {
        console.log('ℹ️  No messages found. Try minting an edition with a message first!');
        console.log();
        console.log('Instructions:');
        console.log('1. Navigate to http://localhost:3000/1337/demo-gallery/sunset-1');
        console.log('2. Check the "Add message" checkbox');
        console.log('3. Enter a test message (e.g., "Hello from MS2Fun!")');
        console.log('4. Click "Mint Edition"');
        console.log('5. Run this script again to see your message');
        console.log();
        process.exit(0);
    }

    // Get recent messages (up to 10)
    const messageCount = Math.min(totalMessages.toNumber(), 10);
    console.log(`Fetching ${messageCount} most recent message(s)...`);
    const messages = await messageRegistry.getRecentMessages(messageCount);
    console.log();

    // Display messages
    console.log('='.repeat(60));
    console.log('Recent Messages');
    console.log('='.repeat(60));
    console.log();

    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const unpacked = GlobalMessagePacking.unpack(msg.packedData);

        console.log(`Message #${i + 1}`);
        console.log('-'.repeat(60));
        console.log(`Instance:    ${msg.instance}`);
        console.log(`Sender:      ${msg.sender}`);
        console.log(`Message:     "${msg.message}"`);
        console.log();
        console.log('Metadata:');
        console.log(`  Timestamp:  ${new Date(unpacked.timestamp * 1000).toLocaleString()}`);
        console.log(`  Factory:    ${GlobalMessagePacking.getFactoryTypeName(unpacked.factoryType)}`);
        console.log(`  Action:     ${GlobalMessagePacking.getActionTypeName(unpacked.actionType)}`);
        console.log(`  Context:    Edition #${unpacked.contextId}`);
        console.log(`  Amount:     ${unpacked.amount}`);
        console.log();
    }

    console.log('='.repeat(60));
    console.log('✓ Message system test complete!');
    console.log('='.repeat(60));
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('❌ Error:', error.message);
        console.error(error);
        process.exit(1);
    });
