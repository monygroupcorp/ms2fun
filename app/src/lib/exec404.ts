import { forkChainId } from './addresses'

/**
 * EXEC404 / "CULT EXECUTIVES" — the project's one live mainnet deployment, grandfathered forever.
 * A custom DN404 genesis contract (ERC20 + NFT mirror) deployed BEFORE the current factory, so it
 * carries its own hand-curated ABI below rather than generated factory bindings. Same address on
 * mainnet and on our anvil mainnet-fork; in dev we read against the fork (see EXEC404_CHAIN_ID).
 *
 * On-chain reality (verified by executing trades on an archive fork): the bonding curve is CLOSED
 * (`buyBonding` reverts "Presale ended"). It graduated to a **Uniswap V2** pool, where it trades
 * with fee-on-transfer swaps (~4% DN404 transfer tax). So this page is read-only — real market
 * price from V2 — and links out to Uniswap to trade (see docs/HUMAN_GATES.md G-D).
 */
export const EXEC404_ADDRESS = '0x185485bF2e26e0Da48149aee0A8032c8c2060Db2' as const

/** Mainnet WETH + Uniswap V2 router — used to read the real (graduated) market price of EXEC. */
export const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as const
export const UNISWAP_V2_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D' as const

/** Deep-link to Uniswap with EXEC preselected as the output token. */
export const UNISWAP_SWAP_URL = `https://app.uniswap.org/swap?outputCurrency=${EXEC404_ADDRESS}&chain=mainnet`

/** Dev reads target the anvil mainnet-fork. Flip to mainnet (1) for production later. */
export const EXEC404_CHAIN_ID = forkChainId

/** 1 EXEC in base units (18 decimals) — the unit we quote price against. */
export const ONE_EXEC = 1_000_000_000_000_000_000n

/** Only the functions this read-only page uses, as-const for viem type inference.
 * (name/symbol/decimals are hardcoded in the UI — "CULT EXECUTIVES"/"EXEC"/18 — so they are
 * intentionally not in the ABI.) */
export const exec404Abi = [
  {
    type: 'function',
    name: 'totalSupply',
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
] as const

/** Uniswap V2 router — just the read we need for a spot price. */
export const uniswapV2RouterAbi = [
  {
    type: 'function',
    name: 'getAmountsOut',
    stateMutability: 'view',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'path', type: 'address[]' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
] as const

/** Shared contract handle for wagmi read hooks — reads target the fork in dev. */
export const exec404Contract = {
  address: EXEC404_ADDRESS,
  abi: exec404Abi,
  chainId: EXEC404_CHAIN_ID,
} as const

export const uniswapV2RouterContract = {
  address: UNISWAP_V2_ROUTER,
  abi: uniswapV2RouterAbi,
  chainId: EXEC404_CHAIN_ID,
} as const

/** Path for pricing 1 EXEC into ETH (sell direction) on the V2 pool. */
export const EXEC_TO_ETH_PATH = [EXEC404_ADDRESS, WETH_ADDRESS] as const
