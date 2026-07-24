/**
 * VaultPanel — alignment economics display for a collection's endowment vault.
 * Renders nothing for legacy (non-AaveEndowment) vaults.
 * ADR-0003: surfaces principal, maturity, yield, and the permissionless harvest action.
 */
import { formatEther } from 'viem'
import { useWaitForTransactionReceipt } from 'wagmi'
import { useWriteAlignmentEndowmentVaultHarvest } from '../../generated/contracts'
import { forkChainId } from '../../lib/addresses'
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
  const {
    writeContract,
    data: txHash,
    isPending: sigPending,
    reset: resetWrite,
  } = useWriteAlignmentEndowmentVaultHarvest()

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash })

  function handleHarvest(): void {
    if (!vault) return
    writeContract({ address: vault, chainId: forkChainId })
  }

  if (isSuccess) {
    state.refetch()
    resetWrite()
  }

  const isBusy = sigPending || isConfirming
  const yieldZero = state.yield === 0n

  const maturityDate =
    state.maturity > 0n ? new Date(Number(state.maturity) * 1000).toLocaleDateString() : '—'

  const maturityLabel = (() => {
    if (state.depositTime === 0n) return '—'
    if (state.matured) return 'vested ✓'
    return `${maturityDate} (26-week vest)`
  })()

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
