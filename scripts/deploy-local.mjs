#!/usr/bin/env node

import { promises as fs } from "fs";
import { ethers } from "ethers";
import { mineHookSalt, decodeHookFlags, isValidUltraAlignmentHookAddress } from "./lib/hookSaltMiner.mjs";

// Configuration
const RPC_URL_LOCAL = "http://127.0.0.1:8545";
const CONFIG_PATH = "src/config/contracts.local.json";

// User address from environment (required)
const USER_ADDRESS = process.env.USER_ADDRESS;
if (!USER_ADDRESS) {
    console.error("❌ USER_ADDRESS environment variable is required");
    console.error("   Set it to your wallet address to interact with the local chain");
    console.error("   Example: USER_ADDRESS=0x... npm run chain:start");
    process.exit(1);
}

// Anvil default accounts
const DEPLOYER_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const DEPLOYER_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

// Test accounts (Anvil defaults)
const TEST_ACCOUNTS = {
    owner: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    trader: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    collector: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    governance: "0x90F79bf6EB2c4f870365E785982E1f101E93b906"
};

// Mainnet addresses (available on fork)
const MAINNET_ADDRESSES = {
    execToken: "0x185485bF2e26e0Da48149aee0A8032c8c2060Db2",
    ms2Token: "0x98Ed411B8cf8536657c660Db8aA55D9D4bAAf820",
    cultToken: "0x0000000000c5dc95539589fbD24BE07c6C14eCa4",
    weth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    uniswapV4PoolManager: "0x000000000004444c5dc75cB358380D2e3dE08A90",
    uniswapV4PositionManager: "0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e",
    uniswapV4Quoter: "0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203",
    uniswapV3Router: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
    uniswapV3Factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
    uniswapV2Router: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
    uniswapV2Factory: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f"
};

// ═══════════════════════════════════════════════════════════
// SEEDING HELPERS
// ═══════════════════════════════════════════════════════════

/**
 * Create an ERC404 bonding curve instance
 * @param {object} params - Creation parameters
 * @param {string} params.name - Token name (no spaces, use hyphens)
 * @param {string} params.symbol - Token symbol
 * @param {string} params.maxSupply - Max supply in ether units
 * @param {number} params.liquidityReservePercent - 0-100
 * @param {string} params.creator - Creator address
 * @param {string} params.vault - Vault address
 * @param {string} params.hook - Hook address
 * @param {object} params.factory - ERC404Factory ethers contract
 * @param {number} params.nonce - Transaction nonce
 * @param {object} params.deployer - Deployer wallet
 * @returns {Promise<{instance: string, nonce: number}>}
 */
async function createERC404Instance({
    name,
    symbol,
    maxSupply,
    liquidityReservePercent,
    creator,
    vault,
    hook,
    factory,
    nonce,
    deployer
}) {
    // Default bonding curve params (can be customized per instance)
    const curveParams = {
        initialPrice: ethers.utils.parseEther("0.0001"),     // 0.0001 ETH
        quarticCoeff: ethers.utils.parseEther("0.00000001"), // Very small
        cubicCoeff: ethers.utils.parseEther("0.0000001"),
        quadraticCoeff: ethers.utils.parseEther("0.000001"),
        normalizationFactor: ethers.utils.parseEther("1000000")
    };

    // Default tier config (1 tier, public password)
    const tierConfig = {
        tierType: 0, // VOLUME_CAP
        passwordHashes: [ethers.utils.keccak256(ethers.utils.toUtf8Bytes("PUBLIC"))], // 1 tier, password "PUBLIC" = open access
        volumeCaps: [ethers.utils.parseEther(maxSupply)], // Cap = maxSupply (effectively unlimited)
        tierUnlockTimes: []
    };

    // Instance fee only
    const instanceFee = ethers.utils.parseEther("0.01");

    const createTx = await factory.createInstance(
        name,
        symbol,
        `https://ms2.fun/metadata/${name.toLowerCase()}/`,
        ethers.utils.parseEther(maxSupply),
        liquidityReservePercent,
        curveParams,
        tierConfig,
        creator,
        vault,
        hook,
        "", // styleUri
        { nonce: nonce++, value: instanceFee }
    );

    const receipt = await createTx.wait();
    const event = receipt.events?.find(e => e.event === "InstanceCreated");
    const instance = event?.args?.instance;

    return { instance, nonce };
}

// Sample messages for seeding activity
const BUY_MESSAGES = [
    "LFG! 🚀",
    "Early and often",
    "This project is going places",
    "Adding to my position",
    "Bullish on this one",
    "Great team, great vision",
    "Diamond hands 💎",
    "WAGMI",
    "In it for the long haul",
    "Love the art direction",
    "Community is everything",
    "Building something special here",
    "First time buyer, excited!",
    "Increasing my stack",
    "Can't stop, won't stop"
];

const MINT_MESSAGES = [
    "Beautiful piece!",
    "Added to my collection",
    "Love this artist's work",
    "Supporting creators 🎨",
    "This one speaks to me",
    "Instant classic",
    "Had to grab one",
    "The details are incredible",
    "Been waiting for this drop",
    "My favorite so far",
    "Art that matters",
    "Proud to own this",
    "Supporting the vision",
    "This is the one",
    "Collector's item for sure"
];

function getRandomMessage(messages) {
    return messages[Math.floor(Math.random() * messages.length)];
}

/**
 * Buy tokens on bonding curve
 * @param {object} params - Buy parameters
 * @param {string} params.instanceAddress - ERC404 instance address
 * @param {object} params.instanceAbi - ERC404 instance ABI
 * @param {string} params.buyer - Buyer address (from TEST_ACCOUNTS)
 * @param {string} params.tokenAmount - Token amount to buy (in ether units)
 * @param {object} params.provider - Ethers provider
 * @returns {Promise<void>}
 */
async function buyOnBondingCurve({ instanceAddress, instanceAbi, buyer, tokenAmount, provider }) {
    const buyerSigner = provider.getSigner(buyer);
    const instance = new ethers.Contract(instanceAddress, instanceAbi, buyerSigner);

    const amount = ethers.utils.parseEther(tokenAmount);
    const cost = await instance.calculateCost(amount);

    // Add 10% buffer for slippage
    const maxCost = cost.mul(110).div(100);

    const buyTx = await instance.buyBonding(
        amount,
        maxCost,
        true, // mintNFT
        ethers.constants.HashZero, // public tier (no password)
        getRandomMessage(BUY_MESSAGES)
    , { value: maxCost });
    await buyTx.wait();
}

/**
 * Set bonding curve active and open
 * @param {object} params - Activation parameters
 * @param {string} params.instanceAddress - ERC404 instance address
 * @param {object} params.instanceAbi - ERC404 instance ABI
 * @param {object} params.deployer - Deployer wallet (instance owner)
 * @param {number} params.nonce - Transaction nonce
 * @returns {Promise<number>} Updated nonce
 */
async function activateBondingCurve({ instanceAddress, instanceAbi, deployer, nonce }) {
    const instance = new ethers.Contract(instanceAddress, instanceAbi, deployer);

    // Set bonding open time to now
    const openTimeTx = await instance.setBondingOpenTime(
        Math.floor(Date.now() / 1000),
        { nonce: nonce++ }
    );
    await openTimeTx.wait();

    // Set maturity time to 30 days from now
    const maturityTimeTx = await instance.setBondingMaturityTime(
        Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        { nonce: nonce++ }
    );
    await maturityTimeTx.wait();

    // Set bonding active
    const activeTx = await instance.setBondingActive(true, { nonce: nonce++ });
    await activeTx.wait();

    return nonce;
}

