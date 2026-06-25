/**
 * Buy/Sell against the bonding curve. Direction toggle, token-amount input, a live quote from the
 * CurveParamsComputer singleton (cost on buy, refund on sell), a user-set slippage tolerance applied
 * as `maxCost` / `minRefund`, the displayed protocol fee (read, not hardcoded), and the password
 * gating path when `gatingActive`.
 *
 * buyBonding(amount, maxCost, mintNFT, passwordHash, messageData, deadline) — payable, value = maxCost.
 * sellBonding(amount, minRefund, passwordHash, messageData, deadline).
 * Quote: CurveParamsComputer.calculateCost(curveParams, totalBondingSupply, amount) (refund = calculateRefund).
 */
import { useState } from 'react'
import { formatEther, parseUnits } from 'viem'
import { useAccount, useWaitForTransactionReceipt } from 'wagmi'
import {
  useReadCurveParamsComputerCalculateCost,
  useReadCurveParamsComputerCalculateRefund,
  useReadErc404BondingInstanceBalanceOf,
  useWriteErc404BondingInstanceBuyBonding,
  useWriteErc404BondingInstanceSellBonding,
} from '../../../generated/contracts'
import { forkChainId } from '../../../lib/addresses'
import type { BondingView } from './bondingPhase'
import { applyBuySlippage, applySellSlippage, formatBps } from './bondingFormat'
import type { CurveParamsTuple } from './useBondingData'
import { EMPTY_BYTES, ZERO_BYTES32, resolveBuyPasswordHash } from './gating'
import styles from './BondingSurface.module.css'

type Direction = 'buy' | 'sell'

/** 24h deadline buffer (legacy parity) — generous for local-fork timestamp drift. */
const DEADLINE_BUFFER_SEC = 86_400n

/** Placeholder address for disabled quote reads (query is gated off when no computer is resolved). */
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const

interface SwapPanelProps {
  instance: `0x${string}`
  view: BondingView
  curveParams: CurveParamsTuple | undefined
  curveComputer: `0x${string}` | undefined
  decimals: number
  feeBps: bigint | undefined
  gatingActive: boolean
  refetch: () => void
}

