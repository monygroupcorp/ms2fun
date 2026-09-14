/**
 * VaultDeliveries — the protocol's accrued cut on a liquidity vault, and the permissionless push
 * that delivers it.
 *
 * A liquidity vault splits every harvest three ways: the benefactors' 80%, the aligned community's
 * 19%, and the protocol's 1%. Only the first is paid out as part of the claim. The other two ACCRUE
 * in the vault — deliberately, so that an un-wired sink can never block a benefactor's claim — and
 * stay there until somebody calls the push that empties them.
 *
 * The community's 19% has a section of its own (`CommunityPayoutPanel`), which names the sink the
 * registry pins and the curation state behind it. This is the other leg: `withdrawProtocolFees`,
 * which sends to the treasury the vault was wired with. It takes no destination either, so a caller
 * can only pay the gas to move an already-accrued cut to where it was always going — which is why
 * the contract leaves it open to anyone, and why the app can offer it to anyone.
 *
 * The endowment family is out of scope here: it splits yield on different weights and exposes no
 * protocol-cut push at all.
 */
import { useReadContracts } from 'wagmi'
import { formatEther } from 'viem'
import { lpVaultAbi } from '../../lib/vaults/lpVaultAbi'
import { forkChainId } from '../../lib/addresses'
import { TxButton } from '../ui/TxButton'
import { useTxAction } from '../ui/useTxAction'
import styles from './VaultDeliveries.module.css'

export function VaultDeliveries({
  vault,
  isEndowment,
}: {
  vault: `0x${string}`
  isEndowment: boolean
}) {
  // allowFailure: a vault that is not one of the three liquidity families does not answer this read,
  // and the section simply does not render — the same tolerance useVaultsSummary applies per family.
  const { data, refetch } = useReadContracts({
    allowFailure: true,
    contracts: [
      {
        address: vault,
        abi: lpVaultAbi,
        functionName: 'accumulatedProtocolFees',
        chainId: forkChainId,
      },
    ],
    query: { enabled: !isEndowment },
  })

  const tx = useTxAction({ onSuccess: refetch })

  const protocolFees = data?.[0]?.status === 'success' ? data[0].result : undefined

  if (isEndowment) return null
  if (protocolFees === undefined || protocolFees === 0n) return null

  return (
    <section className={styles.section} data-testid="vault-deliveries">
      <h2 className={styles.title}>Protocol cut</h2>
      <p className={styles.note}>
        Accrued here and waiting to be pushed to the treasury this vault was wired with. Anyone may
        send it; it takes no destination.
      </p>
      <div className={styles.row}>
        <span className={styles.label}>undelivered</span>
        <span className={styles.amount}>{formatEther(protocolFees)} ETH</span>
        <TxButton
          state={tx.state}
          onClick={() =>
            tx.send({
              address: vault,
              abi: lpVaultAbi,
              functionName: 'withdrawProtocolFees',
              chainId: forkChainId,
            })
          }
          label="deliver"
          className="btn btn-secondary"
          successLabel="delivered — tx confirmed."
          onReset={tx.reset}
          errorText="delivery failed — try again"
          testId="vault-deliver-protocol"
        />
      </div>
    </section>
  )
}
