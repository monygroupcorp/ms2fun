// scripts/local-chain/scenarios/empty.mjs
//
// Empty scenario: contracts deployed, nothing seeded.
// Useful for testing first-time user experience.

/**
 * @returns {Promise<object>}
 */
export async function seed(_addresses, _provider, _deployer, _userAddress) {
  console.log('   Empty scenario: skipping seeding')
  return {
    instances: { erc404: [], erc1155: [] },
    userHoldings: {},
    messages: { total: 0 },
  }
}