export function SwapPanel({
  instance,
  view,
  curveParams,
  curveComputer,
  decimals,
  feeBps,
  gatingActive,
  refetch,
}: SwapPanelProps) {
  const { address, isConnected } = useAccount()
  const [direction, setDirection] = useState<Direction>('buy')
  const [amountStr, setAmountStr] = useState('')
  const [slippagePct, setSlippagePct] = useState('1')
  const [mintNFT, setMintNFT] = useState(false)
  const [password, setPassword] = useState('')

  // Parse amount into token base units. Invalid/empty → undefined (disables quote + actions).
  let amount: bigint | undefined
  try {
    amount = amountStr.trim() === '' ? undefined : parseUnits(amountStr.trim(), decimals)
    if (amount !== undefined && amount <= 0n) amount = undefined
  } catch {
    amount = undefined
  }

  const slippageBps = Math.round((Number(slippagePct) || 0) * 100)

  const quoteEnabled =
    amount !== undefined && curveParams !== undefined && curveComputer !== undefined

  const costQuote = useReadCurveParamsComputerCalculateCost({
    address: curveComputer ?? ZERO_ADDRESS,
    chainId: forkChainId,
    args:
      curveParams !== undefined && amount !== undefined
        ? [
            {
              initialPrice: curveParams[0],
              quarticCoeff: curveParams[1],
              cubicCoeff: curveParams[2],
              quadraticCoeff: curveParams[3],
              normalizationFactor: curveParams[4],
            },
            view.totalBondingSupply,
            amount,
          ]
        : undefined,
    query: { enabled: quoteEnabled && direction === 'buy' },
  })

  const refundQuote = useReadCurveParamsComputerCalculateRefund({
    address: curveComputer ?? ZERO_ADDRESS,
    chainId: forkChainId,
    args:
      curveParams !== undefined && amount !== undefined
        ? [
            {
              initialPrice: curveParams[0],
              quarticCoeff: curveParams[1],
              cubicCoeff: curveParams[2],
              quadraticCoeff: curveParams[3],
              normalizationFactor: curveParams[4],
            },
            view.totalBondingSupply,
            amount,
          ]
        : undefined,
    query: { enabled: quoteEnabled && direction === 'sell' },
  })

  const balance = useReadErc404BondingInstanceBalanceOf({
    address: instance,
    chainId: forkChainId,
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  })

  const buy = useWriteErc404BondingInstanceBuyBonding()
  const sell = useWriteErc404BondingInstanceSellBonding()
  const activeWrite = direction === 'buy' ? buy : sell

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: activeWrite.data,
  })

  const quote = direction === 'buy' ? costQuote.data : refundQuote.data
  const quotePending = direction === 'buy' ? costQuote.isPending : refundQuote.isPending

  function handleSubmit(): void {
    if (amount === undefined || quote === undefined) return
    const deadline = BigInt(Math.floor(Date.now() / 1000)) + DEADLINE_BUFFER_SEC
    const passwordHash = gatingActive ? resolveBuyPasswordHash(password) : ZERO_BYTES32
    const messageData = EMPTY_BYTES // comment posting is a separate surface; keep trades lean

    if (direction === 'buy') {
      const maxCost = applyBuySlippage(quote, slippageBps)
      buy.writeContract({
        address: instance,
        chainId: forkChainId,
        args: [amount, maxCost, mintNFT, passwordHash, messageData, deadline],
        value: maxCost,
      })
    } else {
      const minRefund = applySellSlippage(quote, slippageBps)
      sell.writeContract({
        address: instance,
        chainId: forkChainId,
        args: [amount, minRefund, passwordHash, messageData, deadline],
      })
    }
  }

  function handleReset(): void {
    activeWrite.reset()
    setAmountStr('')
    void balance.refetch()
    refetch()
  }

  const isBusy = activeWrite.isPending || isConfirming
  const hasError = activeWrite.isError

  if (!isConnected) {
    return (
      <div className={styles.panel} data-testid="erc404-swap">
        <p className={styles.panelTitle}>trade</p>
        <p className={styles.connectNote}>connect wallet to trade</p>
      </div>
    )
  }

  if (isSuccess) {
    return (
      <div className={styles.panel} data-testid="erc404-swap">
        <p className={styles.panelTitle}>trade</p>
        <p className={styles.txStatus}>{direction === 'buy' ? 'bought' : 'sold'} — tx confirmed.</p>
        <button className="btn btn-secondary" onClick={handleReset}>
          reset
        </button>
      </div>
    )
  }

  const quoteLabel = direction === 'buy' ? 'cost' : 'refund'
  const quoteValue = quote !== undefined ? `${formatEther(quote)} ETH` : '—'

  return (
    <div className={styles.panel} data-testid="erc404-swap">
      <p className={styles.panelTitle}>trade</p>

      <div className={styles.toggle}>
        <button
          type="button"
          className={`${styles.toggleBtn} ${direction === 'buy' ? styles.toggleActive : ''}`}
          onClick={() => setDirection('buy')}
          data-testid="erc404-direction-buy"
        >
          buy
        </button>
        <button
          type="button"
          className={`${styles.toggleBtn} ${direction === 'sell' ? styles.toggleActive : ''}`}
          onClick={() => setDirection('sell')}
          data-testid="erc404-direction-sell"
        >
          sell
        </button>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="erc404-amount">
          amount (tokens)
        </label>
        <input
          id="erc404-amount"
          className={styles.input}
          type="text"
          inputMode="decimal"
          value={amountStr}
          onChange={(e) => setAmountStr(e.target.value)}
          placeholder="0.0"
          disabled={isBusy}
          data-testid="erc404-amount-input"
        />
        {direction === 'sell' && balance.data !== undefined && (
          <span className={styles.note}>balance: {formatEther(balance.data)}</span>
        )}
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="erc404-slippage">
          slippage %
        </label>
        <div className={styles.slippageRow}>
          <input
            id="erc404-slippage"
            className={`${styles.input} ${styles.slippageInput}`}
            type="text"
            inputMode="decimal"
            value={slippagePct}
            onChange={(e) => setSlippagePct(e.target.value)}
            disabled={isBusy}
            data-testid="erc404-slippage-input"
          />
          {feeBps !== undefined && (
            <span className={styles.note}>protocol fee: {formatBps(feeBps)}</span>
          )}
        </div>
      </div>

      {direction === 'buy' && (
        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={mintNFT}
            onChange={(e) => setMintNFT(e.target.checked)}
            disabled={isBusy}
            data-testid="erc404-mintnft"
          />
          mint NFT on buy
        </label>
      )}

      {gatingActive && (
        <div className={styles.field}>
          <label className={styles.label} htmlFor="erc404-password">
            access password
          </label>
          {/* PASSWORD gating path: keccak256(utf8(password)) → bytes32 passwordHash. MERKLE seam:
              a merkle module would resolve a proof here instead (see gating.ts). */}
          <input
            id="erc404-password"
            className={styles.input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isBusy}
            data-testid="erc404-password-input"
          />
        </div>
      )}

      <div className={styles.quoteRow} data-testid="erc404-quote">
        <span className={styles.quoteLabel}>{quoteLabel}</span>
        <span className={styles.quoteValue}>{quotePending && quoteEnabled ? '…' : quoteValue}</span>
      </div>

      <button
        className="btn btn-primary btn-chromatic"
        onClick={handleSubmit}
        disabled={isBusy || amount === undefined || quote === undefined}
        data-testid={direction === 'buy' ? 'erc404-buy' : 'erc404-sell'}
      >
        {activeWrite.isPending
          ? 'confirm in wallet…'
          : isConfirming
            ? 'confirming…'
            : direction === 'buy'
              ? 'buy'
              : 'sell'}
      </button>

      {hasError && (
        <p className={`${styles.txStatus} ${styles.txError}`}>transaction failed — try again</p>
      )}
    </div>
  )
}
