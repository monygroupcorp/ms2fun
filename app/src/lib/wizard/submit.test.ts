import { describe, expect, it } from 'vitest'
import { encodeFunctionData } from 'viem'
import {
  erc1155FactoryAbi,
  erc404FactoryAbi,
  erc721AuctionFactoryAbi,
} from '../../generated/contracts'
import {
  ZERO_ADDRESS,
  buildCreateInstance,
  buildErc1155Create,
  buildErc404Create,
  buildErc721Create,
} from './submit'
import type { CreateContext } from './submit'
import { EMPTY_TIER_CONFIG } from './gatingConfig'
import { EMPTY_METADATA_CONFIG, encodeMetadataConfig } from './metadataConfig'

// ── shared fixtures ───────────────────────────────────────────────────────────

const CREATOR = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const
const VAULT = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const
const GATING = '0xcccccccccccccccccccccccccccccccccccccccc' as const
const STAKING = '0xdddddddddddddddddddddddddddddddddddddddd' as const
const LIQUIDITY = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as const
const SALT = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as const
const METADATA_URI = 'ipfs://QmTestMetadata'

function baseCtx(overrides: Partial<CreateContext> = {}): CreateContext {
  return {
    creator: CREATOR,
    metadataURI: METADATA_URI,
    salt: SALT,
    modules: {
      vault: VAULT,
      gatingModule: GATING,
      liquidityDeployer: LIQUIDITY,
      stakingModule: STAKING,
    },
    values: {
      name: 'Test Collection',
      symbol: 'TEST',
      styleUri: 'ipfs://QmStyle',
      tokenBaseURI: 'ipfs://QmBase/',
      'freeMint.allocation': '500',
      'freeMint.scope': '2',
      lines: '4',
      baseDuration: '86400',
      timeBuffer: '300',
      bidIncrement: '1000000000000000',
      nftCount: '1000000000',
      presetId: '3',
    },
    ...overrides,
  }
}

// ── ERC1155 ───────────────────────────────────────────────────────────────────

describe('buildErc1155Create', () => {
  it('produces correct discriminant fields', () => {
    const call = buildErc1155Create(baseCtx())
    expect(call.type).toBe('erc1155')
    expect(call.factory).toBe('ERC1155Factory')
    expect(call.value).toBe(0n)
  })

  it('maps args[0] to salt', () => {
    const call = buildErc1155Create(baseCtx())
    expect(call.args[0]).toBe(SALT)
  })

  it('maps params tuple fields from context', () => {
    const ctx = baseCtx()
    const call = buildErc1155Create(ctx)
    if (call.type !== 'erc1155') throw new Error('unexpected type')
    expect(call.args[1].name).toBe('Test Collection')
    expect(call.args[1].metadataURI).toBe(METADATA_URI)
    expect(call.args[1].creator).toBe(CREATOR)
    expect(call.args[1].vault).toBe(VAULT)
    expect(call.args[1].styleUri).toBe('ipfs://QmStyle')
    expect(call.args[1].gatingModule).toBe(GATING)
  })

  it('coerces freeMint.allocation to bigint and scope to number', () => {
    const call = buildErc1155Create(baseCtx())
    if (call.type !== 'erc1155') throw new Error('unexpected type')
    expect(call.args[1].freeMint.allocation).toBe(500n)
    expect(typeof call.args[1].freeMint.allocation).toBe('bigint')
    expect(call.args[1].freeMint.scope).toBe(2)
    expect(typeof call.args[1].freeMint.scope).toBe('number')
  })
})

// ── ERC721 ───────────────────────────────────────────────────────────────────

