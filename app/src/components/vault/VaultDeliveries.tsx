/**
 * VaultDeliveries — the accrued cuts a liquidity vault is holding, and the permissionless pushes that
 * deliver them.
 *
 * A liquidity vault splits every harvest three ways: the benefactors' 80%, the aligned community's
 * 19%, and the protocol's 1%. Only the first is paid out as part of the claim. The other two ACCRUE
 * in the vault — deliberately, so that an un-wired community sink can never block a benefactor's
 * claim — and stay there until somebody calls the push that empties them. Neither push takes a
 * destination: the target leg goes to the sink the alignment registry pins for this vault's target,
 * the protocol leg to the treasury the vault was wired with. A caller pays gas to move money to
 * where it was already going, which is exactly why the contracts leave both open to anyone.
 *
 * Until now nobody could see either figure or send either push, so a community's share could sit
 * accrued indefinitely with nothing on the vault's own page saying so. This is that page's row for
 * it: the amounts when there is something to deliver, and the button next to each.
 *
 * An endowment vault splits on different weights and delivers its target leg through
 * `flushTargetFees`, on the collection's own vault panel — so it has neither push here. It has one
 * delivery of its own, and only in a terminal state: once its target is DE-CURATED, the corpus that
 * vested into that community can no longer be spent by an ambassador (the vault freezes `execute` on
 * an inactive target) and `releaseCorpusToCommunity` is the only way it moves. That call is
 * permissionless and non-discretionary in both arguments it does not take — the whole corpus, to the
 * registry's sink — so it hands a de-curated ambassador nothing, and leaving it uncalled strands the
 * community's own money. It is offered here, on the page for the vault holding it.
 */
import { useReadContracts } from 'wagmi'
import { formatEther } from 'viem'
import {
  alignmentEndowmentVaultAbi,
  useReadAlignmentRegistryV1IsAlignmentTargetActive,
} from '../../generated/contracts'
import { lpVaultAbi } from '../../lib/vaults/lpVaultAbi'
import { forkAddresses, forkChainId } from '../../lib/addresses'
import { TxButton } from '../ui/TxButton'
import { useTxAction } from '../ui/useTxAction'
import styles from './VaultDeliveries.module.css'

export function VaultDeliveries({
  vault,
  isEndowment,
  targetId,
}: {
  vault: `0x${string}`
  isEndowment: boolean
  /** The vault's bound target, from the registry. Undefined for an unregistered vault. */
  targetId?: bigint | undefined
}) {
  const at = { address: vault, abi: lpVaultAbi, chainId: forkChainId } as const
  // allowFailure: a vault that is not one of the three liquidity families answers neither read, and
  // the section simply does not render — the same tolerance useVaultsSummary applies per family.
  const { data, refetch } = useReadContracts({
    allowFailure: true,
    contracts: [
      { ...at, functionName: 'accumulatedTargetFees' },
      { ...at, functionName: 'accumulatedProtocolFees' },
    ],
    query: { enabled: !isEndowment },
  })

  const targetFees = data?.[0]?.status === 'success' ? data[0].result : undefined
  const protocolFees = data?.[1]?.status === 'success' ? data[1].result : undefined

  if (isEndowment) return <CorpusRelease vault={vault} targetId={targetId} />
  if (targetFees === undefined && protocolFees === undefined) return null
  if (targetFees === 0n && (protocolFees ?? 0n) === 0n) return null

  return (
    <section className={styles.section} data-testid="vault-deliveries">
      <h2 className={styles.title}>Undelivered</h2>
      <p className={styles.note}>
        Accrued here and waiting to be pushed to the address each cut is pinned to. Anyone may send
        either; neither takes a destination.
      </p>
      {targetFees !== undefined && targetFees > 0n && (
        <DeliveryRow
          vault={vault}
          label="community share"
          amount={targetFees}
          functionName="withdrawTargetFees"
          onDone={refetch}
          testId="vault-deliver-target"
        />
      )}
      {protocolFees !== undefined && protocolFees > 0n && (
        <DeliveryRow
          vault={vault}
          label="protocol share"
          amount={protocolFees}
          functionName="withdrawProtocolFees"
          onDone={refetch}
          testId="vault-deliver-protocol"
        />
      )}
    </section>
  )
}

/**
 * The endowment's de-curation exit. Rendered only once BOTH conditions the contract checks hold —
 * the target is inactive and there is a corpus left — because `releaseCorpusToCommunity` reverts
 * `TargetStillCurated` on a live target and returns zero on an empty one, and a button that appears
 * on every endowment vault to do nothing on almost all of them says nothing at all.
 */
function CorpusRelease({
  vault,
  targetId,
}: {
  vault: `0x${string}`
  targetId: bigint | undefined
}) {
  const { data: active } = useReadAlignmentRegistryV1IsAlignmentTargetActive({
    address: forkAddresses.AlignmentRegistryV1,
    chainId: forkChainId,
    args: targetId !== undefined ? [targetId] : undefined,
    query: { enabled: targetId !== undefined },
  })
  const { data: corpus, refetch } = useReadContracts({
    allowFailure: true,
    contracts: [
      {
        address: vault,
        abi: alignmentEndowmentVaultAbi,
        functionName: 'deployableCorpus',
        chainId: forkChainId,
      },
    ],
    query: { enabled: active === false },
  })
  const tx = useTxAction({
    onSuccess: () => {
      void refetch()
    },
  })

  const amount = corpus?.[0]?.status === 'success' ? corpus[0].result : undefined
  if (active !== false || amount === undefined || amount === 0n) return null

  return (
    <section className={styles.section} data-testid="vault-deliveries">
      <h2 className={styles.title}>Undelivered</h2>
      <p className={styles.note}>
        This vault&rsquo;s community was de-curated, which freezes any further spending from its
        vested corpus. Releasing it sends the whole corpus to the community&rsquo;s own payout
        address — the destination the registry pins, not one the caller picks. Anyone may send it.
      </p>
      <div className={styles.row}>
        <span className={styles.label}>vested corpus</span>
        <span className={styles.amount}>{formatEther(amount)} ETH</span>
        <TxButton
          state={tx.state}
          onClick={() =>
            tx.send({
              address: vault,
              abi: alignmentEndowmentVaultAbi,
              functionName: 'releaseCorpusToCommunity',
              chainId: forkChainId,
            })
          }
          label="release to community"
          className="btn btn-secondary"
          successLabel="corpus released — tx confirmed."
          onReset={tx.reset}
          errorText="release failed — try again"
          testId="vault-release-corpus"
        />
      </div>
    </section>
  )
}

function DeliveryRow({
  vault,
  label,
  amount,
  functionName,
  onDone,
  testId,
}: {
  vault: `0x${string}`
  label: string
  amount: bigint
  functionName: 'withdrawTargetFees' | 'withdrawProtocolFees'
  onDone: () => void
  testId: string
}) {
  const tx = useTxAction({ onSuccess: onDone })

  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <span className={styles.amount}>{formatEther(amount)} ETH</span>
      <TxButton
        state={tx.state}
        onClick={() =>
          tx.send({ address: vault, abi: lpVaultAbi, functionName, chainId: forkChainId })
        }
        label="deliver"
        className="btn btn-secondary"
        successLabel="delivered — tx confirmed."
        onReset={tx.reset}
        errorText="delivery failed — try again"
        testId={testId}
      />
    </div>
  )
}