const main = async () => {
    console.log("📜 MS2Fun Local Deployment Script");
    console.log("🎯 Following deployment order: MasterRegistry → GlobalMessages → Vaults → Factories");
    console.log("");

    try {
        // Connect to Anvil fork
        const provider = new ethers.providers.JsonRpcProvider(RPC_URL_LOCAL);

        // Verify connection
        try {
            await provider.getNetwork();
            console.log("✅ Connected to Anvil fork");
        } catch (err) {
            throw new Error("Failed to connect to Anvil. Is it running on port 8545?");
        }

        // Set up deployer wallet
        const deployer = new ethers.Wallet(DEPLOYER_PRIVATE_KEY, provider);
        let nonce = await deployer.getTransactionCount();
        console.log(`✅ Deployer: ${deployer.address} (nonce: ${nonce})`);
        console.log("");

        // Fund test accounts and user
        console.log("💰 Funding accounts...");
        await provider.send("anvil_setBalance", [TEST_ACCOUNTS.trader, "0x56BC75E2D63100000"]); // 100 ETH
        await provider.send("anvil_setBalance", [TEST_ACCOUNTS.collector, "0x56BC75E2D63100000"]);
        await provider.send("anvil_setBalance", [TEST_ACCOUNTS.governance, "0x56BC75E2D63100000"]);
        await provider.send("anvil_setBalance", [USER_ADDRESS, "0x56BC75E2D63100000"]); // 100 ETH for user
        console.log(`  ✓ Funded trader: ${TEST_ACCOUNTS.trader}`);
        console.log(`  ✓ Funded collector: ${TEST_ACCOUNTS.collector}`);
        console.log(`  ✓ Funded governance: ${TEST_ACCOUNTS.governance}`);
        console.log(`  ✓ Funded user: ${USER_ADDRESS}`);
        console.log("");

        console.log("═══════════════════════════════════════════════════════");
        console.log("PHASE 1: MASTER REGISTRY SYSTEM");
        console.log("═══════════════════════════════════════════════════════");
        console.log("");

        // STEP 1: Deploy MasterRegistryV1 implementation
        console.log("STEP 1: Deploying MasterRegistryV1 implementation...");
        const masterImplArtifact = JSON.parse(
            await fs.readFile("./contracts/out/MasterRegistryV1.sol/MasterRegistryV1.json", "utf8")
        );
        const MasterImplFactory = new ethers.ContractFactory(
            masterImplArtifact.abi,
            masterImplArtifact.bytecode.object,
            deployer
        );
        const masterImpl = await MasterImplFactory.deploy({ nonce: nonce++ });
        await masterImpl.deployed();
        const masterImplAddress = masterImpl.address;
        console.log(`   ✓ MasterRegistryV1 implementation: ${masterImplAddress}`);
        console.log("");

        // STEP 2: Deploy MasterRegistry proxy with initialization
        console.log("STEP 2: Deploying MasterRegistry proxy...");

        // Encode initialization: initialize(execToken, owner)
        const initData = masterImpl.interface.encodeFunctionData("initialize", [
            MAINNET_ADDRESSES.execToken,  // EXEC token from mainnet
            deployer.address              // Owner (dictator)
        ]);

        const masterProxyArtifact = JSON.parse(
            await fs.readFile("./contracts/out/MasterRegistry.sol/MasterRegistry.json", "utf8")
        );
        const MasterProxyFactory = new ethers.ContractFactory(
            masterProxyArtifact.abi,
            masterProxyArtifact.bytecode.object,
            deployer
        );

        const masterProxy = await MasterProxyFactory.deploy(
            masterImplAddress,
            initData,
            { nonce: nonce++ }
        );
        await masterProxy.deployed();
        const masterRegistryOuterAddress = masterProxy.address;
        console.log(`   ✓ MasterRegistry (outer): ${masterRegistryOuterAddress}`);

        // Get the actual inner ERC1967 proxy address
        const actualProxyAddress = await masterProxy.getProxyAddress();
        console.log(`   ✓ MasterRegistry (inner ERC1967): ${actualProxyAddress}`);
        console.log(`   ℹ️  Auto-deployed: FactoryApprovalGovernance + VaultApprovalGovernance`);

        // IMPORTANT: Connect to the inner proxy directly, not the outer contract
        // This ensures msg.sender is the deployer, not the outer MasterRegistry contract
        const masterRegistryAddress = actualProxyAddress;
        const masterRegistry = new ethers.Contract(
            masterRegistryAddress,
            masterImplArtifact.abi,
            deployer
        );

        // Verify dictator was set correctly
        const actualDictator = await masterRegistry.dictator();
        console.log(`   ✓ Dictator set to: ${actualDictator}`);
        console.log(`   ✓ Deployer address: ${deployer.address}`);
        console.log(`   ✓ Match: ${actualDictator.toLowerCase() === deployer.address.toLowerCase()}`);
        console.log("");

        // STEP 3: Deploy GlobalMessageRegistry
        console.log("STEP 3: Deploying GlobalMessageRegistry...");
        const messageRegistryArtifact = JSON.parse(
            await fs.readFile("./contracts/out/GlobalMessageRegistry.sol/GlobalMessageRegistry.json", "utf8")
        );
        const MessageRegistryFactory = new ethers.ContractFactory(
            messageRegistryArtifact.abi,
            messageRegistryArtifact.bytecode.object,
            deployer
        );
        const messageRegistry = await MessageRegistryFactory.deploy(
            deployer.address,     // owner
            masterRegistryAddress, // masterRegistry (for auto-authorization)
            { nonce: nonce++ }
        );
        await messageRegistry.deployed();
        const messageRegistryAddress = messageRegistry.address;
        console.log(`   ✓ GlobalMessageRegistry: ${messageRegistryAddress}`);

        // Register GlobalMessageRegistry in MasterRegistry
        console.log("   Registering GlobalMessageRegistry in MasterRegistry...");
        const setRegistryTx = await masterRegistry.setGlobalMessageRegistry(
            messageRegistryAddress,
            { nonce: nonce++ }
        );
        await setRegistryTx.wait();
        console.log(`   ✓ GlobalMessageRegistry registered in MasterRegistry`);
        console.log("");

        // STEP 4: Deploy FeaturedQueueManager (optional but included)
        console.log("STEP 4: Deploying FeaturedQueueManager...");
        const queueManagerArtifact = JSON.parse(
            await fs.readFile("./contracts/out/FeaturedQueueManager.sol/FeaturedQueueManager.json", "utf8")
        );
        const QueueManagerFactory = new ethers.ContractFactory(
            queueManagerArtifact.abi,
            queueManagerArtifact.bytecode.object,
            deployer
        );
        const queueManager = await QueueManagerFactory.deploy({ nonce: nonce++ });
        await queueManager.deployed();
        const queueManagerAddress = queueManager.address;
        console.log(`   ✓ FeaturedQueueManager deployed: ${queueManagerAddress}`);

        // Initialize queue manager
        const queueManagerContract = new ethers.Contract(
            queueManagerAddress,
            queueManagerArtifact.abi,
            deployer
        );
        const initQueueTx = await queueManagerContract.initialize(
            masterRegistryAddress,
            deployer.address,
            { nonce: nonce++ }
        );
        await initQueueTx.wait();
        console.log(`   ✓ FeaturedQueueManager initialized`);
        console.log("");

        console.log("═══════════════════════════════════════════════════════");
        console.log("PHASE 2: HOOK FACTORY & VAULT INFRASTRUCTURE");
        console.log("═══════════════════════════════════════════════════════");
        console.log("");

        // STEP 5: Deploy UltraAlignmentHookFactory (must be deployed before vaults)
        console.log("STEP 5: Deploying UltraAlignmentHookFactory...");
        const hookFactoryArtifact = JSON.parse(
            await fs.readFile("./contracts/out/UltraAlignmentHookFactory.sol/UltraAlignmentHookFactory.json", "utf8")
        );
        const HookFactoryFactory = new ethers.ContractFactory(
            hookFactoryArtifact.abi,
            hookFactoryArtifact.bytecode.object,
            deployer
        );
        const hookFactory = await HookFactoryFactory.deploy(
            ethers.constants.AddressZero,  // hookTemplate (factory creates via new, not clone)
            { nonce: nonce++ }
        );
        await hookFactory.deployed();
        const hookFactoryAddress = hookFactory.address;
        console.log(`   ✓ UltraAlignmentHookFactory: ${hookFactoryAddress}`);
        console.log("");

        // Load UltraAlignmentV4Hook bytecode for salt mining
        const hookArtifact = JSON.parse(
            await fs.readFile("./contracts/out/UltraAlignmentV4Hook.sol/UltraAlignmentV4Hook.json", "utf8")
        );
        const hookCreationCode = hookArtifact.bytecode.object;

        // WORKAROUND: createVaultWithHook doesn't support off-chain salt mining because
        // the vault address isn't predictable. Using two-step process instead:
        // 1. Deploy vault directly
        // 2. Mine salt using known vault address
        // 3. Create hook via createHook and manually link

        // Load vault artifact
        const vaultArtifact = JSON.parse(
            await fs.readFile("./contracts/out/UltraAlignmentVault.sol/UltraAlignmentVault.json", "utf8")
        );
        const VaultFactory = new ethers.ContractFactory(
            vaultArtifact.abi,
            vaultArtifact.bytecode.object,
            deployer
        );

        const hookFactoryContract = new ethers.Contract(
            hookFactoryAddress,
            hookFactoryArtifact.abi,
            deployer
        );

        // Helper to mine salt for a specific vault address
        async function mineHookSaltForVault(vaultAddr, creator, vaultName) {
            console.log(`   ⛏️  Mining hook salt for ${vaultName}...`);
            const result = await mineHookSalt({
                hookFactoryAddress: hookFactoryAddress,
                hookCreationCode: hookCreationCode,
                poolManager: MAINNET_ADDRESSES.uniswapV4PoolManager,
                vault: vaultAddr,
                weth: MAINNET_ADDRESSES.weth,
                creator: creator,
                onProgress: (iterations, rate) => {
                    console.log(`      ... ${iterations.toLocaleString()} iterations (${rate.toLocaleString()}/sec)`);
                }
            });
            console.log(`   ✓ Found valid salt in ${result.iterations.toLocaleString()} iterations (${result.timeSeconds.toFixed(2)}s)`);
            const flags = decodeHookFlags(result.address);
            console.log(`   ✓ Hook flags: ${flags.rawFlags} (afterSwap: ${flags.afterSwap}, afterSwapReturnDelta: ${flags.afterSwapReturnDelta})`);
            return result.salt;
        }

        // STEP 5b: Deploy UltraAlignmentVault (MS2-aligned)
        console.log("STEP 5b: Deploying UltraAlignmentVault (MS2-aligned)...");
        const vault = await VaultFactory.deploy(
            MAINNET_ADDRESSES.weth,
            MAINNET_ADDRESSES.uniswapV4PoolManager,
            MAINNET_ADDRESSES.uniswapV3Router,
            MAINNET_ADDRESSES.uniswapV2Router,
            MAINNET_ADDRESSES.uniswapV2Factory,
            MAINNET_ADDRESSES.uniswapV3Factory,
            MAINNET_ADDRESSES.ms2Token,  // alignment token: MS2
            { nonce: nonce++ }
        );
        await vault.deployed();
        const vaultAddress = vault.address;
        console.log(`   ✓ UltraAlignmentVault (MS2): ${vaultAddress}`);

        // Mine salt for MS2 vault hook (now we know the vault address)
        const ms2VaultSalt = await mineHookSaltForVault(vaultAddress, deployer.address, "MS2-Vault");

        // Create hook via hookFactory.createHook
        const hookFee = await hookFactoryContract.hookCreationFee();
        const createMS2HookTx = await hookFactoryContract.createHook(
            MAINNET_ADDRESSES.uniswapV4PoolManager,
            vaultAddress,
            MAINNET_ADDRESSES.weth,
            deployer.address,
            true,  // isCanonical
            ms2VaultSalt,
            { nonce: nonce++, value: hookFee }
        );
        const ms2HookReceipt = await createMS2HookTx.wait();
        const ms2HookEvent = ms2HookReceipt.events?.find(e => e.event === "HookCreated");
        const ms2HookAddress = ms2HookEvent?.args?.hook;
        console.log(`   ✓ Hook: ${ms2HookAddress}`);
        console.log("");

        // STEP 5c: Deploy SimpleVault (CULT-aligned)
        console.log("STEP 5c: Deploying SimpleVault (CULT-aligned)...");
        const simpleVault = await VaultFactory.deploy(
            MAINNET_ADDRESSES.weth,
            MAINNET_ADDRESSES.uniswapV4PoolManager,
            MAINNET_ADDRESSES.uniswapV3Router,
            MAINNET_ADDRESSES.uniswapV2Router,
            MAINNET_ADDRESSES.uniswapV2Factory,
            MAINNET_ADDRESSES.uniswapV3Factory,
            MAINNET_ADDRESSES.cultToken,  // alignment token: CULT
            { nonce: nonce++ }
        );
        await simpleVault.deployed();
        const simpleVaultAddress = simpleVault.address;
        console.log(`   ✓ SimpleVault (CULT): ${simpleVaultAddress}`);

        // Mine salt for CULT vault hook
        const cultVaultSalt = await mineHookSaltForVault(simpleVaultAddress, deployer.address, "CULT-Vault");

        // Create hook via hookFactory.createHook
        const createCULTHookTx = await hookFactoryContract.createHook(
            MAINNET_ADDRESSES.uniswapV4PoolManager,
            simpleVaultAddress,
            MAINNET_ADDRESSES.weth,
            deployer.address,
            true,  // isCanonical
            cultVaultSalt,
            { nonce: nonce++, value: hookFee }
        );
        const cultHookReceipt = await createCULTHookTx.wait();
        const cultHookEvent = cultHookReceipt.events?.find(e => e.event === "HookCreated");
        const cultHookAddress = cultHookEvent?.args?.hook;
        console.log(`   ✓ Hook: ${cultHookAddress}`);
        console.log("");

        // STEP 6: Register Vault using dictator powers
        console.log("STEP 6: Registering vault (dictator approval)...");

        // masterRegistry already created earlier after proxy deployment
        const registerVaultTx = await masterRegistry.registerVault(
            vaultAddress,
            "UltraAlignmentVault",
            "https://ms2.fun/metadata/vault/ultra-alignment",
            { nonce: nonce++, value: ethers.utils.parseEther("0.05") }
        );
        await registerVaultTx.wait();
        console.log(`   ✓ Vault registered in MasterRegistry`);
        console.log("");

        // STEP 6b: Register SimpleVault
        console.log("STEP 6b: Registering SimpleVault (dictator approval)...");
        const registerSimpleVaultTx = await masterRegistry.registerVault(
            simpleVaultAddress,
            "SimpleVault",
            "https://ms2.fun/metadata/vault/simple",
            { nonce: nonce++, value: ethers.utils.parseEther("0.05") }
        );
        await registerSimpleVaultTx.wait();
        console.log(`   ✓ SimpleVault registered in MasterRegistry`);
        console.log("");

        console.log("═══════════════════════════════════════════════════════");
        console.log("PHASE 3: PROJECT FACTORIES");
        console.log("═══════════════════════════════════════════════════════");
        console.log("");

        // STEP 7: Deploy ERC1155Factory
        console.log("STEP 7: Deploying ERC1155Factory...");
        const erc1155FactoryArtifact = JSON.parse(
            await fs.readFile("./contracts/out/ERC1155Factory.sol/ERC1155Factory.json", "utf8")
        );
        const ERC1155FactoryFactory = new ethers.ContractFactory(
            erc1155FactoryArtifact.abi,
            erc1155FactoryArtifact.bytecode.object,
            deployer
        );
        const erc1155Factory = await ERC1155FactoryFactory.deploy(
            masterRegistryAddress,
            ethers.constants.AddressZero,  // instanceTemplate (factory uses new, not clone)
            { nonce: nonce++ }
        );
        await erc1155Factory.deployed();
        const erc1155FactoryAddress = erc1155Factory.address;
        console.log(`   ✓ ERC1155Factory: ${erc1155FactoryAddress}`);
        console.log("");

        // STEP 8: Deploy ERC404Factory
        console.log("STEP 8: Deploying ERC404Factory...");
        const erc404FactoryArtifact = JSON.parse(
            await fs.readFile("./contracts/out/ERC404Factory.sol/ERC404Factory.json", "utf8")
        );
        const ERC404FactoryFactory = new ethers.ContractFactory(
            erc404FactoryArtifact.abi,
            erc404FactoryArtifact.bytecode.object,
            deployer
        );
        const erc404Factory = await ERC404FactoryFactory.deploy(
            masterRegistryAddress,
            ethers.constants.AddressZero,  // instanceTemplate (factory uses new, not clone)
            MAINNET_ADDRESSES.uniswapV4PoolManager,
            MAINNET_ADDRESSES.weth,
            { nonce: nonce++ }
        );
        await erc404Factory.deployed();
        const erc404FactoryAddress = erc404Factory.address;
        console.log(`   ✓ ERC404Factory: ${erc404FactoryAddress}`);
        console.log("");

        console.log("═══════════════════════════════════════════════════════");
        console.log("PHASE 4: FACTORY REGISTRATION");
        console.log("═══════════════════════════════════════════════════════");
        console.log("");

        // STEP 10: Register factories using dictator powers
        console.log("STEP 10: Registering factories (dictator approval)...");

        const registerERC404Tx = await masterRegistry.registerFactory(
            erc404FactoryAddress,
            "ERC404",
            "ERC404-Bonding-Curve-Factory",  // No spaces - only alphanumeric, hyphens, underscores
            "ERC404 Bonding Curve",           // Display title can have spaces
            "https://ms2.fun/metadata/factory/erc404",
            { nonce: nonce++ }
        );
        await registerERC404Tx.wait();
        console.log(`   ✓ ERC404Factory registered (Factory ID: 1)`);

        const registerERC1155Tx = await masterRegistry.registerFactory(
            erc1155FactoryAddress,
            "ERC1155",
            "ERC1155-Edition-Factory",        // No spaces - only alphanumeric, hyphens, underscores
            "ERC1155 Editions",                // Display title can have spaces
            "https://ms2.fun/metadata/factory/erc1155",
            { nonce: nonce++ }
        );
        await registerERC1155Tx.wait();
        console.log(`   ✓ ERC1155Factory registered (Factory ID: 2)`);
        console.log("");

        console.log("═══════════════════════════════════════════════════════");
        console.log("PHASE 6: SAMPLE INSTANCE (OPTIONAL)");
        console.log("═══════════════════════════════════════════════════════");
        console.log("");

        // STEP 11: Create sample ERC1155 instance
        console.log("STEP 11: Creating sample ERC1155 instance...");

        const erc1155FactoryContract = new ethers.Contract(
            erc1155FactoryAddress,
            erc1155FactoryArtifact.abi,
            deployer
        );

        const createInstanceTx = await erc1155FactoryContract.createInstance(
            "Demo-Gallery",                                          // name (no spaces!)
            "https://ms2.fun/metadata/demo-gallery/",              // metadataURI
            deployer.address,                                       // creator
            vaultAddress,                                           // vault
            "",                                                     // styleUri (empty)
            { nonce: nonce++, value: ethers.utils.parseEther("0.01") }
        );
        const createReceipt = await createInstanceTx.wait();

        // Get instance address from event
        const instanceCreatedEvent = createReceipt.events?.find(e => e.event === "InstanceCreated");
        const instanceAddress = instanceCreatedEvent?.args?.instance;

        if (!instanceAddress) {
            throw new Error("Failed to get instance address from InstanceCreated event");
        }

        console.log(`   ✓ ERC1155 Instance: ${instanceAddress}`);
        console.log(`     Name: "Demo-Gallery"`);
        console.log(`     Vault: ${vaultAddress}`);
        console.log("");

        // Create editions in the instance
        console.log("STEP 12: Creating sample editions...");
        const erc1155InstanceArtifact = JSON.parse(
            await fs.readFile("./contracts/out/ERC1155Instance.sol/ERC1155Instance.json", "utf8")
        );
        const erc1155Instance = new ethers.Contract(
            instanceAddress,
            erc1155InstanceArtifact.abi,
            deployer
        );

        // Edition 1: Genesis-Piece (unlimited, 0.01 ETH, fixed price)
        // PricingModel: 0 = UNLIMITED
        const edition1Tx = await erc1155Instance.addEdition(
            "Genesis-Piece",                                        // pieceTitle
            ethers.utils.parseEther("0.01"),                       // basePrice
            0,                                                      // supply (0 = unlimited)
            "https://ms2.fun/metadata/demo-gallery/1.json",       // metadataURI
            0,                                                      // pricingModel (UNLIMITED)
            0,                                                      // priceIncreaseRate (not used for fixed)
            { nonce: nonce++ }
        );
        await edition1Tx.wait();
        console.log(`   ✓ Edition 1: "Genesis-Piece" (0.01 ETH, unlimited, fixed price)`);

        // Edition 2: Limited-Drop (100 max, 0.02 ETH, fixed price)
        // PricingModel: 1 = LIMITED_FIXED
        const edition2Tx = await erc1155Instance.addEdition(
            "Limited-Drop",                                         // pieceTitle
            ethers.utils.parseEther("0.02"),                       // basePrice
            100,                                                    // supply (max 100)
            "https://ms2.fun/metadata/demo-gallery/2.json",       // metadataURI
            1,                                                      // pricingModel (LIMITED_FIXED)
            0,                                                      // priceIncreaseRate (not used for fixed)
            { nonce: nonce++ }
        );
        await edition2Tx.wait();
        console.log(`   ✓ Edition 2: "Limited-Drop" (0.02 ETH, max 100, fixed price)`);
        console.log("");

        // Mint some sample tokens
        console.log("STEP 13: Minting sample tokens...");

        // Mint 3x Edition 1 to deployer
        const mint1Tx = await erc1155Instance.mint(
            1,   // editionId
            3,   // quantity
            getRandomMessage(MINT_MESSAGES),
            { nonce: nonce++, value: ethers.utils.parseEther("0.03") }
        );
        await mint1Tx.wait();
        console.log(`   ✓ Minted 3x Edition 1 to deployer`);

        // Mint 2x Edition 2 to trader
        const traderSigner = provider.getSigner(TEST_ACCOUNTS.trader);
        const erc1155AsTrader = erc1155Instance.connect(traderSigner);
        const mint2Tx = await erc1155AsTrader.mint(
            2,   // editionId
            2,   // quantity
            getRandomMessage(MINT_MESSAGES),
            { value: ethers.utils.parseEther("0.04") }
        );
        await mint2Tx.wait();
        console.log(`   ✓ Minted 2x Edition 2 to trader`);
        console.log("");

        console.log("═══════════════════════════════════════════════════════");
        console.log("PHASE 5: ERC404 INSTANCE SEEDING");
        console.log("═══════════════════════════════════════════════════════");
        console.log("");

        // Load ERC404 instance ABI for interaction
        const erc404InstanceArtifact = JSON.parse(
            await fs.readFile("./contracts/out/ERC404BondingInstance.sol/ERC404BondingInstance.json", "utf8")
        );

        // Instance 1: Early Launch (10% bonding progress)
        // Note: Vault already has its hook configured (created via createVaultWithHook)
        console.log("STEP 12: Creating ERC404 'Early-Launch' instance...");
        const erc404FactoryContract = new ethers.Contract(
            erc404FactoryAddress,
            erc404FactoryArtifact.abi,
            deployer
        );

        const earlyLaunch = await createERC404Instance({
            name: "Early-Launch",
            symbol: "EARLY",
            maxSupply: "10000",
            liquidityReservePercent: 20,
            creator: deployer.address,
            vault: vaultAddress,
            hook: ms2HookAddress,
            factory: erc404FactoryContract,
            nonce: nonce,
            deployer: deployer
        });
        nonce = earlyLaunch.nonce;
        console.log(`   ✓ Early-Launch: ${earlyLaunch.instance}`);

        // Activate bonding curve
        nonce = await activateBondingCurve({
            instanceAddress: earlyLaunch.instance,
            instanceAbi: erc404InstanceArtifact.abi,
            deployer: deployer,
            nonce: nonce
        });
        console.log(`   ✓ Bonding curve activated`);

        // Seed 5 small purchases to reach ~10% progress
        // 10% of 10,000 = 1,000 tokens, so buy 200 tokens each from 5 accounts
        const earlyBuyers = [
            { address: TEST_ACCOUNTS.trader, tokens: "200" },
            { address: TEST_ACCOUNTS.collector, tokens: "200" },
            { address: TEST_ACCOUNTS.governance, tokens: "200" },
            { address: deployer.address, tokens: "200" },
            { address: TEST_ACCOUNTS.trader, tokens: "200" }
        ];

        for (const buyer of earlyBuyers) {
            await buyOnBondingCurve({
                instanceAddress: earlyLaunch.instance,
                instanceAbi: erc404InstanceArtifact.abi,
                buyer: buyer.address,
                tokenAmount: buyer.tokens,
                provider: provider
            });
        }
        console.log(`   ✓ Seeded 5 purchases (~10% bonding progress)`);
        console.log("");

        // Instance 2: Active Project (60% bonding progress)
        console.log("STEP 13: Creating ERC404 'Active-Project' instance...");

        // Refresh nonce after buy transactions (deployer may have bought)
        nonce = await deployer.getTransactionCount();

        const activeProject = await createERC404Instance({
            name: "Active-Project",
            symbol: "ACTIVE",
            maxSupply: "10000",
            liquidityReservePercent: 20,
            creator: deployer.address,
            vault: vaultAddress,
            hook: ms2HookAddress,
            factory: erc404FactoryContract,
            nonce: nonce,
            deployer: deployer
        });
        nonce = activeProject.nonce;
        console.log(`   ✓ Active-Project: ${activeProject.instance}`);

        nonce = await activateBondingCurve({
            instanceAddress: activeProject.instance,
            instanceAbi: erc404InstanceArtifact.abi,
            deployer: deployer,
            nonce: nonce
        });

        // Seed purchases to reach ~60% progress (4800 tokens out of 8000 bonding supply)
        // 8000 = 10000 - 20% liquidity reserve
        const activeBuyers = [
            { address: TEST_ACCOUNTS.trader, tokens: "400" },
            { address: TEST_ACCOUNTS.collector, tokens: "400" },
            { address: TEST_ACCOUNTS.governance, tokens: "400" },
            { address: deployer.address, tokens: "400" },
            { address: TEST_ACCOUNTS.trader, tokens: "400" },
            { address: TEST_ACCOUNTS.collector, tokens: "400" },
            { address: TEST_ACCOUNTS.governance, tokens: "400" },
            { address: TEST_ACCOUNTS.trader, tokens: "400" },
            { address: TEST_ACCOUNTS.collector, tokens: "400" },
            { address: TEST_ACCOUNTS.governance, tokens: "400" },
            { address: deployer.address, tokens: "400" },
            { address: TEST_ACCOUNTS.trader, tokens: "400" }
        ];

        for (const buyer of activeBuyers) {
            await buyOnBondingCurve({
                instanceAddress: activeProject.instance,
                instanceAbi: erc404InstanceArtifact.abi,
                buyer: buyer.address,
                tokenAmount: buyer.tokens,
                provider: provider
            });
        }
        console.log(`   ✓ Seeded 12 purchases (~60% bonding progress)`);
        console.log("");

        // Instance 3: Graduated (liquidity deployed)
        console.log("STEP 14: Creating ERC404 'Graduated' instance...");

        // Refresh nonce after buy transactions
        nonce = await deployer.getTransactionCount();

        const graduated = await createERC404Instance({
            name: "Graduated",
            symbol: "GRAD",
            maxSupply: "10000",
            liquidityReservePercent: 20,
            creator: deployer.address,
            vault: vaultAddress,
            hook: ms2HookAddress,
            factory: erc404FactoryContract,
            nonce: nonce,
            deployer: deployer
        });
        nonce = graduated.nonce;
        console.log(`   ✓ Graduated: ${graduated.instance}`);

        nonce = await activateBondingCurve({
            instanceAddress: graduated.instance,
            instanceAbi: erc404InstanceArtifact.abi,
            deployer: deployer,
            nonce: nonce
        });

        // Buy to 100% to trigger graduation (8000 tokens = full bonding supply)
        const graduatedBuyers = [
            { address: TEST_ACCOUNTS.trader, tokens: "2000" },
            { address: TEST_ACCOUNTS.collector, tokens: "2000" },
            { address: TEST_ACCOUNTS.governance, tokens: "2000" },
            { address: deployer.address, tokens: "2000" }
        ];

        for (const buyer of graduatedBuyers) {
            await buyOnBondingCurve({
                instanceAddress: graduated.instance,
                instanceAbi: erc404InstanceArtifact.abi,
                buyer: buyer.address,
                tokenAmount: buyer.tokens,
                provider: provider
            });
        }
        console.log(`   ✓ Seeded purchases to 100% bonding progress`);

        // Deploy liquidity
        console.log("   Deploying liquidity to Uniswap V4...");
        const graduatedInstance = new ethers.Contract(
            graduated.instance,
            erc404InstanceArtifact.abi,
            deployer
        );

        // Note: Liquidity deployment requires proper V4 pool initialization
        // For MVP, we'll just mark it as "ready to deploy" state
        // Full V4 integration is complex and may be skipped for initial seeding
        console.log(`   ⚠️  V4 liquidity deployment stubbed (complex integration)`);
        console.log(`   ✓ Instance in graduated state (100% bonding complete)`);
        console.log("");

        console.log("═══════════════════════════════════════════════════════");
        console.log("PHASE 8: ADDITIONAL ERC1155 INSTANCES");
        console.log("═══════════════════════════════════════════════════════");
        console.log("");

        // Re-fund all accounts (bonding curve buys consumed ETH)
        await provider.send("anvil_setBalance", [deployer.address, "0x56BC75E2D63100000"]); // 100 ETH
        await provider.send("anvil_setBalance", [TEST_ACCOUNTS.trader, "0x56BC75E2D63100000"]);
        await provider.send("anvil_setBalance", [TEST_ACCOUNTS.collector, "0x56BC75E2D63100000"]);
        await provider.send("anvil_setBalance", [TEST_ACCOUNTS.governance, "0x56BC75E2D63100000"]);
        await provider.send("anvil_setBalance", [USER_ADDRESS, "0x56BC75E2D63100000"]);
        console.log("   ✓ Re-funded all accounts");

        // Refresh nonce after buy transactions
        nonce = await deployer.getTransactionCount();

        // Instance 2: Dynamic Pricing (linear price increase)
        console.log("STEP 17: Creating ERC1155 'Dynamic-Pricing' instance...");

        const dynamicPricingTx = await erc1155FactoryContract.createInstance(
            "Dynamic-Pricing",
            "https://ms2.fun/metadata/dynamic-pricing/",
            deployer.address,
            simpleVaultAddress, // Use SimpleVault
            "",
            { nonce: nonce++, value: ethers.utils.parseEther("0.01") }
        );
        const dynamicReceipt = await dynamicPricingTx.wait();
        const dynamicEvent = dynamicReceipt.events?.find(e => e.event === "InstanceCreated");
        const dynamicInstanceAddress = dynamicEvent?.args?.instance;

        console.log(`   ✓ Dynamic-Pricing: ${dynamicInstanceAddress}`);

        const dynamicInstance = new ethers.Contract(
            dynamicInstanceAddress,
            erc1155InstanceArtifact.abi,
            deployer
        );

        // Edition 1: Base 0.005 ETH, 5% increase per mint, max 50
        // PricingModel: 2 = LIMITED_DYNAMIC (requires supply > 0)
        // priceIncreaseRate is in basis points (500 = 5%)
        const dynamicEd1Tx = await dynamicInstance.addEdition(
            "Evolving-Piece-1",
            ethers.utils.parseEther("0.005"), // basePrice
            50,                                // supply (max 50)
            "https://ms2.fun/metadata/dynamic-pricing/1.json",
            2,                                 // pricingModel (LIMITED_DYNAMIC)
            500,                               // priceIncreaseRate (5% = 500 basis points)
            { nonce: nonce++ }
        );
        await dynamicEd1Tx.wait();
        console.log(`   ✓ Edition 1: "Evolving-Piece-1" (5% increase per mint, max 50)`);

        // Edition 2: Base 0.01 ETH, 10% increase per mint, max 30
        const dynamicEd2Tx = await dynamicInstance.addEdition(
            "Evolving-Piece-2",
            ethers.utils.parseEther("0.01"),
            30,                                // supply (max 30)
            "https://ms2.fun/metadata/dynamic-pricing/2.json",
            2, // LIMITED_DYNAMIC
            1000,                              // priceIncreaseRate (10% = 1000 basis points)
            { nonce: nonce++ }
        );
        await dynamicEd2Tx.wait();
        console.log(`   ✓ Edition 2: "Evolving-Piece-2" (10% increase per mint, max 30)`);

        // Mint some to show price progression
        for (let i = 0; i < 10; i++) {
            const buyer = i % 2 === 0 ? TEST_ACCOUNTS.collector : TEST_ACCOUNTS.trader;
            const signer = provider.getSigner(buyer);
            const asUser = dynamicInstance.connect(signer);

            // Query current price from contract
            const currentPrice = await dynamicInstance.getCurrentPrice(1);
            await asUser.mint(1, 1, getRandomMessage(MINT_MESSAGES), { value: currentPrice });
        }
        console.log(`   ✓ Minted 10x Edition 1 (dynamic pricing)`);

        for (let i = 0; i < 8; i++) {
            const buyer = i % 2 === 0 ? TEST_ACCOUNTS.governance : deployer.address;
            const signer = buyer === deployer.address ? deployer : provider.getSigner(buyer);
            const asUser = dynamicInstance.connect(signer);

            // Query current price from contract
            const currentPrice = await dynamicInstance.getCurrentPrice(2);
            await asUser.mint(2, 1, getRandomMessage(MINT_MESSAGES), { value: currentPrice });
        }
        console.log(`   ✓ Minted 8x Edition 2 (dynamic pricing)`);
        console.log("");

        // Instance 3: Mixed Supply (limited + unlimited)
        console.log("STEP 18: Creating ERC1155 'Mixed-Supply' instance...");

        // Refresh nonce (deployer was used in minting loops)
        nonce = await deployer.getTransactionCount();

        const mixedSupplyTx = await erc1155FactoryContract.createInstance(
            "Mixed-Supply",
            "https://ms2.fun/metadata/mixed-supply/",
            deployer.address,
            simpleVaultAddress,
            "",
            { nonce: nonce++, value: ethers.utils.parseEther("0.01") }
        );
        const mixedReceipt = await mixedSupplyTx.wait();
        const mixedEvent = mixedReceipt.events?.find(e => e.event === "InstanceCreated");
        const mixedInstanceAddress = mixedEvent?.args?.instance;

        console.log(`   ✓ Mixed-Supply: ${mixedInstanceAddress}`);

        const mixedInstance = new ethers.Contract(
            mixedInstanceAddress,
            erc1155InstanceArtifact.abi,
            deployer
        );

        // Edition 1: Limited (100 max), 0.02 ETH fixed
        // PricingModel: 1 = LIMITED_FIXED
        const mixedEd1Tx = await mixedInstance.addEdition(
            "Rare-Limited",
            ethers.utils.parseEther("0.02"),
            100, // max supply
            "https://ms2.fun/metadata/mixed-supply/1.json",
            1, // LIMITED_FIXED
            0,
            { nonce: nonce++ }
        );
        await mixedEd1Tx.wait();
        console.log(`   ✓ Edition 1: "Rare-Limited" (0.02 ETH, max 100)`);

        // Edition 2: Unlimited, 0.005 ETH fixed
        // PricingModel: 0 = UNLIMITED
        const mixedEd2Tx = await mixedInstance.addEdition(
            "Common-Unlimited",
            ethers.utils.parseEther("0.005"),
            0, // unlimited
            "https://ms2.fun/metadata/mixed-supply/2.json",
            0, // UNLIMITED
            0,
            { nonce: nonce++ }
        );
        await mixedEd2Tx.wait();
        console.log(`   ✓ Edition 2: "Common-Unlimited" (0.005 ETH, unlimited)`);

        // Mint 45 limited editions (approaching sellout)
        for (let i = 0; i < 45; i++) {
            const buyers = [TEST_ACCOUNTS.trader, TEST_ACCOUNTS.collector, TEST_ACCOUNTS.governance, deployer.address];
            const buyer = buyers[i % buyers.length];
            const signer = buyer === deployer.address ? deployer : provider.getSigner(buyer);
            const asUser = mixedInstance.connect(signer);

            await asUser.mint(1, 1, getRandomMessage(MINT_MESSAGES), { value: ethers.utils.parseEther("0.02") });
        }
        console.log(`   ✓ Minted 45x Edition 1 (45% sold out)`);

        // Mint 60 unlimited editions
        for (let i = 0; i < 60; i++) {
            const buyers = [TEST_ACCOUNTS.trader, TEST_ACCOUNTS.collector, TEST_ACCOUNTS.governance, deployer.address];
            const buyer = buyers[i % buyers.length];
            const signer = buyer === deployer.address ? deployer : provider.getSigner(buyer);
            const asUser = mixedInstance.connect(signer);

            await asUser.mint(2, 1, getRandomMessage(MINT_MESSAGES), { value: ethers.utils.parseEther("0.005") });
        }
        console.log(`   ✓ Minted 60x Edition 2`);
        console.log("");

        console.log("═══════════════════════════════════════════════════════");
        console.log("PHASE 9: GLOBAL MESSAGE SEEDING");
        console.log("═══════════════════════════════════════════════════════");
        console.log("");

        // Refresh nonce (deployer was used in minting loops)
        nonce = await deployer.getTransactionCount();

        console.log("STEP 19: Verifying global messages...");

        const messageRegistryQuery = new ethers.Contract(
            messageRegistryAddress,
            messageRegistryArtifact.abi,
            provider
        );

        // Get total message count
        const messageCount = await messageRegistryQuery.getMessageCount();
        console.log(`   ✓ Total messages: ${messageCount.toString()}`);

        // Sample first 5 messages
        console.log(`   Sampling first 5 messages:`);
        for (let i = 0; i < Math.min(5, messageCount.toNumber()); i++) {
            const msg = await messageRegistryQuery.messages(i);
            console.log(`     ${i}: ${msg.instance.slice(0, 10)}... by ${msg.sender.slice(0, 10)}...`);
        }
        console.log("");

        // Note: Messages are automatically posted by instances during transactions
        // If message count is low, instances may need GlobalMessageRegistry integration
        if (messageCount.toNumber() < 10) {
            console.log(`   ⚠️  Low message count detected`);
            console.log(`   ℹ️  Ensure instances call globalMessageRegistry.addMessage()`);
            console.log(`   ℹ️  This is expected if contracts don't have messaging integration yet`);
        }
        console.log("");

        console.log("═══════════════════════════════════════════════════════");
        console.log("PHASE 10: VAULT CONTRIBUTION SEEDING");
        console.log("═══════════════════════════════════════════════════════");
        console.log("");

        // Refresh nonce
        nonce = await deployer.getTransactionCount();

        // Connect to vaults for contribution operations
        const vaultContract = new ethers.Contract(
            vaultAddress,
            vaultArtifact.abi,
            deployer
        );

        const simpleVaultContract = new ethers.Contract(
            simpleVaultAddress,
            vaultArtifact.abi,
            deployer
        );

        console.log("STEP 20: Artist withdrawals (triggers vault contributions)...");

        // Artist (deployer) withdraws from Demo-Gallery ERC1155 instance
        // This sends 20% tithe to the vault
        const demoGalleryBalance = await provider.getBalance(instanceAddress);
        console.log(`   Demo-Gallery balance: ${ethers.utils.formatEther(demoGalleryBalance)} ETH`);

        if (demoGalleryBalance.gt(0)) {
            // Withdraw all proceeds from Demo-Gallery (deployer is creator)
            const withdrawTx = await erc1155Instance.withdraw(
                demoGalleryBalance,
                { nonce: nonce++ }
            );
            await withdrawTx.wait();
            const titheAmount = demoGalleryBalance.mul(20).div(100);
            console.log(`   ✓ Withdrawn from Demo-Gallery`);
            console.log(`     Creator received: ${ethers.utils.formatEther(demoGalleryBalance.sub(titheAmount))} ETH`);
            console.log(`     Vault tithe (20%): ${ethers.utils.formatEther(titheAmount)} ETH`);
        }

        // Withdraw from Dynamic-Pricing instance
        const dynamicBalance = await provider.getBalance(dynamicInstanceAddress);
        console.log(`   Dynamic-Pricing balance: ${ethers.utils.formatEther(dynamicBalance)} ETH`);

        if (dynamicBalance.gt(0)) {
            const withdrawDynamicTx = await dynamicInstance.withdraw(
                dynamicBalance,
                { nonce: nonce++ }
            );
            await withdrawDynamicTx.wait();
            const titheAmount = dynamicBalance.mul(20).div(100);
            console.log(`   ✓ Withdrawn from Dynamic-Pricing`);
            console.log(`     Creator received: ${ethers.utils.formatEther(dynamicBalance.sub(titheAmount))} ETH`);
            console.log(`     Vault tithe (20%): ${ethers.utils.formatEther(titheAmount)} ETH`);
        }

        // Withdraw from Mixed-Supply instance
        const mixedBalance = await provider.getBalance(mixedInstanceAddress);
        console.log(`   Mixed-Supply balance: ${ethers.utils.formatEther(mixedBalance)} ETH`);

        if (mixedBalance.gt(0)) {
            const withdrawMixedTx = await mixedInstance.withdraw(
                mixedBalance,
                { nonce: nonce++ }
            );
            await withdrawMixedTx.wait();
            const titheAmount = mixedBalance.mul(20).div(100);
            console.log(`   ✓ Withdrawn from Mixed-Supply`);
            console.log(`     Creator received: ${ethers.utils.formatEther(mixedBalance.sub(titheAmount))} ETH`);
            console.log(`     Vault tithe (20%): ${ethers.utils.formatEther(titheAmount)} ETH`);
        }
        console.log("");

        console.log("STEP 21: Simulating direct vault contributions...");

        // Simulate direct contributions to vaults via receiveHookTax
        // This mimics what V4 hooks would do during swaps
        const contributionAmounts = [
            { contributor: TEST_ACCOUNTS.trader, amount: "0.5" },
            { contributor: TEST_ACCOUNTS.collector, amount: "0.3" },
            { contributor: TEST_ACCOUNTS.governance, amount: "0.2" }
        ];

        // MS2 Vault contributions (via direct ETH transfer - vault's receive() tracks sender)
        for (const { contributor, amount } of contributionAmounts) {
            const contributorSigner = provider.getSigner(contributor);
            const tx = await contributorSigner.sendTransaction({
                to: vaultAddress,
                value: ethers.utils.parseEther(amount)
            });
            await tx.wait();
            console.log(`   ✓ ${contributor.slice(0, 8)}... contributed ${amount} ETH to MS2 Vault`);
        }

        // CULT Vault contributions
        for (const { contributor, amount } of contributionAmounts) {
            const contributorSigner = provider.getSigner(contributor);
            const tx = await contributorSigner.sendTransaction({
                to: simpleVaultAddress,
                value: ethers.utils.parseEther(amount)
            });
            await tx.wait();
            console.log(`   ✓ ${contributor.slice(0, 8)}... contributed ${amount} ETH to CULT Vault`);
        }
        console.log("");

        console.log("STEP 22: Processing vault contributions (convertAndAddLiquidity)...");

        // Check pending ETH in vaults before conversion
        const ms2PendingBefore = await vaultContract.totalPendingETH();
        const cultPendingBefore = await simpleVaultContract.totalPendingETH();
        console.log(`   MS2 Vault pending ETH: ${ethers.utils.formatEther(ms2PendingBefore)} ETH`);
        console.log(`   CULT Vault pending ETH: ${ethers.utils.formatEther(cultPendingBefore)} ETH`);

        // Refresh nonce
        nonce = await deployer.getTransactionCount();

        // Try to convert and add liquidity for MS2 vault
        // Note: This may fail if there's not enough liquidity in the alignment token pools
        // That's expected in a fresh fork - the important thing is contributions are tracked
        if (ms2PendingBefore.gt(0)) {
            try {
                const convertMs2Tx = await vaultContract.convertAndAddLiquidity(
                    0, // minOutTarget (0 for testing, would be higher in production)
                    { nonce: nonce++, gasLimit: 5000000 }
                );
                await convertMs2Tx.wait();
                console.log(`   ✓ MS2 Vault: convertAndAddLiquidity completed`);
            } catch (error) {
                console.log(`   ⚠️  MS2 Vault conversion skipped: ${error.message.slice(0, 50)}...`);
                console.log(`      (Normal if alignment token liquidity is low on fork)`);
            }
        }

        // Try to convert for CULT vault
        if (cultPendingBefore.gt(0)) {
            try {
                // Refresh nonce in case previous tx failed
                nonce = await deployer.getTransactionCount();
                const convertCultTx = await simpleVaultContract.convertAndAddLiquidity(
                    0,
                    { nonce: nonce++, gasLimit: 5000000 }
                );
                await convertCultTx.wait();
                console.log(`   ✓ CULT Vault: convertAndAddLiquidity completed`);
            } catch (error) {
                console.log(`   ⚠️  CULT Vault conversion skipped: ${error.message.slice(0, 50)}...`);
                console.log(`      (Normal if alignment token liquidity is low on fork)`);
            }
        }
        console.log("");

        console.log("STEP 23: Verifying vault state...");

        // Get final vault stats
        const ms2AccumulatedFees = await vaultContract.accumulatedFees();
        const ms2TotalShares = await vaultContract.totalShares();
        const ms2PendingAfter = await vaultContract.totalPendingETH();
        const ms2VaultBalance = await provider.getBalance(vaultAddress);

        const cultAccumulatedFees = await simpleVaultContract.accumulatedFees();
        const cultTotalShares = await simpleVaultContract.totalShares();
        const cultPendingAfter = await simpleVaultContract.totalPendingETH();
        const cultVaultBalance = await provider.getBalance(simpleVaultAddress);

        console.log(`   MS2 Vault (${vaultAddress.slice(0, 10)}...):`);
        console.log(`     Balance: ${ethers.utils.formatEther(ms2VaultBalance)} ETH`);
        console.log(`     Accumulated Fees: ${ethers.utils.formatEther(ms2AccumulatedFees)} ETH`);
        console.log(`     Total Shares: ${ms2TotalShares.toString()}`);
        console.log(`     Pending ETH: ${ethers.utils.formatEther(ms2PendingAfter)} ETH`);

        console.log(`   CULT Vault (${simpleVaultAddress.slice(0, 10)}...):`);
        console.log(`     Balance: ${ethers.utils.formatEther(cultVaultBalance)} ETH`);
        console.log(`     Accumulated Fees: ${ethers.utils.formatEther(cultAccumulatedFees)} ETH`);
        console.log(`     Total Shares: ${cultTotalShares.toString()}`);
        console.log(`     Pending ETH: ${ethers.utils.formatEther(cultPendingAfter)} ETH`);
        console.log("");

        // Update vault metadata for config
        const ms2VaultTVL = ethers.utils.formatEther(ms2VaultBalance.add(ms2AccumulatedFees));
        const cultVaultTVL = ethers.utils.formatEther(cultVaultBalance.add(cultAccumulatedFees));

        console.log("═══════════════════════════════════════════════════════");
        console.log("VERIFICATION & CONFIG");
        console.log("═══════════════════════════════════════════════════════");
        console.log("");

        // Verify all deployments
        console.log("🔍 Verifying deployments...");
        const verifications = [
            { name: "MasterRegistry", address: masterRegistryAddress },
            { name: "GlobalMessageRegistry", address: messageRegistryAddress },
            { name: "FeaturedQueueManager", address: queueManagerAddress },
            { name: "UltraAlignmentVault", address: vaultAddress },
            { name: "SimpleVault", address: simpleVaultAddress },
            { name: "UltraAlignmentHookFactory", address: hookFactoryAddress },
            { name: "ERC1155Factory", address: erc1155FactoryAddress },
            { name: "ERC404Factory", address: erc404FactoryAddress },
            { name: "Sample ERC1155 Instance", address: instanceAddress }
        ];

        for (const contract of verifications) {
            const code = await provider.getCode(contract.address);
            if (code === "0x" || code === "0x0") {
                throw new Error(`${contract.name} has no bytecode at ${contract.address}!`);
            }
        }
        console.log("   ✓ All contracts verified");
        console.log("");

        // Write configuration file
        console.log("📝 Writing configuration...");
        const config = {
            generatedAt: new Date().toISOString(),
            chainId: 1337,
            mode: "local-fork",
            deployer: deployer.address,
            contracts: {
                MasterRegistryV1: masterRegistryAddress,
                GlobalMessageRegistry: messageRegistryAddress,
                FeaturedQueueManager: queueManagerAddress,
                ERC404Factory: erc404FactoryAddress,
                ERC1155Factory: erc1155FactoryAddress,
                UltraAlignmentHookFactory: hookFactoryAddress
            },
            factories: [
                {
                    address: erc404FactoryAddress,
                    type: "ERC404",
                    title: "ERC404-Bonding-Curve-Factory",
                    displayTitle: "ERC404 Bonding Curve",
                    factoryId: 1,
                    registered: true
                },
                {
                    address: erc1155FactoryAddress,
                    type: "ERC1155",
                    title: "ERC1155-Edition-Factory",
                    displayTitle: "ERC1155 Editions",
                    factoryId: 2,
                    registered: true
                }
            ],
            vaults: [
                {
                    address: vaultAddress,
                    name: "UltraAlignmentVault",
                    type: "ultra-alignment",
                    registered: true,
                    tag: "ActiveVault",
                    alignmentToken: MAINNET_ADDRESSES.ms2Token,
                    alignmentTokenSymbol: "MS2",
                    totalShares: ms2TotalShares.toString(),
                    accumulatedFees: ethers.utils.formatEther(ms2AccumulatedFees),
                    pendingETH: ethers.utils.formatEther(ms2PendingAfter),
                    balance: ethers.utils.formatEther(ms2VaultBalance),
                    tvl: ms2VaultTVL
                },
                {
                    address: simpleVaultAddress,
                    name: "SimpleVault",
                    type: "ultra-alignment",
                    registered: true,
                    tag: "SimpleVault",
                    alignmentToken: MAINNET_ADDRESSES.cultToken,
                    alignmentTokenSymbol: "CULT",
                    totalShares: cultTotalShares.toString(),
                    accumulatedFees: ethers.utils.formatEther(cultAccumulatedFees),
                    pendingETH: ethers.utils.formatEther(cultPendingAfter),
                    balance: ethers.utils.formatEther(cultVaultBalance),
                    tvl: cultVaultTVL
                }
            ],
            instances: {
                erc404: [
                    {
                        address: earlyLaunch.instance,
                        name: "Early-Launch",
                        symbol: "EARLY",
                        creator: deployer.address,
                        vault: vaultAddress,
                        hook: ms2HookAddress,
                        state: "early-bonding",
                        bondingProgress: "~10%",
                        holders: 4,
                        messages: 5
                    },
                    {
                        address: activeProject.instance,
                        name: "Active-Project",
                        symbol: "ACTIVE",
                        creator: deployer.address,
                        vault: vaultAddress,
                        hook: ms2HookAddress,
                        state: "active-bonding",
                        bondingProgress: "~60%",
                        holders: 4,
                        messages: 15
                    },
                    {
                        address: graduated.instance,
                        name: "Graduated",
                        symbol: "GRAD",
                        creator: deployer.address,
                        vault: vaultAddress,
                        hook: ms2HookAddress,
                        state: "graduated",
                        bondingProgress: "100%",
                        liquidityDeployed: false, // Stubbed
                        holders: 4,
                        messages: 4
                    }
                ],
                erc1155: [
                    {
                        address: instanceAddress,
                        name: "Demo-Gallery",
                        creator: deployer.address,
                        vault: vaultAddress,
                        editions: [
                            {
                                id: 1,
                                name: "Genesis-Piece",
                                price: "0.01",
                                maxSupply: 0,
                                minted: 3
                            },
                            {
                                id: 2,
                                name: "Limited-Drop",
                                price: "0.02",
                                maxSupply: 100,
                                minted: 2
                            }
                        ]
                    },
                    {
                        address: dynamicInstanceAddress,
                        name: "Dynamic-Pricing",
                        creator: deployer.address,
                        vault: simpleVaultAddress,
                        pricingModel: "exponential-increase",
                        editions: [
                            {
                                id: 1,
                                name: "Evolving-Piece-1",
                                basePrice: "0.005",
                                priceIncreaseRate: 500, // 5% per mint
                                maxSupply: 50,
                                minted: 10
                            },
                            {
                                id: 2,
                                name: "Evolving-Piece-2",
                                basePrice: "0.01",
                                priceIncreaseRate: 1000, // 10% per mint
                                maxSupply: 30,
                                minted: 8
                            }
                        ]
                    },
                    {
                        address: mixedInstanceAddress,
                        name: "Mixed-Supply",
                        creator: deployer.address,
                        vault: simpleVaultAddress,
                        pricingModel: "mixed",
                        editions: [
                            {
                                id: 1,
                                name: "Rare-Limited",
                                price: "0.02",
                                maxSupply: 100,
                                minted: 45,
                                percentSold: 45
                            },
                            {
                                id: 2,
                                name: "Common-Unlimited",
                                price: "0.005",
                                maxSupply: 0,
                                minted: 60
                            }
                        ]
                    }
                ]
            },
            uniswap: {
                v4PoolManager: MAINNET_ADDRESSES.uniswapV4PoolManager,
                v4PositionManager: MAINNET_ADDRESSES.uniswapV4PositionManager,
                v4Quoter: MAINNET_ADDRESSES.uniswapV4Quoter,
                v3Router: MAINNET_ADDRESSES.uniswapV3Router,
                v3Factory: MAINNET_ADDRESSES.uniswapV3Factory,
                v2Router: MAINNET_ADDRESSES.uniswapV2Router,
                v2Factory: MAINNET_ADDRESSES.uniswapV2Factory,
                weth: MAINNET_ADDRESSES.weth
            },
            tokens: {
                exec: MAINNET_ADDRESSES.execToken
            },
            testAccounts: TEST_ACCOUNTS,
            userAddress: USER_ADDRESS,
            governance: {
                dictator: deployer.address,
                abdicationInitiated: false,
                mode: "dictator"
            },
            messages: {
                total: messageCount.toNumber(),
                sources: {
                    erc404Buys: "~20",
                    erc1155Mints: "~123",
                    other: "~0"
                },
                note: "Messages posted automatically during transactions"
            }
        };

        await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
        console.log(`   ✓ Configuration written to ${CONFIG_PATH}`);
        console.log("");

        console.log("═══════════════════════════════════════════════════════");
        console.log("🎉 DEPLOYMENT COMPLETE!");
        console.log("═══════════════════════════════════════════════════════");
        console.log("");
        console.log("📋 Core Contracts:");
        console.log(`   MasterRegistry: ${masterRegistryAddress}`);
        console.log(`   GlobalMessages: ${messageRegistryAddress}`);
        console.log(`   FeaturedQueue:  ${queueManagerAddress}`);
        console.log("");
        console.log("🏦 Vaults (2):");
        console.log(`   MS2 Vault:      ${vaultAddress}`);
        console.log(`                   TVL: ${ms2VaultTVL} ETH | Shares: ${ms2TotalShares.toString()}`);
        console.log(`   CULT Vault:     ${simpleVaultAddress}`);
        console.log(`                   TVL: ${cultVaultTVL} ETH | Shares: ${cultTotalShares.toString()}`);
        console.log("");
        console.log("🏭 Factories (2):");
        console.log(`   ERC404Factory:  ${erc404FactoryAddress} ✓ registered`);
        console.log(`   ERC1155Factory: ${erc1155FactoryAddress} ✓ registered`);
        console.log("");
        console.log("🎨 ERC404 Instances (3):");
        console.log(`   Early-Launch:   ${earlyLaunch.instance} (~10% bonding)`);
        console.log(`   Active-Project: ${activeProject.instance} (~60% bonding)`);
        console.log(`   Graduated:      ${graduated.instance} (100% complete)`);
        console.log("");
        console.log("🖼️  ERC1155 Instances (3):");
        console.log(`   Demo-Gallery:    ${instanceAddress} (fixed pricing)`);
        console.log(`   Dynamic-Pricing: ${dynamicInstanceAddress} (linear increase)`);
        console.log(`   Mixed-Supply:    ${mixedInstanceAddress} (limited + unlimited)`);
        console.log("");
        console.log("💬 Global Messages:");
        console.log(`   Total messages:  ${messageCount.toString()}`);
        console.log(`   From:            Buy/sell/mint transactions`);
        console.log("");
        console.log("👑 Governance:");
        console.log(`   Mode:            Dictator`);
        console.log(`   Dictator:        ${deployer.address}`);
        console.log("");
        console.log("💰 Funded Accounts:");
        console.log(`   User:            ${USER_ADDRESS} (100 ETH) ⭐`);
        console.log(`   Owner:           ${TEST_ACCOUNTS.owner} (100 ETH)`);
        console.log(`   Trader:          ${TEST_ACCOUNTS.trader} (100 ETH)`);
        console.log(`   Collector:       ${TEST_ACCOUNTS.collector} (100 ETH)`);
        console.log(`   Governance:      ${TEST_ACCOUNTS.governance} (100 ETH)`);
        console.log("");
        console.log("🎯 Next steps:");
        console.log("   1. Run: npm run dev");
        console.log("   2. Open: http://localhost:3000");
        console.log("   3. See 6 instances across discovery page");
        console.log("   4. View global activity feed with real transactions");
        console.log("");

    } catch (error) {
        console.error("");
        console.error("═══════════════════════════════════════════════════════");
        console.error("❌ DEPLOYMENT FAILED");
        console.error("═══════════════════════════════════════════════════════");
        console.error("");
        console.error("Error:", error.message);
        console.error("");
        if (error.stack) {
            console.error("Stack trace:");
            console.error(error.stack);
        }
        console.error("");
        console.error("Common issues:");
        console.error("  - Anvil not running: npm run chain:start");
        console.error("  - Contracts not built: cd contracts && forge build");
        console.error("  - Wrong network: Check RPC_URL_LOCAL");
        console.error("");
        process.exit(1);
    }
};

main();
