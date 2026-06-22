import { forkChainId } from './addresses'

/**
 * EXEC404 / "CULT EXECUTIVES" — the project's one live mainnet deployment, grandfathered forever.
 * A custom DN404 genesis contract (ERC20 + NFT mirror) deployed BEFORE the current factory, so it
 * carries its own hand-curated ABI below rather than generated factory bindings. Same address on
 * mainnet and on our anvil mainnet-fork; in dev we read/trade against the fork (see EXEC404_CHAIN_ID).
 *
 * On-chain reality (verified on the fork): graduated (non-zero liquidityPair) yet the bonding curve
 * is still live — calculateCost/calculateRefund return real quotes and buyBonding/sellBonding work.
 * `reserve()` reverts with a custom error, so we never read it.
 */
export const EXEC404_ADDRESS = '0x185485bF2e26e0Da48149aee0A8032c8c2060Db2' as const

/** Dev reads/writes target the anvil mainnet-fork. Flip to mainnet (1) for production later. */
export const EXEC404_CHAIN_ID = forkChainId

/** 1 EXEC in base units (18 decimals) — the unit we quote price against. */
export const ONE_EXEC = 1_000_000_000_000_000_000n

/** Only the functions this slice uses, as-const for viem type inference. */
export const exec404Abi = [
  {
    type: 'function',
    name: 'name',
    stateMutability: 'pure',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
  {
    type: 'function',
    name: 'symbol',
    stateMutability: 'pure',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'totalSupply',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'totalBondingSupply',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'liquidityPair',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'calculateCost',
    stateMutability: 'view',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'calculateRefund',
    stateMutability: 'view',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'buyBonding',
    stateMutability: 'payable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'maxCost', type: 'uint256' },
      { name: 'mintNFT', type: 'bool' },
      { name: 'proof', type: 'bytes32[]' },
      { name: 'message', type: 'string' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'sellBonding',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'minRefund', type: 'uint256' },
      { name: 'proof', type: 'bytes32[]' },
      { name: 'message', type: 'string' },
    ],
    outputs: [],
  },
] as const

/** Buy slippage guard: cap spend at quoted cost + 1%. */
export function maxCostWithSlippage(cost: bigint): bigint {
  return (cost * 101n) / 100n
}

/** Sell slippage guard: accept quoted refund − 1%. */
export function minRefundWithSlippage(refund: bigint): bigint {
  return (refund * 99n) / 100n
}

/**
 * Parse a human EXEC amount ("1.5") to base units (18 decimals) without floating-point error.
 * Returns null for empty/invalid/negative input — callers disable actions on null.
 */
export function parseExecAmount(input: string): bigint | null {
  const trimmed = input.trim()
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === '' || trimmed === '.') return null
  const [whole, frac = ''] = trimmed.split('.')
  if (frac.length > 18) return null
  const padded = frac.padEnd(18, '0')
  try {
    return BigInt(whole || '0') * ONE_EXEC + BigInt(padded || '0')
  } catch {
    return null
  }
}
