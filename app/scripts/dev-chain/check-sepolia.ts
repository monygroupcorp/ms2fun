/**
 * Sepolia-fork channel preflight: does the fork actually hold what the seed claims?
 *
 * The sibling of `check.ts`, for the second channel. `check.ts` reads
 * `src/config/local-deployment.json` against :8545; this reads
 * `src/config/local-deployment.sepolia.json` against :8546 and additionally asserts the SEED's own
 * hand-off, because the whole point of the channel is walking the showcase the seed built.
 *
 * It fixes nothing and refreshes nothing — it names the problem and exits non-zero. Bring the
 * channel up with `pnpm chain:fork:sepolia` / `pnpm chain:deploy:sepolia`.
 *
 * PRESENCE IS NOT IDENTITY. Code at an address only says something was deployed there. Where a
 * cheap typed view call can corroborate that the code behaves like the thing it is named after, one
 * is made — see `MasterRegistry` and the curve rows below.
 *
 * Run: `pnpm chain:check:sepolia` (tsx).
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPublicClient, http, zeroAddress, type Address, type PublicClient } from 'viem'

const here = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(here, '../..')
const repoRoot = resolve(appDir, '..')
const contractsDir = resolve(repoRoot, 'contracts')
const configPath = resolve(appDir, 'src/config/local-deployment.sepolia.json')
const seedStatePath = resolve(contractsDir, 'deployments/sepolia-seed.json')
const venuePath = resolve(contractsDir, 'deployments/sepolia-venues.json')
const saltsPath = resolve(contractsDir, 'script/SepoliaSalts.sol')

const CHAIN_ID = 11155111
const DEFAULT_RPC = 'http://127.0.0.1:8546'

const rpcIndex = process.argv.indexOf('--rpc-url')
const rpcUrl = rpcIndex === -1 ? DEFAULT_RPC : (process.argv[rpcIndex + 1] ?? DEFAULT_RPC)

const MASTER_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'isFactoryRegistered',
    stateMutability: 'view',
    inputs: [{ name: 'factory', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

/**
 * `metadataURI` is the PER-TOKEN base the instance composes `tokenURI(id)` against — distinct from
 * `contractURI`, which is the collection-level document. Reading it costs one view call and answers
 * on a pre-open row that has never minted a piece.
 */
const PIECE_BASE_ABI = [
  {
    type: 'function',
    name: 'metadataURI',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
] as const

const ALIGNMENT_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'getAlignmentTarget',
    stateMutability: 'view',
    inputs: [{ type: 'uint256' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'id', type: 'uint256' },
          { name: 'title', type: 'string' },
          { name: 'description', type: 'string' },
          { name: 'metadataURI', type: 'string' },
          { name: 'approvedAt', type: 'uint256' },
          { name: 'active', type: 'bool' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'getAcquireRoute',
    stateMutability: 'view',
    inputs: [{ type: 'uint256' }, { type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'venue', type: 'uint8' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'feeOrHook', type: 'uint256' },
        ],
      },
    ],
  },
] as const

/**
 * The alignment roster the seed stands up, mirroring `SeedSepoliaShared._alignmentRoster`.
 *
 * Held here as an EXPECTATION rather than read back from the seed's own output, so a roster that
 * silently loses a row, loses its logo, or gains back a target nobody chose fails this check instead
 * of reporting whatever it happens to hold.
 */
const TARGET_LOGO_DIR = 'ipfs://bafybeiaq7odvp24jbgwsyaxq5c67qs2iev2ct42rd7rhjuticpbqd6fhlm/'
const ALIGNMENT_ROSTER: { title: string; logo: string; endowment: boolean }[] = [
  { title: 'Remilia', logo: 'CULT.png', endowment: true },
  { title: 'MS2', logo: 'MS2.png', endowment: true },
  { title: 'SPX6900', logo: 'SPX.png', endowment: false },
  { title: 'MOG', logo: 'MOG.png', endowment: false },
  { title: 'ZAMM', logo: 'ZAMM.png', endowment: false },
  { title: 'CYPH', logo: 'CYPH.png', endowment: false },
]

/** Sepolia LINK — curated as a target once, to hang the endowment vault on. It must not come back. */
const RETIRED_TARGET_TOKEN = '0x779877A7B0D9E8603169DdbD7836e478b4624789'.toLowerCase()

const OVERLAY_ABI = [
  {
    type: 'function',
    name: 'waveCount',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'resolve',
    stateMutability: 'view',
    inputs: [{ type: 'address' }, { type: 'uint256' }, { type: 'address' }],
    outputs: [{ type: 'string' }],
  },
] as const

/**
 * The two directories the ARTIST METADATA row's upper layers resolve to, mirroring
 * `SeedSepoliaShared`. The wave is the maker's later expansion set; the commission is the maker's
 * later edition — the piece a holder paid to be upgraded to. Both are read as on-chain URI equality;
 * no gateway is contacted, so a directory that is not yet pinned still passes here.
 */
const WAVE_BASE = 'ipfs://bafybeifxf2xnossezzaywoni3gf5dfyqotn36vdvhnjkvldgkavyc2kx2q/'
const COMMISSION_BASE = 'ipfs://bafybeigtcr23kdzivowzasei7u7yza5frirctrjflytvooycb6tdqa4dga/'

/** The row the roster flags `metadataOverlay`, and the row that must NOT carry the overlay. */
const METADATA_SLUG = 'vapor-mid'

