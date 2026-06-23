import { useReadMasterRegistryV1GetTotalFactories } from '../generated/contracts'
import { forkAddresses, forkChainId } from '../lib/addresses'
import styles from './HelloChain.module.css'

/**
 * Live platform read rendered as a brutalist stats-bar (docs/examples homepage-v2 `.stats-bar`):
 * the MasterRegistry factory count read straight off the fork through the generated typed bindings
 * — the whole pipeline (config → bindings → typed hook → render) with honest loading/error states.
 */
export function HelloChain() {
  const { data, isPending, isError } = useReadMasterRegistryV1GetTotalFactories({
    address: forkAddresses.MasterRegistryV1,
    chainId: forkChainId,
  })

  const factories = isPending ? '…' : isError ? 'unreachable' : (data?.toString() ?? '—')

  return (
    <dl className={styles.statsBar}>
      <dt className={styles.label}>PLATFORM</dt>
      <dd className={styles.item}>
        factories{' '}
        <span className={styles.value} data-testid="hello-chain-value">
          {factories}
        </span>
      </dd>
      <span className={styles.sep}>·</span>
      <dd className={styles.item}>
        chain <span className={styles.value}>{forkChainId}</span>
      </dd>
      <span className={styles.sep}>·</span>
      <dd className={styles.item}>
        mode <span className={styles.value}>local-fork</span>
      </dd>
    </dl>
  )
}
