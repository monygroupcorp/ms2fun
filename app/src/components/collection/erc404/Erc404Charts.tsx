/**
 * Erc404Charts — the bonding curve + trade-history candles, pulled OUT of the trading column and
 * rendered full-width BELOW the shell (above the gallery). The trading widget alone is short; the
 * charts were what made the "works" column tower over the specimen rail, leaving dead space on the
 * left. Here they get width to breathe and the shell columns stay balanced.
 *
 * Phase-aware, mirroring the old in-surface placement: preopen → nothing; bonding → curve (with the
 * you-are-here dot) + candles; graduated → candles only (the pre-graduation history).
 */
import { useReadErc404BondingInstanceDecimals } from '../../../generated/contracts'
import { useCollectionChainId } from '../useCollectionChain'
import { derivePhase } from './bondingPhase'
import { BondingChart } from './BondingChart'
import { useBondingData } from './useBondingData'
import { useNowSec } from './useNowSec'
import styles from './BondingSurface.module.css'

const DEFAULT_DECIMALS = 18

export function Erc404Charts({ instance }: { instance: `0x${string}` }) {
  const chainId = useCollectionChainId()
  const nowSec = useNowSec()
  const { view, curveParams, isPending, isError } = useBondingData(instance)
  const decimalsRead = useReadErc404BondingInstanceDecimals({
    address: instance,
    chainId: chainId,
  })
  const decimals = decimalsRead.data ?? DEFAULT_DECIMALS

  if (isError || isPending || view === undefined) return null

  const phase = derivePhase(view, nowSec)
  if (phase === 'preopen') return null

  return (
    <div className={styles.charts} data-testid="erc404-charts">
      {phase === 'bonding' && (
        <BondingChart
          instance={instance}
          curveParams={curveParams}
          view="curve"
          decimals={decimals}
          bondingView={view}
        />
      )}
      <BondingChart
        instance={instance}
        curveParams={curveParams}
        view="candles"
        decimals={decimals}
      />
    </div>
  )
}