describe('buildErc721Create', () => {
  it('produces correct discriminant fields', () => {
    const call = buildErc721Create(baseCtx())
    expect(call.type).toBe('erc721')
    expect(call.factory).toBe('ERC721AuctionFactory')
    expect(call.value).toBe(0n)
  })

  it('maps args[0] to salt', () => {
    expect(buildErc721Create(baseCtx()).args[0]).toBe(SALT)
  })

  it('maps symbol from values', () => {
    const call = buildErc721Create(baseCtx())
    if (call.type !== 'erc721') throw new Error('unexpected type')
    expect(call.args[1].symbol).toBe('TEST')
  })

  it('maps uint8/uint40 fields as numbers', () => {
    const call = buildErc721Create(baseCtx())
    if (call.type !== 'erc721') throw new Error('unexpected type')
    expect(call.args[1].lines).toBe(4)
    expect(typeof call.args[1].lines).toBe('number')
    expect(call.args[1].baseDuration).toBe(86400)
    expect(typeof call.args[1].baseDuration).toBe('number')
    expect(call.args[1].timeBuffer).toBe(300)
    expect(typeof call.args[1].timeBuffer).toBe('number')
  })

  it('maps bidIncrement as bigint', () => {
    const call = buildErc721Create(baseCtx())
    if (call.type !== 'erc721') throw new Error('unexpected type')
    expect(call.args[1].bidIncrement).toBe(1000000000000000n)
    expect(typeof call.args[1].bidIncrement).toBe('bigint')
  })
})

// ── ERC404 ───────────────────────────────────────────────────────────────────

describe('buildErc404Create', () => {
  it('produces correct discriminant fields', () => {
    const call = buildErc404Create(baseCtx())
    expect(call.type).toBe('erc404')
    expect(call.factory).toBe('ERC404Factory')
    expect(call.value).toBe(0n)
  })

  it('args layout: [params, metadataURI, liquidityDeployer, gatingModule, freeMint]', () => {
    const call = buildErc404Create(baseCtx())
    if (call.type !== 'erc404') throw new Error('unexpected type')
    // args[0] is the params object; args[1..4] are top-level
    expect(call.args[0].salt).toBe(SALT)
    expect(call.args[0].owner).toBe(CREATOR)
    expect(call.args[0].vault).toBe(VAULT)
    expect(call.args[1]).toBe(METADATA_URI)
    expect(call.args[2]).toBe(LIQUIDITY)
    expect(call.args[3]).toBe(GATING)
    // freeMint tuple at args[4]
    expect(call.args[4].allocation).toBe(500n)
    expect(call.args[4].scope).toBe(2)
  })

  it('maps nftCount as bigint and presetId as number', () => {
    const call = buildErc404Create(baseCtx())
    if (call.type !== 'erc404') throw new Error('unexpected type')
    expect(call.args[0].nftCount).toBe(1000000000n)
    expect(typeof call.args[0].nftCount).toBe('bigint')
    expect(call.args[0].presetId).toBe(3)
    expect(typeof call.args[0].presetId).toBe('number')
  })

  it('maps stakingModule from modules', () => {
    const call = buildErc404Create(baseCtx())
    if (call.type !== 'erc404') throw new Error('unexpected type')
    expect(call.args[0].stakingModule).toBe(STAKING)
  })
})

// ── Tier-gating config threading ──────────────────────────────────────────────

const TIER_CONFIG = {
  tierType: 0,
  passwordHashes: ['0x' + 'ab'.repeat(32)] as `0x${string}`[],
  volumeCaps: [100n],
  tierUnlockTimes: [],
}

describe('gating config threading', () => {
  it('ERC1155: legacy 2-arg create when no config', () => {
    const call = buildErc1155Create(baseCtx())
    expect(call.args.length).toBe(2)
  })

  it('ERC1155: 3-arg gated overload when config present', () => {
    const call = buildErc1155Create(baseCtx({ gatingConfig: TIER_CONFIG }))
    expect(call.args.length).toBe(3)
    expect(call.args[2]).toEqual(TIER_CONFIG)
  })

  it('ERC404: 5-arg legacy create when no config', () => {
    const call = buildErc404Create(baseCtx())
    expect(call.args.length).toBe(5)
  })

  it('ERC404: 6-arg gated overload appends config', () => {
    const call = buildErc404Create(baseCtx({ gatingConfig: TIER_CONFIG }))
    expect(call.args.length).toBe(6)
    expect(call.args[5]).toEqual(TIER_CONFIG)
  })

  it('does NOT thread config when no gating module is selected', () => {
    const call = buildErc1155Create(
      baseCtx({ gatingConfig: TIER_CONFIG, modules: { vault: VAULT } }),
    )
    expect(call.args.length).toBe(2)
  })

  it('does NOT thread an empty config (no passwordHashes)', () => {
    const empty = { tierType: 0, passwordHashes: [], volumeCaps: [], tierUnlockTimes: [] }
    const call = buildErc404Create(baseCtx({ gatingConfig: empty }))
    expect(call.args.length).toBe(5)
  })

  it('the gated args still encode against the factory ABI', () => {
    const call = buildErc404Create(baseCtx({ gatingConfig: TIER_CONFIG }))
    if (call.type !== 'erc404') throw new Error('unexpected type')
    expect(() =>
      encodeFunctionData({ abi: erc404FactoryAbi, functionName: 'createInstance', args: call.args }),
    ).not.toThrow()
  })
})

