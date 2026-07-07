/**
 * BondNotice — wizard disclosure for the refundable creator deploy-bond (N12). Reads the live
 * `bondAmount` from the escrow; renders nothing while the lever is OFF (bondAmount 0 = today's
 * behavior), so it only appears once an admin has enabled the bond. The bond is escrowed at create,
 * returned in full when the collection graduates, and forfeited to the treasury only if it never
 * graduates within the deadline.
 */
import { formatEther } from 'viem'
import { useReadDeployBondEscrowBondAmount } from '../../generated/contracts'
import { forkAddresses, forkChainId } from '../../lib/addresses'
import styles from './CarveDisclosure.module.css'

export function BondNotice() {
  const { data: bondAmount } = useReadDeployBondEscrowBondAmount({
    address: forkAddresses.DeployBondEscrow,
    chainId: forkChainId,
  })
  if (bondAmount === undefined || bondAmount === 0n) return null // lever OFF → no notice

  return (
    <div className={styles.root} data-testid="wizard-bond-notice">
      <p className={styles.head}>refundable deposit — {formatEther(bondAmount)} ETH</p>
      <p className={styles.note}>
        Creating this collection escrows a refundable deposit of {formatEther(bondAmount)} ETH on top
        of any fee. You get it back in full when the collection graduates. It is only forfeited to the
        protocol treasury if the collection never graduates within the deadline.
      </p>
    </div>
  )
}
