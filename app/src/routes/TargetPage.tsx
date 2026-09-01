/**
 * TargetPage (`/target/:id`) — one alignment COMMUNITY: who it is, which venues it is curated on,
 * and every vault bound to it.
 *
 * This is the page between the alignment index and a vault. The index answers "who can a collection
 * align to"; this answers "and what is bound to them"; `/vault/:address` answers "and what is that
 * one vault doing". Vaults used to be a flat list on the index, which could show a vault but never
 * say whose it was.
 *
 * IT RESOLVES A COMMUNITY, NOT A TARGET. `:id` is a registry target id, but an asset curated on two
 * venues has two of those, and both must land here — `MS2` and `MS2-ZAMM` are one page. Styles are
 * the index's on purpose: this is the same wall, one level in.
 */
import { Link, useParams } from 'wouter'
import { useAllVaults } from '../lib/vaults/useAllVaults'
import { useVaultsSummary } from '../lib/vaults/useVaultsSummary'
import { useAlignmentTargets } from '../lib/vaults/useAlignmentTargets'
import { groupTargetsByToken } from '../lib/wizard/vaultFlavor'
import { useAcquireVenues, venueLabel } from '../lib/vaults/acquireVenues'
import {
  ethCompact as eth,
  rollUpByTarget,
  rollupsByTargetKey,
  sumRollups,
  targetFigureLabel,
} from '../lib/vaults/targetRollup'
import { vaultFamilyLabel } from '../components/vault/useVaultOverview'
import { useCollectionMetadata } from '../components/useCollectionMetadata'
import { IpfsImage } from '../components/ui/IpfsImage'
import { StateBlock } from '../components/ui/StateBlock'
import { truncateAddress } from '../lib/format'
import styles from './VaultsPage.module.css'

