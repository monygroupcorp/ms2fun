/**
 * Embedded post-graduation swap (B19 · noesis-349). Once an ERC-404 curve graduates, its token
 * trades on the venue it deployed liquidity to — and it trades IN-SITE on every one of them. Two
 * routers cover the three venues:
 *  - zRouter for the venues it handles natively: Uni-V4 (`swapV4`) and ZAMM (`swapVZ`);
 *  - the Cypher (Algebra Integral) periphery router for the Cypher family, via `exactInputSingle`.
 * There is no link-out fallback anywhere in this surface. A venue the app cannot resolve renders as
 * an unresolved venue (see `BondingSurface`), never as a redirect to somebody else's exchange.
 *
 * Shape mirrors the bonding `SwapPanel`: direction toggle · amount · live quote · slippage · action.
 * Differences that come from trading a real pool instead of the curve:
 *  - the input is the *spent* asset (buy → ETH, sell → tokens), DEX-style;
 *  - there's no view-quoter on either router, so the quote is an `eth_call` SIMULATION of the very
 *    swap that will be signed, with the min-out set to 0; slippage is then applied to the returned
 *    amountOut as the on-chain min-out floor;
 *  - token→ETH sells pull via `transferFrom`, so they're approve-then-swap (buys need no approval),
 *    and because the quote simulation runs that same `transferFrom`, the quote is gated on the
 *    allowance too.
 *
 * Native ETH by venue. zRouter takes ETH as the sentinel `address(0)` and wraps/unwraps internally.
 * The Algebra router instead names the wrapped-native token explicitly: a buy passes `tokenIn = WETH`
 * with the ETH riding as `msg.value`, and a sell settles in native ETH by leaving the output on the
 * router (`recipient = address(0)`) and unwrapping it to the trader in the same `multicall`. Both
 * `multicall` and `unwrapWNativeToken` were confirmed present on the deployed router (see
 * `lib/algebra/abis.ts`), so sells deliver ETH on this venue exactly as they do on the other two.
 */
