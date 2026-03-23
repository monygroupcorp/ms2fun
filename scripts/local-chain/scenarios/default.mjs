// scripts/local-chain/scenarios/default.mjs
//
// Default seeding scenario — reads collection definitions from seed-collections.json.
// Creates ERC1155, ERC404, and ERC721 instances at different lifecycle stages.
// Does buys, mints, vault contributions, and ownership transfers to userAddress.

import { ethers } from 'ethers'
import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  TEST_ACCOUNTS,
  fundAccounts,
  refundAccounts,
  createERC404Instance,
  createERC1155Instance,
  createERC721AuctionInstance,
  buyOnBondingCurve,
  sellOnBondingCurve,
  activateBondingCurve,
  setupPortfolioTestData,
  loadAbi,
  getRandomMessageData,
  getRandomMessage,
  encodeMessageData,
  seedComponentRegistry,
  submitAndProcessProposal,
  BUY_MESSAGES,
  SELL_MESSAGES,
  BID_MESSAGES,
  MINT_MESSAGES,
} from '../seed-common.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ─────────────────────────────────────────────────────────────────────────────
// Load collection config
// ─────────────────────────────────────────────────────────────────────────────

const collectionsPath = path.resolve(__dirname, '..', 'seed-collections.json')
const COLLECTIONS = JSON.parse(await fs.readFile(collectionsPath, 'utf8'))

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Build a data:application/json URI from an object */
function dataUri(obj) {
  return `data:application/json,${encodeURIComponent(JSON.stringify(obj))}`
}

/** Resolve "primary"/"secondary" vault string to actual vault object */
function resolveVault(vaultKey, primaryVault, secondaryVault) {
  return vaultKey === 'secondary' ? secondaryVault : primaryVault
}

/** Resolve account name to address */
function resolveAccount(accountName, deployer) {
  if (accountName === 'deployer') return deployer.address
  return TEST_ACCOUNTS[accountName]?.address || accountName
}

/** Get a signer for an account name */
function resolveSigner(accountName, deployer, provider) {
  if (accountName === 'deployer') return deployer
  return provider.getSigner(TEST_ACCOUNTS[accountName].address)
}

/**
 * Default scenario seed function.
 */