export function TargetPage() {
  const params = useParams<{ id?: string }>()
  const raw = params.id ?? ''
  const targetId = /^\d+$/.test(raw) ? BigInt(raw) : undefined

  const { targets, isPending: targetsPending } = useAlignmentTargets()
  const communities = groupTargetsByToken(targets)
  // Either of a community's target ids must land here, so the lookup scans every id in the group
  // rather than matching only the primary.
  const community =
    targetId !== undefined
      ? communities.find((c) => c.targets.some((t) => t.id === targetId))
      : undefined

  const { vaults, isPending, isError } = useAllVaults()
  const { byAddress, isPending: summaryPending } = useVaultsSummary(vaults.map((v) => v.address))

  const rollups = rollUpByTarget(
    vaults.map((v) => {
      const s = byAddress.get(v.address.toLowerCase())
      return {
        address: v.address,
        collectionCount: v.collectionCount,
        vaultType: s?.vaultType,
        totalPrincipal: s?.totalPrincipal,
        ethLocked: s?.ethLocked,
        pendingEth: s?.pendingEth,
        accumulatedFees: s?.accumulatedFees,
        targetId: s?.targetId ?? null,
      }
    }),
    targets.map((t) => t.id),
  )
  const rollupByKey = rollupsByTargetKey(rollups)

  const meta = useCollectionMetadata(community?.primary.metadataURI)
  // The AMM each of this community's targets is curated on, read from the route rather than guessed
  // from the target's title.
  const { venueByTargetId } = useAcquireVenues(
    (community?.targets ?? []).map((t) => ({ targetId: t.id, token: t.token })),
  )

  if (targetId === undefined) {
    return (
      <div className={styles.page}>
        <StateBlock variant="error" boxed>
          that is not an alignment target id
        </StateBlock>
      </div>
    )
  }
  if (!community) {
    return (
      <div className={styles.page}>
        <nav className={styles.crumb}>
          <Link href="/vaults" className={styles.back}>
            ← alignment
          </Link>
        </nav>
        <StateBlock variant={targetsPending ? 'loading' : 'empty'} boxed>
          {targetsPending ? 'reading the registry…' : 'no alignment target with that id'}
        </StateBlock>
      </div>
    )
  }

  // Every id this community curates — a vault bound to ANY of them belongs on this page.
  const ids = new Set(community.targets.map((t) => t.id.toString()))
  const rollup = sumRollups(community.targets.map((t) => rollupByKey.get(t.id.toString())))
  const mine = vaults.filter((v) => {
    const id = byAddress.get(v.address.toLowerCase())?.targetId
    return id !== undefined && id !== null && ids.has(id.toString())
  })

  return (
    <div className={styles.page}>
      <nav className={styles.crumb}>
        <Link href="/vaults" className={styles.back}>
          ← alignment
        </Link>
      </nav>

      <header className={styles.head}>
        <div className={styles.targetLogo}>
          <IpfsImage
            uri={meta?.image ?? ''}
            alt={`${community.primary.title} logo`}
            className={styles.targetImg}
            fallback={
              <span className={styles.targetGlyph} aria-hidden>
                ◈
              </span>
            }
          />
        </div>
        <h1 className={styles.title}>{community.primary.title}</h1>
        {community.primary.description && (
          <p className={styles.sub}>{community.primary.description}</p>
        )}
        <div className={styles.tvl} data-testid="target-tvl">
          <span className={styles.tvlLabel}>Bound to this community</span>
          <span className={styles.tvlValue} data-testid="target-figure">
            {targetFigureLabel(rollup, summaryPending)}
          </span>
        </div>

        {/* The breakdown the index's asterisk points at. Three states of the same ETH, kept apart
            because they are not interchangeable — and shown even at zero, since "no principal here"
            is an answer rather than an absence. */}
        <dl className={styles.breakdown} data-testid="target-breakdown">
          <div className={styles.breakdownRow}>
            <dt className={styles.breakdownLabel}>Endowment principal</dt>
            <dd className={styles.breakdownValue}>
              {summaryPending ? '…' : `${eth(rollup.endowmentPrincipal)} ETH`}
            </dd>
            <dd className={styles.breakdownNote}>held by the vault, and redeemable</dd>
          </div>
          <div className={styles.breakdownRow}>
            <dt className={styles.breakdownLabel}>Placed as liquidity</dt>
            <dd className={styles.breakdownValue}>
              {summaryPending ? '…' : `${eth(rollup.lpEthPlaced)} ETH`}
            </dd>
            <dd className={styles.breakdownNote}>
              at cost — what the vaults put in, not marked to market, so today&apos;s worth moves
              with the pool and with impermanent loss
            </dd>
          </div>
          <div className={styles.breakdownRow}>
            <dt className={styles.breakdownLabel}>Awaiting conversion</dt>
            <dd className={styles.breakdownValue}>
              {summaryPending ? '…' : `${eth(rollup.lpPendingEth)} ETH`}
            </dd>
            <dd className={styles.breakdownNote}>
              tithed and held, not yet liquidity — converting is permissionless, so anyone can put
              it to work
            </dd>
          </div>
          <div className={styles.breakdownRow}>
            <dt className={styles.breakdownLabel}>Accrued LP fees</dt>
            <dd className={styles.breakdownValue}>
              {summaryPending ? '…' : `${eth(rollup.lpFees)} ETH`}
            </dd>
            <dd className={styles.breakdownNote}>
              earned by the positions; never folded into the total above
            </dd>
          </div>
        </dl>
      </header>

      {/* The venues. One registry target per curated venue, because the registry curates exactly one
          venue per (target, asset) — so this is where that on-chain shape is shown rather than
          leaked onto the index as duplicate rows. */}
      <section className={styles.targets} data-testid="community-venues">
        <h2 className={styles.sectionTitle}>Venues</h2>
        <p className={styles.sectionSub}>
          Where a tithe becomes liquidity: the vault swaps the ETH for {community.primary.title}
          &apos;s token and provides it as liquidity on the venue below. Aligning here is what makes
          that pool deeper.
        </p>
        <ul className={styles.list}>
          {community.targets.map((t) => {
            const count = rollupByKey.get(t.id.toString())?.vaultCount ?? 0
            return (
              <li key={t.id.toString()}>
                <span className={styles.row}>
                  <span className={styles.rowName}>
                    {venueLabel(venueByTargetId.get(t.id.toString()))}
                  </span>
                  <span className={styles.rowCount}>
                    {count > 0
                      ? `${count} ${count === 1 ? 'vault' : 'vaults'}`
                      : 'available — nothing bound yet'}
                  </span>
                </span>
              </li>
            )
          })}
        </ul>
      </section>

      <section className={styles.targets}>
        <h2 className={styles.sectionTitle}>Vaults</h2>
        <p className={styles.sectionSub}>Every vault bound to this community, across its venues.</p>

        {isPending && (
          <StateBlock variant="loading" boxed>
            reading the vaults…
          </StateBlock>
        )}
        {isError && (
          <StateBlock variant="error" boxed>
            couldn&apos;t load vaults — is the fork up?
          </StateBlock>
        )}
        {!isPending && !isError && mine.length === 0 && (
          <StateBlock variant="empty" boxed>
            no vaults bound here yet — align a collection to stand one up.
          </StateBlock>
        )}

        {mine.length > 0 && (
          <ul className={styles.list} data-testid="target-vaults">
            {mine.map((v) => {
              const s = byAddress.get(v.address.toLowerCase())
              const isEndowment = s?.vaultType === 'AaveEndowment'
              return (
                <li key={v.address}>
                  <Link href={`/vault/${v.address}`} className={styles.row} data-testid="vault-row">
                    <span className={styles.rowName}>
                      {v.name || truncateAddress(v.address)}
                      <span className={styles.rowAddr}>{truncateAddress(v.address)}</span>
                    </span>
                    <span className={styles.rowBadge}>{vaultFamilyLabel(s?.vaultType)}</span>
                    <span className={styles.rowTvl}>
                      {isEndowment && s?.totalPrincipal !== undefined ? (
                        <b>{eth(s.totalPrincipal)} ETH</b>
                      ) : (
                        <span className={styles.rowPool}>
                          pool live
                          {s?.accumulatedFees !== undefined && s.accumulatedFees > 0n
                            ? ` · ${eth(s.accumulatedFees)} ETH fees`
                            : ''}
                        </span>
                      )}
                    </span>
                    <span className={styles.rowCount}>
                      {v.collectionCount} {v.collectionCount === 1 ? 'collection' : 'collections'}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
