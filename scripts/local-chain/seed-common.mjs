// scripts/local-chain/seed-common.mjs
//
// Reusable building blocks for seeding the local dev chain.
// Imported by scenario files (scenarios/*.mjs).
//
// All functions use ethers v5 syntax.

import { ethers } from 'ethers'
import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const CONTRACTS_DIR = path.resolve(__dirname, '../../contracts')

// ─────────────────────────────────────────────────────────────────────────────
// Test accounts (Anvil defaults — addresses + private keys)
// ─────────────────────────────────────────────────────────────────────────────

export const TEST_ACCOUNTS = {
  owner: {
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    key: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  },
  trader: {
    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    key: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  },
  collector: {
    address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    key: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  },
  governance: {
    address: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
    key: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  },
}

// Sample messages for seeding activity
export const BUY_MESSAGES = [
  'LFG!',
  'Early and often',
  'This project is going places',
  'Adding to my position',
  'Bullish on this one',
  'Great team, great vision',
  'Diamond hands',
  'WAGMI',
  'In it for the long haul',
  'Love the art direction',
  'Community is everything',
  'Building something special here',
  'First time buyer, excited!',
  'Increasing my stack',
  "Can't stop, won't stop",
]

export const MINT_MESSAGES = [
  'Beautiful piece!',
  'Added to my collection',
  "Love this artist's work",
  'Supporting creators',
  'This one speaks to me',
  'Instant classic',
  'Had to grab one',
  'The details are incredible',
  'Been waiting for this drop',
  'My favorite so far',
  'Art that matters',
  'Proud to own this',
  'Supporting the vision',
  'This is the one',
  "Collector's item for sure",
]

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load ABI from forge build artifacts.
 *
 * @param {string} contractName - e.g. 'ERC404BondingInstance'
 * @param {string} [solFile] - Override the .sol filename (defaults to contractName.sol)
 * @returns {Promise<Array>}
 */
export async function loadAbi(contractName, solFile) {
  const file = solFile || `${contractName}.sol`
  const artifactPath = path.join(CONTRACTS_DIR, 'out', file, `${contractName}.json`)
  const raw = await fs.readFile(artifactPath, 'utf8')
  return JSON.parse(raw).abi
}

/**
 * Returns a random message from the given array.
 *
 * @param {string[]} messages
 * @returns {string}
 */
export function getRandomMessage(messages) {
  return messages[Math.floor(Math.random() * messages.length)]
}

/**
 * Fund all test accounts (and userAddress if provided) via anvil_setBalance.
 * Sets each account to 100 ETH. Skips any address that matches deployer.address.
 *
 * @param {object} provider - ethers JsonRpcProvider connected to Anvil
 * @param {object} deployer - ethers Wallet (the deployer)
 * @param {string} [userAddress] - Optional external user address to fund
 */
export async function fundAccounts(provider, deployer, userAddress) {
  // 100 ETH in hex (wei)
  const hundredEth = '0x56BC75E2D63100000'

  const toFund = [
    { label: 'trader', address: TEST_ACCOUNTS.trader.address },
    { label: 'collector', address: TEST_ACCOUNTS.collector.address },
    { label: 'governance', address: TEST_ACCOUNTS.governance.address },
  ]

  if (userAddress && userAddress.toLowerCase() !== deployer.address.toLowerCase()) {
    toFund.push({ label: 'user', address: userAddress })
  }

  for (const { label, address } of toFund) {
    await provider.send('anvil_setBalance', [address, hundredEth])
    console.log(`   Funded ${label}: ${address}`)
  }
}

/**
 * Re-fund all accounts back to 100 ETH (call after expensive bonding curve operations).
 *
 * @param {object} provider
 * @param {object} deployer
 * @param {string} [userAddress]
 */
export async function refundAccounts(provider, deployer, userAddress) {
  const hundredEth = '0x56BC75E2D63100000'

  const toFund = [
    deployer.address,
    TEST_ACCOUNTS.trader.address,
    TEST_ACCOUNTS.collector.address,
    TEST_ACCOUNTS.governance.address,
  ]

  if (userAddress) toFund.push(userAddress)

  for (const address of toFund) {
    await provider.send('anvil_setBalance', [address, hundredEth])
  }
  console.log('   Re-funded all accounts to 100 ETH')
}

// ─────────────────────────────────────────────────────────────────────────────
// ERC404 helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create an ERC404 bonding curve instance via ERC404Factory.
 *
 * NOTE: The current ERC404Factory.createInstance() signature differs from the old
 * deploy-local.mjs. The factory now uses graduation profiles (profileId) to derive
 * maxSupply, liquidityReservePercent, and curveParams internally — callers pass
 * nftCount + profileId instead. profileId=1 is the default profile set by the
 * forge deployment script (targetETH=15 ETH, 10% liquidity reserve).
 *
 * Old signature (no longer valid):
 *   createInstance(name, symbol, metadataURI, maxSupply, liquidityReservePercent,
 *                  curveParams, tierConfig, creator, vault, hook, styleUri)
 *
 * Current signature:
 *   createInstance(name, symbol, metadataURI, nftCount, profileId,
 *                  tierConfig, instanceCreator, vault, hook, styleUri)
 *
 * @param {object} params
 * @param {string} params.name - Token name (no spaces)
 * @param {string} params.symbol - Token symbol
 * @param {number} params.nftCount - Number of NFTs (determines maxSupply via profile)
 * @param {number} [params.profileId=1] - Graduation profile ID (default=1)
 * @param {string} params.creator - Creator address
 * @param {string} params.vault - Vault address
 * @param {string} params.hook - Hook address
 * @param {object} params.factory - ERC404Factory ethers Contract instance
 * @param {object} params.deployer - Deployer wallet (not used directly but kept for consistency)
 * @returns {Promise<string>} Deployed instance address
 */
