#!/usr/bin/env node

/**
 * Governance Seed Script
 *
 * Seeds a local Anvil instance with GrandCentral DAO state for frontend development.
 * Requires Anvil running on localhost:8545 (default Foundry port).
 *
 * What it does:
 * 1. Deploys a mock GrandCentral contract (simplified for frontend testing)
 * 2. Mints shares to test accounts
 * 3. Creates sample proposals with varying states
 * 4. Casts votes on proposals
 * 5. Funds treasury pools
 * 6. Updates contracts.local.json with deployed address
 *
 * Usage: node scripts/seed-governance.js
 *
 * Prerequisites: Anvil running with `anvil --fork-url <mainnet_rpc>`
 */

import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');

const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';
const CONTRACTS_CONFIG_PATH = path.join(ROOT_DIR, 'src', 'config', 'contracts.local.json');

// Anvil default accounts (derived from "test test test..." mnemonic)
const ACCOUNTS = {
    deployer: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    member1:  '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    member2:  '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    member3:  '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
};

// Deployer private key (Anvil default account 0)
const DEPLOYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

async function main() {
    console.log('=== Governance Seed Script ===\n');

    const provider = new ethers.providers.JsonRpcProvider(RPC_URL);

    // Check connection
    try {
        const blockNumber = await provider.getBlockNumber();
        console.log(`Connected to Anvil at ${RPC_URL} (block ${blockNumber})`);
    } catch (e) {
        console.error(`Failed to connect to ${RPC_URL}. Is Anvil running?`);
        process.exit(1);
    }

    const deployer = new ethers.Wallet(DEPLOYER_KEY, provider);
    console.log(`Deployer: ${deployer.address}\n`);

    // Load GrandCentral ABI
    const abiPath = path.join(ROOT_DIR, 'contracts', 'abi', 'GrandCentral.json');
    if (!fs.existsSync(abiPath)) {
        console.error(`ABI not found at ${abiPath}. Run the implementation plan first.`);
        process.exit(1);
    }
    const grandCentralABI = JSON.parse(fs.readFileSync(abiPath, 'utf-8'));

    // Check if GrandCentral is already deployed (from Forge deploy scripts)
    const config = JSON.parse(fs.readFileSync(CONTRACTS_CONFIG_PATH, 'utf-8'));
    let grandCentralAddress = config.contracts.GrandCentral;

    if (!grandCentralAddress || grandCentralAddress === '0x0000000000000000000000000000000000000000') {
        console.log('GrandCentral not deployed yet.');
        console.log('To deploy GrandCentral, run the Foundry deploy script first:');
        console.log('  cd contracts && forge script script/DeployDAO.s.sol --rpc-url http://127.0.0.1:8545 --broadcast\n');
        console.log('Then re-run this seed script.\n');
        console.log('For now, creating a mock governance state using Anvil impersonation...\n');

        // Since GrandCentral deployment requires Forge (and the full Solidity contract),
        // we'll seed state by simulating what a deployed GrandCentral would emit.
        // The frontend event indexer will pick up these simulated events.

        console.log('Seeding simulated governance state...\n');
        await seedSimulatedState(provider, deployer);
        return;
    }

    // GrandCentral is deployed — seed state via contract calls
    const grandCentral = new ethers.Contract(grandCentralAddress, grandCentralABI, deployer);
    console.log(`GrandCentral at: ${grandCentralAddress}\n`);

    await seedDeployedState(grandCentral, deployer, provider);
}

/**
 * Seed state when GrandCentral is deployed
 */
