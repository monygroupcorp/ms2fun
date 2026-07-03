/**
 * VaultPage (`/vault/:address`) — one vault's detail: family + bound alignment target, live stats
 * (honest TVL — real principal for endowment vaults, pool status for LP), the collections aligned to
 * it, and a board channel (post about the vault). The board channel is free: GlobalMessageRegistry's
 * post/postBatch accept ANY address as a channel, so it's just MessageFeed + MessageComposer keyed on
 * the vault address.
 */
import { Link, useParams } from 'wouter'
import { formatEther } from 'viem'
import { truncateAddress } from '../lib/format'
import { useAllCollections } from '../lib/discovery'
import { useVaultOverview, vaultFamilyLabel } from '../components/vault/useVaultOverview'
import { useCollectionMetadata } from '../components/useCollectionMetadata'
import { IpfsImage } from '../components/ui/IpfsImage'
import { MessageFeed } from '../components/MessageFeed'
import { MessageComposer } from '../components/MessageComposer'
import { StateBlock } from '../components/ui/StateBlock'
import styles from './VaultPage.module.css'

function toAddress(raw: string | undefined): `0x${string}` | undefined {
  if (!raw) return undefined
  return /^0x[0-9a-fA-F]{40}$/.test(raw) ? (raw as `0x${string}`) : undefined
}

function eth(value: bigint | undefined): string {
  if (value === undefined) return '—'
  const s = formatEther(value)
  const [whole, frac] = s.split('.')
  return frac ? `${whole}.${frac.slice(0, 4).replace(/0+$/, '') || '0'}` : (whole ?? s)
}

export function VaultPage() {
  const params = useParams<{ address?: string }>()
  const vault = toAddress(params.address)

  const overview = useVaultOverview(vault)
  const { data: collections } = useAllCollections(vault ? { vault } : undefined)
  // The target's display art lives in its metadataURI (data:/ipfs:/ar:).
  const targetMeta = useCollectionMetadata(overview.target?.metadataURI)

  if (!vault) {
    return (
      <div className={styles.page}>
        <StateBlock variant="error" boxed>
          invalid vault address.
        </StateBlock>
      </div>
    )
  }

  const family = vaultFamilyLabel(overview.vaultType)
  const title = overview.name || `Vault ${truncateAddress(vault)}`
  const aligned = collections ?? []

  return (
    <div className={styles.page}>
      <nav className={styles.crumb}>
        <Link href="/vaults" className={styles.back}>
          ← Vaults
        </Link>
      </nav>

      <header className={styles.head}>
        <p className={styles.kicker}>Alignment vault · {family}</p>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.addr}>{vault}</p>
      </header>

      <div className={styles.layout}>
        <main className={styles.mainCol}>
          {/* Stats */}
          <section className={styles.stats} data-testid="vault-stats">
            <div className={styles.stat}>
              <span className={styles.statLabel}>{overview.isEndowment ? 'TVL (principal)' : 'Model'}</span>
              <span className={styles.statValue}>
                {overview.isEndowment ? `${eth(overview.totalPrincipal)} ETH` : `${family} pool`}
              </span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>Fees accrued</span>
              <span className={styles.statValue}>{eth(overview.accumulatedFees)} ETH</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>Benefactor shares</span>
              <span className={styles.statValue}>
                {overview.totalShares !== undefined ? overview.totalShares.toString() : '—'}
              </span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>Aligned collections</span>
              <span className={styles.statValue}>{aligned.length}</span>
            </div>
          </section>

          {/* Bound alignment target */}
          {overview.target && (
            <section className={styles.target} data-testid="vault-target">
              <h2 className={styles.sectionTitle}>Bound to</h2>
              <div className={styles.targetCard}>
                <div className={styles.targetArt}>
                  <IpfsImage
                    uri={targetMeta?.image ?? ''}
                    alt={`${overview.target.title} art`}
                    className={styles.targetImg}
                    fallback={<span className={styles.targetGlyph} aria-hidden>◈</span>}
                  />
                </div>
                <div className={styles.targetBody}>
                  <p className={styles.targetName}>{overview.target.title}</p>
                  {overview.target.description && (
                    <p className={styles.targetDesc}>{overview.target.description}</p>
                  )}
                  <p className={styles.targetWho}>
                    ~20% of every aligned collection&rsquo;s fees bind here, forever.
                  </p>
                </div>
              </div>
            </section>
          )}

          {/* Aligned collections */}
          <section data-testid="vault-collections">
            <h2 className={styles.sectionTitle}>Aligned collections</h2>
            {aligned.length === 0 ? (
              <p className={styles.note}>no collections align to this vault yet.</p>
            ) : (
              <ul className={styles.collList}>
                {aligned.map((c) => (
                  <li key={c.instance}>
                    <Link href={`/collection/${c.instance}`} className={styles.collRow}>
                      <span className={styles.collName}>{c.name || truncateAddress(c.instance)}</span>
                      <span className={styles.collType}>{c.contractType}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Board channel — post about the vault (channel = the vault address). */}
          <section data-testid="vault-board">
            <MessageFeed
              filter={{ instance: vault }}
              footer={<MessageComposer channel={vault} />}
            />
          </section>
        </main>
      </div>
    </div>
  )
}
