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

/**
 * EXEC's DN404 NFT mirror (the ERC-721 half). Fixed fossil address — same on mainnet and the fork.
 * `owned()`/`tokenOfOwnerByIndex` are NOT available (the base reverts FnSelectorNotRecognized and the
 * mirror isn't ERC721Enumerable), so a wallet's NFT ids are reconstructed by replaying the mirror's
 * Transfer events (see ownedIdsFromTransfers + useExec404Nfts). The count comes straight off
 * `mirror.balanceOf(owner)`. NFT art is `base.tokenURI(id)` (the base serves tokenURI). */
export const EXEC404_MIRROR_ADDRESS = '0x9e752115Caa8dc00693B8D8f9c2071DdBD6109BD' as const

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
  // Sells route through zRouter, which pulls EXEC via transferFrom — so the embedded swap needs the
  // standard ERC-20 allowance/approve surface (DN404 exposes it on the base token).
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  // Fungible send + the reroll primitive: a DN404 self-transfer of the full balance re-shuffles the
  // holder's NFT id assignment (transfer(self, balanceOf(self))). Also used for plain EXEC sends.
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  // The base serves the NFT mirror's tokenURI (per-piece art) — verified on the fork.
  {
    type: 'function',
    name: 'tokenURI',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{ type: 'string' }],
  },
  // Balance-mint: materialize `count` whole-token NFTs from the caller's fungible balance (reverts
  // "NFTs over balance" past floor(balance / ONE_EXEC)). The one holder action EXEC has that the new
  // instances fold into buyBonding's mintNFT flag.
  {
    type: 'function',
    name: 'balanceMint',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'count', type: 'uint256' }],
    outputs: [],
  },
  // Legacy on-chain activity: the genesis DN404 baked a trade-message log into the bonding curve.
  // `totalMessages()` counts them; `getMessagesBatch(start, end)` (end INCLUSIVE, end <= total-1)
  // returns 5 parallel arrays — the fossil's historical chatter, preserved on-chain.
  {
    type: 'function',
    name: 'totalMessages',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getMessagesBatch',
    stateMutability: 'view',
    inputs: [
      { name: 'startIndex', type: 'uint256' },
      { name: 'endIndex', type: 'uint256' },
    ],
    outputs: [
      { name: 'senders', type: 'address[]' },
      { name: 'timestamps', type: 'uint256[]' },
      { name: 'amounts', type: 'uint256[]' },
      { name: 'isBuys', type: 'bool[]' },
      { name: 'messages', type: 'string[]' },
    ],
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

/** Minimal ERC-721 surface of EXEC's DN404 mirror: NFT count, per-id owner, per-id send + the
 *  Transfer event we replay to enumerate a wallet's ids. */
export const exec404MirrorAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'ownerOf',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'transferFrom',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'id', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'id', type: 'uint256', indexed: true },
    ],
  },
] as const

/** One replayable NFT transfer — the fields ownedIdsFromTransfers needs, in chain order. */
export interface MirrorTransfer {
  from: `0x${string}`
  to: `0x${string}`
  id: bigint
  /** Chain order key (block number, then log index) — logs MUST be pre-sorted ascending by this. */
  blockNumber: bigint
  logIndex: number
}

/**
 * Reconstruct the set of NFT ids a wallet currently owns by replaying its Transfer history — the
 * mirror exposes no `owned()`/enumerable view. Feed EVERY transfer that touches `owner` (both
 * `to == owner` and `from == owner`), sorted ascending by (blockNumber, logIndex); an inbound
 * transfer adds the id, an outbound removes it. The final set is the live holdings. Pure + tested.
 */
export function ownedIdsFromTransfers(
  transfers: readonly MirrorTransfer[],
  owner: `0x${string}`,
): bigint[] {
  const lower = owner.toLowerCase()
  const sorted = [...transfers].sort((a, b) =>
    a.blockNumber === b.blockNumber
      ? a.logIndex - b.logIndex
      : a.blockNumber < b.blockNumber
        ? -1
        : 1,
  )
  const held = new Set<bigint>()
  for (const t of sorted) {
    if (t.to.toLowerCase() === lower) held.add(t.id)
    else if (t.from.toLowerCase() === lower) held.delete(t.id)
  }
  return [...held].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}
