import deployment from '../config/local-deployment.json'

/** Chain id of the local anvil mainnet-fork (see ./wagmi.ts) — literal-typed for wagmi hooks. */
export const forkChainId = deployment.chainId as 1337

const c = deployment.contracts

/**
 * Deployed addresses on the local fork. Deterministic across redeploys (anvil CREATE from a
 * fixed deployer nonce), so this committed copy stays valid. Retired DAO contracts
 * (GrandCentral, GnosisSafe, ShareOffering, RevenueConductor, OTCShareEscrow — zero-addressed)
 * are intentionally excluded.
 */
export const forkAddresses = {
  MasterRegistryV1: c.MasterRegistryV1 as `0x${string}`,
  AlignmentRegistryV1: c.AlignmentRegistryV1 as `0x${string}`,
  GlobalMessageRegistry: c.GlobalMessageRegistry as `0x${string}`,
  FeaturedQueueManager: c.FeaturedQueueManager as `0x${string}`,
  QueryAggregator: c.QueryAggregator as `0x${string}`,
  ERC404Factory: c.ERC404Factory as `0x${string}`,
  ERC1155Factory: c.ERC1155Factory as `0x${string}`,
  ERC721AuctionFactory: c.ERC721AuctionFactory as `0x${string}`,
  ComponentRegistry: c.ComponentRegistry as `0x${string}`,
} as const
