/**
 * Embedded swap for the EXEC404 fossil (B19). EXEC's bonding curve is closed — it trades on a
 * Uniswap **V2** pool — so we route swaps through the zRouter singleton's `swapV2` IN-SITE instead
 * of only linking out. The Uniswap deep-link is kept as a secondary "advanced" escape hatch.
 *
 * Fossil-specific gotchas (verified against the fork):
 *  - EXEC is a DN404 with a ~4% fee-on-transfer tax, so the wallet receives a little less than the
 *    quoted pool output. zRouter reads the *actually-received* balance for the swap input, so sells
 *    are FoT-safe; buys just land ~tax% under the quote — hence a wider default slippage + a note.
 *  - zRouter's `swapV2` reads `deadline == type(uint256).max` as a Sushi-pool selector; we pass a
 *    finite deadline so it uses the Uniswap V2 pool EXEC actually graduated to.
 *  - ETH is the zRouter native sentinel `address(0)`; sells (EXEC→ETH) are approve-then-swap.
 */
import { useEffect, useState } from 'react'
import { erc20Abi, formatEther, formatUnits, maxUint256, parseEther, zeroAddress } from 'viem'
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { useSimulateZRouterSwapV2, useWriteZRouterSwapV2 } from '../generated/contracts'
import { forkAddresses } from '../lib/addresses'
import { EXEC404_ADDRESS, EXEC404_CHAIN_ID, UNISWAP_SWAP_URL, exec404Abi } from '../lib/exec404'
import { txErrorReason } from './ui/useTxAction'
import cardStyles from './Exec404TradeLink.module.css'
import styles from './collection/erc404/BondingSurface.module.css'

type Direction = 'buy' | 'sell'

const DEADLINE_BUFFER_SEC = 86_400n
/** Stable far-future deadline for the quote SIMULATION only (see GraduatedSwapPanel) — keeps the sim
 *  query key from churning every second; finite so it never trips zRouter's Sushi-pool selector. */
const QUOTE_DEADLINE = 9_999_999_999n
const BPS_DENOMINATOR = 10_000n
/** EXEC has a ~4% transfer tax, so a 1% default would revert most buys; start wider. */
const DEFAULT_SLIPPAGE_PCT = '6'

