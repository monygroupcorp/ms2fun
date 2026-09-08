/**
 * VaultPanel — alignment economics display for a collection's endowment vault.
 * Renders nothing for legacy (non-AaveEndowment) vaults.
 * ADR-0003: surfaces principal, maturity, yield, and the permissionless harvest action.
 */
import { formatEther } from 'viem'
import { useWaitForTransactionReceipt } from 'wagmi'
import { useWriteAlignmentEndowmentVaultHarvest } from '../../generated/contracts'
import { useCollectionChainId } from './useCollectionChain'
import { truncateAddress } from '../../lib/format'
import { Disclosure } from '../ui/Disclosure'
import { useEndowment } from './useEndowment'
import styles from './VaultPanel.module.css'

interface VaultPanelProps {
  vault: `0x${string}` | undefined
  benefactor: `0x${string}` | undefined
}

export function VaultPanel({ vault, benefactor }: VaultPanelProps) {
  const state = useEndowment(vault, benefactor)

  if (!state.isEndowment) return null

  return <VaultPanelInner vault={vault} state={state} />
}

interface VaultPanelInnerProps {
  vault: `0x${string}` | undefined
  state: ReturnType<typeof useEndowment>
}

function VaultPanelInner({ vault, state }: VaultPanelInnerProps) {
  const chainId = useCollectionChainId()
  const {
    writeContract,
    data: txHash,
    isPending: sigPending,
    reset: resetWrite,
  } = useWriteAlignmentEndowmentVaultHarvest()

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash })

  function handleHarvest(): void {
    if (!vault) return
    writeContract({ address: vault, chainId })
  }

  if (isSuccess) {
    state.refetch()
    resetWrite()
  }

  const isBusy = sigPending || isConfirming
  const yieldZero = state.yield === 0n

  const earliestMaturityDate =
    state.earliestMaturity > 0n
      ? new Date(Number(state.earliestMaturity) * 1000).toLocaleDateString()
      : '—'

  // Each deposit vests on its own clock and the vault exposes no view of them, so the panel states
  // the earliest date any principal can vest rather than a completed vest it cannot verify. The
  // only completed-vest claim left is `fullyVested`, which is `principalOf == 0` — nothing escrowed.
  const maturityLabel = (() => {
    if (state.depositTime === 0n) return '—'
    if (state.fullyVested) return 'vested ✓'
    return `earliest ${earliestMaturityDate}`
  })()

  const vestWeeks = state.vestDuration > 0n ? Number(state.vestDuration / 604800n) : 0
  const showsEarliest = state.depositTime > 0n && !state.fullyVested

  return (
    <Disclosure summary="COMMUNITY ENDOWMENT" testId="vault-panel">
      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>this collection's principal</span>
          <span className={styles.statValue}>{formatEther(state.principal)} ETH</span>
          <span className={styles.statNote}>non-refundable — vests to the community</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>maturity</span>
          <span className={styles.statValue}>{maturityLabel}</span>
          {showsEarliest && (
            <span className={styles.statNote}>
              {vestWeeks > 0 ? `${vestWeeks}-week vest — ` : ''}each top-up vests on its own clock
            </span>
          )}
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>harvestable yield</span>
          <span className={styles.statValue}>{formatEther(state.yield)} ETH</span>
          <div className={styles.harvestRow}>
            <button
              className="btn btn-secondary"
              onClick={handleHarvest}
              disabled={isBusy || yieldZero}
            >
              {sigPending ? 'confirm in wallet…' : isConfirming ? 'confirming…' : 'harvest'}
            </button>
            <span className={styles.harvestNote}>permissionless</span>
          </div>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>community</span>
          <span className={styles.statValue}>
            {state.communityPayout ? truncateAddress(state.communityPayout) : '—'}
          </span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>total endowment (all aligned)</span>
          <span className={styles.statValue}>{formatEther(state.totalPrincipal)} ETH</span>
        </div>
      </div>
    </Disclosure>
  )
}
