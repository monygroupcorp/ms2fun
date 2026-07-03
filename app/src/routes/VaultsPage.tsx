/**
 * VaultsPage (`/vaults`) — the browsable index of alignment vaults + the platform's honest TVL.
 *
 * TVL is shown per the "honest split": endowment vaults report real `totalPrincipal()`; LP vaults
 * (Uni/ZAMM/Cypher) expose no principal read, so they show a family badge + accrued fees instead of
 * a fabricated number. The header total sums ONLY endowment principals, labelled as such.
 */
import { Link } from 'wouter'
import { formatEther } from 'viem'
import { truncateAddress } from '../lib/format'
import { useAllVaults } from '../lib/vaults/useAllVaults'
import { useVaultsSummary } from '../lib/vaults/useVaultsSummary'
import { type AlignmentTargetRow, useAlignmentTargets } from '../lib/vaults/useAlignmentTargets'
import { vaultFamilyLabel } from '../components/vault/useVaultOverview'
import { useCollectionMetadata } from '../components/useCollectionMetadata'
import { IpfsImage } from '../components/ui/IpfsImage'
import { StateBlock } from '../components/ui/StateBlock'
import styles from './VaultsPage.module.css'

/** Trim an ETH string to 4 fraction digits for a compact figure. */
function eth(value: bigint): string {
  const s = formatEther(value)
  const [whole, frac] = s.split('.')
  return frac ? `${whole}.${frac.slice(0, 4).replace(/0+$/, '') || '0'}` : whole
}

/** One alignment-target card: logo (from the target's metadataURI) + title + description. */
function TargetCard({ target }: { target: AlignmentTargetRow }) {
  const meta = useCollectionMetadata(target.metadataURI)
  return (
    <li className={styles.targetCard} data-testid="alignment-target">
      <div className={styles.targetLogo}>
        <IpfsImage
          uri={meta?.image ?? ''}
          alt={`${target.title} logo`}
          className={styles.targetImg}
          fallback={<span className={styles.targetGlyph} aria-hidden>◈</span>}
        />
      </div>
      <div className={styles.targetBody}>
        <p className={styles.targetName}>{target.title}</p>
        {target.description && <p className={styles.targetDesc}>{target.description}</p>}
      </div>
    </li>
  )
}

export function VaultsPage() {
  const { vaults, isPending, isError } = useAllVaults()
  const addresses = vaults.map((v) => v.address)
  const { byAddress, endowmentTvl, isPending: summaryPending } = useVaultsSummary(addresses)
  const { targets } = useAlignmentTargets()

  return (
    <div className={styles.page}>
      <nav className={styles.crumb}>
        <Link href="/" className={styles.back}>
          ← ms2.fun
        </Link>
      </nav>

      <header className={styles.head}>
        <h1 className={styles.title}>Vaults</h1>
        <p className={styles.sub}>
          Every collection binds ~20% of its fees to an alignment vault, by contract. Here they are —
          browse them, read the stats, post about them.
        </p>
        <div className={styles.tvl} data-testid="vaults-tvl">
          <span className={styles.tvlLabel}>Endowment TVL</span>
          <span className={styles.tvlValue}>
            {summaryPending ? '…' : `${eth(endowmentTvl)} ETH`}
          </span>
          <span className={styles.tvlNote}>
            principal locked in endowment vaults · LP-vault positions not valued here
          </span>
        </div>
      </header>

      {/* The communities vaults align TO. Descriptions + logos come from each target's metadataURI. */}
      {targets.length > 0 && (
        <section className={styles.targets} data-testid="alignment-targets">
          <h2 className={styles.sectionTitle}>Alignment targets</h2>
          <p className={styles.sectionSub}>The communities collections bind to — ~20% of fees flow to these.</p>
          <ul className={styles.targetGrid}>
            {targets.map((t) => (
              <TargetCard key={t.id.toString()} target={t} />
            ))}
          </ul>
        </section>
      )}

      {isPending && <StateBlock variant="loading" boxed>reading the vaults…</StateBlock>}
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

      {vaults.length > 0 && (
        <ul className={styles.list} data-testid="vaults-list">
          {vaults.map((v) => {
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
    </div>
  )
}
