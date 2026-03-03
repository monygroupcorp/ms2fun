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
 * Encode a message string into the messageData bytes format expected by
 * ERC1155Instance.mint() and ERC404BondingInstance.buyBonding().
 *
 * The GlobalMessageRegistry.postForAction expects:
 *   abi.encode(uint8 messageType, uint256 refId, bytes32 actionRef, bytes32 metadata, string content)
 *
 * @param {string} content - Message text
 * @returns {string} ABI-encoded messageData hex string
 */
export function encodeMessageData(content) {
  return ethers.utils.defaultAbiCoder.encode(
    ['uint8', 'uint256', 'bytes32', 'bytes32', 'string'],
    [0, 0, ethers.constants.HashZero, ethers.constants.HashZero, content]
  )
}

/**
 * Returns random encoded messageData bytes from the given message array.
 *
 * @param {string[]} messages
 * @returns {string} ABI-encoded messageData hex string
 */
export function getRandomMessageData(messages) {
  return encodeMessageData(getRandomMessage(messages))
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
 * Current signature (struct-based):
 *   createInstance(IdentityParams identity, string metadataURI, address liquidityDeployer,
 *                  address gatingModule, FreeMintParams freeMint)
 *
 *   IdentityParams = (name, symbol, styleUri, owner, vault, nftCount, presetId, creationTier)
 *   FreeMintParams = (allocation, scope)
 *
 * @param {object} params
 * @param {string} params.name - Token name (no spaces)
 * @param {string} params.symbol - Token symbol
 * @param {number} params.nftCount - Number of NFTs (determines maxSupply via preset)
 * @param {number} [params.presetId=1] - Launch preset ID (default=1)
 * @param {string} params.creator - Creator/owner address
 * @param {string} params.vault - Vault address
 * @param {object} params.factory - ERC404Factory ethers Contract instance
 * @returns {Promise<string>} Deployed instance address
 */
export async function createERC404Instance({
  name,
  symbol,
  nftCount,
  presetId = 1,
  creator,
  vault,
  factory,
}) {
  const instanceFee = ethers.utils.parseEther('0.01')

  // IdentityParams struct
  const identity = {
    name,
    symbol,
    styleUri: '',
    owner: creator,
    vault,
    nftCount,
    presetId,
    creationTier: 0, // CreationTier.STANDARD
  }

  // FreeMintParams struct (no free mint)
  const freeMint = {
    allocation: 0,
    scope: 0, // GatingScope.NONE
  }

  // liquidityDeployer must be an approved component in ComponentRegistry.
  // Use mock Uniswap V4 Deployer (seeded in seedComponentRegistry).
  const liquidityDeployer = '0x0000000000000000000000000000000000C0DE03'

  // Use full signature to disambiguate overloaded createInstance (ethers v5 requirement)
  const createTx = await factory['createInstance((string,string,string,address,address,uint256,uint8,uint8),string,address,address,(uint256,uint8))'](
    identity,
    `https://ms2.fun/metadata/${name.toLowerCase()}/`,
    liquidityDeployer,
    ethers.constants.AddressZero, // gatingModule (none)
    freeMint,
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

  // Use full signature to disambiguate overloaded createInstance (ethers v5 requirement)
  const createTx = await factory['createInstance(string,string,address,address,string)'](
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

  // calculateCost was moved to CurveParamsComputer (external module).
  // For local seeding, send a generous ETH amount — the contract refunds excess.
  // Use 10 ETH as a safe upper bound for local dev token purchases.
  const maxCost = ethers.utils.parseEther('10')

  const buyTx = await instance.buyBonding(
    amount,
    maxCost,
    true,                          // mintNFT
    ethers.constants.HashZero,     // public tier (no password)
    getRandomMessageData(BUY_MESSAGES),
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

  // Read current block timestamp from chain (not Date.now() — Anvil clock drifts with evm_increaseTime)
  const block = await provider.getBlock('latest')
  const blockTimestamp = block.timestamp

  // Set bonding open time slightly in the future (contract requires timestamp > block.timestamp)
  const openTimeTx = await instance.setBondingOpenTime(blockTimestamp + 10)
  await openTimeTx.wait()

  // Warp Anvil time forward so block.timestamp >= bondingOpenTime (required by setBondingActive)
  await provider.send('evm_increaseTime', [11])
  await provider.send('evm_mine', [])

  // Set bonding active
  const activeTx = await instance.setBondingActive(true)
  await activeTx.wait()

  // Set maturity time far in the future so bonding doesn't auto-mature during seeding
  const maturityTimeTx = await instance.setBondingMaturityTime(blockTimestamp + 365 * 24 * 3600)
  await maturityTimeTx.wait()
}

// ─────────────────────────────────────────────────────────────────────────────
// Portfolio Testing Setup
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Set up complete portfolio test data for userAddress.
 * Creates all necessary on-chain state to test every Portfolio page section:
 * - Holdings (ERC404 + ERC1155) with position P&L
 * - Staking positions with share of pool and claimable yield
 * - NFT ownership
 * - Transaction activity history
 *
 * @param {object} params
 * @param {string} params.userAddress - User wallet to set up portfolio for
 * @param {string[]} params.erc404Instances - Array of ERC404 instance addresses (need at least 2)
 * @param {string[]} params.erc1155Instances - Array of ERC1155 instance addresses (need at least 1)
 * @param {string} params.vaultAddress - Vault address for staking
 * @param {string} params.messageRegistryAddress - GlobalMessageRegistry address
 * @param {object} params.provider - ethers JsonRpcProvider
 * @returns {Promise<void>}
 */
export async function setupPortfolioTestData({
  userAddress,
  erc404Instances,
  erc1155Instances,
  vaultAddress,
  messageRegistryAddress,
  provider,
  deployer,
}) {
  console.log('\n════════════════════════════════════════════════════')
  console.log('PORTFOLIO TEST DATA SETUP')
  console.log('════════════════════════════════════════════════════')
  console.log(`\n   Setting up portfolio for: ${userAddress}`)

  // Load ABIs
  const erc404Abi = await loadAbi('ERC404BondingInstance')
  const erc1155Abi = await loadAbi('ERC1155Instance')
  const vaultAbi = await loadAbi('UltraAlignmentVault')
  const gmrAbi = await loadAbi('GlobalMessageRegistry')

  // Impersonate userAddress so Anvil will sign transactions on their behalf.
  // userAddress is an external wallet (not an Anvil test account), so we must
  // impersonate it before calling provider.getSigner().
  await provider.send('anvil_impersonateAccount', [userAddress])
  await provider.send('anvil_setBalance', [userAddress, '0x56BC75E2D63100000']) // 100 ETH
  const userSigner = provider.getSigner(userAddress)

  // ───────────────────────────────────────────────────────────────────────
  // 1. USER BUYS ERC404 TOKENS (creates transaction history for P&L)
  // ───────────────────────────────────────────────────────────────────────
  console.log('\n   1. User buying ERC404 tokens (for P&L calculation)...')

  for (let i = 0; i < Math.min(erc404Instances.length, 2); i++) {
    const instanceAddress = erc404Instances[i]
    const instance = new ethers.Contract(instanceAddress, erc404Abi, userSigner)

    let name = 'Project'
    try { name = await instance.name() } catch (e) {}

    const buyAmount = ethers.utils.parseEther(i === 0 ? '500' : '300')
    const maxCost = ethers.utils.parseEther('10')

    const buyTx = await instance.buyBonding(
      buyAmount,
      maxCost,
      true,
      ethers.constants.HashZero,
      getRandomMessageData(BUY_MESSAGES),
      0,
      { value: maxCost }
    )
    await buyTx.wait()
    console.log(`      ✓ Bought ${ethers.utils.formatEther(buyAmount)} tokens from ${name}`)
  }

  // ───────────────────────────────────────────────────────────────────────
  // 2. USER MINTS ERC1155 EDITIONS
  // ───────────────────────────────────────────────────────────────────────
  console.log('\n   2. User minting ERC1155 editions...')

  for (const instanceAddress of erc1155Instances.slice(0, 1)) {
    const instance = new ethers.Contract(instanceAddress, erc1155Abi, userSigner)

    let name = 'Editions'
    try { name = await instance.name() } catch (e) {}

    try {
      // mint(editionId, quantity, gatingData, messageData, maxCost)
      const mintTx = await instance.mint(
        1,
        5,
        ethers.constants.HashZero, // gatingData (no gating)
        getRandomMessageData(MINT_MESSAGES),
        0, // maxCost
        { value: ethers.utils.parseEther('0.05') }
      )
      await mintTx.wait()
      console.log(`      ✓ Minted 5 editions from ${name}`)
    } catch (e) {
      console.log(`      ⚠ Failed to mint from ${name}: ${e.message}`)
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // 3. VAULT BENEFACTOR SETUP
  //
  // Full benefactor flow:
  //   a) receiveInstance() — tracks user as benefactor with pendingETH
  //   b) convertAndAddLiquidity() — converts pending ETH to LP shares
  //      (likely fails on local fork without a live V4 pool; fall through
  //      to direct storage injection as dev-chain workaround)
  //   c) recordAccumulatedFees() — adds claimable yield (owner-only)
  //   d) Fund vault ETH balance so claimFees() can pay out
  // ───────────────────────────────────────────────────────────────────────
  console.log('\n   3. Setting up vault benefactor position...')

  const deployerVault = new ethers.Contract(vaultAddress, vaultAbi, deployer)

  // a) Track user as benefactor via receiveInstance.
  //    Simulates vault fees arriving from the user's ERC404 instance (Early-Launch hook tax).
  //    receiveInstance() has no access control — anyone can attribute a contribution.
  const contributionAmount = ethers.utils.parseEther('0.5')
  const receiveInstanceTx = await deployerVault.receiveInstance(
    ethers.constants.AddressZero, // native ETH (Currency = address)
    contributionAmount,
    userAddress,
    { value: contributionAmount }
  )
  await receiveInstanceTx.wait()
  console.log(`      ✓ Recorded 0.5 ETH vault contribution for user (via receiveInstance)`)

  // b) Try to convert pending ETH to LP shares via convertAndAddLiquidity.
  //    This requires a live V4 pool for the alignment token, which likely
  //    doesn't exist on the local fork. If it fails, inject shares directly.
  let sharesInjected = false
  try {
    await (await deployerVault.convertAndAddLiquidity(0, { gasLimit: 5_000_000 })).wait()
    console.log(`      ✓ Converted pending ETH to benefactor shares`)
    sharesInjected = true
  } catch (err) {
    console.log(`      ⚠ convertAndAddLiquidity failed (${err.reason || err.message.slice(0, 50)})`)
    console.log(`        Injecting shares directly via anvil_setStorageAt...`)

    // Storage layout (from forge inspect UltraAlignmentVault storage):
    //   slot 1 — benefactorShares: mapping(address => uint256)
    //   slot 5 — totalShares: uint256
    //   slot 9 — totalEthLocked: uint256
    //
    // Mapping slot: keccak256(abi.encode(key, mappingSlot))
    const sharesAmount = ethers.utils.parseEther('1000')

    const userSharesSlot = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(['address', 'uint256'], [userAddress, 1])
    )
    await provider.send('anvil_setStorageAt', [
      vaultAddress,
      userSharesSlot,
      ethers.utils.hexZeroPad(sharesAmount.toHexString(), 32),
    ])

    await provider.send('anvil_setStorageAt', [
      vaultAddress,
      '0x0000000000000000000000000000000000000000000000000000000000000005',
      ethers.utils.hexZeroPad(sharesAmount.toHexString(), 32),
    ])

    await provider.send('anvil_setStorageAt', [
      vaultAddress,
      '0x0000000000000000000000000000000000000000000000000000000000000009',
      ethers.utils.hexZeroPad(contributionAmount.toHexString(), 32),
    ])

    sharesInjected = true
    console.log(`        ✓ Injected ${ethers.utils.formatEther(sharesAmount)} shares for user`)
  }

  // c) Accumulate fees the owner-controlled way (simulates LP yield).
  //    claimFees() will try _claimVaultFees() first, but since totalLPUnits==0
  //    it safely returns (0,0), then falls through to distribute accumulatedFees.
  if (sharesInjected) {
    const feeAmount = ethers.utils.parseEther('0.05')
    await (await deployerVault.recordAccumulatedFees(feeAmount)).wait()
    console.log(`      ✓ Accumulated 0.05 ETH in vault fees (claimable by user)`)

    // d) Ensure vault has enough ETH to pay out on claimFees()
    await provider.send('anvil_setBalance', [
      vaultAddress,
      ethers.utils.hexZeroPad(ethers.utils.parseEther('1').toHexString(), 32),
    ])
    console.log(`      ✓ Vault funded with 1 ETH for fee payouts`)
  }

  // ───────────────────────────────────────────────────────────────────────
  // 4. USER POSTS MESSAGES (creates activity)
  // ───────────────────────────────────────────────────────────────────────
  console.log('\n   4. User posting messages...')

  const gmr = new ethers.Contract(messageRegistryAddress, gmrAbi, userSigner)

  const messages = [
    'gm frens!',
    'Excited about this project',
    'LFG! 🚀',
  ]

  for (let i = 0; i < messages.length; i++) {
    const postTx = await gmr.post(
      erc404Instances[i % erc404Instances.length],
      0,
      0,
      ethers.constants.HashZero,
      ethers.constants.HashZero,
      messages[i]
    )
    await postTx.wait()
  }
  console.log(`      ✓ Posted ${messages.length} messages`)

  await provider.send('anvil_stopImpersonatingAccount', [userAddress])

  console.log('\n   ✅ Portfolio test data setup complete!')
  console.log('      User now has:')
  console.log('      - ERC404 holdings with buy history (for P&L)')
  console.log('      - ERC1155 editions (minted directly)')
  console.log('      - Vault benefactor position with claimable yield')
  console.log('      - NFTs (if buy crossed threshold)')
  console.log('      - Activity history (buys, mints, messages)')
}

/**
 * Seed ComponentRegistry with test components for the creation wizard.
 *
 * Registers mock gating and liquidity deployer components so the wizard
 * can query them via getApprovedComponentsByTag().
 *
 * @param {string} componentRegistryAddress - ComponentRegistry proxy address
 * @param {object} deployer - ethers Wallet
 */
export async function seedComponentRegistry(componentRegistryAddress, deployer) {
  if (!componentRegistryAddress || componentRegistryAddress === '0x0000000000000000000000000000000000000000') {
    console.log('   ⚠ ComponentRegistry not deployed, skipping seed')
    return
  }

  console.log('\n   Seeding ComponentRegistry...')
  const abi = await loadAbi('ComponentRegistry')
  const registry = new ethers.Contract(componentRegistryAddress, abi, deployer)

  const gatingTag = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('gating'))
  const liqTag = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('liquidity'))

  // Use deterministic placeholder addresses for test components
  const mockGating1 = '0x0000000000000000000000000000000000C0DE01'
  const mockGating2 = '0x0000000000000000000000000000000000C0DE02'
  const mockLiq1 = '0x0000000000000000000000000000000000C0DE03'
  const mockLiq2 = '0x0000000000000000000000000000000000C0DE04'

  const components = [
    { addr: mockGating1, tag: gatingTag, name: 'Password Tier Gating' },
    { addr: mockGating2, tag: gatingTag, name: 'Merkle Allowlist Gating' },
    { addr: mockLiq1,    tag: liqTag,    name: 'Uniswap V4 Deployer' },
    { addr: mockLiq2,    tag: liqTag,    name: 'ZAMM Deployer' },
  ]
  let registered = 0
  for (const { addr, tag, name } of components) {
    if (await registry.isApprovedComponent(addr)) {
      console.log(`      ⏭ Already registered: ${name}`)
    } else {
      await (await registry.approveComponent(addr, tag, name)).wait()
      console.log(`      ✓ Registered: ${name}`)
      registered++
    }
  }

  console.log(`   ✅ ComponentRegistry seeded (${registered} new, ${components.length - registered} already approved)`)
}
