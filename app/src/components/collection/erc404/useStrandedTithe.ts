/**
 * useStrandedTithe — the ERC-404 family's stashed graduation tithe, and the permissionless re-send.
 *
 * At graduation the liquidity deployer forwards the alignment cut with
 * `vault.receiveContribution(...)` inside a try/catch: a vault that reverts (de-curated, or wired to
 * a sink that cannot take ETH) must not be able to brick graduation itself. The cut is stashed in the
 * module's `pendingVaultCut[instance]` instead, and `flushPendingVaultCut(instance)` re-sends it once
 * the vault is healthy — permissionless, and non-discretionary in its destination, which is what makes
 * it safe to leave open to anyone.
 *
 * Unlike the ERC-1155/721 families the stash does NOT live on the instance: the module custodies the
 * ETH, so the read and the write are both addressed to whichever deployer singleton this instance
 * graduated through. `useGraduatedVenue` already resolves that address and its family; the read and
 * the send both stay in here, so the row above it never branches on venue — it gets an amount, a
 * transaction state, and one `flush()`.
 */
import {
  cypherLiquidityDeployerModuleAbi,
  liquidityDeployerModuleAbi,
  useReadCypherLiquidityDeployerModulePendingVaultCut,
  useReadLiquidityDeployerModulePendingVaultCut,
  useReadZammLiquidityDeployerModulePendingVaultCut,
  zammLiquidityDeployerModuleAbi,
} from '../../../generated/contracts'
import { useTxAction, type TxAction } from '../../ui/useTxAction'
import { useCollectionChainId } from '../useCollectionChain'
import { useGraduatedVenue } from './useGraduatedVenue'

export interface StrandedTithe {
  /** Wei stashed for this instance; undefined until the venue and the read have both landed. */
  amount: bigint | undefined
  /** False before graduation (no module to ask) and whenever the stash is empty. */
  canFlush: boolean
  /** Re-send the stash. A no-op until the venue resolves, so the row need not guard the click. */
  flush: () => void
  tx: TxAction
}

export function useStrandedTithe(instance: `0x${string}`): StrandedTithe {
  const chainId = useCollectionChainId()
  const { venue } = useGraduatedVenue(instance)
  const deployer = venue?.deployer
  const at = deployer ? { address: deployer } : {}
  const args: [`0x${string}`] = [instance]

  const uni = useReadLiquidityDeployerModulePendingVaultCut({
    ...at,
    chainId,
    args,
    query: { enabled: venue?.kind === 'uniV4' },
  })
  const zamm = useReadZammLiquidityDeployerModulePendingVaultCut({
    ...at,
    chainId,
    args,
    query: { enabled: venue?.kind === 'zamm' },
  })
  const cypher = useReadCypherLiquidityDeployerModulePendingVaultCut({
    ...at,
    chainId,
    args,
    query: { enabled: venue?.kind === 'cypher' },
  })

  const read =
    venue?.kind === 'uniV4'
      ? { hook: uni, abi: liquidityDeployerModuleAbi }
      : venue?.kind === 'zamm'
        ? { hook: zamm, abi: zammLiquidityDeployerModuleAbi }
        : venue?.kind === 'cypher'
          ? { hook: cypher, abi: cypherLiquidityDeployerModuleAbi }
          : undefined

  // The getter returns the PendingCut struct as a positional tuple `[vault, amount]`.
  const amount = read?.hook.data?.[1]
  const tx = useTxAction({
    onSuccess: () => {
      void read?.hook.refetch()
    },
    instance,
  })

  return {
    amount,
    canFlush: deployer !== undefined && read !== undefined && amount !== undefined && amount > 0n,
    flush: () => {
      if (!deployer || !read) return
      tx.send({
        address: deployer,
        abi: read.abi,
        functionName: 'flushPendingVaultCut',
        args: [instance],
        chainId,
      })
    },
    tx,
  }
}
