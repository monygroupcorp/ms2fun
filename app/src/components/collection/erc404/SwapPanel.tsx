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
import { useCollectionChainId } from '../useCollectionChain'
import { txErrorReason } from '../../ui/useTxAction'
import { tierErrorCopy } from './tierErrorCopy'
import { useTierPosition } from './useTierPosition'
import { previewBandBurn } from './bandBurnPreview'
import type { BondingView } from './bondingPhase'
import { applyBuySlippage, applySellSlippage, formatBps } from './bondingFormat'
import type { CurveParamsTuple } from './useBondingData'
import { EMPTY_BYTES, ZERO_BYTES32, encodeMerkleGatingData, resolveBuyPasswordHash } from './gating'
import { useMerkleAllowlistProof } from './useMerkleAllowlist'
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
  const chainId = useCollectionChainId()
  const { address, isConnected } = useAccount()
  const publicClient = usePublicClient({ chainId: chainId })
  const [direction, setDirection] = useState<Direction>('buy')
  const [amountStr, setAmountStr] = useState('')
  const [slippagePct, setSlippagePct] = useState('1')
  const [mintNFT, setMintNFT] = useState(false)
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')

  const isBuy = direction === 'buy'
  const slippageBps = Math.round((Number(slippagePct) || 0) * 100)

  // BUY gating (noesis-080): the only deployed gating module is MerkleGatingModule, so `gatingActive`
  // on the buy side means "resolve a merkle proof", not "ask for a password" — the password field below
  // stays for SELL, which still takes a raw `bytes32 passwordHash` untouched by the gating module (see
  // gating.ts's doc comment).
  const buyAllowlist = useMerkleAllowlistProof(instance, gatingActive && isBuy)

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
  const unit = useReadErc404BondingInstanceUnit({ address: instance, chainId: chainId })
  const reserveRead = useReadErc404BondingInstanceLiquidityReserve({
    address: instance,
    chainId: chainId,
  })
  const freeMintRead = useReadErc404BondingInstanceFreeMintAllocation({
    address: instance,
    chainId: chainId,
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
      kCoeff: curveParams[0],
      poleWad: curveParams[1],
      normalizationFactor: curveParams[2],
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
    chainId: chainId,
    args:
      curveParams !== undefined && sellAmount !== undefined
        ? [
            {
              kCoeff: curveParams[0],
              poleWad: curveParams[1],
              normalizationFactor: curveParams[2],
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
    chainId: chainId,
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  })

  // Holdings readout (noesis-172): `balance` above stays the ONLY read used for the sell quote,
  // limit, and quick-fill presets (the balanceOf-primacy rule — see useTierPosition's docstring).
  // `tiered`/`holdings`/`pendingEscrowRelease` here drive display only.
  const {
    tiered,
    holdings,
    pendingEscrowRelease,
    bandPieces,
    balance: tierBalance,
  } = useTierPosition(instance, address)

  // Debit-burns-your-band preview (noesis-173): fed `tierBalance` (balanceOf-primacy, never
  // `holdings`) and the existing `unit` read above — SEE its own module doc for the arithmetic.
  const bandBurnPreview = previewBandBurn({
    balance: tierBalance,
    amount: sellAmount,
    unit: unit.data,
    bandPieces,
  })

  const buy = useWriteErc404BondingInstanceBuyBonding()
  const sell = useWriteErc404BondingInstanceSellBonding()
  const activeWrite = isBuy ? buy : sell

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: activeWrite.data,
  })

  function handleSubmit(): void {
    const deadline = BigInt(Math.floor(Date.now() / 1000)) + DEADLINE_BUFFER_SEC

    if (isBuy) {
      if (resolved === undefined) return
      // A gated buy with no resolved merkle proof must not fire.
      if (
        gatingActive &&
        (buyAllowlist.status !== 'eligible' || buyAllowlist.proof === undefined)
      ) {
        return
      }
      // Optional buy message → posted to the collection channel atomically with the trade (S5).
      const trimmedMsg = message.trim()
      const messageData = trimmedMsg ? encodeActionMessage(trimmedMsg) : EMPTY_BYTES
      const maxCost = applyBuySlippage(resolved.cost, slippageBps)
      const gatingData =
        gatingActive && buyAllowlist.proof !== undefined
          ? encodeMerkleGatingData(0n, buyAllowlist.maxQty ?? 0n, buyAllowlist.proof)
          : EMPTY_BYTES
      buy.writeContract({
        address: instance,
        chainId: chainId,
        args: [resolved.amount, maxCost, mintNFT, gatingData, messageData, deadline],
        value: maxCost,
      })
    } else {
      if (sellAmount === undefined || refundQuote.data === undefined) return
      const minRefund = applySellSlippage(refundQuote.data, slippageBps)
      // `sellBonding` still takes the raw bytes32 passwordHash, unaffected by the merkle module
      // (gating.ts's doc comment) — vestigial now PasswordTierGating is gone, but left intact.
      const passwordHash = gatingActive ? resolveBuyPasswordHash(password) : ZERO_BYTES32
      sell.writeContract({
        address: instance,
        chainId: chainId,
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
  const swapReason = txErrorReason(activeWrite.error)
  const swapErrorCopy = tierErrorCopy(swapReason)

  // Whether the action can fire. A gated buy additionally needs a resolved merkle proof.
  const canSubmit = isBuy
    ? resolved !== undefined && !solving && (!gatingActive || buyAllowlist.status === 'eligible')
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
        {/* Untiered (every ERC-404 shipped to date): unchanged from before this readout existed. */}
        {!isBuy && balance.data !== undefined && !tiered && (
          <span className={styles.note}>balance: {formatEther(balance.data)}</span>
        )}
        {/* Tiered: Holdings (coinBalanceOf, escrow-inclusive) beside balance (transferable) so
            coin folded into a band NFT reads as held, not lost. `balance` still drives the sell
            quote/limit above — this block is display only. Each value renders only once its own
            read has landed; a momentary "0" here would be exactly the false loss this exists to
            stop. */}
        {!isBuy && balance.data !== undefined && tiered && (
          <div className={styles.note} data-testid="erc404-holdings-readout">
            {holdings !== undefined && <div>holdings: {formatEther(holdings)}</div>}
            <div>balance: {formatEther(balance.data)}</div>
          </div>
        )}
        {!isBuy && tiered && pendingEscrowRelease !== undefined && pendingEscrowRelease > 0n && (
          <p className={styles.note} data-testid="erc404-pending-escrow-note">
            {formatEther(pendingEscrowRelease)} released from escrow and waiting to be claimed — not
            yet in your balance.
          </p>
        )}
        {/* Debit-burns-your-band warning (noesis-173): informational only — never blocks the sell,
            never implies the coin is at risk. Named exactly when the holder owns one band and the
            debit empties the whole position; bounded otherwise. */}
        {!isBuy && tiered && bandBurnPreview.bandsBurnedMax > 0 && (
          <p className={styles.note} data-testid="erc404-band-burn-warning">
            {bandBurnPreview.exact && bandBurnPreview.bandBurned !== undefined ? (
              <>
                This sell burns tier {bandBurnPreview.bandBurned.tierN} band #
                {bandBurnPreview.bandBurned.id.toString()} and credits you{' '}
                {formatEther(bandBurnPreview.escrowReleasedMax)} as claimable escrow. The NFT is
                gone; the coin is not.
              </>
            ) : (
              <>
                This sell burns {bandBurnPreview.piecesBurned} of your NFTs, and up to{' '}
                {bandBurnPreview.bandsBurnedMax} of them may be band NFTs — up to{' '}
                {formatEther(bandBurnPreview.escrowReleasedMax)} credited to you as claimable
                escrow. The coin is not lost; the NFTs are.
              </>
            )}
          </p>
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

      {gatingActive && isBuy && (
        <p className={styles.field} data-testid="erc404-buy-allowlist-status">
          {buyAllowlist.status === 'loading' && 'checking allowlist…'}
          {buyAllowlist.status === 'no-list' && 'allowlist not yet configured by the creator'}
          {buyAllowlist.status === 'not-eligible' && 'this wallet is not on the allowlist'}
          {buyAllowlist.status === 'eligible' &&
            `allowlisted — up to ${buyAllowlist.maxQty?.toString() ?? '0'} per wallet`}
        </p>
      )}

      {gatingActive && !isBuy && (
        <div className={styles.field}>
          <label className={styles.label} htmlFor="erc404-password">
            access password
          </label>
          {/* `sellBonding` still takes a raw bytes32 passwordHash, unaffected by the merkle gating
              module (see gating.ts's doc comment) — vestigial now PasswordTierGating is gone. */}
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
        <p className={`${styles.txStatus} ${styles.txError}`}>
          {swapErrorCopy ?? 'transaction failed — try again'}
        </p>
      )}
    </div>
  )
}
