/**
 * Hand-written ABI fragments for the tithe report (`../../scripts/tithe-report.ts` + this dir).
 *
 * The generated wagmi bindings (`src/generated/contracts.ts`) carry `alignmentEndowmentVaultAbi`,
 * `alignmentRegistryV1Abi` and `masterRegistryV1Abi` — the report imports and reuses those directly
 * — but no ABI for the three liquidity-family vault contracts (`UniAlignmentVault`,
 * `CypherAlignmentVault`, `ZAMMAlignmentVault`) or for the hazard events emitted by the instance and
 * module contracts that call `receiveContribution`. CI never regenerates bindings, and running
 * `pnpm wagmi:generate` here would swamp this change with an unrelated regen diff, so these
 * fragments are hand-written instead — the minimal slice this report needs. Source line references
 * are current as of `main` @ 87b94cc.
 */

/**
 * `UniAlignmentVault.alignmentTargetId()` / `CypherAlignmentVault.alignmentTargetId()` /
 * `ZAMMAlignmentVault.alignmentTargetId()` — the liquidity-family target getter (set once at
 * initialization, no setter, so a read at `latest` is valid for all history). The endowment vault's
 * equivalent field is named `targetId()` and already ships in `alignmentEndowmentVaultAbi`; a report
 * must probe both names or an entire family reports nothing.
 */
export const alignmentTargetIdAbi = [
  {
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    name: 'alignmentTargetId',
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

/**
 * `IAlignmentVault.ContributionReceived(address indexed benefactor, uint256 amount)` — the receipt
 * event, emitted by every vault (liquidity and endowment alike) on every delivered contribution.
 * Identical shape to the copy already inside `alignmentEndowmentVaultAbi`; kept here so one ABI
 * covers every vault the report scans.
 */
export const contributionReceivedAbi = [
  {
    type: 'event',
    anonymous: false,
    name: 'ContributionReceived',
    inputs: [
      { name: 'benefactor', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
] as const

/**
 * `VaultCutRedirected(address indexed vault, address indexed treasury, uint256 amount)` — identical
 * signature on every emitter (the three liquidity deployer modules, `ERC1155Instance`,
 * `ERC721AuctionInstance`, `MetadataOverlayModule`): the vault's alignment target was revoked and the
 * tithe was routed to `protocolTreasury` instead of the de-curated vault.
 */
export const vaultCutRedirectedAbi = [
  {
    type: 'event',
    anonymous: false,
    name: 'VaultCutRedirected',
    inputs: [
      { name: 'vault', type: 'address', indexed: true },
      { name: 'treasury', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
] as const

/**
 * `VaultContributionFailed(address indexed vault, uint256 amount)` — the `ERC1155Instance` /
 * `ERC721AuctionInstance` shape: a mint/settle tithe could not be delivered and is stashed in the
 * instance's own retry queue (`pendingVaultCut`). The emitting contract address IS the benefactor —
 * these events are only ever emitted by the instance itself.
 */
export const vaultContributionFailedInstanceAbi = [
  {
    type: 'event',
    anonymous: false,
    name: 'VaultContributionFailed',
    inputs: [
      { name: 'vault', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
] as const

/**
 * `VaultContributionFailed(address indexed vault, address indexed instance, uint256 amount)` — the
 * graduation-module shape (the three liquidity deployer modules): a graduation vault cut could not be
 * delivered and was stashed for retry. Distinct topic0 from the instance-level shape above because it
 * carries an extra indexed `instance`, which doubles as the benefactor.
 */
export const vaultContributionFailedModuleAbi = [
  {
    type: 'event',
    anonymous: false,
    name: 'VaultContributionFailed',
    inputs: [
      { name: 'vault', type: 'address', indexed: true },
      { name: 'instance', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
] as const
