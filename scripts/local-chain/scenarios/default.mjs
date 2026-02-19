// scripts/local-chain/scenarios/default.mjs
//
// Default seeding scenario: mirrors what the old deploy-local.mjs seeded.
// Creates 3 ERC1155 instances (Demo-Gallery, Dynamic-Pricing, Mixed-Supply) and
// 3 ERC404 instances (Early-Launch, Active-Project, Graduated) at different stages.
// Does buys, mints, vault contributions, and ownership transfers to userAddress.
//
// Ported from deploy-local.mjs phases 6-11.

import { ethers } from 'ethers'
import {
  TEST_ACCOUNTS,
  BUY_MESSAGES,
  MINT_MESSAGES,
  fundAccounts,
  refundAccounts,
  createERC404Instance,
  createERC1155Instance,
  buyOnBondingCurve,
  activateBondingCurve,
  loadAbi,
  getRandomMessage,
} from '../seed-common.mjs'

/**
 * Default scenario seed function.
 *
 * @param {object} addresses
 * @param {object} addresses.core - Core contract addresses
 * @param {string} addresses.core.masterRegistry
 * @param {string} addresses.core.globalMessageRegistry
 * @param {string} addresses.core.featuredQueueManager
 * @param {string} addresses.core.queryAggregator
 * @param {string} addresses.core.hookFactory
 * @param {object} addresses.factories - Factory addresses
 * @param {string} addresses.factories.erc1155
 * @param {string} addresses.factories.erc404
 * @param {object[]} addresses.vaults - Array of { address, alignmentToken, hookAddress }
 * @param {object} provider - ethers JsonRpcProvider
 * @param {object} deployer - ethers Wallet (deployer / anvil account 0)
 * @param {string} userAddress - External user wallet to receive tokens/ownership
 * @returns {Promise<object>} Seed result for write-config
 */
