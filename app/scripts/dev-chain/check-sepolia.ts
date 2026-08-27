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

/**
 * The collection each curve row wears, mirroring the roster in `SeedSepoliaShared`. Every row on
 * this seed draws its pieces from a different collection; a row that came up on another row's
 * directory renders as a uniform wall and still passes every wiring check above. On-chain URI
 * equality only: no gateway is contacted from this script.
 */
const PIECE_BASE_BY_SLUG: Record<string, string> = {
  'ember-preopen': 'ipfs://bafybeigd7557iwardhnwg5kbmg2s7tmuxqkstjeoixu7wunooiywbb3jqq/',
  'vapor-mid': 'ipfs://QmZ7K6hG5uiTvLVvmxZgm72Nv3kmvTq4CVAEG6JoMFvpkW/',
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

interface SeedState {
  chainId: number
  instances: Record<string, Address>
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
