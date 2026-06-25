/**
 * VaultPanel — alignment economics display for a collection's endowment vault.
 * Renders nothing for legacy (non-AaveEndowment) vaults.
 * ADR-0003: surfaces principal, maturity, yield, and the permissionless harvest action.
 */
import { formatEther } from 'viem'
import { useWaitForTransactionReceipt } from 'wagmi'
import {
  alignmentEndowmentVaultAbi,
  useWriteAlignmentEndowmentVaultHarvest,
} from '../../generated/contracts'
import { forkChainId } from '../../lib/addresses'
import { truncateAddress } from '../../lib/format'
import { TxButton } from '../ui/TxButton'
import { Disclosure } from '../ui/Disclosure'
import { useTxAction } from '../ui/useTxAction'
import { useEndowment } from './useEndowment'
import styles from './VaultPanel.module.css'

interface VaultPanelProps {
  vault: `0x${string}` | undefined
  benefactor: `0x${string}` | undefined
}

export function VaultPanel({ vault, benefactor }: VaultPanelProps) {
  const state = useEndowment(vault, benefactor)

  if (!state.isEndowment) return null

  return <VaultPanelInner vault={vault} benefactor={benefactor} state={state} />
}

interface VaultPanelInnerProps {
  vault: `0x${string}` | undefined
  benefactor: `0x${string}` | undefined
  state: ReturnType<typeof useEndowment>
}

function VaultPanelInner({ vault, benefactor, state }: VaultPanelInnerProps) {
  const {
    writeContract,
    data: txHash,
    isPending: sigPending,
    reset: resetWrite,
  } = useWriteAlignmentEndowmentVaultHarvest()

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash })

  const withdraw = useTxAction({ onSuccess: state.refetch })

  function handleHarvest(): void {
    if (!vault) return
    writeContract({ address: vault, chainId: forkChainId })
  }

  function handleWithdraw(): void {
    if (!vault || !benefactor) return
    withdraw.send({
      address: vault,
      abi: alignmentEndowmentVaultAbi,
      functionName: 'withdrawPrincipal',
      args: [benefactor],
      chainId: forkChainId,
    })
  }

  if (isSuccess) {
    state.refetch()
    resetWrite()
  }

  const isBusy = sigPending || isConfirming
  const yieldZero = state.yield === 0n
  const claimableZero = state.claimable === 0n

  const maturityDate =
    state.maturity > 0n ? new Date(Number(state.maturity) * 1000).toLocaleDateString() : '—'

  const maturityLabel = (() => {
    if (state.depositTime === 0n) return '—'
    if (state.matured) return 'matured ✓'
    return `${maturityDate} (365-day lock)`
  })()

  return (
    <Disclosure summary="COMMUNITY ENDOWMENT" testId="vault-panel">
      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>this collection's principal</span>
          <span className={styles.statValue}>{formatEther(state.principal)} ETH</span>
          <span className={styles.statNote}>refundable at maturity</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>maturity</span>
          <span className={styles.statValue}>{maturityLabel}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>claimable principal</span>
          <span className={styles.statValue}>
            {claimableZero ? '—' : `${formatEther(state.claimable)} ETH`}
          </span>
          <div className={styles.harvestRow}>
            <TxButton
              state={withdraw.state}
              onClick={handleWithdraw}
              label="withdraw principal"
              className="btn btn-secondary"
              disabled={claimableZero}
              onReset={withdraw.reset}
              successLabel="principal withdrawn ✓"
              testId="vault-withdraw-principal"
            />
            <span className={styles.harvestNote}>
              {claimableZero
                ? `locked until maturity — ${maturityDate}`
                : 'on withdraw: 80% creator / 19% community / 1% platform'}
            </span>
          </div>
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
