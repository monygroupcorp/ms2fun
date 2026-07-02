/**
 * Embedded post-graduation swap (B19). Once an ERC-404 curve graduates, its token trades on the
 * venue it deployed liquidity to — this panel routes those swaps through the zRouter singleton
 * IN-SITE (no Uniswap link-out) for the two venues zRouter handles natively: Uni-V4 (`swapV4`) and
 * ZAMM (`swapVZ`). Cypher/Algebra is a separate router (fast-follow) and keeps the link-out, so this
 * component is only mounted for `uniV4` | `zamm` venues.
 *
 * Shape mirrors the bonding `SwapPanel`: direction toggle · amount · live quote · slippage · action.
 * Differences that come from trading a real pool instead of the curve:
 *  - the input is the *spent* asset (buy → ETH, sell → tokens), DEX-style;
 *  - there's no view-quoter, so the quote is an `eth_call` SIMULATION of the swap with amountLimit=0
 *    (returns amountOut); slippage is applied to that as the on-chain `amountLimit` min-out floor;
 *  - ETH is the zRouter native sentinel `address(0)` (the router wraps/unwraps WETH internally);
 *  - token→ETH sells pull via `transferFrom`, so they're approve-then-swap (buys need no approval).
 */
import { useState } from 'react'
import { formatEther, formatUnits, maxUint256, parseUnits, zeroAddress } from 'viem'
import { useAccount, useWaitForTransactionReceipt } from 'wagmi'
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
import { forkAddresses, forkChainId } from '../../../lib/addresses'
import { txErrorReason } from '../../ui/useTxAction'
import type { GraduatedVenue } from './useGraduatedVenue'
import styles from './BondingSurface.module.css'

type Direction = 'buy' | 'sell'

/** 24h deadline buffer — matches the bonding panel; generous for local-fork timestamp drift. */
const DEADLINE_BUFFER_SEC = 86_400n
const BPS_DENOMINATOR = 10_000n

interface GraduatedSwapPanelProps {
  instance: `0x${string}`
  /** Only the zRouter-native venues reach this component. */
  venue: Extract<GraduatedVenue, { kind: 'uniV4' | 'zamm' }>
  decimals: number
  refetch: () => void
}