/** `SHOWCASE_NFT_COUNT` in `SeedSepoliaShared` — the piece ids a curve row can mint, so the id range
 *  the overlay is read across is the row's whole reachable range rather than a sample of it. */
const SHOWCASE_PIECE_IDS = 50

/**
 * The collection each curve row wears, mirroring the roster in `SeedSepoliaShared`. Every row on
 * this seed draws its pieces from a different collection; a row that came up on another row's
 * directory renders as a uniform wall and still passes every wiring check above. On-chain URI
 * equality only: no gateway is contacted from this script.
 */
const PIECE_BASE_BY_SLUG: Record<string, string> = {
  'ember-preopen': 'ipfs://QmZ7K6hG5uiTvLVvmxZgm72Nv3kmvTq4CVAEG6JoMFvpkW/',
  'vapor-mid': 'ipfs://bafybeigd7557iwardhnwg5kbmg2s7tmuxqkstjeoixu7wunooiywbb3jqq/',
  'cinder-ready': 'ipfs://bafybeih64fcswxjq7qrpx6hbzr2wkmn7u7bcl63yadaxmzgcyabecenl6e/',
  'flare-graduated': 'ipfs://bafybeibvgwjwuosoov6cfgwoyyrt7vocalqoprjayni6rfepda7bi2jdse/',
}

/**
 * The same reading for the BREADTH rows that carry an on-chain base, keyed by hand-off field rather
 * than by roster slug because those rows are recorded individually rather than in the roster list.
 * The edition and auction rows are absent on purpose: their mechanisms compose per-piece `data:`
 * documents and expose no base to read back.
 */
const BREADTH_PIECE_BASES: { key: BreadthKey; label: string; expected: string }[] = [
  {
    key: 'staking404',
    label: 'quarry-staking',
    expected: 'ipfs://QmanYsjnxPVtaFwUQ4uQSRETNWKjDSzeakT3iz13AUr4ZY/',
  },
  {
    key: 'tiers404',
    label: 'prism-tiers',
    expected: 'ipfs://QmX89dvzA3TSwsGfY7SthYkDxSFjszec8JkEEZE7JP5QHF/',
  },
  {
    key: 'carve404',
    label: 'carve-demo',
    expected: 'ipfs://bafybeic5in4it4rsocajjvzn3zs5scsci4a7hhpbpd5fulqca42vqtjs2q/',
  },
  {
    key: 'cypher404',
    label: 'cypher-flagship',
    expected: 'ipfs://bafybeicrcd4fgtumtkjfzkxkmlzqvy3w6cn2tlb3vm6jvbnxbojebvnwne/',
  },
]

/**
 * The directories this showcase has RETIRED. No row may compose its pieces against one of them: a
 * base that came back — copied across from another seed, or restored from an older revision — puts
 * foreign art on the wall while every other check here still passes. Matched as a substring,
 * because what is refused is the directory, not the exact string it was wired as.
 */
const RETIRED_ART_DIRS: readonly string[] = [
  'QmZcH4YvBVVRJtdn4RdbaqgspFU8gH6P9vomDpBVpAL3u4',
  'bafybeibc5sgo2plmjkq2tzmhrn54bk3crhnc23zd2msg4ea7a4pxrkgfna',
  'QmeSjSinHpPnmXmspMjwiXyN6zS4E9zccariGR3jxcaWtq',
  'QmPMc4tcBsMqLRuCQtPmPe84bpSjrC3Ky7t3JWuHXYB4aS',
  'QmYDvPAXtiJg7s8JdRBSLWdgSphQdac8j1YuQNNxcGE1hg',
]

/**
 * The one event every activity surface in the app reads: the home page's RECENT ACTIVITY preview,
 * each collection page's ACTIVITY section, and the board all render `MessagePosted` and nothing
 * else. Declared here as an event-only ABI because that is all this check needs — the group below
 * reads logs, it never calls the registry.
 */
const MESSAGE_POSTED_ABI = [
  {
    type: 'event',
    name: 'MessagePosted',
    inputs: [
      { name: 'messageId', type: 'uint256', indexed: true },
      { name: 'instance', type: 'address', indexed: true },
      { name: 'sender', type: 'address', indexed: true },
      { name: 'messageType', type: 'uint8', indexed: false },
      { name: 'refId', type: 'uint256', indexed: false },
      { name: 'actionRef', type: 'bytes32', indexed: false },
      { name: 'metadata', type: 'bytes32', indexed: false },
      { name: 'value', type: 'uint256', indexed: false },
      { name: 'content', type: 'string', indexed: false },
    ],
  },
] as const

/** `MessageTypes` (contracts/src/libraries/MessageTypes.sol), mirrored for the assertions below. */
const MESSAGE_TYPE = { POST: 0, REPLY: 1, QUOTE: 2, REACT: 3 } as const

/**
 * What the seed's activity wave puts on chain, as the floor this check holds it to.
 *
 * PER_CHANNEL is two because a single message renders as a one-line feed that still reads as an
 * accident; the seed posts two to every collection so each ACTIVITY section shows a filled state.
 * GLOBAL_MIN is the whole batch at its SMALLEST legal size — eleven collections (the Cypher row is
 * absent on deployments without the Algebra rail) times two, plus the nine messages the salon and
 * the typed trio contribute. A deployment carrying the Cypher row exceeds it by two.
 */
const ACTIVITY_MESSAGES_PER_CHANNEL = 2
const ACTIVITY_GLOBAL_MIN = 31

