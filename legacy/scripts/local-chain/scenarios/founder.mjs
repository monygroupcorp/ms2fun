// scripts/local-chain/scenarios/founder.mjs
//
// Founder scenario: runs the default seed, then transfers DAO founder
// status to USER_ADDRESS. Mints 5000 shares to the user and burns the
// deployer's 1000, making the user the sole majority shareholder.
//
// Usage: USER_ADDRESS=0x... node scripts/local-chain/run-local.mjs --scenario founder

import { ethers } from 'ethers'
import { seed as defaultSeed } from './default.mjs'
import { submitAndProcessProposal, loadAbi } from '../seed-common.mjs'

export async function seed(addresses, provider, deployer, userAddress, vaults) {
  // Run default scenario first
  const result = await defaultSeed(addresses, provider, deployer, userAddress, vaults)

  // Transfer founder status to userAddress
  const { governance } = addresses
  if (!userAddress) {
    console.log('   ⚠ No USER_ADDRESS — skipping founder transfer')
    return result
  }
  if (!governance?.grandCentral || governance.grandCentral === ethers.constants.AddressZero) {
    console.log('   ⚠ GrandCentral not deployed — skipping founder transfer')
    return result
  }

  console.log('\n════════════════════════════════════════════════════')
  console.log('FOUNDER SCENARIO: Transfer DAO ownership to user')
  console.log('════════════════════════════════════════════════════')

  const grandCentralAbi = await loadAbi('GrandCentral')
  const grandCentral = new ethers.Contract(governance.grandCentral, grandCentralAbi, deployer)

  const votingPeriod = parseInt((await grandCentral.votingPeriod()).toString())
  const gracePeriod = parseInt((await grandCentral.gracePeriod()).toString())

  // The default scenario leaves the last proposal active (voted but unprocessed).
  // GrandCentral requires sequential processing, so we must clear it first.
  const lastProposalId = parseInt((await grandCentral.proposalCount()).toString())
  console.log(`   Processing pending proposal #${lastProposalId}...`)

  // Advance time past voting + grace to make it processable
  await provider.send('evm_increaseTime', [votingPeriod + gracePeriod + 1])
  await provider.send('evm_mine', [])

  // The pending proposal from default scenario is a setGovernanceConfig call
  const pendingCalldata = grandCentral.interface.encodeFunctionData('setGovernanceConfig', [
    0, 0, 5, ethers.utils.parseEther('1'), 50
  ])
  await (await grandCentral.processProposal(
    lastProposalId, [governance.grandCentral], [0], [pendingCalldata]
  )).wait()
  console.log(`   Processed proposal #${lastProposalId}`)

  // Mint 5000 shares to userAddress
  const mintCalldata = grandCentral.interface.encodeFunctionData('mintShares', [
    [userAddress],
    [ethers.utils.parseEther('5000')],
  ])
  await submitAndProcessProposal({
    grandCentral, provider,
    targets: [governance.grandCentral],
    values: [0],
    calldatas: [mintCalldata],
    details: `Mint 5000 shares to founder ${userAddress}`,
    votingPeriod, gracePeriod,
  })
  console.log(`   Minted 5000 shares to ${userAddress}`)

  // Burn deployer's 1000 shares
  const burnCalldata = grandCentral.interface.encodeFunctionData('burnShares', [
    [deployer.address],
    [ethers.utils.parseEther('1000')],
  ])
  await submitAndProcessProposal({
    grandCentral, provider,
    targets: [governance.grandCentral],
    values: [0],
    calldatas: [burnCalldata],
    details: `Burn deployer shares (transfer founder role)`,
    votingPeriod, gracePeriod,
  })
  console.log(`   Burned 1000 deployer shares`)

  console.log(`\n   ✅ Founder transfer complete!`)
  console.log(`      ${userAddress} → 5000 shares (100% majority)`)
  console.log(`      ${deployer.address} → 0 shares`)

  return result
}
