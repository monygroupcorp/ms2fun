/**
 * ERC404 staking surface. The INSTANCE exposes the stake/unstake/claim/activate entrypoints; the
 * separate ERC404StakingModule holds the position/reward READS (aggregated in useStaking).
 *
 * Visibility:
 *  - stakingActive === false: owner sees an "activate staking" button; non-owners see nothing.
 *  - stakingActive === true: staked balance + pending rewards, a stake form (capped at token
 *    balance), an unstake form (capped at staked balance), and a claim-rewards button.
 *
 * Amounts are token units (parseUnits/formatUnits with the instance decimals); rewards are ETH/wei.
 * Each write has its own tx-receipt wait and refetches every read on success (write idiom mirrors
 * SwapPanel / EditionList: useWrite + useWaitForTransactionReceipt, forkChainId + chainId on every
 * call).
 */
import { useEffect, useState } from 'react'
import { formatEther, formatUnits, parseUnits } from 'viem'
import { useWaitForTransactionReceipt } from 'wagmi'
import {
  useWriteErc404BondingInstanceClaimStakingRewards,
  useWriteErc404BondingInstanceStake,
  useWriteErc404BondingInstanceUnstake,
} from '../../../generated/contracts'
import { forkChainId } from '../../../lib/addresses'
import { useStaking } from './useStaking'
import bonding from './BondingSurface.module.css'
import styles from './StakingPanel.module.css'

interface StakingPanelProps {
  instance: `0x${string}`
  /** Instance token decimals — passed in by the parent (already read for the swap surface). */
  decimals: number
}

/** Parse a token-unit amount string into base units; invalid/empty/<=0 → undefined. */
function parseAmount(input: string, decimals: number): bigint | undefined {
  try {
    const trimmed = input.trim()
    if (trimmed === '') return undefined
    const value = parseUnits(trimmed, decimals)
    return value > 0n ? value : undefined
  } catch {
    return undefined
  }
}

