import { describe, expect, it } from 'vitest'
import { decodeFunctionData, encodeFunctionData } from 'viem'
import { erc404FactoryAbi } from '../../generated/contracts'
import { getProjectType, PROJECT_TYPES } from './projectTypes'
import { collectDefaults, validateFields } from './schema'
import {
  advancedInEffect,
  defaultLiquidityDeployer,
  hasAdvancedSettings,
  visibleFields,
  visibleSlots,
} from './simpleMode'
import { ZERO_ADDRESS, buildCreateInstance } from './submit'

const V4 = '0x367039E2E64c9405213Ab077C130a5Df9e78466C' as const
const ZAMM = '0x4B7a7485D974013e9553f2dcFd2F544822B9DC46' as const
const VAULT = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const
const CREATOR = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const
const SALT = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as const
const TIER = '0x00000000000000000000000000000000000000a1' as const

const erc404 = getProjectType('erc404')!

describe('simple mode hides the advanced settings', () => {
  it('hides the carve disclosure from the ERC-404 core fields', () => {
    const simple = visibleFields(erc404.coreFields, false).map((f) => f.key)
    expect(simple).not.toContain('declaredMaxAllowanceBps')
    // What a launch needs is still there.
    expect(simple).toEqual(expect.arrayContaining(['symbol', 'nftCount', 'presetId', 'creator']))
    expect(visibleFields(erc404.coreFields, true).map((f) => f.key)).toContain(
      'declaredMaxAllowanceBps',
    )
  })

  it('hides the resolver, tier and overlay slots, keeping liquidity, gating and staking', () => {
    const simple = visibleSlots(erc404.moduleSlots, false).map((s) => s.key)
    expect(simple).toEqual(['liquidityDeployer', 'gatingModule', 'stakingModule'])
    expect(visibleSlots(erc404.moduleSlots, true).map((s) => s.key)).toEqual(
      expect.arrayContaining(['resolver', 'tier', 'overlay']),
    )
  })

  it('never hides a required slot or a required field', () => {
    for (const pt of PROJECT_TYPES) {
      for (const s of pt.moduleSlots) if (s.advanced) expect(s.required).toBe(false)
      for (const f of pt.coreFields) if (f.advanced) expect(f.validation?.required).not.toBe(true)
    }
  })

  it('only ERC-404 has anything for the toggle to reveal', () => {
    expect(hasAdvancedSettings(erc404)).toBe(true)
    expect(hasAdvancedSettings(getProjectType('erc1155')!)).toBe(false)
    expect(hasAdvancedSettings(getProjectType('erc721')!)).toBe(false)
  })
})

describe('advancedInEffect (hidden is not reset)', () => {
  const defaults = collectDefaults(erc404.coreFields)

  it('is empty for an untouched launch', () => {
    expect(advancedInEffect(erc404, defaults, {})).toEqual([])
    // A blank carve submits the same 10000 default, so it is not a change either.
    expect(advancedInEffect(erc404, { ...defaults, declaredMaxAllowanceBps: '' }, {})).toEqual([])
    // A "None" choice on an advanced slot is the zero address — still off.
    expect(advancedInEffect(erc404, defaults, { tier: ZERO_ADDRESS })).toEqual([])
  })

  it('names each advanced setting the creator changed', () => {
    const set = advancedInEffect(
      erc404,
      { ...defaults, declaredMaxAllowanceBps: '2500' },
      { tier: TIER, liquidityDeployer: V4 },
    )
    expect(set).toEqual(['Creator carve — declared max', 'Token Tiers'])
  })
})

describe('defaultLiquidityDeployer', () => {
  const approved = [{ address: ZAMM }, { address: V4 }]

  it('picks the V4 deployer when the registry approves it (case-insensitive)', () => {
    expect(defaultLiquidityDeployer(approved, V4)).toBe(V4)
    expect(defaultLiquidityDeployer(approved, V4.toLowerCase() as `0x${string}`)).toBe(V4)
  })

  it('leaves the slot empty with no V4 deployer on the chain, or when it is not approved', () => {
    expect(defaultLiquidityDeployer(approved, ZERO_ADDRESS)).toBeUndefined()
    expect(defaultLiquidityDeployer([{ address: ZAMM }], V4)).toBeUndefined()
    expect(defaultLiquidityDeployer(undefined, V4)).toBeUndefined()
  })
})

describe('a simple-mode ERC-404 launch builds a valid create call', () => {
  // Exactly what the wizard holds when a creator never opens Advanced settings: the seeded
  // defaults plus the fields simple mode shows and requires.
  const values = {
    ...collectDefaults(erc404.coreFields),
    name: 'First Launch',
    symbol: 'FIRST',
    creator: CREATOR,
    nftCount: '1000',
  }

  it('passes validation with no advanced input', () => {
    expect(validateFields(erc404.coreFields, values)).toEqual({})
  })

  it('submits the defaults for every hidden setting and ABI-encodes', () => {
    const call = buildCreateInstance('erc404', {
      values,
      creator: CREATOR,
      metadataURI: 'data:application/json;base64,e30=',
      salt: SALT,
      modules: { vault: VAULT, liquidityDeployer: V4 },
    })
    if (call.type !== 'erc404') throw new Error('unexpected type')

    // No metadata stack → the 5-arg base create (no tiers, no overlay, no resolver).
    expect(call.args).toHaveLength(5)
    const [params, , liquidity, gating, freeMint] = call.args
    expect(params.declaredMaxAllowanceBps).toBe(10_000)
    expect(params.presetId).toBe(0)
    expect(params.nftCount).toBe(1000n)
    expect(params.stakingModule).toBe(ZERO_ADDRESS)
    expect(liquidity).toBe(V4)
    expect(gating).toBe(ZERO_ADDRESS)
    expect(freeMint).toEqual({ allocation: 0n, scope: 0 })

    const data = encodeFunctionData({
      abi: erc404FactoryAbi,
      functionName: 'createInstance',
      args: call.args,
    })
    const decoded = decodeFunctionData({ abi: erc404FactoryAbi, data })
    expect(decoded.functionName).toBe('createInstance')
    expect(decoded.args).toHaveLength(5)
  })
})