// ── Metadata-resolution stack threading (ADR-0006/0007) ───────────────────────

describe('metadata config threading', () => {
  const RESOLVER = '0x1111111111111111111111111111111111111111' as const
  const OVERLAY = '0x2222222222222222222222222222222222222222' as const
  const TIER = '0x3333333333333333333333333333333333333333' as const

  // A fully-wired stack: router pointer + [overlay, tier] children + one tier row + overlay flags.
  function stackCtx(extra: Partial<CreateContext> = {}): CreateContext {
    const meta = encodeMetadataConfig(
      { resolver: RESOLVER, overlay: OVERLAY, tier: TIER },
      {
        overlayAutoLatest: 'true',
        overlayDefaultPayout: '1',
        'tierIdStarts.0': '1',
        'tierIdEnds.0': '3',
        'tierMinBalances.0': '1000000000000000000000000',
        'tierBaseURIs.0': 'rare-',
        'tierLockedURIs.0': 'locked-',
      },
    )
    return baseCtx({ metadataConfig: meta, ...extra })
  }

  it('off (empty config) → falls back to the non-metadata overload', () => {
    const call = buildErc404Create(baseCtx({ metadataConfig: EMPTY_METADATA_CONFIG }))
    expect(call.args.length).toBe(5)
  })

  it('on, no gating → 7-arg overload with an EMPTY tier config at args[5]', () => {
    const call = buildErc404Create(stackCtx())
    if (call.type !== 'erc404') throw new Error('unexpected type')
    expect(call.args.length).toBe(7)
    expect(call.args[5]).toEqual(EMPTY_TIER_CONFIG) // gating slot filled with empty
    expect(call.args[6]?.resolver).toBe(RESOLVER)
    expect(call.args[6]?.childResolvers).toEqual([OVERLAY, TIER])
    expect(call.args[6]?.autoLatest).toBe(true)
    expect(call.args[6]?.defaultPayout).toBe(1)
    expect(call.args[6]?.tiers[0]?.baseURI).toBe('rare-')
  })

  it('on, with gating → 7-arg overload carries BOTH the tier config and the metadata config', () => {
    const call = buildErc404Create(stackCtx({ gatingConfig: TIER_CONFIG }))
    if (call.type !== 'erc404') throw new Error('unexpected type')
    expect(call.args.length).toBe(7)
    expect(call.args[5]).toEqual(TIER_CONFIG)
    expect(call.args[6]?.resolver).toBe(RESOLVER)
  })

  it('the 7-arg metadata args encode against the factory ABI', () => {
    const call = buildErc404Create(stackCtx({ gatingConfig: TIER_CONFIG }))
    if (call.type !== 'erc404') throw new Error('unexpected type')
    expect(() =>
      encodeFunctionData({ abi: erc404FactoryAbi, functionName: 'createInstance', args: call.args }),
    ).not.toThrow()
  })

  it('single module, no router → instance points directly at it (no children)', () => {
    const meta = encodeMetadataConfig(
      { tier: TIER },
      { 'tierIdStarts.0': '1', 'tierIdEnds.0': '3', 'tierMinBalances.0': '1', 'tierBaseURIs.0': 'r-' },
    )
    const call = buildErc404Create(baseCtx({ metadataConfig: meta }))
    if (call.type !== 'erc404') throw new Error('unexpected type')
    expect(call.args.length).toBe(7)
    expect(call.args[6]?.resolver).toBe(TIER)
    expect(call.args[6]?.childResolvers).toEqual([])
  })
})

