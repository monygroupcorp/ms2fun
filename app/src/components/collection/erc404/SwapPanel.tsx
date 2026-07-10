/**
 * Buy/Sell against the bonding curve.
 *
 * BUY is denominated in ETH-to-SPEND (S4) — no one types a coin count on a swap UI. The curve's API
 * is amount-in / cost-out (`buyBonding(amount, maxCost, …)` with `calculateCost` the truth), so we
 * INVERT it: `solveBuyAmount` bisects `calculateCost` to find the largest token amount whose cost is
 * <= the ETH the user typed (never overspends), seeded by the client curve for fast convergence and
 * capped at the buyable ceiling (maxSupply − liquidityReserve − freeMint − totalBondingSupply). The
 * resolved amount + its exact cost drive the tx; `maxCost`/`value` = cost + slippage. Quick-fill ETH
 * presets (.005/.01/.05/.1) fill the spend input.
 *
 * SELL is unchanged: a token amount, quoted by `calculateRefund`, with %-of-balance quick-fill.
 *
 * buyBonding(amount, maxCost, mintNFT, gatingData, messageData, deadline) — payable, value = maxCost.
 *   (post-#25 `gatingData` is `bytes` = abi.encode(bytes32 passwordHash); see gating.encodeBuyGatingData.)
 * sellBonding(amount, minRefund, passwordHash, messageData, deadline) — passwordHash still `bytes32`.
 */
import { useEffect, useState } from 'react'
import { formatEther, formatUnits, parseEther, parseUnits } from 'viem'
import { useAccount, usePublicClient, useWaitForTransactionReceipt } from 'wagmi'
import {
  curveParamsComputerAbi,
  useReadCurveParamsComputerCalculateRefund,
  useReadErc404BondingInstanceBalanceOf,
  useReadErc404BondingInstanceFreeMintAllocation,
  useReadErc404BondingInstanceLiquidityReserve,
  useReadErc404BondingInstanceUnit,
  useWriteErc404BondingInstanceBuyBonding,
  useWriteErc404BondingInstanceSellBonding,
} from '../../../generated/contracts'
import { forkChainId } from '../../../lib/addresses'
import type { BondingView } from './bondingPhase'
import { applyBuySlippage, applySellSlippage, formatBps } from './bondingFormat'
import type { CurveParamsTuple } from './useBondingData'
import { EMPTY_BYTES, ZERO_BYTES32, encodeBuyGatingData, resolveBuyPasswordHash } from './gating'
import { encodeActionMessage } from '../../../lib/actionMessage'
import { type CostInverse, solveBuyAmount } from './costInverse'
import { curveParamsFromTuple, curvePriceAt } from './curveSampler'
import { SwapQuickFill } from './SwapQuickFill'
import { buyEthPresets, sellPctPresets } from './swapPresets'
import styles from './BondingSurface.module.css'

type Direction = 'buy' | 'sell'

/** 24h deadline buffer (legacy parity) — generous for local-fork timestamp drift. */
const DEADLINE_BUFFER_SEC = 86_400n

/** Placeholder address for disabled quote reads (query is gated off when no computer is resolved). */
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const

