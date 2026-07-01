import deployment from '../config/local-deployment.json'

/** Chain id of the local anvil mainnet-fork (see ./wagmi.ts) — literal-typed for wagmi hooks. */
export const forkChainId = deployment.chainId as 1337

const c = deployment.contracts

/**
 * Deployed addresses on the local fork. Addresses are NON-deterministic — DeployAnvil derives
 * CreateX salts from block.timestamp — so this file is REGENERATED on every deploy by the
 * dev-chain bridge (`pnpm chain:deploy`), not a stable committed snapshot. The committed copy is
 * a zero-address placeholder so typecheck/build pass without a live fork; run the bridge to
 * populate it. To keep the regenerated file out of git noise: `git update-index --skip-worktree
 * app/src/config/local-deployment.json`. Retired DAO contracts are intentionally excluded.
 */
export const forkAddresses = {
  MasterRegistryV1: c.MasterRegistryV1 as `0x${string}`,
  AlignmentRegistryV1: c.AlignmentRegistryV1 as `0x${string}`,
  GlobalMessageRegistry: c.GlobalMessageRegistry as `0x${string}`,
  FeaturedQueueManager: c.FeaturedQueueManager as `0x${string}`,
  ProtocolTreasuryV1: c.ProtocolTreasuryV1 as `0x${string}`,
  QueryAggregator: c.QueryAggregator as `0x${string}`,
  ERC404Factory: c.ERC404Factory as `0x${string}`,
  ERC1155Factory: c.ERC1155Factory as `0x${string}`,
  ERC721AuctionFactory: c.ERC721AuctionFactory as `0x${string}`,
  ComponentRegistry: c.ComponentRegistry as `0x${string}`,
  ProfileRegistry: c.ProfileRegistry as `0x${string}`,
  AlignmentTargetRequestRegistry: c.AlignmentTargetRequestRegistry as `0x${string}`,
  // Metadata-resolution stack singletons (ADR-0006/0007).
  MetadataResolverRouter: c.MetadataResolverRouter as `0x${string}`,
  MetadataOverlayModule: c.MetadataOverlayModule as `0x${string}`,
  TierRevealModule: c.TierRevealModule as `0x${string}`,
} as const
