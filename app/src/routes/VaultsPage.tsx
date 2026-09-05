/**
 * VaultsPage (`/vaults`) — the index of ALIGNMENT COMMUNITIES + the platform's honest TVL.
 *
 * ONE CARD PER COMMUNITY, not per registry target. An asset curated on two venues is two targets on
 * chain (see `lib/vaults/communities`), and showing both was showing the same community twice. The
 * venues live on the community's own page, which is also where its vaults are listed — this page
 * answers "who can a collection align to", and the target page answers "and what is bound to them".
 *
 * TVL is shown per the "honest split": endowment vaults report real `totalPrincipal()`; LP vaults
 * (Uni/ZAMM/Cypher) expose no principal read, so they show a family badge + accrued fees instead of
 * a fabricated number. The header total sums ONLY endowment principals, labelled as such.
 */
import { Link } from 'wouter'
import { useAllVaults } from '../lib/vaults/useAllVaults'
import { useVaultsSummary } from '../lib/vaults/useVaultsSummary'
import { useAlignmentTargets } from '../lib/vaults/useAlignmentTargets'
import { groupTargetsByToken, type TargetGroup } from '../lib/wizard/vaultFlavor'
import type { AlignmentTargetRow } from '../lib/vaults/useAlignmentTargets'
import {
  ethCompact as eth,
  rollUpByTarget,
  rollupsByTargetKey,
  sumRollups,
  targetFigureLabel,
  type TargetRollup,
} from '../lib/vaults/targetRollup'
import { useCollectionMetadata } from '../components/useCollectionMetadata'
import { IpfsImage } from '../components/ui/IpfsImage'
import { StateBlock } from '../components/ui/StateBlock'
import styles from './VaultsPage.module.css'

/**
 * One alignment-target card: logo (from the target's metadataURI) + title + description + the ETH
 * bound to that target. The figure is always shown with its scope stated — a bare number here is a
 * claim a visitor cannot check, and checking it is the whole point of the page.
 */
function CommunityCard({
  community,
  rollup,
  pending,
}: {
  community: TargetGroup<AlignmentTargetRow>
  rollup: TargetRollup
  pending: boolean
}) {
  const target = community.primary
  const meta = useCollectionMetadata(target.metadataURI)
  return (
    <li className={styles.targetCard} data-testid="alignment-target">
      <Link href={`/target/${target.id.toString()}`} className={styles.targetLink}>
        <div className={styles.targetLogo}>
          <IpfsImage
            uri={meta?.image ?? ''}
            alt={`${target.title} logo`}
            className={styles.targetImg}
            fallback={
              <span className={styles.targetGlyph} aria-hidden>
                ◈
              </span>
            }
          />
        </div>
        <div className={styles.targetBody}>
          <p className={styles.targetName}>{target.title}</p>
          {target.description && (
            <>
              <p className={styles.targetDesc}>{target.description}</p>
              {/* Not an anchor: the whole card already is one, and nesting a second would be invalid
                  markup. This is the affordance, the card is the click. */}
              <span className={styles.readMore}>read more →</span>
            </>
          )}
          <p className={styles.targetFigure} data-testid="target-figure">
            {targetFigureLabel(rollup, pending)}
            {!pending && <sup className={styles.asterisk}>*</sup>}
          </p>
        </div>
      </Link>
    </li>
  )
}

/**
 * Vaults whose target could not be placed on a card above — the target read failed, or it names a
 * target that is not currently active. Rendered as its own line rather than dropped: the per-target
 * figures plus this one sum to the header's Endowment TVL, and a total that quietly omitted what it
 * could not attribute would fall apart the moment someone added the rows up.
 */
function UnattributedCard({ rollup, pending }: { rollup: TargetRollup; pending: boolean }) {
  return (
    <li className={styles.targetCard} data-testid="unattributed-target">
      <div className={styles.targetBody}>
        <p className={styles.targetName}>Unattributed</p>
        <p className={styles.targetDesc}>
          vaults whose alignment target did not resolve to an active target
        </p>
        <p className={styles.targetFigure} data-testid="target-figure">
          {targetFigureLabel(rollup, pending)}
          {!pending && <sup className={styles.asterisk}>*</sup>}
        </p>
      </div>
    </li>
  )
}

export function VaultsPage() {
  const { vaults, isPending, isError } = useAllVaults()
  const addresses = vaults.map((v) => v.address)
  const {
    byAddress,
    endowmentTvl,
    lpEthPlaced,
    lpPendingEth,
    isPending: summaryPending,
  } = useVaultsSummary(addresses)
  const { targets } = useAlignmentTargets()

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
  const unattributed = rollupByKey.get('unattributed')
  // One card per community. An asset on two venues is two targets on chain and one row here, and its
  // figure sums every venue — see `lib/vaults/communities`.
  const communities = groupTargetsByToken(targets)

  return (
    <div className={styles.page}>
      <nav className={styles.crumb}>
        <Link href="/" className={styles.back}>
          ← noesis
        </Link>
      </nav>

      <header className={styles.head}>
        <h1 className={styles.title}>Alignment</h1>
        <p className={styles.sub}>
          Every collection routes a fixed share of its fees to an alignment vault — 19% on liquidity
          collections, 80% on endowment ones, at a ratio nobody can change. These are the
          communities that money flows to — open one to see its venues and its vaults.
        </p>
        <div className={styles.tvl} data-testid="vaults-tvl">
          <span className={styles.tvlLabel}>ETH bound</span>
          <span className={styles.tvlValue}>
            {summaryPending ? '…' : `${eth(endowmentTvl + lpEthPlaced + lpPendingEth)} ETH`}
          </span>
          <span className={styles.tvlNote}>across every alignment community*</span>
        </div>
      </header>

      {/* The communities vaults align TO. Descriptions + logos come from each target's metadataURI. */}
      {(targets.length > 0 || unattributed !== undefined) && (
        <section className={styles.targets} data-testid="alignment-targets">
          <h2 className={styles.sectionTitle}>Alignment targets</h2>
          <p className={styles.sectionSub}>
            The communities collections bind to — 19% or 80% of fees flow to these, by vault family.
          </p>
          <ul className={styles.targetGrid}>
            {communities.map((c) => (
              <CommunityCard
                key={c.key}
                community={c}
                rollup={sumRollups(c.targets.map((t) => rollupByKey.get(t.id.toString())))}
                pending={summaryPending}
              />
            ))}
            {unattributed && <UnattributedCard rollup={unattributed} pending={summaryPending} />}
          </ul>
        </section>
      )}

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
      {!isPending && !isError && vaults.length === 0 && (
        <StateBlock variant="empty" boxed>
          no vaults yet — deploy a collection to stand one up.
        </StateBlock>
      )}

      {/* The vaults themselves are listed on each community's own page: a flat list here repeated
          every vault under a heading that could not say which community it served. */}

      {/* One footnote for every asterisk above. The figures are a sum of unlike things and saying so
          once, here, beats repeating a scope line under each of six cards — the per-community
          breakdown is on the community's own page, one click away. */}
      <footer className={styles.footnote}>
        <p>
          <span aria-hidden>*</span> ETH bound to a community, counting three things that are not
          the same: <b>endowment principal</b>, which the vault holds and can redeem;{' '}
          <b>ETH placed as liquidity</b>, stated at what the vault put in rather than marked to
          market, so the position&apos;s worth today moves with the pool and with impermanent loss;
          and <b>ETH awaiting conversion</b>, tithed and held but not yet working. Accrued LP fees
          are counted separately again and are never folded in. Open a community for its own
          breakdown.
        </p>
      </footer>
    </div>
  )
}
