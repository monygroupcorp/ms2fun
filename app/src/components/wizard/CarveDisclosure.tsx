/**
 * CarveDisclosure — the wizard's live allowance/depth preview for the ERC404
 * `declaredMaxAllowanceBps` disclosure field. Pure-math rows come from `lib/carve` (a bit-exact
 * mirror of the on-chain math); bracket params + pool floor are read LIVE from the factory so the
 * preview tracks owner-tuned regimes (falling back to the protocol defaults while loading).
 *
 * LIVE is the right read HERE and only here. A collection is sealed onto the carve terms standing at
 * its create and is never moved by a later change, so a surface describing an EXISTING collection must
 * read that collection's own terms — which is what the on-chain `previewCarve` the admin panel calls
 * already resolves. This is the wizard: the collection does not exist yet, so the terms the next create
 * would be sealed onto are exactly the ones to quote.
 *
 * Also carries the dead-band honesty nudge: raises below the pool floor's reach carve ~nothing —
 * the art path (editions/auctions) on a cash-now (Liquidity) vault pays the creator 80% of
 * settlements. The threshold is computed from the live `minPoolEth`, never hardcoded: the floor is
 * an owner-settable parameter, and a fixed figure beside a live table goes wrong silently the first
 * time it is moved.
 */
import { formatEther } from 'viem'
import {
  useReadErc404FactoryCarveBracketParams,
  useReadErc404FactoryMinPoolEth,
} from '../../generated/contracts'
import { forkAddresses, forkChainId } from '../../lib/addresses'
import {
  carveDeadBandRaise,
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
        The carve is taken from the LP share only — the vault&apos;s 19% comes first, and the pool
        floor ({fmt(minPoolEth)} ETH) bounds how much of the rest the carve may take. The carved
        amount is itself tithed 80/19/1 (you / vault / protocol). This declared max is immutable and
        shown to buyers before the first buy.
      </p>
      <p className={styles.nudge}>
        Raising under {fmt(carveDeadBandRaise(minPoolEth))} ETH? The carve is near zero there — the
        LP share does not clear the pool floor, so there is no headroom for it to come out of. If
        you want money today, the art path (editions / auctions) pays you 80% of every settlement —
        the same split on every vault family.
      </p>
    </div>
  )
}