/** Debounce (ms) before the buy inverse-solve fires, so typing doesn't spam the probe. */
const SOLVE_DEBOUNCE_MS = 250

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
  const publicClient = usePublicClient({ chainId: forkChainId })
  const [direction, setDirection] = useState<Direction>('buy')
  const [amountStr, setAmountStr] = useState('')
  const [slippagePct, setSlippagePct] = useState('1')
  const [mintNFT, setMintNFT] = useState(false)
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')

  const isBuy = direction === 'buy'
  const slippageBps = Math.round((Number(slippagePct) || 0) * 100)

  // BUY input = ETH to spend; SELL input = token amount.
  let spendWei: bigint | undefined
  try {
    spendWei = isBuy && amountStr.trim() !== '' ? parseEther(amountStr.trim()) : undefined
    if (spendWei !== undefined && spendWei <= 0n) spendWei = undefined
  } catch {
    spendWei = undefined
  }
  let sellAmount: bigint | undefined
  try {
    sellAmount =
      !isBuy && amountStr.trim() !== '' ? parseUnits(amountStr.trim(), decimals) : undefined
    if (sellAmount !== undefined && sellAmount <= 0n) sellAmount = undefined
  } catch {
    sellAmount = undefined
  }

  // Buyable ceiling for the inverse solve (contract's ExceedsBonding guard).
  const unit = useReadErc404BondingInstanceUnit({ address: instance, chainId: forkChainId })
  const reserveRead = useReadErc404BondingInstanceLiquidityReserve({
    address: instance,
    chainId: forkChainId,
  })
  const freeMintRead = useReadErc404BondingInstanceFreeMintAllocation({
    address: instance,
    chainId: forkChainId,
  })
  let remaining: bigint | undefined
  if (
    unit.data !== undefined &&
    reserveRead.data !== undefined &&
    freeMintRead.data !== undefined
  ) {
    const ceiling = view.maxSupply - reserveRead.data - freeMintRead.data * unit.data
    const r = ceiling - view.totalBondingSupply
    remaining = r > 0n ? r : 0n
  }

  // ── BUY inverse-solve: ETH spend → token amount + exact cost ──────────────────────────────────
  const [resolved, setResolved] = useState<CostInverse | undefined>()
  const [solving, setSolving] = useState(false)

  // A stable key of everything the solve depends on (curveParams is a fresh array each render, so we
  // can't put it in the dep list directly). Empty string = solve not applicable → clear.
  const solveKey =
    isBuy &&
    spendWei !== undefined &&
    curveComputer !== undefined &&
    curveParams !== undefined &&
    remaining !== undefined &&
    remaining > 0n
      ? `${spendWei}|${remaining}|${view.totalBondingSupply}|${curveComputer}|${curveParams.join(',')}`
      : ''

  useEffect(() => {
    if (
      solveKey === '' ||
      !publicClient ||
      spendWei === undefined ||
      curveComputer === undefined ||
      curveParams === undefined ||
      remaining === undefined
    ) {
      setResolved(undefined)
      setSolving(false)
      return
    }
    const ctrl = new AbortController()
    setSolving(true)
    const params = {
      initialPrice: curveParams[0],
      quarticCoeff: curveParams[1],
      cubicCoeff: curveParams[2],
      quadraticCoeff: curveParams[3],
      normalizationFactor: curveParams[4],
    }
    const costOf = (amt: bigint): Promise<bigint> =>
      publicClient.readContract({
        address: curveComputer,
        abi: curveParamsComputerAbi,
        functionName: 'calculateCost',
        args: [params, view.totalBondingSupply, amt],
      }) as Promise<bigint>

    // Client-curve seed: at the current marginal price, spend/price is an over-estimate of the amount
    // (price only rises), which brackets the search tightly. Skip if the price reads as 0.
    const price0 = curvePriceAt(curveParamsFromTuple(curveParams), Number(view.totalBondingSupply))
    const seed =
      price0 > 0 ? BigInt(Math.floor((Number(spendWei) / 1e18 / price0) * 1e18)) : undefined

    const timer = setTimeout(() => {
      solveBuyAmount({
        targetSpend: spendWei,
        maxAmount: remaining,
        costOf,
        seed,
        signal: ctrl.signal,
      })
        .then((r) => {
          if (!ctrl.signal.aborted) {
            setResolved(r)
            setSolving(false)
          }
        })
        .catch(() => {
          if (!ctrl.signal.aborted) {
            setResolved(undefined)
            setSolving(false)
          }
        })
    }, SOLVE_DEBOUNCE_MS)

    return () => {
      ctrl.abort()
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solveKey encodes every input; the rest are stable
  }, [solveKey, publicClient])

  // ── SELL quote (unchanged): token amount → refund ─────────────────────────────────────────────
  const refundQuote = useReadCurveParamsComputerCalculateRefund({
    address: curveComputer ?? ZERO_ADDRESS,
    chainId: forkChainId,
    args:
      curveParams !== undefined && sellAmount !== undefined
        ? [
            {
              initialPrice: curveParams[0],
              quarticCoeff: curveParams[1],
              cubicCoeff: curveParams[2],
              quadraticCoeff: curveParams[3],
              normalizationFactor: curveParams[4],
            },
            view.totalBondingSupply,
            sellAmount,
          ]
        : undefined,
    query: {
      enabled:
        !isBuy &&
        sellAmount !== undefined &&
        curveParams !== undefined &&
        curveComputer !== undefined,
    },
  })

  const balance = useReadErc404BondingInstanceBalanceOf({
    address: instance,
    chainId: forkChainId,
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  })

  const buy = useWriteErc404BondingInstanceBuyBonding()
  const sell = useWriteErc404BondingInstanceSellBonding()
  const activeWrite = isBuy ? buy : sell

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: activeWrite.data,
  })

  function handleSubmit(): void {
    const deadline = BigInt(Math.floor(Date.now() / 1000)) + DEADLINE_BUFFER_SEC
    // `sellBonding` still takes the raw bytes32 passwordHash; `buyBonding` (post-#25) takes `bytes`
    // gatingData, forwarded to the module's abi.decode(data,(bytes32)). Derive the hash once, then
    // wrap it for the buy path.
    const passwordHash = gatingActive ? resolveBuyPasswordHash(password) : ZERO_BYTES32

    if (isBuy) {
      if (resolved === undefined) return
      // Optional buy message → posted to the collection channel atomically with the trade (S5).
      const trimmedMsg = message.trim()
      const messageData = trimmedMsg ? encodeActionMessage(trimmedMsg) : EMPTY_BYTES
      const maxCost = applyBuySlippage(resolved.cost, slippageBps)
      const gatingData = gatingActive ? encodeBuyGatingData(passwordHash) : EMPTY_BYTES
      buy.writeContract({
        address: instance,
        chainId: forkChainId,
        args: [resolved.amount, maxCost, mintNFT, gatingData, messageData, deadline],
        value: maxCost,
      })
    } else {
      if (sellAmount === undefined || refundQuote.data === undefined) return
      const minRefund = applySellSlippage(refundQuote.data, slippageBps)
      sell.writeContract({
        address: instance,
        chainId: forkChainId,
        args: [sellAmount, minRefund, passwordHash, EMPTY_BYTES, deadline],
      })
    }
  }

  function handleReset(): void {
    activeWrite.reset()
    setAmountStr('')
    setMessage('')
    setResolved(undefined)
    void balance.refetch()
    refetch()
  }

  const isBusy = activeWrite.isPending || isConfirming
  const hasError = activeWrite.isError

  // Whether the action can fire.
  const canSubmit = isBuy
    ? resolved !== undefined && !solving
    : sellAmount !== undefined && refundQuote.data !== undefined

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
        <p className={styles.txStatus}>{isBuy ? 'bought' : 'sold'} — tx confirmed.</p>
        <button className="btn btn-secondary" onClick={handleReset}>
          reset
        </button>
      </div>
    )
  }

  // Quote row. BUY shows tokens received (with the exact ETH cost as a sub-note); SELL shows the refund.
  const buyTooSmall = isBuy && spendWei !== undefined && !solving && resolved === undefined
  const buyQuoteValue = solving
    ? '…'
    : resolved !== undefined
      ? `${formatUnits(resolved.amount, decimals)} tokens`
      : buyTooSmall
        ? 'spend too small'
        : '—'
  const sellQuoteValue =
    refundQuote.data !== undefined ? `${formatEther(refundQuote.data)} ETH` : '—'

  return (
    <div className={styles.panel} data-testid="erc404-swap">
      <p className={styles.panelTitle}>trade</p>

      <div className={styles.toggle}>
        <button
          type="button"
          className={`${styles.toggleBtn} ${isBuy ? styles.toggleActive : ''}`}
          onClick={() => {
            setDirection('buy')
            setAmountStr('')
          }}
          data-testid="erc404-direction-buy"
        >
          buy
        </button>
        <button
          type="button"
          className={`${styles.toggleBtn} ${!isBuy ? styles.toggleActive : ''}`}
          onClick={() => {
            setDirection('sell')
            setAmountStr('')
          }}
          data-testid="erc404-direction-sell"
        >
          sell
        </button>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="erc404-amount">
          {isBuy ? 'spend (ETH)' : 'amount (tokens)'}
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
        {/* Buy fills an ETH amount to spend; sell fills a % of the token balance. */}
        <SwapQuickFill
          className={styles.quickfill}
          disabled={isBusy}
          onPick={setAmountStr}
          presets={isBuy ? buyEthPresets() : sellPctPresets(balance.data, decimals)}
        />
        {!isBuy && balance.data !== undefined && (
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

      {isBuy && (
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

      {isBuy && (
        <div className={styles.field}>
          <label className={styles.label} htmlFor="erc404-buy-message">
            message (optional)
          </label>
          {/* Rides along as buyBonding's messageData → posts to the collection channel with the buy. */}
          <input
            id="erc404-buy-message"
            className={styles.input}
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="say something with your buy…"
            disabled={isBusy}
            maxLength={280}
            data-testid="erc404-buy-message"
          />
        </div>
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
        <span className={styles.quoteLabel}>{isBuy ? 'receive' : 'refund'}</span>
        <span className={styles.quoteValue}>{isBuy ? buyQuoteValue : sellQuoteValue}</span>
      </div>
      {isBuy && resolved !== undefined && (
        <div className={styles.quoteRow}>
          <span className={styles.quoteLabel}>cost</span>
          <span className={styles.quoteValue} data-testid="erc404-buy-cost">
            ≈ {formatEther(resolved.cost)} ETH
          </span>
        </div>
      )}

      <button
        className="btn btn-primary btn-chromatic"
        onClick={handleSubmit}
        disabled={isBusy || !canSubmit}
        data-testid={isBuy ? 'erc404-buy' : 'erc404-sell'}
      >
        {activeWrite.isPending
          ? 'confirm in wallet…'
          : isConfirming
            ? 'confirming…'
            : isBuy
              ? 'buy'
              : 'sell'}
      </button>

      {hasError && (
        <p className={`${styles.txStatus} ${styles.txError}`}>transaction failed — try again</p>
      )}
    </div>
  )
}
