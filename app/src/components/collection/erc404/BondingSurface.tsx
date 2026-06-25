/**
 * Phase-aware ERC404 bonding surface (W-B4). Orchestrates the swap / free-mint / reroll / gating /
 * graduate panels around the pure `derivePhase` machine:
 *   preopen   → "opens at …" + live countdown, no trading
 *   bonding   → buy/sell + free-mint + reroll, plus a graduate affordance when canDeployLiquidity
 *   graduated → "graduated to DEX" notice + a mount point for the pool view (W-B5)
 *
 * SCOPE: the curve/candle CHART (W-B5) and STAKING (W-B7) are intentionally NOT built here — their
 * mount points are marked below.
 */
import {
  useReadErc404BondingInstanceDecimals,
  useReadErc404BondingInstanceGatingActive,
} from '../../../generated/contracts'
import { forkChainId } from '../../../lib/addresses'
import { canDeployLiquidity, derivePhase } from './bondingPhase'
import { formatCountdown, formatOpenTime } from './bondingFormat'
import { BondingChart } from './BondingChart'
import { FreeMintPanel } from './FreeMintPanel'
import { GraduateButton } from './GraduateButton'
import { RerollPanel } from './RerollPanel'
import { StakingPanel } from './StakingPanel'
import { SwapPanel } from './SwapPanel'
import { useBondingData } from './useBondingData'
import { useCurveComputer } from './useCurveComputer'
import { useNowSec } from './useNowSec'
import styles from './BondingSurface.module.css'

interface BondingSurfaceProps {
  instance: `0x${string}`
}

/** Default DN404 token decimals — used until the on-chain `decimals()` read resolves. */
const DEFAULT_DECIMALS = 18

export function BondingSurface({ instance }: BondingSurfaceProps) {
  const nowSec = useNowSec()
  const { view, curveParams, unit, feeBps, isPending, isError, refetch } = useBondingData(instance)
  const curveComputer = useCurveComputer()

  const decimalsRead = useReadErc404BondingInstanceDecimals({
    address: instance,
    chainId: forkChainId,
  })
  const gatingRead = useReadErc404BondingInstanceGatingActive({
    address: instance,
    chainId: forkChainId,
  })

  const decimals = decimalsRead.data ?? DEFAULT_DECIMALS
  const gatingActive = gatingRead.data ?? false

  if (isError) {
    return (
      <div className={styles.surface}>
        <p className={styles.note}>could not load bonding data — is the fork up?</p>
      </div>
    )
  }

  if (isPending || view === undefined) {
    return (
      <div className={styles.surface}>
        <p className={styles.note}>loading bonding curve…</p>
      </div>
    )
  }

  const phase = derivePhase(view, nowSec)

  if (phase === 'preopen') {
    const remaining = Number(view.bondingOpenTime - nowSec)
    return (
      <div className={styles.surface} data-testid="erc404-phase-preopen">
        <div className={styles.banner}>
          <span className={styles.bannerLabel}>bonding opens at</span>
          <span className={styles.bannerValue}>{formatOpenTime(view.bondingOpenTime)}</span>
          <span className={styles.countdown}>in {formatCountdown(remaining)}</span>
        </div>
        {/* Free mint can be eligible before open in some configs; panel self-hides when not. */}
        <FreeMintPanel
          instance={instance}
          bondingOpenTime={view.bondingOpenTime}
          gatingActive={gatingActive}
          refetch={refetch}
        />
      </div>
    )
  }

  if (phase === 'graduated') {
    return (
      <div className={styles.surface} data-testid="erc404-phase-graduated">
        <div className={styles.banner}>
          <span className={styles.bannerLabel}>status</span>
          <span className={styles.bannerValue}>graduated to DEX</span>
          <span className={styles.countdown}>
            the bonding curve is closed — trading has moved to the liquidity pool.
          </span>
        </div>
        {/* Curve is closed; show the trade-history candles for the now-graduated instance. */}
        <div data-testid="erc404-pool-mount">
          <BondingChart
            instance={instance}
            curveParams={curveParams}
            view="candles"
            decimals={decimals}
          />
        </div>
      </div>
    )
  }

  // phase === 'bonding'
  const showGraduate = canDeployLiquidity(view, nowSec)

  return (
    <div className={styles.surface} data-testid="erc404-phase-bonding">
      {/* W-B5: the bonding curve (with a you-are-here dot) + trade-history candles. */}
      <div data-testid="erc404-chart-mount">
        <BondingChart
          instance={instance}
          curveParams={curveParams}
          view="curve"
          decimals={decimals}
          bondingView={view}
        />
        <BondingChart
          instance={instance}
          curveParams={curveParams}
          view="candles"
          decimals={decimals}
        />
      </div>

      <SwapPanel
        instance={instance}
        view={view}
        curveParams={curveParams}
        curveComputer={curveComputer.address}
        decimals={decimals}
        feeBps={feeBps}
        gatingActive={gatingActive}
        refetch={refetch}
      />

      <FreeMintPanel
        instance={instance}
        bondingOpenTime={view.bondingOpenTime}
        gatingActive={gatingActive}
        refetch={refetch}
      />

      <RerollPanel instance={instance} decimals={decimals} refetch={refetch} />

      {showGraduate && <GraduateButton instance={instance} refetch={refetch} />}

      {/* W-B7: staking panel (stake / unstake / claim rewards); self-hides when inactive. */}
      <div data-testid="erc404-staking-mount">
        <StakingPanel instance={instance} decimals={decimals} />
      </div>

      {curveComputer.address === undefined && !curveComputer.isPending && (
        <p className={styles.note}>
          quote unavailable: no approved curve computer found in the component registry.
        </p>
      )}
      {unit !== undefined && unit === 0n && (
        <p className={styles.note}>warning: token unit is zero — instance may be misconfigured.</p>
      )}
    </div>
  )
}
