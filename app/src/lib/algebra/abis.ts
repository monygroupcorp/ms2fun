/**
 * Hand-written ABI fragments for the Cypher (Algebra Integral) venue.
 *
 * The generated wagmi bindings (`src/generated/contracts.ts`) cover this repo's OWN contracts, and
 * `wagmi.config.ts` targets the Foundry artifact set — the Algebra factory / swap-router the Cypher
 * LP family graduates into are external singletons with no artifact of ours behind them, so their
 * fragments are hand-written here. Same pattern (and same reason) as `src/lib/tithe/abis.ts`: the
 * minimal slice the embedded post-graduation swap needs, nothing more.
 *
 * SHAPE PROVENANCE. The deployed router this app talks to is the Algebra **Integral** periphery
 * build, not the Algebra V2 shape carried by `contracts/src/interfaces/algebra/IAlgebra.sol`. The
 * fragments below were confirmed against the live router on a local mainnet fork:
 *  - `exactInputSingle` carries an extra `deployer` field between `tokenOut` and `recipient`
 *    (selector `0x1679c792`); the V2 seven-field shape (`0xbc651188`) is not present on the router.
 *  - `multicall(bytes[])` (`0xac9650d8`), `unwrapWNativeToken(uint256,address)` (`0x69bc35b2`) and
 *    `refundNativeToken()` (`0x41865270`) are present, so a token→ETH sell can settle in native ETH.
 *  - `recipient == address(0)` inside `exactInputSingle` means "leave the output on the router",
 *    which is what makes the swap-then-unwrap multicall work.
 *  - a native-ETH buy needs no wrapping step of its own: `tokenIn` is the wrapped-native token and
 *    the ETH rides along as `msg.value`.
 */

/** `IAlgebraFactory.poolByPair` — names the canonical pool for an unordered token pair, or `0x0`. */
export const algebraFactoryAbi = [
  {
    type: 'function',
    stateMutability: 'view',
    name: 'poolByPair',
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
    ],
    outputs: [{ name: 'pool', type: 'address' }],
  },
] as const

/**
 * The Algebra Integral SwapRouter slice the panel executes against.
 *
 * `limitSqrtPrice` is Algebra's name for a price bound; `0` = no bound, which is what a
 * slippage-floored `amountOutMinimum` already covers. `deployer` is `address(0)` for a pool created
 * through the plain factory path, which is the path the Cypher LP module graduates into.
 */
export const algebraSwapRouterAbi = [
  {
    type: 'function',
    stateMutability: 'payable',
    name: 'exactInputSingle',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'deployer', type: 'address' },
          { name: 'recipient', type: 'address' },
          { name: 'deadline', type: 'uint256' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
          { name: 'limitSqrtPrice', type: 'uint160' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
  {
    type: 'function',
    stateMutability: 'payable',
    name: 'unwrapWNativeToken',
    inputs: [
      { name: 'amountMinimum', type: 'uint256' },
      { name: 'recipient', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    stateMutability: 'payable',
    name: 'refundNativeToken',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    stateMutability: 'payable',
    name: 'multicall',
    inputs: [{ name: 'data', type: 'bytes[]' }],
    outputs: [{ name: 'results', type: 'bytes[]' }],
  },
] as const

/** `deployer` is `address(0)` for factory-created (non-custom) Algebra pools. */
export const ALGEBRA_DEFAULT_DEPLOYER = '0x0000000000000000000000000000000000000000' as const

/** `limitSqrtPrice = 0` — no price bound; the min-out floor is the slippage control. */
export const ALGEBRA_NO_PRICE_LIMIT = 0n
