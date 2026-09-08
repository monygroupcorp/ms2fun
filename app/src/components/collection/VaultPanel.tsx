/**
 * VaultPanel — alignment economics display for a collection's endowment vault.
 * Renders nothing for legacy (non-AaveEndowment) vaults.
 * ADR-0003: surfaces principal, maturity, yield, and the permissionless harvest action.
 *
 * The three actions under the stats are the endowment's whole value path, and none of them is
 * reachable through the per-type creator admin panels: those call the instance's `claimVaultFees` /
 * `claimAllFees`, which route to `IAlignmentVault.claimFees` — a function the endowment implements by
 * reverting `NotSupported`, because it has no tradable shares to pay out against. So a creator on an
 * endowment vault could watch their yield accrue and had nowhere to pull it from.
 *
 *  - **claim yield** — `claimYieldPurse(instance)`, the endowment's actual creator claim. Authorised
 *    to the collection's owner or a platform agent, and paid to the owner, so the button is gated on
 *    the same `owner()` the contract reads.
 *  - **vest** — `vest(instance)`, permissionless once the 26-week window has elapsed. It moves this
 *    collection's principal from escrow into the target's deployable corpus and stops the creator's
 *    yield accruing, which is the deal the endowment was entered under, not a loss to be hidden.
 *  - **deliver community share** — `flushTargetFees()`, permissionless, to a destination the registry
 *    fixes rather than the caller. Only shown with something actually undelivered: the target leg
 *    accrues in place while the community sink is unset, and the flush reverts until one is wired.
 */
import { formatEther } from 'viem'
import { useWaitForTransactionReceipt } from 'wagmi'
import {
  alignmentEndowmentVaultAbi,
  useWriteAlignmentEndowmentVaultHarvest,
} from '../../generated/contracts'
import { useCollectionChainId } from './useCollectionChain'
import { truncateAddress } from '../../lib/format'
import { Disclosure } from '../ui/Disclosure'
import { TxButton } from '../ui/TxButton'
import { useOwnerGate } from '../ui/useOwnerGate'
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
      <EndowmentActions vault={vault} benefactor={benefactor} state={state} />
    </Disclosure>
  )
}

/**
 * The endowment's claim + delivery actions. Split out so the stats above stay a pure render: this is
 * the only part that needs the wallet, and it is the only part that writes.
 */
function EndowmentActions({ vault, benefactor, state }: VaultPanelInnerProps) {
  const chainId = useCollectionChainId()
  const { isOwner } = useOwnerGate(benefactor)
  const claimTx = useTxAction({ onSuccess: state.refetch })
  const vestTx = useTxAction({ onSuccess: state.refetch })
  const flushTx = useTxAction({ onSuccess: state.refetch })

  if (!vault || !benefactor) return null

  // `vest()` matures whatever tranches are due, so the button is offered from the moment the FIRST
  // deposit's clock elapses — the earliest instant any principal can move. That is necessary and not
  // sufficient: a later top-up alone still escrowed will revert, which the hint below says.
  const vestWindowOpen =
    state.earliestMaturity > 0n && BigInt(Math.floor(Date.now() / 1000)) >= state.earliestMaturity

  const send = (tx: ReturnType<typeof useTxAction>, functionName: 'claimYieldPurse' | 'vest') =>
    tx.send({
      address: vault,
      abi: alignmentEndowmentVaultAbi,
      functionName,
      args: [benefactor],
      chainId,
    })

  return (
    <div className={styles.actions} data-testid="vault-panel-actions">
      {isOwner && (
        <div className={styles.actionRow}>
          <TxButton
            state={claimTx.state}
            onClick={() => send(claimTx, 'claimYieldPurse')}
            label="claim yield"
            className="btn btn-primary"
            successLabel="yield claimed — tx confirmed."
            onReset={claimTx.reset}
            disabled={state.claimable === 0n}
            disabledHint="nothing accrued to this collection yet"
            errorText="claim failed — try again"
            testId="vault-claim-yield"
          />
          <span className={styles.harvestNote}>
            {formatEther(state.claimable)} ETH accrued to this collection&rsquo;s creator
          </span>
        </div>
      )}
      {vestWindowOpen && state.principal > 0n && (
        <div className={styles.actionRow}>
          <TxButton
            state={vestTx.state}
            onClick={() => send(vestTx, 'vest')}
            label="vest principal"
            className="btn btn-secondary"
            successLabel="principal vested — tx confirmed."
            onReset={vestTx.reset}
            errorText="vest failed — try again"
            testId="vault-vest"
          />
          <span className={styles.harvestNote}>
            permissionless — moves every matured tranche of {formatEther(state.principal)} ETH into
            the community&rsquo;s corpus and ends this collection&rsquo;s yield
          </span>
        </div>
      )}
      {state.undeliveredTargetFees > 0n && (
        <div className={styles.actionRow}>
          <TxButton
            state={flushTx.state}
            onClick={() =>
              flushTx.send({
                address: vault,
                abi: alignmentEndowmentVaultAbi,
                functionName: 'flushTargetFees',
                chainId,
              })
            }
            label="deliver community share"
            className="btn btn-secondary"
            successLabel="community share delivered — tx confirmed."
            onReset={flushTx.reset}
            disabled={state.communityPayout === undefined}
            disabledHint="no community payout wired yet — the share keeps accruing"
            errorText="delivery failed — try again"
            testId="vault-flush-target"
          />
          <span className={styles.harvestNote}>
            permissionless — {formatEther(state.undeliveredTargetFees)} ETH accrued to the community
            and not yet sent
          </span>
        </div>
      )}
    </div>
  )
}