// ── Module defaults (undefined → ZERO_ADDRESS) ────────────────────────────────

describe('module defaults', () => {
  function minCtx(): CreateContext {
    return baseCtx({
      modules: { vault: VAULT },
    })
  }

  it('erc1155: undefined gatingModule → ZERO_ADDRESS', () => {
    const call = buildErc1155Create(minCtx())
    if (call.type !== 'erc1155') throw new Error('unexpected type')
    expect(call.args[1].gatingModule).toBe(ZERO_ADDRESS)
  })

  it('erc404: undefined gatingModule → ZERO_ADDRESS at args[3]', () => {
    const call = buildErc404Create(minCtx())
    if (call.type !== 'erc404') throw new Error('unexpected type')
    expect(call.args[3]).toBe(ZERO_ADDRESS)
  })

  it('erc404: undefined liquidityDeployer → ZERO_ADDRESS at args[2]', () => {
    const call = buildErc404Create(minCtx())
    if (call.type !== 'erc404') throw new Error('unexpected type')
    expect(call.args[2]).toBe(ZERO_ADDRESS)
  })

  it('erc404: undefined stakingModule → ZERO_ADDRESS inside params', () => {
    const call = buildErc404Create(minCtx())
    if (call.type !== 'erc404') throw new Error('unexpected type')
    expect(call.args[0].stakingModule).toBe(ZERO_ADDRESS)
  })
})

// ── ERC404 creator-carve disclosure (declaredMaxAllowanceBps) ─────────────────

describe('erc404 declaredMaxAllowanceBps', () => {
  it('defaults an untouched field to 10000 (matches the schema default the form displays)', () => {
    const call = buildErc404Create(baseCtx()) // baseCtx has no declaredMaxAllowanceBps value
    if (call.type !== 'erc404') throw new Error('unexpected type')
    expect(call.args[0].declaredMaxAllowanceBps).toBe(10_000)
  })

  it('threads an explicit value, including 0 (waived carve rights)', () => {
    const at = (v: string): number => {
      const ctx = baseCtx()
      ctx.values.declaredMaxAllowanceBps = v
      const call = buildErc404Create(ctx)
      if (call.type !== 'erc404') throw new Error('unexpected type')
      return call.args[0].declaredMaxAllowanceBps
    }
    expect(at('2500')).toBe(2500)
    expect(at('0')).toBe(0)
    // Out-of-range/garbage input is clamped/floored client-side (the factory validates too).
    expect(at('20000')).toBe(10_000)
    expect(at('2500.9')).toBe(2500)
  })
})

// ── Coercion robustness ───────────────────────────────────────────────────────

