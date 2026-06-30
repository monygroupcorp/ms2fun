import { Link } from 'wouter'
import {
  isPortfolioEmpty,
  type PortfolioData,
  type Erc404Holding,
  type Erc1155Holding,
  type VaultPosition,
} from './usePortfolio'
import { fmtEth } from './portfolioFormat'
import { truncateAddress } from '../../lib/format'
import { StateBlock } from '../ui/StateBlock'
import styles from './PortfolioPanels.module.css'

/**
 * The Held + Vaults tab bodies of the merged profile plate (NOESIS "the plate" — Surface 6). The
 * profile owns the `usePortfolio(target)` read and passes the data in; these panels render it for
 * any address (own or a visitor's). Reads are unchanged — this is the portfolio data, re-housed
 * from the standalone PortfolioPage into the plate's tabs. Colour stays out of the chrome; holdings
 * are data, shown as mono fact.
 */

interface PanelProps {
  data: PortfolioData | undefined
  isPending: boolean
  isError: boolean
  truncated?: boolean
}

function Erc404Cards({ holdings }: { holdings: readonly Erc404Holding[] }) {
  const held = holdings.filter(
    (h) =>
      h.tokenBalance > 0n || h.nftBalance > 0n || h.stakedBalance > 0n || h.pendingRewards > 0n,
  )
  if (held.length === 0) return null
  return (
    <section className={styles.section}>
      <p className={styles.sectionTitle}>ERC404 holdings</p>
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
                <dt>token</dt>
                <dd>{fmtEth(h.tokenBalance)}</dd>
              </div>
              <div className={styles.stat}>
                <dt>nfts</dt>
                <dd>{h.nftBalance.toString()}</dd>
              </div>
              <div className={styles.stat}>
                <dt>staked</dt>
                <dd>{fmtEth(h.stakedBalance)}</dd>
              </div>
              <div className={styles.stat}>
                <dt>pending</dt>
                <dd>{fmtEth(h.pendingRewards)}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Erc1155Cards({ holdings }: { holdings: readonly Erc1155Holding[] }) {
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
      <p className={styles.sectionTitle}>Editions (ERC1155)</p>
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

export function HeldPanel({ data, isPending, isError, truncated }: PanelProps) {
  if (isPending) return <StateBlock variant="loading">hanging the work…</StateBlock>
  if (isError)
    return <StateBlock variant="error">could not reach the aggregator — is the fork up?</StateBlock>
  if (isPortfolioEmpty(data))
    return (
      <StateBlock variant="empty" boxed testId="portfolio-empty">
        nothing held yet — go mint or bid.
      </StateBlock>
    )
  return (
    <div data-testid="portfolio-holdings">
      {truncated && (
        <p className={styles.warn} data-testid="portfolio-truncated">
          showing the first 50 collections only — some holdings may be hidden.
        </p>
      )}
      <Erc404Cards holdings={data?.[0] ?? []} />
      <Erc1155Cards holdings={data?.[1] ?? []} />
    </div>
  )
}

export function VaultsPanel({ data, isPending, isError }: PanelProps) {
  if (isPending) return <StateBlock variant="loading">hanging the work…</StateBlock>
  if (isError)
    return <StateBlock variant="error">could not reach the aggregator — is the fork up?</StateBlock>

  const positions: readonly VaultPosition[] = data?.[2] ?? []
  const held = positions.filter((v) => v.contribution > 0n || v.shares > 0n || v.claimable > 0n)
  const claimable = data?.[3] ?? 0n

  return (
    <div data-testid="portfolio-vaults">
      {/* Claimable hero — the bind grammar at the person level: aligned-to-you → claimable. */}
      <div className={`noesis-claimbox ${styles.claimbox}`}>
        <div className="cell">
          aligned to you<b>{held.length}</b>
        </div>
        <div className="arrow">→</div>
        <div className="cell got">
          claimable<b>{fmtEth(claimable)} ETH</b>
        </div>
      </div>

      {held.length === 0 ? (
        <StateBlock variant="empty" boxed>
          no vault positions yet — what aligns to you, and what you align to, shows here.
        </StateBlock>
      ) : (
        <section className={styles.section}>
          <p className={styles.sectionTitle}>Vault positions</p>
          <div className="noesis-ledger">
            <div className="noesis-ledger-head">
              <span>Vault</span>
              <span>Contribution · Claimable</span>
            </div>
            {held.map((v) => (
              <div className="noesis-ledger-row" key={v.vault}>
                <span className="n" />
                <span>
                  {v.name || truncateAddress(v.vault)}
                  <small>{truncateAddress(v.vault)}</small>
                </span>
                <span className="v">
                  {fmtEth(v.contribution)} · {fmtEth(v.claimable)} ETH
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
