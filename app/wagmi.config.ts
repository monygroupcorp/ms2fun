import { defineConfig } from '@wagmi/cli'
import { foundry, react } from '@wagmi/cli/plugins'

/**
 * Generates typed contract hooks from the Foundry ABIs into `src/generated/`.
 * Run `pnpm wagmi:generate` after a `forge build` (the dev loop does this on (re)deploy).
 * `forge.build: false` — we read pre-built artifacts in `../contracts/out` rather than
 * triggering a full (slow) forge build during generation. Generated output is deterministic (G7).
 */
export default defineConfig({
  out: 'src/generated/contracts.ts',
  plugins: [
    foundry({
      project: '../contracts',
      forge: { build: false },
      include: [
        'MasterRegistryV1.sol/**',
        'AlignmentRegistryV1.sol/**',
        'AlignmentTargetRequestRegistry.sol/**',
        'GlobalMessageRegistry.sol/**',
        'ComponentRegistry.sol/**',
        'ProfileRegistry.sol/**',
        'QueryAggregator.sol/**',
        'FeaturedQueueManager.sol/**',
        'ProtocolTreasuryV1.sol/ProtocolTreasuryV1.json',
        'ERC404Factory.sol/**',
        'ERC404BondingInstance.sol/**',
        'ERC404StakingModule.sol/**',
        'CurveParamsComputer.sol/**',
        'ERC1155Factory.sol/**',
        'ERC1155Instance.sol/**',
        'AlignmentEndowmentVault.sol/**',
        'ERC721AuctionFactory.sol/**',
        'ERC721AuctionInstance.sol/**',
        'PasswordTierGatingModule.sol/**',
        'MetadataResolverRouter.sol/**',
        'TierRevealModule.sol/**',
        'MetadataOverlayModule.sol/**',
      ],
    }),
    react(),
  ],
})