export function GraduatedSwapPanel({ instance, venue, decimals, refetch }: GraduatedSwapPanelProps) {
  const { address, isConnected } = useAccount()
  const [direction, setDirection] = useState<Direction>('buy')
  const [amountStr, setAmountStr] = useState('')
  const [slippagePct, setSlippagePct] = useState('1')

  const zRouter = forkAddresses.zRouter
  const isBuy = direction === 'buy'

  const symbolRead = useReadErc404BondingInstanceSymbol({ address: instance, chainId: forkChainId })
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

  const slippageBps = BigInt(Math.max(0, Math.round((Number(slippagePct) || 0) * 100)))

  // Sells pull tokens via transferFrom → need a zRouter allowance first (approve-then-swap). Buys
  // send native ETH, so no approval. The quote sim also reverts pre-approval on sells (it runs the
  // real transferFrom), so we gate the quote on a sufficient allowance too.
  const allowanceRead = useReadErc404BondingInstanceAllowance({
    address: instance,
    chainId: forkChainId,
    args: address ? [address, zRouter] : undefined,
    query: { enabled: Boolean(address) },
  })
  const allowance = allowanceRead.data ?? 0n
  const needsApproval = !isBuy && amountIn !== undefined && allowance < amountIn

  const balanceRead = useReadErc404BondingInstanceBalanceOf({
    address: instance,
    chainId: forkChainId,
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  })

  // Swap I/O in zRouter terms. ETH = the native sentinel address(0).
  const tokenIn = isBuy ? zeroAddress : instance
  const tokenOut = isBuy ? instance : zeroAddress
  const deadline = () => BigInt(Math.floor(Date.now() / 1000)) + DEADLINE_BUFFER_SEC

  // Quote = simulate the swap with amountLimit=0 (no slippage floor) and read amountOut. Enabled
  // only when the swap could actually succeed (connected, amount set, and — for sells — approved).
  const quoteReady = isConnected && amountIn !== undefined && (isBuy || !needsApproval)
  const buyValue = isBuy && amountIn !== undefined ? amountIn : undefined

  const v4Sim = useSimulateZRouterSwapV4({
    address: zRouter,
    chainId: forkChainId,
    account: address,
    value: buyValue,
    args:
      venue.kind === 'uniV4' && amountIn !== undefined
        ? [address ?? zeroAddress, false, venue.poolFee, venue.tickSpacing, tokenIn, tokenOut, amountIn, 0n, deadline()]
        : undefined,
    query: { enabled: quoteReady && venue.kind === 'uniV4' },
  })
  const vzSim = useSimulateZRouterSwapVz({
    address: zRouter,
    chainId: forkChainId,
    account: address,
    value: buyValue,
    args:
      venue.kind === 'zamm' && amountIn !== undefined
        ? [address ?? zeroAddress, false, venue.feeOrHook, tokenIn, tokenOut, 0n, 0n, amountIn, 0n, deadline()]
        : undefined,
    query: { enabled: quoteReady && venue.kind === 'zamm' },
  })
  const sim = venue.kind === 'uniV4' ? v4Sim : vzSim
  // swapV4/swapVZ both return (amountIn, amountOut) — index 1 is what the user receives.
  const quoteOut = sim.data?.result?.[1]
  const minOut =
    quoteOut !== undefined ? (quoteOut * (BPS_DENOMINATOR - slippageBps)) / BPS_DENOMINATOR : undefined

  const approve = useWriteErc404BondingInstanceApprove()
  const v4Swap = useWriteZRouterSwapV4()
  const vzSwap = useWriteZRouterSwapVz()
  const swap = venue.kind === 'uniV4' ? v4Swap : vzSwap

  const { isLoading: isApproving } = useWaitForTransactionReceipt({ hash: approve.data })
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: swap.data })

  function handleApprove(): void {
    approve.writeContract(
      { address: instance, chainId: forkChainId, args: [zRouter, maxUint256] },
      { onSuccess: () => void allowanceRead.refetch() },
    )
  }

  function handleSwap(): void {
    if (amountIn === undefined || minOut === undefined) return
    if (venue.kind === 'uniV4') {
      v4Swap.writeContract({
        address: zRouter,
        chainId: forkChainId,
        args: [address ?? zeroAddress, false, venue.poolFee, venue.tickSpacing, tokenIn, tokenOut, amountIn, minOut, deadline()],
        value: buyValue,
      })
    } else {
      vzSwap.writeContract({
        address: zRouter,
        chainId: forkChainId,
        args: [address ?? zeroAddress, false, venue.feeOrHook, tokenIn, tokenOut, 0n, 0n, amountIn, minOut, deadline()],
        value: buyValue,
      })
    }
  }

  function handleReset(): void {
    swap.reset()
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

  if (isSuccess) {
    return (
      <div className={styles.panel} data-testid="erc404-graduated-swap">
        <p className={styles.panelTitle}>trade</p>
        <p className={styles.txStatus}>{isBuy ? 'bought' : 'sold'} — tx confirmed.</p>
        <button className="btn btn-secondary" onClick={handleReset} data-testid="erc404-graduated-again">
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

  const isBusy = swap.isPending || isConfirming
  const swapError = txErrorReason(swap.error)
  const quoteError = sim.error && quoteReady ? txErrorReason(sim.error) : undefined

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
          <span className={styles.note}>{venue.kind === 'uniV4' ? 'Uniswap V4' : 'ZAMM'} pool</span>
        </div>
      </div>

      <div className={styles.quoteRow} data-testid="erc404-graduated-quote">
        <span className={styles.quoteLabel}>receive</span>
        <span className={styles.quoteValue}>
          {sim.isFetching && quoteReady ? '…' : quoteValue}
        </span>
      </div>

      {needsApproval ? (
        <button
          className="btn btn-primary btn-chromatic"
          onClick={handleApprove}
          disabled={approve.isPending || isApproving}
          data-testid="erc404-graduated-approve"
        >
          {approve.isPending ? 'confirm in wallet…' : isApproving ? 'approving…' : `approve ${symbol}`}
        </button>
      ) : (
        <button
          className="btn btn-primary btn-chromatic"
          onClick={handleSwap}
          disabled={isBusy || amountIn === undefined || minOut === undefined}
          data-testid="erc404-graduated-swap-submit"
        >
          {swap.isPending
            ? 'confirm in wallet…'
            : isConfirming
              ? 'confirming…'
              : isBuy
                ? 'buy'
                : 'sell'}
        </button>
      )}

      {!isBuy && needsApproval && (
        <p className={styles.note}>approve {symbol} once so the router can pull it — then the quote + sell unlock.</p>
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