const BONDING_ABI = [
  {
    type: 'function',
    name: 'graduated',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'bool' }],
  },
] as const

/**
 * `name()` and `symbol()` are what every surface renders a collection AS — the home grid reads the
 * name straight off `getHomePageData`, and a wallet reads the symbol. Both are set once at create
 * and are not settable afterwards, so a row that came up under the wrong one is a re-seed, not a
 * fix; asserting them here is what makes that discoverable before anybody walks the showcase.
 */
const NAME_ABI = [
  {
    type: 'function',
    name: 'name',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
  {
    type: 'function',
    name: 'symbol',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
] as const

/**
 * The name and symbol each CURVE row must answer with, keyed by roster slug. The slug is the seed's
 * internal identifier — the salt input and this hand-off's map key — and is deliberately NOT the
 * display name: what a visitor reads is the name below.
 */
const NAME_BY_SLUG: Record<string, { name: string; symbol: string }> = {
  'ember-preopen': { name: 'SnoredMilady', symbol: 'SNORED' },
  'vapor-mid': { name: 'Voxelady', symbol: 'VOXY' },
  'cinder-ready': { name: 'Figmenta', symbol: 'FIGM' },
  'flare-graduated': { name: 'Shrimpsters', symbol: 'SHRMP' },
}

/**
 * The same reading for every row recorded under its own hand-off field: the two edition
 * collections, the three remaining ERC-404 rows, the Cypher flagship and the two auction houses.
 * Together with `NAME_BY_SLUG` this covers all twelve collections the seed creates.
 */
const NAMED_ROWS: { key: NamedKey; label: string; name: string; symbol: string }[] = [
  { key: 'editions', label: 'atlas-editions', name: 'GladbroWebring', symbol: 'GLADBRO' },
  { key: 'gatedEditions', label: 'veil-list', name: 'Mferlady', symbol: 'MFERL' },
  { key: 'staking404', label: 'quarry-staking', name: 'MiladySubstation', symbol: 'SUBSTN' },
  { key: 'tiers404', label: 'prism-tiers', name: 'SonoraEcho', symbol: 'ECHO' },
  { key: 'carve404', label: 'carve-demo', name: 'Ghibladita', symbol: 'GBLD' },
  { key: 'cypher404', label: 'cypher-flagship', name: 'AngeliteMaker', symbol: 'ANGLT' },
  { key: 'auctionTimed', label: 'relic-line', name: 'Mewlady', symbol: 'MEW' },
  { key: 'auctionLive', label: 'salon-line', name: 'Colombilady', symbol: 'COLMB' },
]

/**
 * The home page's own read. `getHomePageData` is a lens over the featured queue, so this is the
 * exact call the landing grid makes — a wall asserted against the queue directly would pass while
 * the aggregator the app actually reads answered with an empty grid.
 */
const HOME_PAGE_ABI = [
  {
    type: 'function',
    name: 'getHomePageData',
    stateMutability: 'view',
    inputs: [
      { name: 'offset', type: 'uint256' },
      { name: 'limit', type: 'uint256' },
    ],
    outputs: [
      {
        name: 'projects',
        type: 'tuple[]',
        components: [
          { name: 'instance', type: 'address' },
          { name: 'name', type: 'string' },
          { name: 'metadataURI', type: 'string' },
          { name: 'creator', type: 'address' },
          { name: 'registeredAt', type: 'uint256' },
          { name: 'factory', type: 'address' },
          { name: 'contractType', type: 'string' },
          { name: 'factoryTitle', type: 'string' },
          { name: 'vault', type: 'address' },
          { name: 'vaultName', type: 'string' },
          { name: 'currentPrice', type: 'uint256' },
          { name: 'totalSupply', type: 'uint256' },
          { name: 'maxSupply', type: 'uint256' },
          { name: 'isActive', type: 'bool' },
          { name: 'extraData', type: 'bytes' },
          { name: 'featuredRank', type: 'uint256' },
          { name: 'featuredExpires', type: 'uint256' },
        ],
      },
      { name: 'totalFeatured', type: 'uint256' },
    ],
  },
] as const

/** `QueryAggregator.MAX_QUERY_LIMIT` — a larger page is refused by the lens itself. */
const HOME_PAGE_LIMIT = 50n

interface AppConfig {
  chainId: number
  deployBlock?: number
  contracts: Record<string, Address>
}

/** The hand-off fields that name a breadth row carrying an on-chain piece base. */
type BreadthKey = 'staking404' | 'tiers404' | 'carve404' | 'cypher404'

/** Every hand-off field holding a collection whose name and symbol are checked below. */
type NamedKey = BreadthKey | 'editions' | 'gatedEditions' | 'auctionTimed' | 'auctionLive'

interface SeedState {
  chainId: number
  instances: Record<string, Address>
  editions?: Address
  gatedEditions?: Address
  auctionTimed?: Address
  auctionLive?: Address
  staking404?: Address
  tiers404?: Address
  carve404?: Address
  cypher404?: Address
  ms2Vault?: Address
  cultVault?: Address
  ms2ZammVault?: Address
  cultCypherVault?: Address
  ms2ReferencePool?: Address
  cultReferencePool?: Address
  cultAlgebraPool?: Address
  targetTokens?: Address[]
  targetVaults?: Address[]
  targetIds?: number[]
  endowmentVaults?: Address[]
  ms2TargetId?: number
  cultTargetId?: number
  ms2ZammTargetId?: number
  cultAlgebraTargetId?: number
  featured?: Address[]
}

const failures: string[] = []

function check(condition: boolean, ok: string, bad: string): void {
  if (condition) {
    console.log(`  ✓ ${ok}`)
  } else {
    console.log(`  ✗ ${bad}`)
    failures.push(bad)
  }
}

/** A base that landed inside a retired directory is named on its own line, not folded into the
 *  equality failure above: the two say different things, and the retired one is the regression. */
function checkNotRetired(label: string, base: string): void {
  const hit = RETIRED_ART_DIRS.find((dir) => base.includes(dir))
  check(
    hit === undefined,
    `${label} is clear of the retired directories`,
    `${label} composes its pieces against a RETIRED directory (${hit ?? ''})`,
  )
}

/**
 * The name and symbol one collection answers with, against what the seed says it created. Read as
 * two calls rather than one so a row that answers with the right name under the wrong ticker is
 * named for what it is: the name is what the grid shows, the symbol is what a wallet shows.
 */
async function checkNameAndSymbol(
  client: PublicClient,
  label: string,
  instance: Address,
  expected: { name: string; symbol: string },
): Promise<void> {
  const [name, symbol] = await Promise.all([
    client.readContract({ address: instance, abi: NAME_ABI, functionName: 'name' }).catch(() => ''),
    client
      .readContract({ address: instance, abi: NAME_ABI, functionName: 'symbol' })
      .catch(() => ''),
  ])
  check(
    name === expected.name,
    `${label} is on-chain "${expected.name}"`,
    `${label} is on-chain "${name || '(unreadable)'}", expected "${expected.name}"`,
  )
  check(
    symbol === expected.symbol,
    `${label} trades as ${expected.symbol}`,
    `${label} trades as ${symbol || '(unreadable)'}, expected ${expected.symbol}`,
  )
}

async function hasCode(client: PublicClient, address: Address): Promise<boolean> {
  if (address === zeroAddress) return false
  const code = await client.getCode({ address })
  return code !== undefined && code !== '0x'
}

function readJson<T>(path: string, what: string): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    throw new Error(`cannot read ${what} at ${path} — run pnpm chain:deploy:sepolia first`)
  }
}

