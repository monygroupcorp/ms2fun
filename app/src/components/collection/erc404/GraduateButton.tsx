/**
 * Permissionless "graduate" affordance. `deployLiquidity()` is callable by anyone once the curve is
 * FULL or MATURED (the contract gates owner-vs-permissionless internally) — `canDeployLiquidity` from
 * the pure phase machine decides whether to surface this. The call takes NO arguments: the instance
 * derives pool params from its own reserve/liquidityReserve and the pluggable LiquidityDeployerModule,
 * so there is nothing unsafe to guess client-side — we wire it directly.
 */
import { useWaitForTransactionReceipt } from 'wagmi'
import { useWriteErc404BondingInstanceDeployLiquidity } from '../../../generated/contracts'
import { forkChainId } from '../../../lib/addresses'
import styles from './BondingSurface.module.css'

interface GraduateButtonProps {
  instance: `0x${string}`
  refetch: () => void
}

export function GraduateButton({ instance, refetch }: GraduateButtonProps) {
  const deploy = useWriteErc404BondingInstanceDeployLiquidity()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: deploy.data })

  function handleDeploy(): void {
    deploy.writeContract({ address: instance, chainId: forkChainId, args: [] })
  }

  const isBusy = deploy.isPending || isConfirming

  if (isSuccess) {
    return (
      <div className={styles.panel}>
        <p className={styles.panelTitle}>graduate</p>
        <p className={styles.txStatus}>liquidity deployed — graduating to DEX.</p>
        <button
          className="btn btn-secondary"
          onClick={() => {
            deploy.reset()
            refetch()
          }}
        >
          refresh
        </button>
      </div>
    )
  }

  return (
    <div className={styles.panel} data-testid="erc404-graduate-panel">
      <p className={styles.panelTitle}>graduate</p>
      <p className={styles.note}>
        the curve is full or matured — anyone may deploy liquidity to graduate this collection to
        the DEX.
      </p>
      <button
        className="btn btn-primary btn-chromatic"
        onClick={handleDeploy}
        disabled={isBusy}
        data-testid="erc404-graduate"
      >
        {deploy.isPending ? 'confirm in wallet…' : isConfirming ? 'deploying…' : 'deploy liquidity'}
      </button>
      {deploy.isError && (
        <p className={`${styles.txStatus} ${styles.txError}`}>deploy failed — try again</p>
      )}
    </div>
  )
}