export async function createERC404Instance({
  name,
  symbol,
  nftCount,
  profileId = 1,
  creator,
  vault,
  hook,
  factory,
}) {
  // Public tier config (1 tier, open access via zero password hash)
  const tierConfig = {
    tierType: 0, // VOLUME_CAP
    passwordHashes: [ethers.utils.keccak256(ethers.utils.toUtf8Bytes('PUBLIC'))],
    volumeCaps: [ethers.utils.parseEther(String(nftCount * 1_000_000))], // cap = total supply (effectively unlimited)
    tierUnlockTimes: [],
  }

  const instanceFee = ethers.utils.parseEther('0.01')

  const createTx = await factory.createInstance(
    name,
    symbol,
    `https://ms2.fun/metadata/${name.toLowerCase()}/`,
    nftCount,
    profileId,
    tierConfig,
    creator,
    vault,
    hook,
    '', // styleUri
    { value: instanceFee }
  )

  const receipt = await createTx.wait()
  const event = receipt.events?.find(e => e.event === 'InstanceCreated')
  const instance = event?.args?.instance

  if (!instance) {
    throw new Error(`createERC404Instance: InstanceCreated event not found for ${name}`)
  }

  return instance
}

/**
 * Create an ERC1155 editions instance via ERC1155Factory.
 *
 * Signature (unchanged from old deploy-local.mjs):
 *   createInstance(name, metadataURI, creator, vault, styleUri)
 *
 * @param {object} params
 * @param {string} params.name - Instance name (no spaces)
 * @param {string} params.creator - Creator address
 * @param {string} params.vault - Vault address
 * @param {object} params.factory - ERC1155Factory ethers Contract instance
 * @returns {Promise<string>} Deployed instance address
 */
export async function createERC1155Instance({
  name,
  creator,
  vault,
  factory,
}) {
  const instanceFee = ethers.utils.parseEther('0.01')

  const createTx = await factory.createInstance(
    name,
    `https://ms2.fun/metadata/${name.toLowerCase()}/`,
    creator,
    vault,
    '', // styleUri
    { value: instanceFee }
  )

  const receipt = await createTx.wait()
  const event = receipt.events?.find(e => e.event === 'InstanceCreated')
  const instance = event?.args?.instance

  if (!instance) {
    throw new Error(`createERC1155Instance: InstanceCreated event not found for ${name}`)
  }

  return instance
}

/**
 * Buy tokens on an ERC404 bonding curve.
 *
 * NOTE: The current buyBonding() signature has an extra `deadline` parameter
 * compared to the old deploy-local.mjs:
 *
 * Old signature (no longer valid):
 *   buyBonding(amount, maxCost, mintNFT, passwordHash, message)
 *
 * Current signature:
 *   buyBonding(amount, maxCost, mintNFT, passwordHash, message, deadline)
 *
 * @param {object} params
 * @param {string} params.instanceAddress - ERC404BondingInstance address
 * @param {Array} params.instanceAbi - ERC404BondingInstance ABI
 * @param {string} params.buyer - Buyer address (must be an Anvil test account)
 * @param {string} params.tokenAmount - Token amount to buy (in whole units, e.g. '200')
 * @param {object} params.provider - ethers JsonRpcProvider
 */
export async function buyOnBondingCurve({ instanceAddress, instanceAbi, buyer, tokenAmount, provider }) {
  const buyerSigner = provider.getSigner(buyer)
  const instance = new ethers.Contract(instanceAddress, instanceAbi, buyerSigner)

  const amount = ethers.utils.parseEther(tokenAmount)
  const cost = await instance.calculateCost(amount)

  // Add 10% buffer for slippage
  const maxCost = cost.mul(110).div(100)

  const buyTx = await instance.buyBonding(
    amount,
    maxCost,
    true,                          // mintNFT
    ethers.constants.HashZero,     // public tier (no password)
    getRandomMessage(BUY_MESSAGES),
    0,                             // deadline (0 = no deadline)
    { value: maxCost }
  )
  await buyTx.wait()
}

/**
 * Activate bonding curve on an ERC404 instance (set open time, maturity time, active=true).
 *
 * @param {object} params
 * @param {string} params.instanceAddress - ERC404BondingInstance address
 * @param {Array} params.instanceAbi - ERC404BondingInstance ABI
 * @param {object} params.deployer - Deployer wallet (instance owner)
 */
export async function activateBondingCurve({ instanceAddress, instanceAbi, deployer, provider }) {
  const instance = new ethers.Contract(instanceAddress, instanceAbi, deployer)

  const now = Math.floor(Date.now() / 1000)

  // Set bonding open time slightly in the future (contract requires timestamp > block.timestamp)
  const openTimeTx = await instance.setBondingOpenTime(now + 10)
  await openTimeTx.wait()

  // Warp Anvil time forward so block.timestamp >= bondingOpenTime (required by setBondingActive)
  await provider.send('evm_increaseTime', [11])
  await provider.send('evm_mine', [])

  // Set bonding active
  const activeTx = await instance.setBondingActive(true)
  await activeTx.wait()

  // Set maturity time far in the future so bonding doesn't auto-mature during seeding
  const maturityTimeTx = await instance.setBondingMaturityTime(now + 365 * 24 * 3600)
  await maturityTimeTx.wait()
}
