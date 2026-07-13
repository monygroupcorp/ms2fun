/**
 * Concrete project-type descriptors — one per factory.
 *
 * Transcribes the real `createInstance` ABI surface of each factory into the typed
 * `ProjectTypeSchema` declared in `schema.ts`. The submit-builder maps `field.key`
 * directly onto contract args; `unit` documents ambiguous on-chain units.
 */

import type { FieldSchema, ModuleSlot, ProjectTypeSchema } from './schema'

// ── Shared sub-schemas ────────────────────────────────────────────────────────

const freeMintGroup: FieldSchema = {
  key: 'freeMint',
  label: 'Free mint',
  kind: 'group',
  learnMore: 'free-mint-reserve',
  fields: [
    {
      key: 'freeMint.allocation',
      label: 'Free allocation',
      kind: 'number',
      unit: 'count',
      default: 0,
      help: '0 disables free mint',
    },
    {
      key: 'freeMint.scope',
      label: 'Gating scope',
      kind: 'select',
      default: '0',
      options: [
        { value: '0', label: 'Both' },
        { value: '1', label: 'Free-mint only' },
        { value: '2', label: 'Paid only' },
      ],
      visibleWhen: { field: 'freeMint.allocation', greaterThan: 0 },
    },
  ],
}

const vaultSlot: ModuleSlot = {
  key: 'vault',
  label: 'Alignment vault',
  tag: 'vault',
  required: true,
  help: 'Aave endowment vault (pending T4)',
  learnMore: 'alignment-vault',
  pendingProvider: true,
}

// ── ERC-404 ───────────────────────────────────────────────────────────────────

const erc404: ProjectTypeSchema = {
  key: 'erc404',
  title: 'ERC-404 Bonding Collection',
  factory: 'ERC404Factory',
  summary: 'Hybrid ERC-20/ERC-721 bonding-curve collection with optional free mint and staking.',
  learnMore: 'erc404',
  coreFields: [
    // `name` is authored once on the "Collection page" step (CollectionMetaForm) and mirrored into
    // the create params — not a coreField, to avoid two Name inputs that could drift apart.
    {
      key: 'symbol',
      label: 'Symbol',
      kind: 'text',
      validation: { required: true },
    },
    // NOTE: `metadataURI` is NOT a coreField — it is authored on the "Collection page" step by
    // CollectionMetaForm and assembled at submit (collectionToDataUri). A raw text field here was
    // dead input (always overwritten) and read as "paste your art", which confused creators.
    {
      // Keyed `creator` (not `owner`) to share the wizard's creator plumbing with ERC1155/ERC721:
      // the autofill effect, `effectiveCreator`, and the agent-delegation gate all read
      // `values.creator`. The ERC404 builder maps it to the instance `owner` at submit. A field keyed
      // `owner` here was orphaned — never autofilled and read by nothing.
      key: 'creator',
      label: 'Creator',
      kind: 'address',
      help: 'Defaults to the connected wallet',
      validation: { required: true },
    },
    {
      key: 'nftCount',
      label: 'NFT supply',
      kind: 'bigint',
      unit: 'count',
      validation: { required: true, min: 1 },
    },
    {
      key: 'presetId',
      label: 'Launch preset',
      kind: 'select',
      default: '0',
      options: [
        {
          value: '0',
          label: 'NICHE — 5 ETH target',
          description: 'Low volume, high supply per NFT',
        },
        { value: '1', label: 'STANDARD — 25 ETH target', description: 'Balanced' },
        {
          value: '2',
          label: 'HYPE — 50 ETH target',
          description: 'High volume, low supply per NFT',
        },
      ],
      validation: { required: true },
    },
    {
      key: 'tokenBaseURI',
      label: 'Token base URI',
      kind: 'text',
      help: 'NFT tokenURI base path',
    },
    {
      key: 'declaredMaxAllowanceBps',
      label: 'Creator carve — declared max',
      kind: 'number',
      unit: 'bps',
      default: '10000',
      help:
        'IMMUTABLE disclosure, shown to buyers before the first buy: the fraction (bps, 10000 = all) ' +
        'of the protocol carve allowance you may ever take at graduation. The actual carve is chosen ' +
        'at graduation, bracket-bounded and pool-floor-clamped. 0 = waive carve rights forever.',
      // Not `required`: an untouched field submits the displayed default (10000) — the builder
      // (`buildErc404Create`) applies the same default, so form and calldata agree.
      validation: { min: 0, max: 10000 },
    },
    {
      key: 'styleUri',
      label: 'Style URI',
      kind: 'text',
    },
    freeMintGroup,
  ],
  moduleSlots: [
    vaultSlot,
    {
      key: 'liquidityDeployer',
      label: 'Liquidity deployer',
      tag: 'liquidity',
      required: true,
      help: 'DEX the bonding curve graduates into',
      learnMore: 'bonding-curve-graduation',
    },
    {
      key: 'gatingModule',
      label: 'Gating',
      tag: 'gating',
      required: false,
      learnMore: 'gating-overview',
    },
    {
      key: 'stakingModule',
      label: 'Staking',
      tag: 'staking',
      required: false,
    },
    // ── Metadata-resolution stack (ADR-0006/0007) ──────────────────────────────
    // All optional. The resolver (router) is the instance's METADATA_RESOLVER target; overlay/tier
    // are its children, wired + frozen at create. Selecting the resolver turns the feature on; the
    // overlay/tier slots supply the concrete modules the router stacks (precedence: overlay→tier).
    {
      key: 'resolver',
      label: 'Metadata resolver',
      tag: 'resolver',
      required: false,
      help: 'Router that stacks dynamic-metadata modules (overlay/tier). Off when unset.',
    },
    {
      key: 'overlay',
      label: 'Artist overlay',
      tag: 'overlay',
      required: false,
      help: 'Augmentation layer: event waves + paid commissions (configured post-create)',
      learnMore: 'metadata-overlay',
    },
    {
      key: 'tier',
      label: 'Tier reveal',
      tag: 'tier',
      required: false,
      help: 'Rarity-by-ownership reveal; tier table is set at create (immutable)',
      learnMore: 'tier-reveal',
    },
  ],
}

