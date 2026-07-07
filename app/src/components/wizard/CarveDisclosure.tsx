/**
 * CarveDisclosure — the wizard's live allowance/depth preview for the ERC404
 * `declaredMaxAllowanceBps` disclosure field. Pure-math rows come from `lib/carve` (a bit-exact
 * mirror of the on-chain math); bracket params + pool floor are read LIVE from the factory so the
 * preview tracks owner-tuned regimes (falling back to the protocol defaults while loading).
 *
 * Also carries the sub-2-ETH honesty nudge: minnow raises carve ~nothing — the art path (editions/
 * auctions) on a cash-now (Liquidity) vault pays the creator 80% of settlements.
 */
import { formatEther } from 'viem'
import {
  useReadErc404FactoryCarveBracketParams,
  useReadErc404FactoryMinPoolEth,
} from '../../generated/contracts'
import { forkAddresses, forkChainId } from '../../lib/addresses'
import {
  carveDisclosurePreview,
  DEFAULT_CARVE_BRACKETS,
  DEFAULT_MIN_POOL_ETH,
  parseBps,
  type CarveBrackets,
} from '../../lib/carve'
import styles from './CarveDisclosure.module.css'

/** Read the factory's live carve params, defaulting while unavailable. */
function useCarveParams(): { brackets: CarveBrackets; minPoolEth: bigint } {
  const bracketsRead = useReadErc404FactoryCarveBracketParams({
    address: forkAddresses.ERC404Factory,
    chainId: forkChainId,
  })
  const minPoolRead = useReadErc404FactoryMinPoolEth({
    address: forkAddresses.ERC404Factory,
    chainId: forkChainId,
  })
  const b = bracketsRead.data
  return {
    brackets: b ? { b1: b.b1, b2: b.b2, r1: b.r1, r2: b.r2, r3: b.r3 } : DEFAULT_CARVE_BRACKETS,
    minPoolEth: minPoolRead.data ?? DEFAULT_MIN_POOL_ETH,
  }
}

const fmt = (wei: bigint): string => {
  const s = formatEther(wei)
  const dot = s.indexOf('.')
  if (dot === -1) return s
  const int = s.slice(0, dot)
  const trimmed = s.slice(dot + 1, dot + 4).replace(/0+$/, '')
  return trimmed ? `${int}.${trimmed}` : int
}

export function CarveDisclosure({ declaredValue }: { declaredValue: string | undefined }) {
  const { brackets, minPoolEth } = useCarveParams()
  const declaredBps = parseBps(declaredValue, 10_000) // untouched field = the displayed default
  const rows = carveDisclosurePreview(declaredBps, brackets, minPoolEth)

  return (
    <div className={styles.root} data-testid="wizard-carve-disclosure">
      <p className={styles.head}>
        carve preview — declared max {(declaredBps / 100).toFixed(declaredBps % 100 === 0 ? 0 : 2)}%
        of the protocol allowance
      </p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>raise</th>
              <th>allowance</th>
              <th>your max carve</th>
              <th>you net (80%)</th>
              <th>pool depth left</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.raise)}>
                <td>{fmt(r.raise)} ETH</td>
                <td>{fmt(r.allowance)}</td>
                <td>{fmt(r.maxCarve)}</td>
                <td>{fmt(r.creatorNet)}</td>
                <td>{fmt(r.poolDepth)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.note}>
        The carve is taken from the LP share only — the vault&apos;s 19% and the pool floor (
        {fmt(minPoolEth)} ETH) always come first, and the carved amount is itself tithed 80/19/1
        (you / vault / protocol). This declared max is immutable and shown to buyers before the
        first buy.
      </p>
      <p className={styles.nudge}>
        Raising under ~2 ETH? The carve is structurally near zero there — if you want money today,
        the art path (editions / auctions) on a cash-now (Liquidity) vault pays you 80% of every
        settlement (an endowment / Yield vault keeps the 19% creator split).
      </p>
    </div>
  )
}