export function StakingPanel({ instance, decimals }: StakingPanelProps) {
  const { stakingActive, tokenBalance, userStaked, globalTotalStaked, pendingRewards, refetch } =
    useStaking(instance)

  const [stakeStr, setStakeStr] = useState('')
  const [unstakeStr, setUnstakeStr] = useState('')

  const stake = useWriteErc404BondingInstanceStake()
  const unstake = useWriteErc404BondingInstanceUnstake()
  const claim = useWriteErc404BondingInstanceClaimStakingRewards()

  const stakeRx = useWaitForTransactionReceipt({ hash: stake.data })
  const unstakeRx = useWaitForTransactionReceipt({ hash: unstake.data })
  const claimRx = useWaitForTransactionReceipt({ hash: claim.data })

  // Refetch reads once each write confirms; clear the corresponding input on stake/unstake.
  // Effects (not in-render side effects) keep this safe across re-renders / strict mode.
  useEffect(() => {
    if (stakeRx.isSuccess) {
      setStakeStr('')
      refetch()
    }
  }, [stakeRx.isSuccess, refetch])
  useEffect(() => {
    if (unstakeRx.isSuccess) {
      setUnstakeStr('')
      refetch()
    }
  }, [unstakeRx.isSuccess, refetch])
  useEffect(() => {
    if (claimRx.isSuccess) refetch()
  }, [claimRx.isSuccess, refetch])

  // ---- Visibility gates -------------------------------------------------
  // Pre-activation shows nothing here — ACTIVATE STAKING is a creator action, moved to the admin
  // menu (T4). This panel is the holder-facing stake/unstake/claim surface, live once active.
  if (stakingActive === undefined || !stakingActive) return null

  // ---- Active surface ---------------------------------------------------
  const stakeAmount = parseAmount(stakeStr, decimals)
  const unstakeAmount = parseAmount(unstakeStr, decimals)

  const stakeBusy = stake.isPending || stakeRx.isLoading
  const unstakeBusy = unstake.isPending || unstakeRx.isLoading
  const claimBusy = claim.isPending || claimRx.isLoading

  const stakeOverBalance =
    stakeAmount !== undefined && tokenBalance !== undefined && stakeAmount > tokenBalance
  const unstakeOverStaked =
    unstakeAmount !== undefined && userStaked !== undefined && unstakeAmount > userStaked

  const hasRewards = pendingRewards !== undefined && pendingRewards > 0n

  const fmt = (v: bigint | undefined): string => (v === undefined ? '—' : formatUnits(v, decimals))

  return (
    <div className={bonding.panel} data-testid="erc404-staking">
      <p className={bonding.panelTitle}>staking</p>

      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>your stake</span>
          <span className={styles.statValue}>{fmt(userStaked)}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>pending rewards</span>
          <span className={styles.statValue}>
            {pendingRewards === undefined ? '—' : `${formatEther(pendingRewards)} ETH`}
          </span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>total staked</span>
          <span className={styles.statValue}>{fmt(globalTotalStaked)}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>your balance</span>
          <span className={styles.statValue}>{fmt(tokenBalance)}</span>
        </div>
      </div>

      {/* ---- Stake ---- */}
      <div className={styles.formSection}>
        <div className={bonding.field}>
          <label className={bonding.label} htmlFor="erc404-stake-amount">
            stake (tokens)
          </label>
          <input
            id="erc404-stake-amount"
            className={bonding.input}
            type="text"
            inputMode="decimal"
            value={stakeStr}
            onChange={(e) => setStakeStr(e.target.value)}
            placeholder="0.0"
            disabled={stakeBusy}
            data-testid="erc404-stake-input"
          />
        </div>
        <button
          className={`btn btn-primary ${styles.fullWidthBtn}`}
          onClick={() => {
            if (stakeAmount === undefined) return
            stake.writeContract({
              address: instance,
              chainId: forkChainId,
              args: [stakeAmount],
            })
          }}
          disabled={stakeBusy || stakeAmount === undefined || stakeOverBalance}
          data-testid="erc404-stake"
        >
          {stake.isPending
            ? 'confirm in wallet…'
            : stakeRx.isLoading
              ? 'staking…'
              : stakeOverBalance
                ? 'exceeds balance'
                : 'stake'}
        </button>
        {stake.isError && (
          <p className={`${bonding.txStatus} ${bonding.txError}`}>stake failed — try again</p>
        )}
      </div>

      {/* ---- Unstake ---- */}
      <div className={styles.formSection}>
        <div className={bonding.field}>
          <label className={bonding.label} htmlFor="erc404-unstake-amount">
            unstake (tokens)
          </label>
          <input
            id="erc404-unstake-amount"
            className={bonding.input}
            type="text"
            inputMode="decimal"
            value={unstakeStr}
            onChange={(e) => setUnstakeStr(e.target.value)}
            placeholder="0.0"
            disabled={unstakeBusy}
            data-testid="erc404-unstake-input"
          />
        </div>
        <button
          className={`btn btn-secondary ${styles.fullWidthBtn}`}
          onClick={() => {
            if (unstakeAmount === undefined) return
            unstake.writeContract({
              address: instance,
              chainId: forkChainId,
              args: [unstakeAmount],
            })
          }}
          disabled={unstakeBusy || unstakeAmount === undefined || unstakeOverStaked}
          data-testid="erc404-unstake"
        >
          {unstake.isPending
            ? 'confirm in wallet…'
            : unstakeRx.isLoading
              ? 'unstaking…'
              : unstakeOverStaked
                ? 'exceeds stake'
                : 'unstake'}
        </button>
        {unstake.isError && (
          <p className={`${bonding.txStatus} ${bonding.txError}`}>unstake failed — try again</p>
        )}
      </div>

      {/* ---- Claim ---- */}
      <button
        className={`btn btn-primary btn-chromatic ${styles.fullWidthBtn}`}
        onClick={() => claim.writeContract({ address: instance, chainId: forkChainId })}
        disabled={claimBusy || !hasRewards}
        data-testid="erc404-claim-rewards"
      >
        {claim.isPending ? 'confirm in wallet…' : claimRx.isLoading ? 'claiming…' : 'claim rewards'}
      </button>
      {claim.isError && (
        <p className={`${bonding.txStatus} ${bonding.txError}`}>claim failed — try again</p>
      )}
    </div>
  )
}