/** The six CREATE3 registry addresses the salt set documents, by name. */
function documentedSaltAddresses(): { name: string; address: Address }[] {
  const source = readFileSync(saltsPath, 'utf8')
  const pattern =
    /bytes32 internal constant (\w+) = 0x[0-9a-fA-F]{64};\s*\/\/ => (0x[0-9a-fA-F]{40})/g
  return [...source.matchAll(pattern)].map((m) => ({ name: m[1], address: m[2] as Address }))
}

async function main(): Promise<void> {
  const config = readJson<AppConfig>(configPath, "the channel's app config")
  const client = createPublicClient({ transport: http(rpcUrl) }) as PublicClient

  console.log(`chain config : ${configPath}`)
  console.log(`rpc          : ${rpcUrl}`)
  console.log('')

  // ── The chain the config claims ──
  console.log('chain')
  let liveChainId = 0
  try {
    liveChainId = await client.getChainId()
  } catch {
    console.log(`  ✗ cannot reach ${rpcUrl} — start the channel: pnpm chain:fork:sepolia`)
    process.exit(1)
  }
  check(
    liveChainId === CHAIN_ID,
    `rpc reports chain ${liveChainId}`,
    `rpc reports chain ${liveChainId}, expected ${CHAIN_ID}`,
  )
  check(
    config.chainId === CHAIN_ID,
    `config names chain ${config.chainId}`,
    `config names chain ${config.chainId}, expected ${CHAIN_ID}`,
  )
  check(
    (config.deployBlock ?? 0) > 0,
    `deploy-block floor ${config.deployBlock}`,
    'deploy-block floor is 0 — the app would scan the fork from genesis',
  )

  // ── The protocol addresses the app reads ──
  console.log('\nprotocol addresses (app config)')
  for (const [name, address] of Object.entries(config.contracts)) {
    if (address === zeroAddress) {
      // A zero here is a statement the deploy made about this network, not a failure of the check.
      console.log(`  · ${name} is unset on this network`)
      continue
    }
    check(await hasCode(client, address), `${name} ${address}`, `${name} ${address} holds NO code`)
  }

  const masterRegistry = config.contracts.MasterRegistryV1
  const erc404Factory = config.contracts.ERC404Factory
  if (masterRegistry !== zeroAddress && erc404Factory !== zeroAddress) {
    const registered = await client
      .readContract({
        address: masterRegistry,
        abi: MASTER_REGISTRY_ABI,
        functionName: 'isFactoryRegistered',
        args: [erc404Factory],
      })
      .catch(() => false)
    check(
      registered,
      'MasterRegistry knows the ERC-404 factory (identity corroborated)',
      'MasterRegistry does not report the ERC-404 factory as registered — wrong instance, or a partial deploy',
    )
  }

  // ── The CREATE3 registry set ──
  console.log('\nCREATE3 registry set')
  for (const { name, address } of documentedSaltAddresses()) {
    check(
      await hasCode(client, address),
      `${name} ${address}`,
      `${name} ${address} holds NO code — the salt set did not deploy`,
    )
  }

  // ── What the seed claims it built ──
  const seed = readJson<SeedState>(seedStatePath, "the seed's hand-off")
  console.log('\nseed hand-off')
  check(
    seed.chainId === CHAIN_ID,
    `seed hand-off names chain ${seed.chainId}`,
    `seed hand-off names chain ${seed.chainId}, expected ${CHAIN_ID} (stale file?)`,
  )

  console.log('\ncurve rows')
  for (const [slug, address] of Object.entries(seed.instances)) {
    check(await hasCode(client, address), `${slug} ${address}`, `${slug} ${address} holds NO code`)
  }

  // ── The art each row wears ──
  //
  // A seeded row whose pieces resolve into the wrong collection is a failed seed even though it
  // holds code, is registered and reports the right curve state. Asserted by URI equality against
  // the roster's own bases — the check names a mismatch, it does not fetch the art.
  console.log('\ncollection art')
  for (const [slug, expected] of Object.entries(PIECE_BASE_BY_SLUG)) {
    const instance = seed.instances[slug]
    if (!instance || instance === zeroAddress) {
      check(false, '', `${slug} is missing from the seed hand-off — its art cannot be checked`)
      continue
    }
    const base = await client
      .readContract({ address: instance, abi: PIECE_BASE_ABI, functionName: 'metadataURI' })
      .catch(() => '')
    check(
      base === expected,
      `${slug} composes its pieces against its own collection`,
      `${slug} composes its pieces against ${base || '(unreadable)'}, expected ${expected}`,
    )
    checkNotRetired(slug, base)
  }

  // The breadth rows wear their own collections on the same terms. The Cypher row is optional: its
  // rail is not wired on every deployment, and phase 1 records a zero address when it is skipped.
  for (const { key, label, expected } of BREADTH_PIECE_BASES) {
    const instance = seed[key]
    if (!instance || instance === zeroAddress) {
      if (key === 'cypher404') {
        console.log(`  · ${label} is not on this deployment — its art is not checked`)
        continue
      }
      check(false, '', `${label} is missing from the seed hand-off — its art cannot be checked`)
      continue
    }
    const base = await client
      .readContract({ address: instance, abi: PIECE_BASE_ABI, functionName: 'metadataURI' })
      .catch(() => '')
    check(
      base === expected,
      `${label} composes its pieces against its own collection`,
      `${label} composes its pieces against ${base || '(unreadable)'}, expected ${expected}`,
    )
    checkNotRetired(label, base)
  }

  // ── The alignment roster ──
  //
  // Six communities, each with its own logo, its own vault and a curated venue behind it. Read from
  // the REGISTRY rather than from the seed's hand-off where it can be, because the hand-off records
  // what the seed believes it did and this check exists to disagree with that when it is wrong.
  console.log('\nalignment roster')
  const rosterRegistry = config.contracts.AlignmentRegistryV1
  const rosterIds = seed.targetIds ?? []
  const rosterVaults = seed.targetVaults ?? []
  const rosterTokens = seed.targetTokens ?? []
  const endowmentVaults = seed.endowmentVaults ?? []

  check(
    rosterIds.length === ALIGNMENT_ROSTER.length,
    `the roster stands up ${ALIGNMENT_ROSTER.length} communities`,
    `the roster stands up ${rosterIds.length} communities, expected ${ALIGNMENT_ROSTER.length}`,
  )

  if (rosterRegistry && rosterRegistry !== zeroAddress && rosterIds.length > 0) {
    const targets = await Promise.all(
      rosterIds.map((id) =>
        client
          .readContract({
            address: rosterRegistry,
            abi: ALIGNMENT_REGISTRY_ABI,
            functionName: 'getAlignmentTarget',
            args: [BigInt(id)],
          })
          .catch(() => undefined),
      ),
    )

    ALIGNMENT_ROSTER.forEach((expected, i) => {
      const target = targets[i]
      if (!target) {
        check(false, '', `${expected.title} did not read back from the registry`)
        return
      }
      check(
        target.title === expected.title,
        `${expected.title} is registered under its own name`,
        `roster row ${i} is "${target.title}", expected "${expected.title}"`,
      )
      // THE LOGO. A target whose metadataURI carries no image renders as the fallback glyph, which
      // is the state this roster existed to leave behind.
      const wantImage = `${TARGET_LOGO_DIR}${expected.logo}`
      check(
        target.metadataURI.includes(wantImage),
        `${expected.title} carries its own logo`,
        `${expected.title} does not point at ${wantImage}`,
      )
      check(
        target.active,
        `${expected.title} is active`,
        `${expected.title} is registered but not active`,
      )
    })

    // Every roster row is curated on a venue: a target a creator can pick whose route is NONE takes
    // their tithe and cannot acquire with it.
    const routes = await Promise.all(
      rosterIds.map((id, i) =>
        client
          .readContract({
            address: rosterRegistry,
            abi: ALIGNMENT_REGISTRY_ABI,
            functionName: 'getAcquireRoute',
            args: [BigInt(id), rosterTokens[i] ?? zeroAddress],
          })
          .catch(() => undefined),
      ),
    )
    const uncurated = ALIGNMENT_ROSTER.filter((_, i) => (routes[i]?.venue ?? 0) === 0).map(
      (r) => r.title,
    )
    check(
      uncurated.length === 0,
      'every community is curated on a venue',
      `no acquire route curated for: ${uncurated.join(', ')}`,
    )

    // The retired target must not come back. It was only ever a peg for the endowment vault, and the
    // endowments have real homes now.
    const retired = rosterTokens.filter((tk) => tk?.toLowerCase() === RETIRED_TARGET_TOKEN)
    check(
      retired.length === 0,
      'the retired endowment-peg target is gone',
      'a roster row still points at the retired endowment-peg token',
    )
  }

  // The endowment family hangs on the two rows that should carry one, and on no others.
  ALIGNMENT_ROSTER.forEach((expected, i) => {
    const vault = endowmentVaults[i]
    const has = vault !== undefined && vault !== zeroAddress
    check(
      has === expected.endowment,
      expected.endowment
        ? `${expected.title} carries an endowment vault`
        : `${expected.title} carries no endowment vault, as intended`,
      expected.endowment
        ? `${expected.title} should carry an endowment vault and does not`
        : `${expected.title} carries an endowment vault it was not meant to`,
    )
  })

  // Every community has a liquidity vault, and it holds code.
  const vaultChecks = await Promise.all(
    ALIGNMENT_ROSTER.map(async (expected, i) => {
      const vault = rosterVaults[i]
      if (!vault || vault === zeroAddress) return { expected, ok: false, why: 'no vault recorded' }
      return {
        expected,
        ok: await hasCode(client, vault),
        why: 'the recorded vault holds no code',
      }
    }),
  )
  for (const { expected, ok, why } of vaultChecks) {
    check(ok, `${expected.title} has a liquidity vault`, `${expected.title}: ${why}`)
  }

  // ── The artist-metadata demonstration ──
  //
  // The row shows three layers at once: the collection base, the artist's WAVE, and a PAID
  // commission. This reads what the overlay RESOLVES for every piece the row can mint, so it asserts
  // the demonstration a visitor actually sees rather than the calls the seed made. The counts are
  // exact — one wave piece, one paid commission — because "at least one" would pass a run that
  // switched the whole row onto one layer.
  console.log('\nartist metadata')
  const overlay = config.contracts.MetadataOverlayModule
  const metadataRow = seed.instances[METADATA_SLUG]
  if (!overlay || overlay === zeroAddress) {
    check(false, '', 'MetadataOverlayModule is unset — the artist-metadata row cannot be checked')
  } else if (!metadataRow || metadataRow === zeroAddress) {
    check(
      false,
      '',
      `${METADATA_SLUG} is missing from the seed hand-off — its metadata layers cannot be checked`,
    )
  } else {
    const waves = await client
      .readContract({
        address: overlay,
        abi: OVERLAY_ABI,
        functionName: 'waveCount',
        args: [metadataRow],
      })
      .catch(() => -1n)
    check(
      waves === 1n,
      `${METADATA_SLUG} carries the artist's one published wave`,
      `${METADATA_SLUG} carries ${waves === -1n ? '(unreadable)' : waves.toString()} waves, expected 1`,
    )

    const ids = Array.from({ length: SHOWCASE_PIECE_IDS }, (_, i) => BigInt(i + 1))
    const resolved = await Promise.all(
      ids.map((id) =>
        client
          .readContract({
            address: overlay,
            abi: OVERLAY_ABI,
            functionName: 'resolve',
            args: [metadataRow, id, zeroAddress],
          })
          .catch(() => ''),
      ),
    )
    const waveIds = ids.filter((id, i) => resolved[i] === `${WAVE_BASE}${id}`)
    const commissionIds = ids.filter((id, i) => resolved[i] === `${COMMISSION_BASE}${id}`)
    const strayIds = ids.filter(
      (id, i) =>
        resolved[i] !== '' &&
        resolved[i] !== `${WAVE_BASE}${id}` &&
        resolved[i] !== `${COMMISSION_BASE}${id}`,
    )
    check(
      waveIds.length === 1,
      `one piece wears the wave (id ${waveIds[0] ?? '-'})`,
      `${waveIds.length} pieces resolve to the wave directory, expected exactly 1`,
    )
    check(
      commissionIds.length === 1,
      `one piece wears a paid commission (id ${commissionIds[0] ?? '-'})`,
      `${commissionIds.length} pieces resolve to the commission directory, expected exactly 1`,
    )
    check(
      strayIds.length === 0,
      'every other piece falls through the overlay to the collection base',
      `${strayIds.length} pieces resolve to a directory that is neither the wave nor the commission`,
    )
    // The unpaid commission is the live action, so it must NOT be visible. It is authored on an id
    // whose `resolve` is empty — indistinguishable here from an untouched id, which is the point:
    // an unpaid commission shows a visitor the base, and the payment is what changes the picture.
    check(
      waveIds.length + commissionIds.length < SHOWCASE_PIECE_IDS,
      'pieces remain on the collection base for the layers to be told apart',
      'every piece is switched onto an upper layer — the base is not demonstrated',
    )
  }

  // The tier row demonstrates TOKEN TIERS and no longer carries the overlay: one row, one thing to
  // learn. A wave reappearing here is the demo-split regressing.
  if (overlay && overlay !== zeroAddress && seed.tiers404 && seed.tiers404 !== zeroAddress) {
    const tierWaves = await client
      .readContract({
        address: overlay,
        abi: OVERLAY_ABI,
        functionName: 'waveCount',
        args: [seed.tiers404],
      })
      .catch(() => -1n)
    check(
      tierWaves === 0n,
      'prism-tiers carries no overlay wave — its demonstration is Token Tiers alone',
      `prism-tiers carries ${tierWaves === -1n ? '(unreadable)' : tierWaves.toString()} overlay waves, expected 0`,
    )
  }

  // ── What every row is CALLED ──
  //
  // A collection's name and symbol are fixed at create, so a seed that came up under the wrong ones
  // cannot be corrected in place — the deployment has to be re-seeded. Asserting all twelve here is
  // what turns that into a preflight failure rather than something read off the home page later.
  console.log('\ncollection names')
  for (const [slug, expected] of Object.entries(NAME_BY_SLUG)) {
    const instance = seed.instances[slug]
    if (!instance || instance === zeroAddress) {
      check(false, '', `${slug} is missing from the seed hand-off — its name cannot be checked`)
      continue
    }
    await checkNameAndSymbol(client, slug, instance, expected)
  }
  for (const { key, label, name, symbol } of NAMED_ROWS) {
    const instance = seed[key]
    if (!instance || instance === zeroAddress) {
      // Same rule the art check follows: the Cypher rail is not wired on every deployment, and
      // phase 1 records a zero there rather than failing the whole showcase over one absent venue.
      if (key === 'cypher404') {
        console.log(`  · ${label} is not on this deployment — its name is not checked`)
        continue
      }
      check(false, '', `${label} is missing from the seed hand-off — its name cannot be checked`)
      continue
    }
    await checkNameAndSymbol(client, label, instance, { name, symbol })
  }

  // The graduated row is the one the walk is FOR: the curve closed and the raise moved into a live
  // pool. Its neighbour is asserted the other way, so a chain where everything graduated fails too.
  const graduatedRow = seed.instances['flare-graduated']
  if (graduatedRow) {
    const isGraduated = await client
      .readContract({ address: graduatedRow, abi: BONDING_ABI, functionName: 'graduated' })
      .catch(() => false)
    check(
      isGraduated,
      'flare-graduated has graduated',
      'flare-graduated reports NOT graduated — the graduated row is not walkable',
    )
  }
  const readyRow = seed.instances['cinder-ready']
  if (readyRow) {
    const isGraduated = await client
      .readContract({ address: readyRow, abi: BONDING_ABI, functionName: 'graduated' })
      .catch(() => true)
    check(
      !isGraduated,
      'cinder-ready is still ungraduated (graduation left uncrossed)',
      'cinder-ready has already graduated — the ready-to-graduate state is not walkable',
    )
  }

  // ── The four alignment targets and their venues ──
  console.log('\nalignment targets')
  const targets: [string, number | undefined][] = [
    ['MS2 / UNI_V4', seed.ms2TargetId],
    ['CULT / UNI_V4', seed.cultTargetId],
    ['MS2 / ZAMM', seed.ms2ZammTargetId],
    ['CULT / ALGEBRA', seed.cultAlgebraTargetId],
  ]
  for (const [label, id] of targets) {
    check(
      id !== undefined && id > 0,
      `${label} target id ${id}`,
      `${label} has no target id — that venue is missing from the showcase`,
    )
  }

  console.log('\nvaults and pools')
  const addressChecks: [string, Address | undefined][] = [
    ['MS2 alignment vault', seed.ms2Vault],
    ['CULT alignment vault', seed.cultVault],
    ['MS2 ZAMM vault', seed.ms2ZammVault],
    ['CULT Cypher vault', seed.cultCypherVault],
    ['MS2 reference pool', seed.ms2ReferencePool],
    ['CULT reference pool', seed.cultReferencePool],
    ['CULT Algebra pool', seed.cultAlgebraPool],
  ]
  for (const [label, address] of addressChecks) {
    if (!address || address === zeroAddress) {
      check(false, '', `${label} is unset in the seed hand-off`)
      continue
    }
    check(
      await hasCode(client, address),
      `${label} ${address}`,
      `${label} ${address} holds NO code`,
    )
  }

  // ── The featured wall: the showcase's front door ──
  //
  // A seeded chain can hold every collection the tour needs and still open on an empty wall: the
  // landing grid renders FEATURED PLACEMENTS, which are rented rather than created. So the wall is
  // asserted through `getHomePageData` — what the app calls — rather than through the roster.
  console.log('\nfeatured wall')
  const featured = seed.featured ?? []
  check(
    featured.length > 0,
    `seed hand-off claims ${featured.length} featured placement(s)`,
    'seed hand-off names NO featured placements — the home page opens on an empty wall',
  )

  const aggregator = config.contracts.QueryAggregator
  if (featured.length > 0) {
    if (!aggregator || aggregator === zeroAddress) {
      check(
        false,
        '',
        'QueryAggregator is unset in the app config — the home page has no lens to read',
      )
    } else {
      const home = await client
        .readContract({
          address: aggregator,
          abi: HOME_PAGE_ABI,
          functionName: 'getHomePageData',
          args: [0n, HOME_PAGE_LIMIT],
        })
        .catch(() => null)
      if (home === null) {
        check(false, '', 'getHomePageData reverted — the home page cannot render its grid at all')
      } else {
        const [projects, totalFeatured] = home
        check(
          Number(totalFeatured) >= featured.length,
          `getHomePageData reports ${totalFeatured} featured placement(s)`,
          `getHomePageData reports ${totalFeatured} featured placement(s), fewer than the ${featured.length} the seed rented`,
        )
        const rendered = new Set(projects.map((p) => p.instance.toLowerCase()))
        for (const [index, instance] of featured.entries()) {
          check(
            rendered.has(instance.toLowerCase()),
            `slot ${index + 1} ${instance} is on the wall`,
            `slot ${index + 1} ${instance} was rented but does not render on the home page`,
          )
        }
      }
    }
  }

  // The venue hand-off is what a later script reads to reach the ZAMM and Cypher families.
  const venues = readJson<{
    chainId: number
    zammVaultFactory: Address
    cypherVaultFactory: Address
  }>(venuePath, 'the venue hand-off')
  console.log('\nvenue factories')
  check(
    venues.chainId === CHAIN_ID,
    `venue hand-off names chain ${venues.chainId}`,
    `venue hand-off names chain ${venues.chainId}, expected ${CHAIN_ID}`,
  )
  for (const [label, address] of [
    ['ZAMM vault factory', venues.zammVaultFactory],
    ['Cypher vault factory', venues.cypherVaultFactory],
  ] as const) {
    check(
      await hasCode(client, address),
      `${label} ${address}`,
      `${label} ${address} holds NO code`,
    )
  }

  // ── The activity the showcase carries ──
  //
  // Every check above asserts something a visitor can only reach by clicking. This one asserts what
  // they read FIRST: the home page's activity preview, each collection's ACTIVITY section and the
  // board are rendered entirely from `MessagePosted`, so a seed that builds twelve collections and
  // posts to none of them opens all three on their empty state while passing every other group here.
  console.log('\nactivity')
  const registry = config.contracts.GlobalMessageRegistry
  if (!registry || registry === zeroAddress) {
    check(
      false,
      '',
      'GlobalMessageRegistry is unset in the app config — no activity surface can render',
    )
  } else {
    const logs = await client
      .getLogs({
        address: registry,
        event: MESSAGE_POSTED_ABI[0],
        fromBlock: BigInt(config.deployBlock ?? 0),
        toBlock: 'latest',
      })
      .catch(() => null)

    if (logs === null) {
      check(
        false,
        '',
        'the message registry could not be read for MessagePosted — the activity feed cannot render',
      )
    } else {
      check(
        logs.length >= ACTIVITY_GLOBAL_MIN,
        `board carries ${logs.length} message(s) (floor ${ACTIVITY_GLOBAL_MIN})`,
        `board carries ${logs.length} message(s), fewer than the ${ACTIVITY_GLOBAL_MIN} the seed posts — the board and the home preview open near-empty`,
      )

      // Per-channel, over the same twelve collections the name group walks. A total that clears the
      // floor says nothing about DISTRIBUTION: one busy channel and eleven silent ones passes the
      // count and still leaves eleven collection pages on their empty state.
      const perChannel = new Map<string, number>()
      let wallPosts = 0
      const typed = new Set<number>()
      for (const log of logs) {
        const { instance, sender, messageType } = log.args
        if (instance === undefined || sender === undefined || messageType === undefined) continue
        const key = instance.toLowerCase()
        perChannel.set(key, (perChannel.get(key) ?? 0) + 1)
        if (key === sender.toLowerCase()) wallPosts++
        typed.add(messageType)
      }

      const activityChannels: [string, Address | undefined][] = [
        ...Object.keys(NAME_BY_SLUG).map(
          (slug) => [slug, seed.instances[slug]] as [string, Address | undefined],
        ),
        ...NAMED_ROWS.map((row) => [row.label, seed[row.key]] as [string, Address | undefined]),
      ]
      for (const [label, instance] of activityChannels) {
        if (!instance || instance === zeroAddress) {
          // Same rule the art and name groups follow: the Cypher rail is not on every deployment.
          if (label === 'cypher-flagship') {
            console.log(`  · ${label} is not on this deployment — its channel is not checked`)
            continue
          }
          check(
            false,
            '',
            `${label} is missing from the seed hand-off — its channel cannot be checked`,
          )
          continue
        }
        const count = perChannel.get(instance.toLowerCase()) ?? 0
        check(
          count >= ACTIVITY_MESSAGES_PER_CHANNEL,
          `${label} channel carries ${count} message(s)`,
          `${label} channel carries ${count} message(s), fewer than ${ACTIVITY_MESSAGES_PER_CHANNEL} — its ACTIVITY section reads as empty`,
        )
      }

      // A WALL post — one filed under the poster's own address rather than a collection — is what
      // the board's own composer writes. Without one the board has nothing outside the collection
      // chips, which is the state it opens on.
      check(
        wallPosts > 0,
        `board holds ${wallPosts} wall post(s) outside the collection channels`,
        'board holds NO wall posts — the board opens with nothing outside the collection chips',
      )

      // The three typed messages, asserted from the events rather than from a count: the reply,
      // quote and reaction each drive a different renderer, and a feed of plain posts exercises none
      // of them.
      for (const [label, type] of [
        ['reply', MESSAGE_TYPE.REPLY],
        ['quote', MESSAGE_TYPE.QUOTE],
        ['endorsement', MESSAGE_TYPE.REACT],
      ] as const) {
        check(
          typed.has(type),
          `at least one ${label} (type ${type}) is on chain`,
          `NO ${label} (type ${type}) is on chain — that surface renders on no seeded message`,
        )
      }
    }
  }

  console.log('')
  if (failures.length > 0) {
    console.log(`✗ ${failures.length} check(s) failed on the Sepolia-fork channel.`)
    process.exit(1)
  }
  console.log('✅ The Sepolia-fork channel holds what the seed claims.')
  console.log('   Drive it: VITE_SEPOLIA_FORK=1 VITE_CHAIN_ID=11155111 pnpm dev')
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