// ── ERC-1155 ──────────────────────────────────────────────────────────────────

const erc1155: ProjectTypeSchema = {
  key: 'erc1155',
  title: 'ERC-1155 Edition Collection',
  factory: 'ERC1155Factory',
  summary: 'Multi-edition ERC-1155 collection with per-edition pricing and optional gating.',
  learnMore: 'erc1155',
  coreFields: [
    // `name` + `metadataURI` are authored on the "Collection page" step (CollectionMetaForm) — name is
    // mirrored into the create params, metadataURI is assembled at submit. See the ERC-404 note above.
    {
      key: 'creator',
      label: 'Creator',
      kind: 'address',
      help: 'Defaults to the connected wallet',
      validation: { required: true },
    },
    {
      key: 'styleUri',
      label: 'Style URI',
      kind: 'text',
    },
    freeMintGroup,
  ],
  moduleSlots: [
    vaultSlot,
    {
      key: 'gatingModule',
      label: 'Gating',
      tag: 'gating',
      required: false,
      learnMore: 'gating-overview',
    },
  ],
  postCreate: {
    title: 'Editions',
    fields: [
      {
        key: 'pieceTitle',
        label: 'Title',
        kind: 'text',
        validation: { required: true },
      },
      {
        key: 'basePrice',
        label: 'Base price',
        kind: 'bigint',
        unit: 'wei',
        validation: { required: true },
      },
      {
        key: 'supply',
        label: 'Supply',
        kind: 'bigint',
        unit: 'count',
        help: 'Required for limited editions',
        default: 0,
        // UNLIMITED (pricingModel 0) requires supply == 0 on-chain — only collect supply otherwise.
        visibleWhen: { field: 'pricingModel', notEquals: '0' },
      },
      {
        key: 'metadataURI',
        label: 'Edition metadata URI',
        kind: 'text',
        help: 'addEdition metadata pointer (data:/ipfs)',
        validation: { required: true },
      },
      {
        key: 'pricingModel',
        label: 'Pricing model',
        kind: 'select',
        default: '0',
        options: [
          { value: '0', label: 'Unlimited (fixed price)' },
          { value: '1', label: 'Limited (fixed)' },
          { value: '2', label: 'Limited (dynamic)' },
        ],
        validation: { required: true },
      },
      {
        key: 'priceIncreaseRate',
        label: 'Price increase rate',
        kind: 'number',
        unit: 'bps',
        help: '100 = 1% per mint',
        visibleWhen: { field: 'pricingModel', equals: '2' },
      },
      {
        key: 'openTime',
        label: 'Open time',
        kind: 'number',
        unit: 'seconds',
        help: '0 = open immediately',
        default: 0,
      },
    ],
  },
}

// ── ERC-721 ───────────────────────────────────────────────────────────────────

const erc721: ProjectTypeSchema = {
  key: 'erc721',
  title: 'ERC-721 Auction Collection',
  factory: 'ERC721AuctionFactory',
  summary:
    'Sequential ERC-721 auction collection with configurable auction lines and anti-snipe buffer.',
  learnMore: 'erc721',
  coreFields: [
    // `name` + `metadataURI` are authored on the "Collection page" step (CollectionMetaForm) — name is
    // mirrored into the create params, metadataURI is assembled at submit. See the ERC-404 note above.
    {
      key: 'creator',
      label: 'Creator',
      kind: 'address',
      validation: { required: true },
    },
    {
      key: 'symbol',
      label: 'Symbol',
      kind: 'text',
      validation: { required: true },
    },
    {
      key: 'lines',
      label: 'Auction lines',
      kind: 'number',
      help: 'Concurrent auction slots',
      default: 1,
      validation: { required: true, min: 1, max: 3 },
    },
    {
      key: 'baseDuration',
      label: 'Base duration',
      kind: 'number',
      unit: 'seconds',
      validation: { required: true, min: 1 },
    },
    {
      key: 'timeBuffer',
      label: 'Anti-snipe buffer',
      kind: 'number',
      unit: 'seconds',
      validation: { required: true, min: 1 },
    },
    {
      key: 'bidIncrement',
      label: 'Min bid increment',
      kind: 'bigint',
      unit: 'wei',
      help: 'Absolute amount added to the current high bid (immutable)',
      validation: { required: true },
    },
  ],
  moduleSlots: [vaultSlot],
  postCreate: {
    title: 'Auction pieces',
    // queuePiece(string _tokenURI) payable — the reserve is sent as msg.value; start/end times are
    // set by the contract on queue, so they are NOT creator inputs.
    fields: [
      {
        key: 'tokenURI',
        label: 'Token URI',
        kind: 'text',
        validation: { required: true },
      },
      {
        key: 'minBid',
        label: 'Reserve / min bid',
        kind: 'bigint',
        unit: 'wei',
        help: 'Sent as msg.value when queuing the piece',
        validation: { required: true },
      },
    ],
  },
}

// ── Exports ───────────────────────────────────────────────────────────────────

export const PROJECT_TYPES: ProjectTypeSchema[] = [erc404, erc1155, erc721]

export function getProjectType(key: ProjectTypeSchema['key']): ProjectTypeSchema | undefined {
  return PROJECT_TYPES.find((pt) => pt.key === key)
}