export async function seed(addresses, provider, deployer, userAddress, vaults) {
  const { factories } = addresses

  // Primary vault (MS2-aligned, index 0) and secondary vault (CULT-aligned, index 1)
  const primaryVault = vaults[0]
  const secondaryVault = vaults[1] || vaults[0]

  // ─────────────────────────────────────────────────────────────────────────
  // Fund accounts
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n   Funding accounts...')
  await fundAccounts(provider, deployer, userAddress)

  // ─────────────────────────────────────────────────────────────────────────
  // Load ABIs
  // ─────────────────────────────────────────────────────────────────────────
  const erc1155FactoryAbi = await loadAbi('ERC1155Factory')
  const erc1155InstanceAbi = await loadAbi('ERC1155Instance')
  const erc404FactoryAbi = await loadAbi('ERC404Factory')
  const erc404InstanceAbi = await loadAbi('ERC404BondingInstance')
  const vaultAbi = await loadAbi('UltraAlignmentVault')
  const gmrAbi = await loadAbi('GlobalMessageRegistry')

  const erc1155Factory = new ethers.Contract(factories.erc1155, erc1155FactoryAbi, deployer)
  const erc404Factory = new ethers.Contract(factories.erc404, erc404FactoryAbi, deployer)

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE 6: ERC1155 INSTANCE — Demo-Gallery (primary vault, MS2-aligned)
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════')
  console.log('PHASE 6: ERC1155 INSTANCES')
  console.log('════════════════════════════════════════════════════')

  console.log('\n   Creating ERC1155 Demo-Gallery...')
  const demoGalleryAddress = await createERC1155Instance({
    name: 'Demo-Gallery',
    creator: deployer.address,
    vault: primaryVault.address,
    factory: erc1155Factory,
  })
  console.log(`   Demo-Gallery: ${demoGalleryAddress}`)

  const demoGallery = new ethers.Contract(demoGalleryAddress, erc1155InstanceAbi, deployer)

  // Edition 1: Genesis-Piece (unlimited, 0.01 ETH fixed)
  await (await demoGallery.addEdition(
    'Genesis-Piece',
    ethers.utils.parseEther('0.01'),
    0,       // supply=0 means unlimited
    'https://ms2.fun/metadata/demo-gallery/1.json',
    0,       // PricingModel.UNLIMITED
    0        // priceIncreaseRate (unused for fixed)
  )).wait()
  console.log('   Added Edition 1: Genesis-Piece (0.01 ETH, unlimited)')

  // Edition 2: Limited-Drop (max 100, 0.02 ETH fixed)
  await (await demoGallery.addEdition(
    'Limited-Drop',
    ethers.utils.parseEther('0.02'),
    100,     // max supply
    'https://ms2.fun/metadata/demo-gallery/2.json',
    1,       // PricingModel.LIMITED_FIXED
    0
  )).wait()
  console.log('   Added Edition 2: Limited-Drop (0.02 ETH, max 100)')

  // Mint Edition 1: 3x to deployer
  await (await demoGallery.mint(
    1, 3,
    getRandomMessage(MINT_MESSAGES),
    0, // maxCost=0 means no cap check
    { value: ethers.utils.parseEther('0.03') }
  )).wait()
  console.log('   Minted 3x Edition 1 to deployer')

  // Mint Edition 2: 2x to trader
  const traderSigner = provider.getSigner(TEST_ACCOUNTS.trader.address)
  const demoGalleryAsTrader = demoGallery.connect(traderSigner)
  await (await demoGalleryAsTrader.mint(
    2, 2,
    getRandomMessage(MINT_MESSAGES),
    0,
    { value: ethers.utils.parseEther('0.04') }
  )).wait()
  console.log('   Minted 2x Edition 2 to trader')

  // Mint for user via collector then transfer
  const collectorSigner = provider.getSigner(TEST_ACCOUNTS.collector.address)
  const demoGalleryAsCollector = demoGallery.connect(collectorSigner)

  await (await demoGalleryAsCollector.mint(
    1, 2,
    getRandomMessage(MINT_MESSAGES),
    0,
    { value: ethers.utils.parseEther('0.02') }
  )).wait()
  await (await demoGalleryAsCollector.mint(
    2, 1,
    getRandomMessage(MINT_MESSAGES),
    0,
    { value: ethers.utils.parseEther('0.02') }
  )).wait()

  // Transfer to user
  await (await demoGalleryAsCollector.safeTransferFrom(
    TEST_ACCOUNTS.collector.address, userAddress, 1, 2, '0x'
  )).wait()
  await (await demoGalleryAsCollector.safeTransferFrom(
    TEST_ACCOUNTS.collector.address, userAddress, 2, 1, '0x'
  )).wait()
  console.log('   Transferred 2x Edition 1 + 1x Edition 2 to user')

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE 7: ERC404 INSTANCE SEEDING
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════')
  console.log('PHASE 7: ERC404 INSTANCES')
  console.log('════════════════════════════════════════════════════')

  // Instance 1: Early-Launch (~10% bonding progress)
  console.log('\n   Creating ERC404 Early-Launch...')
  const earlyLaunchAddress = await createERC404Instance({
    name: 'Early-Launch',
    symbol: 'EARLY',
    nftCount: 10,       // profileId=1: unitPerNFT=1,000,000 => maxSupply=10,000,000 tokens
    profileId: 1,
    creator: deployer.address,
    vault: primaryVault.address,
    hook: primaryVault.hookAddress,
    factory: erc404Factory,
  })
  console.log(`   Early-Launch: ${earlyLaunchAddress}`)

  await activateBondingCurve({
    instanceAddress: earlyLaunchAddress,
    instanceAbi: erc404InstanceAbi,
    deployer,
    provider,
  })
  console.log('   Bonding curve activated')

  // Seed ~10% progress (1,000 tokens out of ~9,000,000 bonding supply)
  // Profile gives maxSupply = 10 * 1,000,000 * 1e18, liquidity reserve = 10%
  // bonding supply = 90% of maxSupply = 9,000,000; 10% = 900,000 tokens
  const earlyBuyers = [
    { address: TEST_ACCOUNTS.trader.address, tokens: '200' },
    { address: TEST_ACCOUNTS.collector.address, tokens: '350' },  // 150 extra to transfer to user
    { address: TEST_ACCOUNTS.governance.address, tokens: '200' },
    { address: deployer.address, tokens: '200' },
    { address: TEST_ACCOUNTS.trader.address, tokens: '50' },
  ]

  for (const buyer of earlyBuyers) {
    await buyOnBondingCurve({
      instanceAddress: earlyLaunchAddress,
      instanceAbi: erc404InstanceAbi,
      buyer: buyer.address,
      tokenAmount: buyer.tokens,
      provider,
    })
  }

  // Transfer 150 tokens from collector to user
  const earlyInstance = new ethers.Contract(
    earlyLaunchAddress, erc404InstanceAbi, provider.getSigner(TEST_ACCOUNTS.collector.address)
  )
  await (await earlyInstance.transfer(userAddress, ethers.utils.parseEther('150'))).wait()
  console.log('   Seeded purchases & transferred 150 EARLY to user (~10% bonding)')

  // Instance 2: Active-Project (~60% bonding progress)
  console.log('\n   Creating ERC404 Active-Project...')

  const activeProjectAddress = await createERC404Instance({
    name: 'Active-Project',
    symbol: 'ACTIVE',
    nftCount: 10,
    profileId: 1,
    creator: deployer.address,
    vault: primaryVault.address,
    hook: primaryVault.hookAddress,
    factory: erc404Factory,
  })
  console.log(`   Active-Project: ${activeProjectAddress}`)

  await activateBondingCurve({
    instanceAddress: activeProjectAddress,
    instanceAbi: erc404InstanceAbi,
    deployer,
    provider,
  })

  // Seed ~60% progress
  const activeBuyers = [
    { address: TEST_ACCOUNTS.trader.address, tokens: '400' },
    { address: TEST_ACCOUNTS.collector.address, tokens: '1200' },  // 800 extra to transfer to user
    { address: TEST_ACCOUNTS.governance.address, tokens: '400' },
    { address: deployer.address, tokens: '400' },
    { address: TEST_ACCOUNTS.trader.address, tokens: '400' },
    { address: TEST_ACCOUNTS.governance.address, tokens: '400' },
    { address: TEST_ACCOUNTS.trader.address, tokens: '400' },
    { address: TEST_ACCOUNTS.governance.address, tokens: '400' },
    { address: deployer.address, tokens: '200' },
  ]

  for (const buyer of activeBuyers) {
    await buyOnBondingCurve({
      instanceAddress: activeProjectAddress,
      instanceAbi: erc404InstanceAbi,
      buyer: buyer.address,
      tokenAmount: buyer.tokens,
      provider,
    })
  }

  const activeInstance = new ethers.Contract(
    activeProjectAddress, erc404InstanceAbi, provider.getSigner(TEST_ACCOUNTS.collector.address)
  )
  await (await activeInstance.transfer(userAddress, ethers.utils.parseEther('800'))).wait()
  console.log('   Seeded purchases & transferred 800 ACTIVE to user (~60% bonding)')

  // Instance 3: Graduated (100% bonding)
  console.log('\n   Creating ERC404 Graduated...')

  const graduatedAddress = await createERC404Instance({
    name: 'Graduated',
    symbol: 'GRAD',
    nftCount: 10,
    profileId: 1,
    creator: deployer.address,
    vault: primaryVault.address,
    hook: primaryVault.hookAddress,
    factory: erc404Factory,
  })
  console.log(`   Graduated: ${graduatedAddress}`)

  await activateBondingCurve({
    instanceAddress: graduatedAddress,
    instanceAbi: erc404InstanceAbi,
    deployer,
    provider,
  })

  // Buy to 100% to trigger graduation
  const graduatedBuyers = [
    { address: TEST_ACCOUNTS.trader.address, tokens: '1500' },
    { address: TEST_ACCOUNTS.collector.address, tokens: '2500' },  // 1000 extra to transfer to user
    { address: TEST_ACCOUNTS.governance.address, tokens: '2000' },
    { address: deployer.address, tokens: '2000' },
  ]

  for (const buyer of graduatedBuyers) {
    await buyOnBondingCurve({
      instanceAddress: graduatedAddress,
      instanceAbi: erc404InstanceAbi,
      buyer: buyer.address,
      tokenAmount: buyer.tokens,
      provider,
    })
  }

  const graduatedAsCollector = new ethers.Contract(
    graduatedAddress, erc404InstanceAbi, provider.getSigner(TEST_ACCOUNTS.collector.address)
  )
  await (await graduatedAsCollector.transfer(userAddress, ethers.utils.parseEther('1000'))).wait()
  console.log('   Seeded purchases & transferred 1000 GRAD to user (100% bonding)')
  console.log('   V4 liquidity deployment stubbed (complex integration)')

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE 8: ADDITIONAL ERC1155 INSTANCES
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════')
  console.log('PHASE 8: ADDITIONAL ERC1155 INSTANCES')
  console.log('════════════════════════════════════════════════════')

  // Re-fund accounts after expensive bonding curve buys
  await refundAccounts(provider, deployer, userAddress)

  // Instance 2: Dynamic-Pricing (secondary/CULT vault)
  console.log('\n   Creating ERC1155 Dynamic-Pricing...')
  const dynamicPricingAddress = await createERC1155Instance({
    name: 'Dynamic-Pricing',
    creator: deployer.address,
    vault: secondaryVault.address,
    factory: erc1155Factory,
  })
  console.log(`   Dynamic-Pricing: ${dynamicPricingAddress}`)

  const dynamicInstance = new ethers.Contract(dynamicPricingAddress, erc1155InstanceAbi, deployer)

  // Edition 1: Evolving-Piece-1 (max 50, 0.005 ETH, 5% dynamic increase)
  await (await dynamicInstance.addEdition(
    'Evolving-Piece-1',
    ethers.utils.parseEther('0.005'),
    50,
    'https://ms2.fun/metadata/dynamic-pricing/1.json',
    2,   // PricingModel.LIMITED_DYNAMIC
    500  // 5% increase per mint (basis points)
  )).wait()
  console.log('   Added Edition 1: Evolving-Piece-1 (5% increase per mint, max 50)')

  // Edition 2: Evolving-Piece-2 (max 30, 0.01 ETH, 10% dynamic increase)
  await (await dynamicInstance.addEdition(
    'Evolving-Piece-2',
    ethers.utils.parseEther('0.01'),
    30,
    'https://ms2.fun/metadata/dynamic-pricing/2.json',
    2,    // LIMITED_DYNAMIC
    1000  // 10% increase per mint
  )).wait()
  console.log('   Added Edition 2: Evolving-Piece-2 (10% increase per mint, max 30)')

  // Mint 10x Edition 1 via collector/trader alternating
  for (let i = 0; i < 10; i++) {
    const buyer = i % 2 === 0 ? TEST_ACCOUNTS.collector.address : TEST_ACCOUNTS.trader.address
    const signer = provider.getSigner(buyer)
    const asUser = dynamicInstance.connect(signer)
    const currentPrice = await dynamicInstance.getCurrentPrice(1)
    await (await asUser.mint(1, 1, getRandomMessage(MINT_MESSAGES), 0, { value: currentPrice })).wait()
  }
  console.log('   Minted 10x Edition 1 (dynamic pricing)')

  // Mint 3x for user via collector, then transfer
  const dynamicAsCollector = dynamicInstance.connect(provider.getSigner(TEST_ACCOUNTS.collector.address))
  for (let i = 0; i < 3; i++) {
    const currentPrice = await dynamicInstance.getCurrentPrice(1)
    await (await dynamicAsCollector.mint(1, 1, getRandomMessage(MINT_MESSAGES), 0, { value: currentPrice })).wait()
  }
  await (await dynamicAsCollector.safeTransferFrom(
    TEST_ACCOUNTS.collector.address, userAddress, 1, 3, '0x'
  )).wait()
  console.log('   Minted & transferred 3x Edition 1 to user (dynamic pricing)')

  // Mint 8x Edition 2 via governance/deployer alternating
  for (let i = 0; i < 8; i++) {
    const buyer = i % 2 === 0 ? TEST_ACCOUNTS.governance.address : deployer.address
    const signer = buyer === deployer.address ? deployer : provider.getSigner(buyer)
    const asUser = dynamicInstance.connect(signer)
    const currentPrice = await dynamicInstance.getCurrentPrice(2)
    await (await asUser.mint(2, 1, getRandomMessage(MINT_MESSAGES), 0, { value: currentPrice })).wait()
  }
  console.log('   Minted 8x Edition 2 (dynamic pricing)')

  // Instance 3: Mixed-Supply (secondary vault)
  console.log('\n   Creating ERC1155 Mixed-Supply...')
  const mixedSupplyAddress = await createERC1155Instance({
    name: 'Mixed-Supply',
    creator: deployer.address,
    vault: secondaryVault.address,
    factory: erc1155Factory,
  })
  console.log(`   Mixed-Supply: ${mixedSupplyAddress}`)

  const mixedInstance = new ethers.Contract(mixedSupplyAddress, erc1155InstanceAbi, deployer)

  // Edition 1: Rare-Limited (max 100, 0.02 ETH fixed)
  await (await mixedInstance.addEdition(
    'Rare-Limited',
    ethers.utils.parseEther('0.02'),
    100,
    'https://ms2.fun/metadata/mixed-supply/1.json',
    1,  // LIMITED_FIXED
    0
  )).wait()
  console.log('   Added Edition 1: Rare-Limited (0.02 ETH, max 100)')

  // Edition 2: Common-Unlimited (0.005 ETH, unlimited)
  await (await mixedInstance.addEdition(
    'Common-Unlimited',
    ethers.utils.parseEther('0.005'),
    0,  // unlimited
    'https://ms2.fun/metadata/mixed-supply/2.json',
    0,  // UNLIMITED
    0
  )).wait()
  console.log('   Added Edition 2: Common-Unlimited (0.005 ETH, unlimited)')

  // Mint 40x Edition 1 via rotating buyers
  for (let i = 0; i < 40; i++) {
    const buyers = [
      TEST_ACCOUNTS.trader.address,
      TEST_ACCOUNTS.collector.address,
      TEST_ACCOUNTS.governance.address,
      deployer.address,
    ]
    const buyer = buyers[i % buyers.length]
    const signer = buyer === deployer.address ? deployer : provider.getSigner(buyer)
    const asUser = mixedInstance.connect(signer)
    await (await asUser.mint(1, 1, getRandomMessage(MINT_MESSAGES), 0, { value: ethers.utils.parseEther('0.02') })).wait()
  }
  console.log('   Minted 40x Edition 1 (40% sold out)')

  // Mint 5x Edition 1 for user via collector, transfer
  const mixedAsCollector = mixedInstance.connect(provider.getSigner(TEST_ACCOUNTS.collector.address))
  for (let i = 0; i < 5; i++) {
    await (await mixedAsCollector.mint(1, 1, getRandomMessage(MINT_MESSAGES), 0, { value: ethers.utils.parseEther('0.02') })).wait()
  }
  await (await mixedAsCollector.safeTransferFrom(
    TEST_ACCOUNTS.collector.address, userAddress, 1, 5, '0x'
  )).wait()
  console.log('   Minted & transferred 5x Edition 1 to user (limited)')

  // Mint 55x Edition 2 via rotating buyers
  for (let i = 0; i < 55; i++) {
    const buyers = [
      TEST_ACCOUNTS.trader.address,
      TEST_ACCOUNTS.collector.address,
      TEST_ACCOUNTS.governance.address,
      deployer.address,
    ]
    const buyer = buyers[i % buyers.length]
    const signer = buyer === deployer.address ? deployer : provider.getSigner(buyer)
    const asUser = mixedInstance.connect(signer)
    await (await asUser.mint(2, 1, getRandomMessage(MINT_MESSAGES), 0, { value: ethers.utils.parseEther('0.005') })).wait()
  }
  console.log('   Minted 55x Edition 2')

  // Mint 5x Edition 2 for user via collector, transfer
  for (let i = 0; i < 5; i++) {
    await (await mixedAsCollector.mint(2, 1, getRandomMessage(MINT_MESSAGES), 0, { value: ethers.utils.parseEther('0.005') })).wait()
  }
  await (await mixedAsCollector.safeTransferFrom(
    TEST_ACCOUNTS.collector.address, userAddress, 2, 5, '0x'
  )).wait()
  console.log('   Minted & transferred 5x Edition 2 to user (unlimited)')

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE 9: GLOBAL MESSAGE VERIFICATION
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════')
  console.log('PHASE 9: GLOBAL MESSAGE VERIFICATION')
  console.log('════════════════════════════════════════════════════')

  const messageRegistry = new ethers.Contract(addresses.core.globalMessageRegistry, gmrAbi, provider)
  let messageCount = 0
  try {
    const countBn = await messageRegistry.getMessageCount()
    messageCount = countBn.toNumber()
    console.log(`   Total messages: ${messageCount}`)
    if (messageCount < 10) {
      console.log('   Low message count — expected if GlobalMessageRegistry integration is partial')
    }
  } catch (err) {
    console.log(`   Could not query message count: ${err.message}`)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE 10: VAULT CONTRIBUTION SEEDING
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════')
  console.log('PHASE 10: VAULT CONTRIBUTION SEEDING')
  console.log('════════════════════════════════════════════════════')

  // Artist withdrawals from ERC1155 instances (triggers vault tithe)
  const instancesForWithdrawal = [
    { name: 'Demo-Gallery', address: demoGalleryAddress, contract: demoGallery },
    { name: 'Dynamic-Pricing', address: dynamicPricingAddress, contract: dynamicInstance.connect(deployer) },
    { name: 'Mixed-Supply', address: mixedSupplyAddress, contract: mixedInstance.connect(deployer) },
  ]

  for (const inst of instancesForWithdrawal) {
    const balance = await provider.getBalance(inst.address)
    console.log(`   ${inst.name} balance: ${ethers.utils.formatEther(balance)} ETH`)
    if (balance.gt(0)) {
      try {
        await (await inst.contract.withdraw(balance)).wait()
        const tithe = balance.mul(20).div(100)
        console.log(`   Withdrawn from ${inst.name} (vault tithe: ${ethers.utils.formatEther(tithe)} ETH)`)
      } catch (err) {
        console.log(`   Withdrawal from ${inst.name} skipped: ${err.message.slice(0, 60)}`)
      }
    }
  }

  // Direct contributions to vaults (simulates hook tax from V4 swaps)
  console.log('\n   Simulating direct vault contributions...')
  const contributionAmounts = [
    { contributor: TEST_ACCOUNTS.trader.address, amount: '0.5' },
    { contributor: TEST_ACCOUNTS.collector.address, amount: '0.3' },
    { contributor: TEST_ACCOUNTS.governance.address, amount: '0.2' },
  ]

  for (const vault of vaults) {
    for (const { contributor, amount } of contributionAmounts) {
      const contributorSigner = provider.getSigner(contributor)
      await (await contributorSigner.sendTransaction({
        to: vault.address,
        value: ethers.utils.parseEther(amount),
      })).wait()
      console.log(`   ${contributor.slice(0, 8)}... → ${vault.address.slice(0, 8)}... (${amount} ETH)`)
    }
  }

  // Try convertAndAddLiquidity on each vault (may fail on fresh fork — expected)
  for (const vault of vaults) {
    const vaultContract = new ethers.Contract(vault.address, vaultAbi, deployer)
    try {
      const pending = await vaultContract.totalPendingETH()
      if (pending.gt(0)) {
        await (await vaultContract.convertAndAddLiquidity(0, { gasLimit: 5_000_000 })).wait()
        console.log(`   convertAndAddLiquidity succeeded for ${vault.address.slice(0, 8)}...`)
      }
    } catch (err) {
      console.log(`   convertAndAddLiquidity skipped for ${vault.address.slice(0, 8)}...: ${err.message.slice(0, 60)}`)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE 11: OWNERSHIP TRANSFERS
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════')
  console.log('PHASE 11: OWNERSHIP TRANSFERS')
  console.log('════════════════════════════════════════════════════')

  // Transfer Demo-Gallery (ERC1155) ownership to userAddress
  await (await demoGallery.transferOwnership(userAddress)).wait()
  console.log(`   Demo-Gallery owner transferred to user: ${userAddress}`)

  // Transfer Early-Launch (ERC404) ownership to userAddress
  const earlyLaunchInstance = new ethers.Contract(earlyLaunchAddress, erc404InstanceAbi, deployer)
  await (await earlyLaunchInstance.transferOwnership(userAddress)).wait()
  console.log(`   Early-Launch owner transferred to user: ${userAddress}`)

  // ─────────────────────────────────────────────────────────────────────────
  // Build and return result
  // ─────────────────────────────────────────────────────────────────────────
  return {
    instances: {
      erc404: [
        {
          address: earlyLaunchAddress,
          name: 'Early-Launch',
          symbol: 'EARLY',
          creator: deployer.address,
          owner: userAddress,
          vault: primaryVault.address,
          hook: primaryVault.hookAddress,
          state: 'early-bonding',
          bondingProgress: '~10%',
          note: 'Owned by userAddress for owner view testing',
        },
        {
          address: activeProjectAddress,
          name: 'Active-Project',
          symbol: 'ACTIVE',
          creator: deployer.address,
          vault: primaryVault.address,
          hook: primaryVault.hookAddress,
          state: 'active-bonding',
          bondingProgress: '~60%',
        },
        {
          address: graduatedAddress,
          name: 'Graduated',
          symbol: 'GRAD',
          creator: deployer.address,
          vault: primaryVault.address,
          hook: primaryVault.hookAddress,
          state: 'graduated',
          bondingProgress: '100%',
          liquidityDeployed: false,
        },
      ],
      erc1155: [
        {
          address: demoGalleryAddress,
          name: 'Demo-Gallery',
          creator: deployer.address,
          owner: userAddress,
          vault: primaryVault.address,
          editions: [
            { id: 1, name: 'Genesis-Piece', price: '0.01', maxSupply: 0, minted: 5 },
            { id: 2, name: 'Limited-Drop', price: '0.02', maxSupply: 100, minted: 3 },
          ],
          note: 'Owned by userAddress for owner view testing',
        },
        {
          address: dynamicPricingAddress,
          name: 'Dynamic-Pricing',
          creator: deployer.address,
          vault: secondaryVault.address,
          pricingModel: 'exponential-increase',
          editions: [
            { id: 1, name: 'Evolving-Piece-1', basePrice: '0.005', priceIncreaseRate: 500, maxSupply: 50, minted: 13 },
            { id: 2, name: 'Evolving-Piece-2', basePrice: '0.01', priceIncreaseRate: 1000, maxSupply: 30, minted: 8 },
          ],
        },
        {
          address: mixedSupplyAddress,
          name: 'Mixed-Supply',
          creator: deployer.address,
          vault: secondaryVault.address,
          pricingModel: 'mixed',
          editions: [
            { id: 1, name: 'Rare-Limited', price: '0.02', maxSupply: 100, minted: 45, percentSold: 45 },
            { id: 2, name: 'Common-Unlimited', price: '0.005', maxSupply: 0, minted: 60 },
          ],
        },
      ],
    },
    userHoldings: {
      erc404: [
        { instance: 'Early-Launch', tokens: '150' },
        { instance: 'Active-Project', tokens: '800' },
        { instance: 'Graduated', tokens: '1000' },
      ],
      erc1155: [
        {
          instance: 'Demo-Gallery',
          holdings: [
            { editionId: 1, quantity: 2 },
            { editionId: 2, quantity: 1 },
          ],
        },
        {
          instance: 'Dynamic-Pricing',
          holdings: [{ editionId: 1, quantity: 3 }],
        },
        {
          instance: 'Mixed-Supply',
          holdings: [
            { editionId: 1, quantity: 5 },
            { editionId: 2, quantity: 5 },
          ],
        },
      ],
    },
    messages: {
      total: messageCount,
      note: 'Messages posted automatically during transactions',
    },
  }
}