export async function seed(addresses, provider, deployer, userAddress, vaults) {
  const { factories } = addresses

  const primaryVault = vaults[0]
  const secondaryVault = vaults[1] || vaults[0]

  // ─────────────────────────────────────────────────────────────────────────
  // Seed ComponentRegistry (if deployed)
  // ─────────────────────────────────────────────────────────────────────────
  let componentAddresses = {}
  if (addresses.core?.componentRegistry) {
    componentAddresses = await seedComponentRegistry(addresses.core.componentRegistry, deployer) || {}
  }
  const uniswapDeployerAddress = componentAddresses['Uniswap V4 Deployer']
  if (!uniswapDeployerAddress) throw new Error('Uniswap V4 Deployer not seeded — cannot create ERC404 instances')

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
  const vaultAbi = await loadAbi('UniAlignmentVault')
  const gmrAbi = await loadAbi('GlobalMessageRegistry')

  const erc1155Factory = new ethers.Contract(factories.erc1155, erc1155FactoryAbi, deployer)
  const erc404Factory = new ethers.Contract(factories.erc404, erc404FactoryAbi, deployer)

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 6: ERC1155 INSTANCES (first one — primary vault)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n════════════════════════════════════════════════════')
  console.log('PHASE 6: ERC1155 INSTANCES')
  console.log('════════════════════════════════════════════════════')

  const erc1155Results = []

  // --- First ERC1155: primary vault, simple editions ---
  const firstEditions = COLLECTIONS.erc1155[0]
  console.log(`\n   Creating ERC1155 ${firstEditions.displayName}...`)

  const firstEditionsVault = resolveVault(firstEditions.vault, primaryVault, secondaryVault)
  const firstEditionsAddress = await createERC1155Instance({
    name: firstEditions.name,
    creator: deployer.address,
    vault: firstEditionsVault.address,
    factory: erc1155Factory,
    metadataURI: dataUri({
      name: firstEditions.displayName,
      description: firstEditions.description,
      image: firstEditions.image,
      category: firstEditions.category,
      tags: firstEditions.tags,
    }),
  })
  console.log(`   ${firstEditions.displayName}: ${firstEditionsAddress}`)

  const firstEditionsContract = new ethers.Contract(firstEditionsAddress, erc1155InstanceAbi, deployer)

  // Add editions from config
  for (const edition of firstEditions.editions) {
    await (await firstEditionsContract.addEdition(
      edition.name,
      ethers.utils.parseEther(edition.price),
      edition.maxSupply,
      dataUri({ name: edition.displayName, description: edition.description, image: edition.image }),
      edition.pricingModel,
      edition.priceIncreaseRate || 0,
      0 // openTime
    )).wait()
    console.log(`   Added Edition: ${edition.displayName} (${edition.price} ETH, ${edition.maxSupply === 0 ? 'unlimited' : `max ${edition.maxSupply}`})`)
  }

  // Seed mints from config
  for (const mint of firstEditions.seedMints) {
    const signer = resolveSigner(mint.account, deployer, provider)
    const asUser = firstEditionsContract.connect(signer)
    const price = firstEditions.editions[mint.edition - 1].price
    await (await asUser.mint(
      mint.edition, mint.quantity,
      ethers.constants.HashZero,
      getRandomMessageData(MINT_MESSAGES),
      0,
      { value: ethers.utils.parseEther(String(Number(price) * mint.quantity)) }
    )).wait()
    console.log(`   Minted ${mint.quantity}x Edition ${mint.edition} to ${mint.account}`)
  }

  // User mints (mint via collector, transfer to user)
  for (const userMint of firstEditions.userMints) {
    const signer = resolveSigner(userMint.from, deployer, provider)
    const fromAddress = resolveAccount(userMint.from, deployer)
    const asFrom = firstEditionsContract.connect(signer)
    const price = firstEditions.editions[userMint.edition - 1].price

    for (let i = 0; i < userMint.mintQuantity; i++) {
      await (await asFrom.mint(
        userMint.edition, 1,
        ethers.constants.HashZero,
        getRandomMessageData(MINT_MESSAGES),
        0,
        { value: ethers.utils.parseEther(price) }
      )).wait()
    }
    await (await asFrom.safeTransferFrom(
      fromAddress, userAddress, userMint.edition, userMint.transferQuantity, '0x'
    )).wait()
    console.log(`   Transferred ${userMint.transferQuantity}x Edition ${userMint.edition} to user`)
  }

  erc1155Results.push({
    config: firstEditions,
    address: firstEditionsAddress,
    contract: firstEditionsContract,
    vault: firstEditionsVault,
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 7: ERC404 INSTANCES
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n════════════════════════════════════════════════════')
  console.log('PHASE 7: ERC404 INSTANCES')
  console.log('════════════════════════════════════════════════════')

  const erc404Results = []

  for (const collection of COLLECTIONS.erc404) {
    console.log(`\n   Creating ERC404 ${collection.displayName}...`)

    const vault = resolveVault(collection.vault, primaryVault, secondaryVault)
    const instanceAddress = await createERC404Instance({
      name: collection.name,
      symbol: collection.symbol,
      nftCount: collection.nftCount,
      presetId: collection.presetId,
      creator: deployer.address,
      vault: vault.address,
      factory: erc404Factory,
      metadataURI: dataUri({
        name: collection.displayName,
        description: collection.description,
        image: collection.image,
        category: collection.category,
        tags: collection.tags,
      }),
      liquidityDeployer: uniswapDeployerAddress,
    })
    console.log(`   ${collection.displayName}: ${instanceAddress}`)

    await activateBondingCurve({
      instanceAddress,
      instanceAbi: erc404InstanceAbi,
      deployer,
      provider,
    })
    console.log('   Bonding curve activated')

    // Seed trades from config (buys and sells)
    for (const trade of collection.buyers) {
      if (trade.type === 'sell') {
        await sellOnBondingCurve({
          instanceAddress,
          instanceAbi: erc404InstanceAbi,
          seller: resolveAccount(trade.account, deployer),
          tokenAmount: trade.tokens,
          provider,
        })
      } else {
        await buyOnBondingCurve({
          instanceAddress,
          instanceAbi: erc404InstanceAbi,
          buyer: resolveAccount(trade.account, deployer),
          tokenAmount: trade.tokens,
          provider,
        })
      }
    }

    // Transfer to user
    if (collection.userTransfer) {
      const fromAddress = resolveAccount(collection.userTransfer.from, deployer)
      const instance = new ethers.Contract(
        instanceAddress, erc404InstanceAbi, provider.getSigner(fromAddress)
      )
      await (await instance.transfer(userAddress, ethers.utils.parseEther(collection.userTransfer.amount))).wait()
      console.log(`   Seeded purchases & transferred ${collection.userTransfer.amount} ${collection.symbol} to user (~${collection.bondingTarget} bonding)`)
    }

    if (collection.bondingTarget === '100%') {
      console.log('   V4 liquidity deployment stubbed (complex integration)')
    }

    erc404Results.push({
      config: collection,
      address: instanceAddress,
      vault,
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 8: ADDITIONAL ERC1155 INSTANCES
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n════════════════════════════════════════════════════')
  console.log('PHASE 8: ADDITIONAL ERC1155 INSTANCES')
  console.log('════════════════════════════════════════════════════')

  // Re-fund accounts after expensive bonding curve buys
  await refundAccounts(provider, deployer, userAddress)

  // Process remaining ERC1155 collections (index 1+)
  for (let idx = 1; idx < COLLECTIONS.erc1155.length; idx++) {
    const collection = COLLECTIONS.erc1155[idx]
    console.log(`\n   Creating ERC1155 ${collection.displayName}...`)

    const vault = resolveVault(collection.vault, primaryVault, secondaryVault)
    const instanceAddress = await createERC1155Instance({
      name: collection.name,
      creator: deployer.address,
      vault: vault.address,
      factory: erc1155Factory,
      metadataURI: dataUri({
        name: collection.displayName,
        description: collection.description,
        image: collection.image,
        category: collection.category,
        tags: collection.tags,
      }),
    })
    console.log(`   ${collection.displayName}: ${instanceAddress}`)

    const instanceContract = new ethers.Contract(instanceAddress, erc1155InstanceAbi, deployer)

    // Add editions
    for (const edition of collection.editions) {
      await (await instanceContract.addEdition(
        edition.name,
        ethers.utils.parseEther(edition.price),
        edition.maxSupply,
        dataUri({ name: edition.displayName, description: edition.description, image: edition.image }),
        edition.pricingModel,
        edition.priceIncreaseRate || 0,
        0
      )).wait()
      const supplyLabel = edition.maxSupply === 0 ? 'unlimited' : `max ${edition.maxSupply}`
      const rateLabel = edition.priceIncreaseRate ? `, ${edition.priceIncreaseRate / 100}% increase` : ''
      console.log(`   Added Edition: ${edition.displayName} (${edition.price} ETH, ${supplyLabel}${rateLabel})`)
    }

    // Seed mints
    for (const mint of collection.seedMints) {
      if (mint.rotating) {
        // Rotating buyers pattern
        for (let i = 0; i < mint.count; i++) {
          const accountName = mint.rotating[i % mint.rotating.length]
          const signer = resolveSigner(accountName, deployer, provider)
          const asUser = instanceContract.connect(signer)

          // For dynamic pricing, read current price from contract
          const isDynamic = collection.editions[mint.edition - 1].pricingModel === 2
          let value
          if (isDynamic) {
            value = await instanceContract.getCurrentPrice(mint.edition)
          } else {
            value = ethers.utils.parseEther(collection.editions[mint.edition - 1].price)
          }

          await (await asUser.mint(
            mint.edition, 1,
            ethers.constants.HashZero,
            getRandomMessageData(MINT_MESSAGES),
            0,
            { value }
          )).wait()
        }
        console.log(`   Minted ${mint.count}x Edition ${mint.edition}`)
      } else {
        // Single account mint
        const signer = resolveSigner(mint.account, deployer, provider)
        const asUser = instanceContract.connect(signer)
        const price = collection.editions[mint.edition - 1].price
        await (await asUser.mint(
          mint.edition, mint.quantity,
          ethers.constants.HashZero,
          getRandomMessageData(MINT_MESSAGES),
          0,
          { value: ethers.utils.parseEther(String(Number(price) * mint.quantity)) }
        )).wait()
        console.log(`   Minted ${mint.quantity}x Edition ${mint.edition} to ${mint.account}`)
      }
    }

    // User mints (mint via account, transfer to user)
    for (const userMint of (collection.userMints || [])) {
      const fromAddress = resolveAccount(userMint.from, deployer)
      const signer = resolveSigner(userMint.from, deployer, provider)
      const asFrom = instanceContract.connect(signer)

      const isDynamic = collection.editions[userMint.edition - 1].pricingModel === 2
      for (let i = 0; i < userMint.mintQuantity; i++) {
        let value
        if (isDynamic) {
          value = await instanceContract.getCurrentPrice(userMint.edition)
        } else {
          value = ethers.utils.parseEther(collection.editions[userMint.edition - 1].price)
        }
        await (await asFrom.mint(
          userMint.edition, 1,
          ethers.constants.HashZero,
          getRandomMessageData(MINT_MESSAGES),
          0,
          { value }
        )).wait()
      }
      await (await asFrom.safeTransferFrom(
        fromAddress, userAddress, userMint.edition, userMint.transferQuantity, '0x'
      )).wait()
      console.log(`   Transferred ${userMint.transferQuantity}x Edition ${userMint.edition} to user`)
    }

    erc1155Results.push({
      config: collection,
      address: instanceAddress,
      contract: instanceContract,
      vault,
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 9: GLOBAL MESSAGE VERIFICATION
  // ═══════════════════════════════════════════════════════════════════════════
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

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 10: VAULT CONTRIBUTION SEEDING
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n════════════════════════════════════════════════════')
  console.log('PHASE 10: VAULT CONTRIBUTION SEEDING')
  console.log('════════════════════════════════════════════════════')

  // Artist withdrawals from ERC1155 instances (triggers vault tithe)
  const instancesForWithdrawal = erc1155Results.map(r => ({
    name: r.config.displayName,
    address: r.address,
    contract: r.contract.connect(deployer),
  }))

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

  // Try convertAndAddLiquidity on each vault
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

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 11: PORTFOLIO TEST DATA SETUP
  // ═══════════════════════════════════════════════════════════════════════════
  await setupPortfolioTestData({
    userAddress,
    erc404Instances: erc404Results.slice(0, 2).map(r => r.address),
    erc1155Instances: [erc1155Results[0].address],
    vaultAddress: primaryVault.address,
    messageRegistryAddress: addresses.core.globalMessageRegistry,
    provider,
    deployer,
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 13: ERC721 AUCTION INSTANCES
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n════════════════════════════════════════════════════')
  console.log('PHASE 13: ERC721 AUCTION INSTANCES')
  console.log('════════════════════════════════════════════════════')

  await refundAccounts(provider, deployer, userAddress)

  const erc721FactoryAbi = await loadAbi('ERC721AuctionFactory')
  const erc721InstanceAbi = await loadAbi('ERC721AuctionInstance')
  const erc721Factory = new ethers.Contract(factories.erc721, erc721FactoryAbi, deployer)

  const erc721Results = []

  // Signers for auction bids
  const traderSigner = provider.getSigner(TEST_ACCOUNTS.trader.address)
  const collectorSigner = provider.getSigner(TEST_ACCOUNTS.collector.address)
  const govSigner = provider.getSigner(TEST_ACCOUNTS.governance.address)

  for (const collection of COLLECTIONS.erc721) {
    console.log(`\n   Creating ERC721 ${collection.displayName}...`)

    const vault = resolveVault(collection.vault, primaryVault, secondaryVault)
    const instanceAddress = await createERC721AuctionInstance({
      name: collection.name,
      symbol: collection.symbol,
      lines: collection.lines,
      baseDuration: collection.baseDuration,
      timeBuffer: collection.timeBuffer,
      bidIncrement: collection.bidIncrement,
      creator: deployer.address,
      vault: vault.address,
      factory: erc721Factory,
      metadataURI: dataUri({
        name: collection.displayName,
        description: collection.description,
        image: collection.image,
        category: collection.category,
        tags: collection.tags,
      }),
    })
    console.log(`   ${collection.displayName}: ${instanceAddress}`)

    const instanceContract = new ethers.Contract(instanceAddress, erc721InstanceAbi, deployer)

    // Queue pieces
    for (const piece of collection.pieces) {
      const tokenURI = dataUri({
        name: piece.name,
        description: piece.description,
        image: piece.image,
      })
      await (await instanceContract.queuePiece(tokenURI, { value: ethers.utils.parseEther(collection.queueDeposit) })).wait()
      console.log(`   Queued piece: ${piece.name}`)
    }

    // Execute auction script
    const pieceResults = collection.pieces.map((p, i) => ({
      tokenId: i + 1,
      name: p.name,
      status: 'queued',
    }))

    for (const step of collection.auctionScript) {
      if (step._settleGroup) {
        // Advance time and settle multiple pieces
        if (step.advanceTime) {
          await provider.send('evm_increaseTime', [step.advanceTime])
          await provider.send('evm_mine', [])
        }
        for (const pieceId of step.settle) {
          await (await instanceContract.settleAuction(pieceId)).wait()
          pieceResults[pieceId - 1].status = 'settled'
          console.log(`   Piece ${pieceId} settled`)
        }
        continue
      }

      // Place bids
      if (step.bids) {
        for (const bid of step.bids) {
          const signer = resolveSigner(bid.account, deployer, provider)
          const asUser = instanceContract.connect(signer)
          await (await asUser.createBid(
            step.piece,
            encodeMessageData(getRandomMessage(BID_MESSAGES)),
            { value: ethers.utils.parseEther(bid.amount) }
          )).wait()
          console.log(`   Bid on piece ${step.piece}: ${bid.account} ${bid.amount} ETH`)
        }

        // Track highest bid
        const lastBid = step.bids[step.bids.length - 1]
        pieceResults[step.piece - 1].status = 'active'
        pieceResults[step.piece - 1].highestBid = lastBid.amount
        pieceResults[step.piece - 1].highestBidder = resolveAccount(lastBid.account, deployer)
      }

      // Settle this piece
      if (step.settle) {
        if (step.advanceTime) {
          await provider.send('evm_increaseTime', [step.advanceTime])
          await provider.send('evm_mine', [])
        }
        await (await instanceContract.settleAuction(step.piece)).wait()
        const winner = pieceResults[step.piece - 1].highestBidder
        pieceResults[step.piece - 1].status = 'settled'
        pieceResults[step.piece - 1].winner = winner
        console.log(`   Piece ${step.piece} settled — NFT to ${winner.slice(0, 8)}...`)

        // Transfer to user if requested
        if (step.transferToUser) {
          const winnerSigner = provider.getSigner(winner)
          const asWinner = new ethers.Contract(instanceAddress, erc721InstanceAbi, winnerSigner)
          await (await asWinner.transferFrom(winner, userAddress, step.piece)).wait()
          pieceResults[step.piece - 1].transferredTo = userAddress
          console.log(`   Transferred NFT #${step.piece} to user`)
        }
      }
    }

    erc721Results.push({
      config: collection,
      address: instanceAddress,
      vault,
      pieceResults,
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 12: OWNERSHIP TRANSFERS
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n════════════════════════════════════════════════════')
  console.log('PHASE 12: OWNERSHIP TRANSFERS')
  console.log('════════════════════════════════════════════════════')

  // Transfer ownership of collections flagged in config
  for (const result of erc1155Results) {
    if (result.config.ownershipTransfer) {
      await (await result.contract.transferOwnership(userAddress)).wait()
      console.log(`   ${result.config.displayName} owner transferred to user: ${userAddress}`)
    }
  }

  for (const result of erc404Results) {
    if (result.config.ownershipTransfer) {
      const instance = new ethers.Contract(result.address, erc404InstanceAbi, deployer)
      await (await instance.transferOwnership(userAddress)).wait()
      console.log(`   ${result.config.displayName} owner transferred to user: ${userAddress}`)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 14: GOVERNANCE SEEDING
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n════════════════════════════════════════════════════')
  console.log('PHASE 14: GOVERNANCE SEEDING')
  console.log('════════════════════════════════════════════════════')

  const { governance } = addresses
  if (!governance || !governance.grandCentral || governance.grandCentral === ethers.constants.AddressZero) {
    console.log('   ⚠ GrandCentral not deployed, skipping governance seeding')
  } else {
    const grandCentralAbi = await loadAbi('GrandCentral')
    const grandCentral = new ethers.Contract(governance.grandCentral, grandCentralAbi, deployer)
    const shareOfferingAbi = await loadAbi('ShareOffering', 'ShareOffering.sol')

    // Read governance config for time advances
    const votingPeriod = (await grandCentral.votingPeriod())
    const gracePeriod = (await grandCentral.gracePeriod())
    const vp = typeof votingPeriod === 'number' ? votingPeriod : parseInt(votingPeriod.toString())
    const gp = typeof gracePeriod === 'number' ? gracePeriod : parseInt(gracePeriod.toString())

    console.log(`   Voting period: ${vp}s, Grace period: ${gp}s`)

    // --- Phase A: Fund Treasury ---
    console.log('\n   Phase A: Fund DAO Treasury...')

    // Send ETH to the Safe
    const treasuryAmount = ethers.utils.parseEther('10')
    await (await deployer.sendTransaction({
      to: governance.safe,
      value: treasuryAmount,
    })).wait()
    console.log(`   Sent ${ethers.utils.formatEther(treasuryAmount)} ETH to Safe`)

    // Fund DAO pools via proposals
    // fundClaimsPool/fundRagequitPool are daoOrManager and check safe.balance
    // The 10 ETH sent to Safe above satisfies the balance check

    // Fund claims pool (5 ETH)
    const claimsAmount = ethers.utils.parseEther('5')
    const fundClaimsCalldata = grandCentral.interface.encodeFunctionData('fundClaimsPool', [claimsAmount])
    await submitAndProcessProposal({
      grandCentral, provider,
      targets: [governance.grandCentral],
      values: [0],
      calldatas: [fundClaimsCalldata],
      details: 'Fund claims pool with 5 ETH',
      votingPeriod: vp, gracePeriod: gp,
    })
    console.log('   Claims pool funded with 5 ETH')

    // Fund ragequit pool (3 ETH)
    const ragequitAmount = ethers.utils.parseEther('3')
    const fundRagequitCalldata = grandCentral.interface.encodeFunctionData('fundRagequitPool', [ragequitAmount])
    await submitAndProcessProposal({
      grandCentral, provider,
      targets: [governance.grandCentral],
      values: [0],
      calldatas: [fundRagequitCalldata],
      details: 'Fund ragequit pool with 3 ETH',
      votingPeriod: vp, gracePeriod: gp,
    })
    console.log('   Ragequit pool funded with 3 ETH')

    // --- Phase B: Demonstrate Proposal Flow ---
    console.log('\n   Phase B: Governance proposal demonstrations...')

    // Create a "set governance config" proposal (demonstrating parameter changes)
    // Pass 0 for votingPeriod/gracePeriod to keep current values (contract enforces min 1 day)
    const setConfigCalldata = grandCentral.interface.encodeFunctionData('setGovernanceConfig', [
      0,    // votingPeriod: 0 = no change (keep local dev value)
      0,    // gracePeriod: 0 = no change (keep local dev value)
      1,    // quorumPercent (keep at 1%)
      ethers.utils.parseEther('1'), // sponsorThreshold (keep at 1 share)
      50,   // minRetentionPercent (keep at 50%)
    ])

    const configProposalId = await submitAndProcessProposal({
      grandCentral, provider,
      targets: [governance.grandCentral],
      values: [0],
      calldatas: [setConfigCalldata],
      details: 'Confirm initial governance parameters',
      votingPeriod: vp, gracePeriod: gp,
    })
    console.log(`   Proposal #${configProposalId}: Governance config confirmed`)

    // --- Phase C: Create Share Offering Tranche ---
    console.log('\n   Phase C: Share Offering...')

    // Create tranche via Safe impersonation (local dev shortcut).
    // In production this would go through a DAO proposal, but execTransactionFromModule
    // on the canonical mainnet-fork Safe has gas/guard issues in Anvil.
    await provider.send('anvil_impersonateAccount', [governance.safe])
    const safeSigner = provider.getSigner(governance.safe)
    const soAsSafe = new ethers.Contract(governance.shareOffering, shareOfferingAbi, safeSigner)
    await (await soAsSafe.createTranche(
      ethers.utils.parseEther('0.01'),    // pricePerShare: 0.01 ETH
      500,                                 // totalShares: 500 available (raw count)
      86400,                               // duration: 24 hours
      1,                                   // minShares: 1 (raw count)
      100,                                 // maxSharesPerAddress: 100 (raw count)
      ethers.constants.HashZero,          // whitelistRoot (open to all)
    )).wait()
    await provider.send('anvil_stopImpersonatingAccount', [governance.safe])
    console.log('   Share offering tranche created (500 shares @ 0.01 ETH)')

    // Have a test account buy shares
    const traderSigner = provider.getSigner(TEST_ACCOUNTS.trader.address)
    const shareOfferingContract = new ethers.Contract(governance.shareOffering, shareOfferingAbi, traderSigner)

    try {
      await (await shareOfferingContract.commit(
        1, // trancheId (first tranche)
        10, // 10 shares (raw count)
        [], // no proof (open whitelist)
        { value: ethers.utils.parseEther('0.1') } // 10 × 0.01 ETH
      )).wait()
      console.log('   Trader committed to buy 10 shares')
    } catch (err) {
      console.log(`   ⚠ Share commitment failed: ${err.message.slice(0, 100)}`)
    }

    // --- Phase D: One Active (Unprocessed) Proposal ---
    console.log('\n   Phase D: Create pending proposal for UI...')

    // Submit a proposal but DON'T process it — so the UI has an active proposal to display
    const pendingDetails = 'Proposal to update quorum to 5% (pending)'
    const pendingCalldata = grandCentral.interface.encodeFunctionData('setGovernanceConfig', [
      0,  // votingPeriod: no change
      0,  // gracePeriod: no change
      5,  // quorumPercent: increase to 5%
      ethers.utils.parseEther('1'), 50
    ])

    const pendingTx = await grandCentral.submitProposal(
      [governance.grandCentral], [0], [pendingCalldata],
      0, pendingDetails
    )
    const pendingReceipt = await pendingTx.wait()
    const pendingEvent = pendingReceipt.events?.find(e => e.event === 'ProposalSubmitted')
    const pendingId = pendingEvent.args.proposalId.toNumber()

    // Vote yes but don't advance time or process
    await (await grandCentral.submitVote(pendingId, true)).wait()
    console.log(`   Proposal #${pendingId}: Active (voting in progress)`)

    console.log('\n   ✅ Governance seeding complete!')
    console.log(`      - ${configProposalId + 1} processed proposals`)
    console.log(`      - 1 active proposal (#${pendingId})`)
    console.log(`      - Share offering tranche active`)
    console.log(`      - Treasury funded and swept`)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Build and return result
  // ─────────────────────────────────────────────────────────────────────────
  return {
    instances: {
      erc404: erc404Results.map((r, i) => ({
        address: r.address,
        name: r.config.name,
        symbol: r.config.symbol,
        creator: deployer.address,
        owner: r.config.ownershipTransfer ? userAddress : deployer.address,
        vault: r.vault.address,
        state: r.config.bondingTarget === '100%' ? 'graduated' : r.config.bondingTarget === '10%' ? 'early-bonding' : 'active-bonding',
        bondingProgress: `~${r.config.bondingTarget}`,
        ...(r.config.ownershipTransfer && { note: 'Owned by userAddress for owner view testing' }),
        ...(r.config.bondingTarget === '100%' && { liquidityDeployed: false }),
      })),
      erc1155: erc1155Results.map(r => ({
        address: r.address,
        name: r.config.name,
        creator: deployer.address,
        owner: r.config.ownershipTransfer ? userAddress : deployer.address,
        vault: r.vault.address,
        ...(r.config.ownershipTransfer && { note: 'Owned by userAddress for owner view testing' }),
        editions: r.config.editions.map((ed, i) => ({
          id: i + 1,
          name: ed.name,
          price: ed.price,
          maxSupply: ed.maxSupply,
          ...(ed.priceIncreaseRate && { priceIncreaseRate: ed.priceIncreaseRate }),
        })),
      })),
      erc721: erc721Results.map(r => ({
        address: r.address,
        name: r.config.name,
        symbol: r.config.symbol,
        creator: deployer.address,
        vault: r.vault.address,
        lines: r.config.lines,
        baseDuration: r.config.baseDuration,
        timeBuffer: r.config.timeBuffer,
        bidIncrement: r.config.bidIncrement,
        pieces: r.pieceResults,
      })),
    },
    userHoldings: {
      erc404: erc404Results
        .filter(r => r.config.userTransfer)
        .map(r => ({
          instance: r.config.name,
          tokens: r.config.userTransfer.amount,
        })),
      erc1155: erc1155Results
        .filter(r => r.config.userMints?.length > 0)
        .map(r => ({
          instance: r.config.name,
          holdings: r.config.userMints.map(m => ({
            editionId: m.edition,
            quantity: m.transferQuantity,
          })),
        })),
      erc721: erc721Results
        .filter(r => r.pieceResults.some(p => p.transferredTo))
        .map(r => ({
          instance: r.config.name,
          holdings: r.pieceResults
            .filter(p => p.transferredTo)
            .map(p => ({ tokenId: p.tokenId, name: p.name })),
        })),
    },
    messages: {
      total: messageCount,
      note: 'Messages posted automatically during transactions',
    },
    governance: addresses.governance ? {
      proposalsCreated: true,
      shareOfferingActive: true,
      treasuryFunded: true,
    } : null,
  }
}