import { useEffect, useRef, useState } from 'react'
import {
  decodeAbiParameters,
  encodeFunctionData,
  formatEther,
  formatUnits,
  maxUint256,
  parseUnits,
  zeroAddress,
} from 'viem'
import {
  useAccount,
  useSimulateContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import {
  useReadErc404BondingInstanceAllowance,
  useReadErc404BondingInstanceBalanceOf,
  useReadErc404BondingInstanceSymbol,
  useSimulateZRouterSwapV4,
  useSimulateZRouterSwapVz,
  useWriteErc404BondingInstanceApprove,
  useWriteZRouterSwapV4,
  useWriteZRouterSwapVz,
} from '../../../generated/contracts'
import {
  ALGEBRA_DEFAULT_DEPLOYER,
  ALGEBRA_NO_PRICE_LIMIT,
  algebraSwapRouterAbi,
} from '../../../lib/algebra/abis'
import { useCollectionAddresses, useCollectionChainId } from '../useCollectionChain'
import { invalidateInstanceQueries, txErrorReason } from '../../ui/useTxAction'
import type { GraduatedVenue } from './useGraduatedVenue'
import { applySellSlippage } from './bondingFormat'
import { SwapQuickFill } from './SwapQuickFill'
import { buyEthPresets, sellPctPresets } from './swapPresets'
import styles from './BondingSurface.module.css'

type Direction = 'buy' | 'sell'

/** Every venue the app can name is tradable here. `unknown` never reaches this component. */
export type EmbeddableVenue = Extract<GraduatedVenue, { kind: 'uniV4' | 'zamm' | 'cypher' }>

/** Venue names come from `venue.kind`, so a new venue cannot fall through to another one's label. */
const VENUE_LABEL: Record<EmbeddableVenue['kind'], string> = {
  uniV4: 'Uniswap V4',
  zamm: 'ZAMM',
  cypher: 'Cypher',
}

/** 24h deadline buffer for the executed swap — matches the bonding panel. */
const DEADLINE_BUFFER_SEC = 86_400n
/** Stable far-future deadline for the quote SIMULATION only: a live `Date.now()` deadline would
 *  change the sim's query key every second and re-run it (quote flicker). Finite (not maxUint256) so
 *  it never trips zRouter's `deadline==max` → Sushi-pool selector. The executed swap still uses a
 *  fresh now+buffer deadline. */
const QUOTE_DEADLINE = 9_999_999_999n

interface GraduatedSwapPanelProps {
  instance: `0x${string}`
  venue: EmbeddableVenue
  decimals: number
  refetch: () => void
}

/** The Algebra `exactInputSingle` params tuple, in the order the deployed router declares it. */
function algebraSwapParams(args: {
  tokenIn: `0x${string}`
  tokenOut: `0x${string}`
  recipient: `0x${string}`
  deadline: bigint
  amountIn: bigint
  minOut: bigint
}) {
  return {
    tokenIn: args.tokenIn,
    tokenOut: args.tokenOut,
    deployer: ALGEBRA_DEFAULT_DEPLOYER,
    recipient: args.recipient,
    deadline: args.deadline,
    amountIn: args.amountIn,
    amountOutMinimum: args.minOut,
    limitSqrtPrice: ALGEBRA_NO_PRICE_LIMIT,
  } as const
}

/**
 * A Cypher sell in one transaction: swap the tokens for wrapped native, leaving the proceeds on the
 * router (`recipient = address(0)`), then unwrap them to the trader. The min-out floor is asserted on
 * both legs — the swap will not execute below it, and the unwrap will not deliver below it.
 */
function algebraSellMulticall(args: {
  instance: `0x${string}`
  weth: `0x${string}`
  trader: `0x${string}`
  deadline: bigint
  amountIn: bigint
  minOut: bigint
}): readonly `0x${string}`[] {
  return [
    encodeFunctionData({
      abi: algebraSwapRouterAbi,
      functionName: 'exactInputSingle',
      args: [
        algebraSwapParams({
          tokenIn: args.instance,
          tokenOut: args.weth,
          recipient: zeroAddress,
          deadline: args.deadline,
          amountIn: args.amountIn,
          minOut: args.minOut,
        }),
      ],
    }),
    encodeFunctionData({
      abi: algebraSwapRouterAbi,
      functionName: 'unwrapWNativeToken',
      args: [args.minOut, args.trader],
    }),
  ]
}

export function GraduatedSwapPanel({
  instance,
  venue,
  decimals,
  refetch,
}: GraduatedSwapPanelProps) {
  const chainId = useCollectionChainId()
  const addresses = useCollectionAddresses()
  const { address, isConnected } = useAccount()
  const [direction, setDirection] = useState<Direction>('buy')
  const [amountStr, setAmountStr] = useState('')
  const [slippagePct, setSlippagePct] = useState('1')

  const isCypher = venue.kind === 'cypher'
  const zRouter = addresses.zRouter
  const cypherRouter = addresses.CypherSwapRouter
  // Whichever router this venue signs against — also the address a sell must approve.
  const router = isCypher ? cypherRouter : zRouter
  const routerReady = Boolean(router) && router !== zeroAddress
  const isBuy = direction === 'buy'

  const symbolRead = useReadErc404BondingInstanceSymbol({ address: instance, chainId: chainId })
  const symbol = symbolRead.data ?? 'tokens'

  // Parse the input amount in the SPENT asset's units: buy spends ETH (18), sell spends tokens.
  let amountIn: bigint | undefined
  try {
    const trimmed = amountStr.trim()
    amountIn = trimmed === '' ? undefined : parseUnits(trimmed, isBuy ? 18 : decimals)
    if (amountIn !== undefined && amountIn <= 0n) amountIn = undefined
  } catch {
    amountIn = undefined
  }

  // Free-text box → bps; the value is not range-checked here. `applySellSlippage` does the
  // clamping: a tolerance at or above 100% floors the min-out at 0n instead of going negative,
  // and a non-finite or non-positive one is treated as zero tolerance.
  const slippageBps = Math.round((Number(slippagePct) || 0) * 100)

  // Sells pull tokens via transferFrom → need a router allowance first (approve-then-swap). Buys
  // send native ETH, so no approval. The quote sim also reverts pre-approval on sells (it runs the
  // real transferFrom), so we gate the quote on a sufficient allowance too.
  const allowanceRead = useReadErc404BondingInstanceAllowance({
    address: instance,
    chainId: chainId,
    args: address && routerReady ? [address, router] : undefined,
    query: { enabled: Boolean(address) && routerReady },
  })
  const allowance = allowanceRead.data ?? 0n
  const needsApproval = !isBuy && amountIn !== undefined && allowance < amountIn

  const balanceRead = useReadErc404BondingInstanceBalanceOf({
    address: instance,
    chainId: chainId,
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  })

  // Swap I/O in zRouter terms. ETH = the native sentinel address(0).
  const tokenIn = isBuy ? zeroAddress : instance
  const tokenOut = isBuy ? instance : zeroAddress
  const deadline = () => BigInt(Math.floor(Date.now() / 1000)) + DEADLINE_BUFFER_SEC

  // Quote = simulate the swap with the min-out set to 0 and read amountOut. Enabled only when the
  // swap could actually succeed (connected, amount set, and — for sells — approved).
  const quoteReady = isConnected && amountIn !== undefined && (isBuy || !needsApproval)
  const buyValue = isBuy && amountIn !== undefined ? amountIn : undefined

  const v4Sim = useSimulateZRouterSwapV4({
    address: zRouter,
    chainId: chainId,
    account: address,
    value: buyValue,
    args:
      venue.kind === 'uniV4' && amountIn !== undefined
        ? [
            address ?? zeroAddress,
            false,
            venue.poolFee,
            venue.tickSpacing,
            tokenIn,
            tokenOut,
            amountIn,
            0n,
            QUOTE_DEADLINE,
          ]
        : undefined,
    query: { enabled: quoteReady && venue.kind === 'uniV4' },
  })
  const vzSim = useSimulateZRouterSwapVz({
    address: zRouter,
    chainId: chainId,
    account: address,
    value: buyValue,
    args:
      venue.kind === 'zamm' && amountIn !== undefined
        ? [
            address ?? zeroAddress,
            false,
            venue.feeOrHook,
            tokenIn,
            tokenOut,
            0n,
            0n,
            amountIn,
            0n,
            QUOTE_DEADLINE,
          ]
        : undefined,
    query: { enabled: quoteReady && venue.kind === 'zamm' },
  })

  // Cypher buy: ETH in as msg.value against tokenIn = wrapped native, tokens straight to the trader.
  const cypherBuySim = useSimulateContract({
    abi: algebraSwapRouterAbi,
    functionName: 'exactInputSingle',
    ...(routerReady ? { address: router } : {}),
    chainId: chainId,
    account: address,
    value: buyValue,
    args:
      venue.kind === 'cypher' && amountIn !== undefined
        ? [
            algebraSwapParams({
              tokenIn: venue.weth,
              tokenOut: instance,
              recipient: address ?? zeroAddress,
              deadline: QUOTE_DEADLINE,
              amountIn,
              minOut: 0n,
            }),
          ]
        : undefined,
    query: { enabled: quoteReady && isBuy && venue.kind === 'cypher' && routerReady },
  })
  // Cypher sell: simulate the exact swap-then-unwrap multicall that will be signed, so the quote
  // cannot drift from the transaction. `results[0]` is the swap leg's abi-encoded amountOut.
  const cypherSellSim = useSimulateContract({
    abi: algebraSwapRouterAbi,
    functionName: 'multicall',
    ...(routerReady ? { address: router } : {}),
    chainId: chainId,
    account: address,
    args:
      venue.kind === 'cypher' && amountIn !== undefined && address !== undefined
        ? [
            algebraSellMulticall({
              instance,
              weth: venue.weth,
              trader: address,
              deadline: QUOTE_DEADLINE,
              amountIn,
              minOut: 0n,
            }),
          ]
        : undefined,
    query: { enabled: quoteReady && !isBuy && venue.kind === 'cypher' && routerReady },
  })

  let quoteOut: bigint | undefined
  let quoteIsFetching = false
  let quoteRawError: unknown
  if (venue.kind === 'uniV4') {
    // swapV4/swapVZ both return (amountIn, amountOut) — index 1 is what the user receives.
    quoteOut = v4Sim.data?.result?.[1]
    quoteIsFetching = v4Sim.isFetching
    quoteRawError = v4Sim.error
  } else if (venue.kind === 'zamm') {
    quoteOut = vzSim.data?.result?.[1]
    quoteIsFetching = vzSim.isFetching
    quoteRawError = vzSim.error
  } else if (isBuy) {
    quoteOut = cypherBuySim.data?.result
    quoteIsFetching = cypherBuySim.isFetching
    quoteRawError = cypherBuySim.error
  } else {
    const encoded = cypherSellSim.data?.result?.[0]
    quoteOut =
      encoded === undefined ? undefined : decodeAbiParameters([{ type: 'uint256' }], encoded)[0]
    quoteIsFetching = cypherSellSim.isFetching
    quoteRawError = cypherSellSim.error
  }
  const minOut = quoteOut !== undefined ? applySellSlippage(quoteOut, slippageBps) : undefined

  const approve = useWriteErc404BondingInstanceApprove()
  const v4Swap = useWriteZRouterSwapV4()
  const vzSwap = useWriteZRouterSwapVz()
  const cypherSwap = useWriteContract()
  const swapData = isCypher ? cypherSwap.data : venue.kind === 'uniV4' ? v4Swap.data : vzSwap.data
  const swapIsPending = isCypher
    ? cypherSwap.isPending
    : venue.kind === 'uniV4'
      ? v4Swap.isPending
      : vzSwap.isPending
  const swapRawError = isCypher
    ? cypherSwap.error
    : venue.kind === 'uniV4'
      ? v4Swap.error
      : vzSwap.error

  const { isLoading: isApproving, isSuccess: approveConfirmed } = useWaitForTransactionReceipt({
    hash: approve.data,
  })
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: swapData })

  // Shared invalidation (noesis-352): a graduated buy/sell still moves the underlying DN404 token's
  // coin balance AND NFT ids in the same transaction (the venue changed, the mint/burn-on-transfer
  // mechanics didn't) — every cached read for this instance must invalidate the moment the receipt
  // lands. See SwapPanel's twin effect / useTxAction's `instance` opt for the full rationale.
  const queryClient = useQueryClient()
  const invalidatedOnSuccess = useRef(false)
  useEffect(() => {
    if (isSuccess && !invalidatedOnSuccess.current) {
      invalidatedOnSuccess.current = true
      invalidateInstanceQueries(queryClient, instance)
    }
    if (!isSuccess) invalidatedOnSuccess.current = false
  }, [isSuccess, queryClient, instance])

  // Re-read the allowance once the approval is MINED (not merely submitted) so `needsApproval` flips
  // and the quote + sell unlock. `refetch` is referentially stable (react-query), so this runs only
  // on confirmation.
  const refetchAllowance = allowanceRead.refetch
  useEffect(() => {
    if (approveConfirmed) void refetchAllowance()
  }, [approveConfirmed, refetchAllowance])

  function handleApprove(): void {
    if (!routerReady) return
    approve.writeContract({ address: instance, chainId: chainId, args: [router, maxUint256] })
  }

  function handleSwap(): void {
    if (amountIn === undefined || minOut === undefined) return
    if (venue.kind === 'uniV4') {
      v4Swap.writeContract({
        address: zRouter,
        chainId: chainId,
        args: [
          address ?? zeroAddress,
          false,
          venue.poolFee,
          venue.tickSpacing,
          tokenIn,
          tokenOut,
          amountIn,
          minOut,
          deadline(),
        ],
        value: buyValue,
      })
    } else if (venue.kind === 'zamm') {
      vzSwap.writeContract({
        address: zRouter,
        chainId: chainId,
        args: [
          address ?? zeroAddress,
          false,
          venue.feeOrHook,
          tokenIn,
          tokenOut,
          0n,
          0n,
          amountIn,
          minOut,
          deadline(),
        ],
        value: buyValue,
      })
    } else {
      if (!routerReady || address === undefined) return
      if (isBuy) {
        cypherSwap.writeContract({
          abi: algebraSwapRouterAbi,
          functionName: 'exactInputSingle',
          address: router,
          chainId: chainId,
          args: [
            algebraSwapParams({
              tokenIn: venue.weth,
              tokenOut: instance,
              recipient: address,
              deadline: deadline(),
              amountIn,
              minOut,
            }),
          ],
          value: buyValue,
        })
      } else {
        cypherSwap.writeContract({
          abi: algebraSwapRouterAbi,
          functionName: 'multicall',
          address: router,
          chainId: chainId,
          args: [
            algebraSellMulticall({
              instance,
              weth: venue.weth,
              trader: address,
              deadline: deadline(),
              amountIn,
              minOut,
            }),
          ],
        })
      }
    }
  }

  function handleReset(): void {
    if (isCypher) cypherSwap.reset()
    else if (venue.kind === 'uniV4') v4Swap.reset()
    else vzSwap.reset()
    setAmountStr('')
    void balanceRead.refetch()
    void allowanceRead.refetch()
    refetch()
  }

  if (!isConnected) {
    return (
      <div className={styles.panel} data-testid="erc404-graduated-swap">
        <p className={styles.panelTitle}>trade</p>
        <p className={styles.connectNote}>connect wallet to trade</p>
      </div>
    )
  }

  // The venue is known but this network carries no router address for it — say that, and say it
  // without sending anyone to another exchange.
  if (!routerReady) {
    return (
      <div className={styles.panel} data-testid="erc404-graduated-swap">
        <p className={styles.panelTitle}>trade</p>
        <p className={styles.connectNote} data-testid="erc404-graduated-no-router">
          this collection graduated to a {VENUE_LABEL[venue.kind]} pool, but no{' '}
          {VENUE_LABEL[venue.kind]} router is configured for this network yet — trading here will
          light up as soon as one is.
        </p>
      </div>
    )
  }

  if (isSuccess) {
    return (
      <div className={styles.panel} data-testid="erc404-graduated-swap">
        <p className={styles.panelTitle}>trade</p>
        <p className={styles.txStatus}>{isBuy ? 'bought' : 'sold'} — tx confirmed.</p>
        <button
          className="btn btn-secondary"
          onClick={handleReset}
          data-testid="erc404-graduated-again"
        >
          trade again
        </button>
      </div>
    )
  }

  const inLabel = isBuy ? 'amount (ETH)' : `amount (${symbol})`
  const outLabel = isBuy ? symbol : 'ETH'
  const quoteValue =
    quoteOut !== undefined
      ? `${isBuy ? formatUnits(quoteOut, decimals) : formatEther(quoteOut)} ${outLabel}`
      : '—'

  const isBusy = swapIsPending || isConfirming
  const swapError = txErrorReason(swapRawError)
  const quoteError = quoteRawError && quoteReady ? txErrorReason(quoteRawError) : undefined

  return (
    <div className={styles.panel} data-testid="erc404-graduated-swap">
      <p className={styles.panelTitle}>trade</p>

      <div className={styles.toggle}>
        <button
          type="button"
          className={`${styles.toggleBtn} ${isBuy ? styles.toggleActive : ''}`}
          onClick={() => setDirection('buy')}
          data-testid="erc404-graduated-direction-buy"
        >
          buy
        </button>
        <button
          type="button"
          className={`${styles.toggleBtn} ${!isBuy ? styles.toggleActive : ''}`}
          onClick={() => setDirection('sell')}
          data-testid="erc404-graduated-direction-sell"
        >
          sell
        </button>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="erc404-graduated-amount">
          {inLabel}
        </label>
        <input
          id="erc404-graduated-amount"
          className={styles.input}
          type="text"
          inputMode="decimal"
          value={amountStr}
          onChange={(e) => setAmountStr(e.target.value)}
          placeholder="0.0"
          disabled={isBusy}
          data-testid="erc404-graduated-amount-input"
        />
        <SwapQuickFill
          className={styles.quickfill}
          disabled={isBusy}
          onPick={setAmountStr}
          presets={isBuy ? buyEthPresets() : sellPctPresets(balanceRead.data, decimals)}
        />
        {!isBuy && balanceRead.data !== undefined && (
          <span className={styles.note}>
            balance: {formatUnits(balanceRead.data, decimals)} {symbol}
          </span>
        )}
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="erc404-graduated-slippage">
          slippage %
        </label>
        <div className={styles.slippageRow}>
          <input
            id="erc404-graduated-slippage"
            className={`${styles.input} ${styles.slippageInput}`}
            type="text"
            inputMode="decimal"
            value={slippagePct}
            onChange={(e) => setSlippagePct(e.target.value)}
            disabled={isBusy}
            data-testid="erc404-graduated-slippage-input"
          />
          <span className={styles.note} data-testid="erc404-graduated-venue-label">
            {VENUE_LABEL[venue.kind]} pool
          </span>
        </div>
      </div>

      <div className={styles.quoteRow} data-testid="erc404-graduated-quote">
        <span className={styles.quoteLabel}>receive</span>
        <span className={styles.quoteValue}>
          {quoteIsFetching && quoteReady ? '…' : quoteValue}
        </span>
      </div>

      {needsApproval ? (
        <button
          className="btn btn-primary btn-chromatic"
          onClick={handleApprove}
          disabled={approve.isPending || isApproving}
          data-testid="erc404-graduated-approve"
        >
          {approve.isPending
            ? 'confirm in wallet…'
            : isApproving
              ? 'approving…'
              : `approve ${symbol}`}
        </button>
      ) : (
        <button
          className="btn btn-primary btn-chromatic"
          onClick={handleSwap}
          disabled={isBusy || amountIn === undefined || minOut === undefined}
          data-testid="erc404-graduated-swap-submit"
        >
          {swapIsPending
            ? 'confirm in wallet…'
            : isConfirming
              ? 'confirming…'
              : isBuy
                ? 'buy'
                : 'sell'}
        </button>
      )}

      {!isBuy && needsApproval && (
        <p className={styles.note}>
          approve {symbol} once so the router can pull it — then the quote + sell unlock.
        </p>
      )}
      {quoteError && !swapError && (
        <p className={`${styles.txStatus} ${styles.txError}`}>quote failed: {quoteError}</p>
      )}
      {swapError && (
        <p className={`${styles.txStatus} ${styles.txError}`}>transaction failed: {swapError}</p>
      )}
    </div>
  )
}