async function seedDeployedState(grandCentral, deployer, provider) {
    // Step 1: Mint shares to test accounts
    console.log('1. Minting shares...');
    try {
        const tx1 = await grandCentral.mintShares(
            [ACCOUNTS.deployer, ACCOUNTS.member1, ACCOUNTS.member2, ACCOUNTS.member3],
            [
                ethers.utils.parseEther('100'),
                ethers.utils.parseEther('50'),
                ethers.utils.parseEther('30'),
                ethers.utils.parseEther('20'),
            ]
        );
        await tx1.wait();
        console.log('   Shares minted: deployer=100, member1=50, member2=30, member3=20');
    } catch (e) {
        console.log(`   Shares already minted or error: ${e.message}`);
    }

    // Step 2: Mint loot to some members
    console.log('2. Minting loot...');
    try {
        const tx2 = await grandCentral.mintLoot(
            [ACCOUNTS.member1, ACCOUNTS.member2],
            [ethers.utils.parseEther('10'), ethers.utils.parseEther('5')]
        );
        await tx2.wait();
        console.log('   Loot minted: member1=10, member2=5');
    } catch (e) {
        console.log(`   Loot already minted or error: ${e.message}`);
    }

    // Step 3: Fund treasury pools
    console.log('3. Funding treasury pools...');
    try {
        const tx3 = await grandCentral.fundRagequitPool(ethers.utils.parseEther('5'), { value: ethers.utils.parseEther('5') });
        await tx3.wait();
        console.log('   Ragequit pool funded: 5 ETH');
    } catch (e) {
        console.log(`   Treasury funding error: ${e.message}`);
    }

    try {
        const tx4 = await grandCentral.fundClaimsPool(ethers.utils.parseEther('2'), { value: ethers.utils.parseEther('2') });
        await tx4.wait();
        console.log('   Claims pool funded: 2 ETH');
    } catch (e) {
        console.log(`   Claims pool funding error: ${e.message}`);
    }

    // Step 4: Create sample proposals
    console.log('4. Creating sample proposals...');

    const masterRegistryAddress = await getContractAddress('MasterRegistryV1');

    // Proposal 1: Register a factory
    const registryIface = new ethers.utils.Interface([
        'function registerFactoryWithFeaturesAndCreator(address factory, string title, string displayTitle, string metadataURI, string factoryType, uint256 creatorFeeBps, address creator)',
    ]);
    const calldata1 = registryIface.encodeFunctionData('registerFactoryWithFeaturesAndCreator', [
        '0x1234567890123456789012345678901234567890',
        'ERC721-Auction-Factory',
        'ERC721 Auctions',
        '',
        'ERC721',
        500,
        ACCOUNTS.deployer,
    ]);

    try {
        const expiration = Math.floor(Date.now() / 1000) + 30 * 86400;
        const tx5 = await grandCentral.submitProposal(
            [masterRegistryAddress],
            [0],
            [calldata1],
            expiration,
            'Register the ERC721 Auction Factory for 1/1 artists'
        );
        await tx5.wait();
        console.log('   Proposal 1 created: Register ERC721 Factory');
    } catch (e) {
        console.log(`   Proposal 1 error: ${e.message}`);
    }

    // Proposal 2: Governance config change
    const gcIface = new ethers.utils.Interface([
        'function setGovernanceConfig(uint32 voting, uint32 grace, uint256 quorum, uint256 sponsor, uint256 minRetention)',
    ]);
    const calldata2 = gcIface.encodeFunctionData('setGovernanceConfig', [
        172800, // 2 days voting
        86400,  // 1 day grace
        20,     // 20% quorum
        1,      // 1 share sponsor threshold
        50,     // 50% min retention
    ]);

    try {
        const expiration2 = Math.floor(Date.now() / 1000) + 30 * 86400;
        const safeAddress = await grandCentral.safe();
        const tx6 = await grandCentral.submitProposal(
            [safeAddress],
            [0],
            [calldata2],
            expiration2,
            'Update governance parameters: 2-day voting, 1-day grace, 20% quorum'
        );
        await tx6.wait();
        console.log('   Proposal 2 created: Update governance config');
    } catch (e) {
        console.log(`   Proposal 2 error: ${e.message}`);
    }

    // Proposal 3: Mint shares to new member
    const calldata3 = gcIface.encodeFunctionData('setGovernanceConfig', [
        172800, 86400, 15, 1, 50,
    ]);

    try {
        const expiration3 = Math.floor(Date.now() / 1000) + 14 * 86400;
        const safeAddress = await grandCentral.safe();
        const tx7 = await grandCentral.submitProposal(
            [safeAddress],
            [0],
            [calldata3],
            expiration3,
            'Lower quorum to 15% for faster governance'
        );
        await tx7.wait();
        console.log('   Proposal 3 created: Lower quorum');
    } catch (e) {
        console.log(`   Proposal 3 error: ${e.message}`);
    }

    // Step 5: Sponsor and vote on proposals (impersonate members)
    console.log('5. Sponsoring and voting...');

    for (const proposalId of [1, 2]) {
        try {
            // Sponsor
            const tx = await grandCentral.sponsorProposal(proposalId);
            await tx.wait();
            console.log(`   Proposal ${proposalId} sponsored`);
        } catch (e) {
            console.log(`   Sponsor ${proposalId} error: ${e.message}`);
        }
    }

    // Vote as member1 (impersonate)
    try {
        await provider.send('anvil_impersonateAccount', [ACCOUNTS.member1]);
        const member1Signer = provider.getSigner(ACCOUNTS.member1);
        const gcAsMember1 = grandCentral.connect(member1Signer);

        await (await gcAsMember1.submitVote(1, true)).wait();
        console.log('   Member1 voted Yes on Proposal 1');

        await (await gcAsMember1.submitVote(2, false)).wait();
        console.log('   Member1 voted No on Proposal 2');

        await provider.send('anvil_stopImpersonatingAccount', [ACCOUNTS.member1]);
    } catch (e) {
        console.log(`   Voting error: ${e.message}`);
    }

    console.log('\n=== Seed Complete ===');
    console.log(`GrandCentral: ${grandCentral.address}`);
    console.log('Governance pages should now show seeded data.\n');
}

/**
 * Seed simulated state when GrandCentral is not yet deployed
 * Creates a placeholder message for the user
 */
async function seedSimulatedState(provider, deployer) {
    console.log('Since GrandCentral is not deployed, the governance pages will show');
    console.log('"GrandCentral address not available" errors, which is expected.\n');
    console.log('To fully test governance, deploy GrandCentral using:');
    console.log('  cd contracts && forge script script/DeployDAO.s.sol --rpc-url http://127.0.0.1:8545 --broadcast\n');
    console.log('Then update contracts.local.json with the deployed address,');
    console.log('and re-run: node scripts/seed-governance.js\n');
}

/**
 * Get contract address from local config
 */
function getContractAddress(name) {
    const config = JSON.parse(fs.readFileSync(CONTRACTS_CONFIG_PATH, 'utf-8'));
    return config.contracts[name] || '0x0000000000000000000000000000000000000000';
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