describe('coercion robustness', () => {
  it('empty-string numeric values → 0n (uint256) and 0 (uint8/uint40)', () => {
    const ctx = baseCtx({
      values: {
        name: 'X',
        symbol: 'X',
        styleUri: '',
        tokenBaseURI: '',
        'freeMint.allocation': '',
        'freeMint.scope': '',
        lines: '',
        baseDuration: '',
        timeBuffer: '',
        bidIncrement: '',
        nftCount: '',
        presetId: '',
      },
    })

    const erc1155Call = buildErc1155Create(ctx)
    if (erc1155Call.type !== 'erc1155') throw new Error('unexpected type')
    expect(erc1155Call.args[1].freeMint.allocation).toBe(0n)
    expect(erc1155Call.args[1].freeMint.scope).toBe(0)

    const erc721Call = buildErc721Create(ctx)
    if (erc721Call.type !== 'erc721') throw new Error('unexpected type')
    expect(erc721Call.args[1].lines).toBe(0)
    expect(erc721Call.args[1].baseDuration).toBe(0)
    expect(erc721Call.args[1].timeBuffer).toBe(0)
    expect(erc721Call.args[1].bidIncrement).toBe(0n)

    const erc404Call = buildErc404Create(ctx)
    if (erc404Call.type !== 'erc404') throw new Error('unexpected type')
    expect(erc404Call.args[0].nftCount).toBe(0n)
    expect(erc404Call.args[0].presetId).toBe(0)
  })

  it('garbage numeric values → 0n / 0, never NaN / throw', () => {
    const ctx = baseCtx({
      values: {
        name: 'X',
        symbol: 'X',
        styleUri: '',
        tokenBaseURI: '',
        'freeMint.allocation': 'not-a-number',
        'freeMint.scope': 'abc',
        lines: 'abc',
        baseDuration: 'xyz',
        timeBuffer: 'bad',
        bidIncrement: '!!',
        nftCount: '??',
        presetId: 'p',
      },
    })

    expect(() => buildErc1155Create(ctx)).not.toThrow()
    expect(() => buildErc721Create(ctx)).not.toThrow()
    expect(() => buildErc404Create(ctx)).not.toThrow()

    const erc1155Call = buildErc1155Create(ctx)
    if (erc1155Call.type !== 'erc1155') throw new Error('unexpected type')
    expect(erc1155Call.args[1].freeMint.allocation).toBe(0n)
    expect(Number.isNaN(erc1155Call.args[1].freeMint.scope)).toBe(false)

    const erc404Call = buildErc404Create(ctx)
    if (erc404Call.type !== 'erc404') throw new Error('unexpected type')
    expect(erc404Call.args[0].nftCount).toBe(0n)
  })

  it('nftCount: "1000000000" → 1000000000n', () => {
    const ctx = baseCtx({ values: { ...baseCtx().values, nftCount: '1000000000' } })
    const call = buildErc404Create(ctx)
    if (call.type !== 'erc404') throw new Error('unexpected type')
    expect(call.args[0].nftCount).toBe(1000000000n)
  })
})

// ── Dispatcher ───────────────────────────────────────────────────────────────

describe('buildCreateInstance dispatcher', () => {
  it('routes erc1155 to ERC1155 builder', () => {
    expect(buildCreateInstance('erc1155', baseCtx()).type).toBe('erc1155')
  })

  it('routes erc721 to ERC721 builder', () => {
    expect(buildCreateInstance('erc721', baseCtx()).type).toBe('erc721')
  })

  it('routes erc404 to ERC404 builder', () => {
    expect(buildCreateInstance('erc404', baseCtx()).type).toBe('erc404')
  })
})

// ── ABI round-trip (encodeFunctionData) ──────────────────────────────────────

describe('ABI round-trip via encodeFunctionData', () => {
  it('erc1155 args conform to erc1155FactoryAbi', () => {
    const call = buildErc1155Create(baseCtx())
    if (call.type !== 'erc1155') throw new Error('unexpected type')
    let encoded: string
    expect(() => {
      encoded = encodeFunctionData({
        abi: erc1155FactoryAbi,
        functionName: 'createInstance',
        args: call.args,
      })
    }).not.toThrow()
    expect(encoded!).toMatch(/^0x/)
  })

  it('erc721 args conform to erc721AuctionFactoryAbi', () => {
    const call = buildErc721Create(baseCtx())
    if (call.type !== 'erc721') throw new Error('unexpected type')
    let encoded: string
    expect(() => {
      encoded = encodeFunctionData({
        abi: erc721AuctionFactoryAbi,
        functionName: 'createInstance',
        args: call.args,
      })
    }).not.toThrow()
    expect(encoded!).toMatch(/^0x/)
  })

  it('erc404 args conform to erc404FactoryAbi', () => {
    const call = buildErc404Create(baseCtx())
    if (call.type !== 'erc404') throw new Error('unexpected type')
    let encoded: string
    expect(() => {
      encoded = encodeFunctionData({
        abi: erc404FactoryAbi,
        functionName: 'createInstance',
        args: call.args,
      })
    }).not.toThrow()
    expect(encoded!).toMatch(/^0x/)
  })
})
