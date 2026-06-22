import { useReadMasterRegistryV1GetTotalFactories } from '../generated/contracts'
import { forkAddresses, forkChainId } from '../lib/addresses'
import styles from './HelloChain.module.css'

/**
 * Phase 0 "hello chain": reads one real value off a forked contract through the generated typed
 * bindings (MasterRegistry total factory count). Proves the whole pipeline — config -> bindings
 * -> typed hook -> render — with honest loading/error states (no stub).
 */
export function HelloChain() {
  const { data, isPending, isError } = useReadMasterRegistryV1GetTotalFactories({
    address: forkAddresses.MasterRegistryV1,
    chainId: forkChainId,
  })

  return (
    <dl className={styles.hello}>
      <dt className={styles.label}>MasterRegistry · total factories</dt>
      <dd className={styles.value} data-testid="hello-chain-value">
        {isPending ? '…' : isError ? 'unreachable' : (data?.toString() ?? '—')}
      </dd>
    </dl>
  )
}