export function Exec404SwapPanel() {
  const { address, isConnected } = useAccount()
  const [direction, setDirection] = useState<Direction>('buy')
  const [amountStr, setAmountStr] = useState('')
  const [slippagePct, setSlippagePct] = useState(DEFAULT_SLIPPAGE_PCT)

  const zRouter = forkAddresses.zRouter
  const chainId = EXEC404_CHAIN_ID
  const isBuy = direction === 'buy'

  // Input is the SPENT asset (buy → ETH, sell → EXEC); both are 18 decimals so one parse covers it.
  let amountIn: bigint | undefined
  try {
    const trimmed = amountStr.trim()
    amountIn = trimmed === '' ? undefined : parseEther(trimmed)
    if (amountIn !== undefined && amountIn <= 0n) amountIn = undefined
  } catch {
    amountIn = undefined
  }

  const slippageBps = BigInt(Math.max(0, Math.round((Number(slippagePct) || 0) * 100)))

  const allowanceRead = useReadContract({
    address: EXEC404_ADDRESS,
    abi: exec404Abi,
    functionName: 'allowance',
    chainId,
    args: address ? [address, zRouter] : undefined,
    query: { enabled: Boolean(address) },
  })
  const allowance = allowanceRead.data ?? 0n
  const needsApproval = !isBuy && amountIn !== undefined && allowance < amountIn

  const balanceRead = useReadContract({
    address: EXEC404_ADDRESS,
    abi: exec404Abi,
    functionName: 'balanceOf',
    chainId,
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  })

  const tokenIn = isBuy ? zeroAddress : EXEC404_ADDRESS
  const tokenOut = isBuy ? EXEC404_ADDRESS : zeroAddress
  const deadline = () => BigInt(Math.floor(Date.now() / 1000)) + DEADLINE_BUFFER_SEC

  const quoteReady = isConnected && amountIn !== undefined && (isBuy || !needsApproval)
  const buyValue = isBuy && amountIn !== undefined ? amountIn : undefined

  const sim = useSimulateZRouterSwapV2({
    address: zRouter,
    chainId,
    account: address,
    value: buyValue,
    args:
      amountIn !== undefined
        ? [address ?? zeroAddress, false, tokenIn, tokenOut, amountIn, 0n, QUOTE_DEADLINE]
        : undefined,
    query: { enabled: quoteReady },
  })
  const quoteOut = sim.data?.result?.[1]
  const minOut =
    quoteOut !== undefined ? (quoteOut * (BPS_DENOMINATOR - slippageBps)) / BPS_DENOMINATOR : undefined

  const approve = useWriteContract()
  const swap = useWriteZRouterSwapV2()
  const { isLoading: isApproving, isSuccess: approveConfirmed } = useWaitForTransactionReceipt({
    hash: approve.data,
  })
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: swap.data })

  // Re-read the allowance once the approval is MINED so `needsApproval` flips (see GraduatedSwapPanel).
  const refetchAllowance = allowanceRead.refetch
  useEffect(() => {
    if (approveConfirmed) void refetchAllowance()
  }, [approveConfirmed, refetchAllowance])

  function handleApprove(): void {
    approve.writeContract({
      address: EXEC404_ADDRESS,
      abi: erc20Abi,
      functionName: 'approve',
      chainId,
      args: [zRouter, maxUint256],
    })
  }

  function handleSwap(): void {
    if (amountIn === undefined || minOut === undefined) return
    swap.writeContract({
      address: zRouter,
      chainId,
      args: [address ?? zeroAddress, false, tokenIn, tokenOut, amountIn, minOut, deadline()],
      value: buyValue,
    })
  }

  function handleReset(): void {
    swap.reset()
    setAmountStr('')
    void balanceRead.refetch()
    void allowanceRead.refetch()
  }

  const inLabel = isBuy ? 'amount (ETH)' : 'amount (EXEC)'
  const outLabel = isBuy ? 'EXEC' : 'ETH'
  const quoteValue =
    quoteOut !== undefined
      ? `${isBuy ? formatUnits(quoteOut, 18) : formatEther(quoteOut)} ${outLabel}`
      : '—'
  const isBusy = swap.isPending || isConfirming
  const swapError = txErrorReason(swap.error)
  const quoteError = sim.error && quoteReady ? txErrorReason(sim.error) : undefined

  return (
    <section className={cardStyles.card} data-testid="exec404-swap">
      <h2 className={cardStyles.title}>Trade</h2>
      <p className={cardStyles.note}>Graduated to a Uniswap V2 pool — swap EXEC here (routed via zRouter).</p>

      {!isConnected ? (
        <p className={styles.connectNote}>connect wallet to trade</p>
      ) : isSuccess ? (
        <>
          <p className={styles.txStatus}>{isBuy ? 'bought' : 'sold'} EXEC — tx confirmed.</p>
          <button className="btn btn-secondary" onClick={handleReset} data-testid="exec404-swap-again">
            trade again
          </button>
        </>
      ) : (
        <div className={styles.panel}>
          <div className={styles.toggle}>
            <button
              type="button"
              className={`${styles.toggleBtn} ${isBuy ? styles.toggleActive : ''}`}
              onClick={() => setDirection('buy')}
              data-testid="exec404-direction-buy"
            >
              buy
            </button>
            <button
              type="button"
              className={`${styles.toggleBtn} ${!isBuy ? styles.toggleActive : ''}`}
              onClick={() => setDirection('sell')}
              data-testid="exec404-direction-sell"
            >
              sell
            </button>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="exec404-amount">
              {inLabel}
            </label>
            <input
              id="exec404-amount"
              className={styles.input}
              type="text"
              inputMode="decimal"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              placeholder="0.0"
              disabled={isBusy}
              data-testid="exec404-amount-input"
            />
            {!isBuy && balanceRead.data !== undefined && (
              <span className={styles.note}>balance: {formatUnits(balanceRead.data, 18)} EXEC</span>
            )}
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="exec404-slippage">
              slippage %
            </label>
            <div className={styles.slippageRow}>
              <input
                id="exec404-slippage"
                className={`${styles.input} ${styles.slippageInput}`}
                type="text"
                inputMode="decimal"
                value={slippagePct}
                onChange={(e) => setSlippagePct(e.target.value)}
                disabled={isBusy}
                data-testid="exec404-slippage-input"
              />
              <span className={styles.note}>~4% transfer tax</span>
            </div>
          </div>

          <div className={styles.quoteRow} data-testid="exec404-quote">
            <span className={styles.quoteLabel}>receive</span>
            <span className={styles.quoteValue}>{sim.isFetching && quoteReady ? '…' : quoteValue}</span>
          </div>

          {needsApproval ? (
            <button
              className="btn btn-primary btn-chromatic"
              onClick={handleApprove}
              disabled={approve.isPending || isApproving}
              data-testid="exec404-approve"
            >
              {approve.isPending ? 'confirm in wallet…' : isApproving ? 'approving…' : 'approve EXEC'}
            </button>
          ) : (
            <button
              className="btn btn-primary btn-chromatic"
              onClick={handleSwap}
              disabled={isBusy || amountIn === undefined || minOut === undefined}
              data-testid="exec404-swap-submit"
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

          {quoteError && !swapError && (
            <p className={`${styles.txStatus} ${styles.txError}`}>quote failed: {quoteError}</p>
          )}
          {swapError && (
            <p className={`${styles.txStatus} ${styles.txError}`}>transaction failed: {swapError}</p>
          )}
        </div>
      )}

      <a
        className={cardStyles.fine}
        href={UNISWAP_SWAP_URL}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="exec404-uniswap-link"
      >
        or trade on app.uniswap.org ↗
      </a>
    </section>
  )
}
