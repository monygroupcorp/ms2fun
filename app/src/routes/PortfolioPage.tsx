import { Link } from 'wouter'
import { useAccount } from 'wagmi'
import { formatEther } from 'viem'
import {
  usePortfolio,
  isPortfolioEmpty,
  type Erc404Holding,
  type Erc1155Holding,
  type VaultPosition,
} from '../components/portfolio/usePortfolio'
import { truncateAddress } from '../lib/format'
import { StateBlock } from '../components/ui/StateBlock'
import styles from './PortfolioPage.module.css'

/**
 * PortfolioPage (W-F) — the connected wallet's holdings across every registered collection.
 *
 * Sections: a header total (`totalClaimable`), ERC404 holdings (token + NFT count + staked +
 * pending rewards, per collection), ERC1155 edition balances, and vault positions (contribution /
 * claimable). Read path is `usePortfolio` → `QueryAggregator.getPortfolioData`.
 *
 * NFT rendering note: the W-D `Erc404NftGallery` scans a collection's mirror by id and is NOT
 * cheaply filterable by owner (that needs an `ownerOf` per id). So here we show the holder's NFT
 * COUNT per collection and link to that collection's full gallery rather than re-scanning per
 * owner — judgment call per the W-F brief.
 */

/** Format a wei value to a trimmed ETH string (drops trailing zeros, e.g. "1.5", "0"). */
function fmtEth(wei: bigint): string {
  const s = formatEther(wei)
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}

function Erc404Section({ holdings }: { holdings: readonly Erc404Holding[] }) {
  const held = holdings.filter(
    (h) =>
      h.tokenBalance > 0n || h.nftBalance > 0n || h.stakedBalance > 0n || h.pendingRewards > 0n,
  )
  if (held.length === 0) return null

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>ERC404 HOLDINGS</h2>
      <ul className={styles.list}>
        {held.map((h) => (
          <li key={h.instance} className={styles.card}>
            <div className={styles.cardHead}>
              <Link href={`/collection/${h.instance}`} className={styles.cardLink}>
                {h.name || truncateAddress(h.instance)}
              </Link>
              <span className={styles.cardAddr}>{truncateAddress(h.instance)}</span>
            </div>
            <dl className={styles.stats}>
              <div className={styles.stat}>
                <dt className={styles.statLabel}>TOKEN</dt>
                <dd className={styles.statValue}>{fmtEth(h.tokenBalance)}</dd>
              </div>
              <div className={styles.stat}>
                <dt className={styles.statLabel}>NFTS</dt>
                <dd className={styles.statValue}>{h.nftBalance.toString()}</dd>
              </div>
              <div className={styles.stat}>
                <dt className={styles.statLabel}>STAKED</dt>
                <dd className={styles.statValue}>{fmtEth(h.stakedBalance)}</dd>
              </div>
              <div className={styles.stat}>
                <dt className={styles.statLabel}>PENDING</dt>
                <dd className={styles.statValue}>{fmtEth(h.pendingRewards)}</dd>
              </div>
            </dl>
            {h.nftBalance > 0n && (
              <Link href={`/collection/${h.instance}`} className={styles.galleryLink}>
                VIEW GALLERY →
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function Erc1155Section({ holdings }: { holdings: readonly Erc1155Holding[] }) {
  // Per holding, keep only editions with a non-zero balance.
  const rows = holdings
    .map((h) => ({
      ...h,
      editions: h.editionIds
        .map((id, i) => ({ id, balance: h.balances[i] ?? 0n }))
        .filter((e) => e.balance > 0n),
    }))
    .filter((h) => h.editions.length > 0)
  if (rows.length === 0) return null

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>EDITIONS (ERC1155)</h2>
      <ul className={styles.list}>
        {rows.map((h) => (
          <li key={h.instance} className={styles.card}>
            <div className={styles.cardHead}>
              <Link href={`/collection/${h.instance}`} className={styles.cardLink}>
                {h.name || truncateAddress(h.instance)}
              </Link>
              <span className={styles.cardAddr}>{truncateAddress(h.instance)}</span>
            </div>
            <ul className={styles.editions}>
              {h.editions.map((e) => (
                <li key={e.id.toString()} className={styles.edition}>
                  <Link
                    href={`/collection/${h.instance}/edition/${e.id.toString()}`}
                    className={styles.editionLink}
                  >
                    #{e.id.toString()}
                  </Link>
                  <span className={styles.editionBal}>×{e.balance.toString()}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  )
}

function VaultSection({ positions }: { positions: readonly VaultPosition[] }) {
  const held = positions.filter((v) => v.contribution > 0n || v.shares > 0n || v.claimable > 0n)
  if (held.length === 0) return null

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>VAULT POSITIONS</h2>
      <ul className={styles.list}>
        {held.map((v) => (
          <li key={v.vault} className={styles.card}>
            <div className={styles.cardHead}>
              <span className={styles.cardLink}>{v.name || truncateAddress(v.vault)}</span>
              <span className={styles.cardAddr}>{truncateAddress(v.vault)}</span>
            </div>
            <dl className={styles.stats}>
              <div className={styles.stat}>
                <dt className={styles.statLabel}>CONTRIBUTION</dt>
                <dd className={styles.statValue}>{fmtEth(v.contribution)} ETH</dd>
              </div>
              <div className={styles.stat}>
                <dt className={styles.statLabel}>SHARES</dt>
                <dd className={styles.statValue}>{fmtEth(v.shares)}</dd>
              </div>
              <div className={styles.stat}>
                <dt className={styles.statLabel}>CLAIMABLE</dt>
                <dd className={styles.statValue}>{fmtEth(v.claimable)} ETH</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function PortfolioPage() {
  const { address } = useAccount()
  const { data, isPending, isError, truncated, noWallet } = usePortfolio(address)

  return (
    <div className={styles.page}>
      <nav className={styles.crumb}>
        <Link href="/" className={styles.back}>
          ← ms2.fun
        </Link>
      </nav>

      <div className={styles.header}>
        <h1 className={`${styles.title} text-chromatic-medium`}>PORTFOLIO</h1>
        {data !== undefined && (
          <div className={styles.total}>
            <span className={styles.totalLabel}>TOTAL CLAIMABLE</span>
            <span className={styles.totalValue}>{fmtEth(data[3])} ETH</span>
          </div>
        )}
      </div>

      {noWallet && (
        <StateBlock variant="empty" testId="portfolio-connect">
          connect your wallet to view your portfolio
        </StateBlock>
      )}

      {!noWallet && isPending && (
        <StateBlock variant="loading" testId="portfolio-loading">
          loading your holdings…
        </StateBlock>
      )}

      {!noWallet && !isPending && isError && (
        <StateBlock variant="error">could not reach the aggregator — is the fork up?</StateBlock>
      )}

      {truncated && (
        <p className={styles.warn} data-testid="portfolio-truncated">
          showing the first 50 collections only — some holdings may be hidden.
        </p>
      )}

      {!noWallet && !isPending && !isError && isPortfolioEmpty(data) && (
        <StateBlock variant="empty" testId="portfolio-empty">
          nothing yet — go mint or bid.
        </StateBlock>
      )}

      {!noWallet && !isPending && !isError && data !== undefined && !isPortfolioEmpty(data) && (
        <div data-testid="portfolio-holdings">
          <Erc404Section holdings={data[0]} />
          <Erc1155Section holdings={data[1]} />
          <VaultSection positions={data[2]} />
        </div>
      )}
    </div>
  )
}
