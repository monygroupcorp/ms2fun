import { Link } from 'wouter'
import {
  auctionPositions,
  isPortfolioEmpty,
  type PortfolioData,
  type Erc404Holding,
  type Erc1155Holding,
  type VaultPosition,
  type AuctionPosition,
} from './usePortfolio'
import { fmtEth, fmtEndTime, escrowNote } from './portfolioFormat'
import { truncateAddress } from '../../lib/format'
import { forkChainId } from '../../lib/addresses'
import { StateBlock } from '../ui/StateBlock'
import styles from './PortfolioPanels.module.css'

/** Slug link when the holding's name is in hand; else the address link (301s via the legacy
 * redirect route — chain-scoped-slug-routes noesis-079 step 9). */
function holdingHref(instance: `0x${string}`, name: string | undefined, suffix = ''): string {
  return name
    ? `/${forkChainId}/${name.toLowerCase()}${suffix}`
    : `/collection/${instance}${suffix}`
}

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
              <Link href={holdingHref(h.instance, h.name)} className={styles.cardLink}>
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
              <Link href={holdingHref(h.instance, h.name)} className={styles.cardLink}>
                {h.name || truncateAddress(h.instance)}
              </Link>
              <span className={styles.cardAddr}>{truncateAddress(h.instance)}</span>
            </div>
            <ul className={styles.editions}>
              {h.editions.map((e) => (
                <li key={e.id.toString()} className={styles.edition}>
                  <Link
                    href={holdingHref(h.instance, h.name, `/edition/${e.id.toString()}`)}
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

/**
 * Auction escrow — ETH the user has committed to an ERC721 auction and has NOT got back yet: a
 * standing high bid, or a creator's queue deposit. It is money the portfolio has to be able to name,
 * so each row states the amount, why it is held, and the act that releases it.
 *
 * Escrow is not claimable: it stays out of the Vaults tab's claimable figure by construction (the
 * aggregator does not sum it into `totalClaimable`).
 */
function AuctionPositions({ positions }: { positions: readonly AuctionPosition[] }) {
  const held = positions.filter((p) => p.amount > 0n)
  if (held.length === 0) return null
  return (
    <section className={styles.section} data-testid="portfolio-auctions">
      <p className={styles.sectionTitle}>Auction escrow</p>
      <ul className={styles.list}>
        {held.map((p) => (
          <li
            key={`${p.instance}-${p.tokenId.toString()}-${p.isCreatorDeposit ? 'd' : 'b'}`}
            className={styles.card}
          >
            <div className={styles.cardHead}>
              <Link href={holdingHref(p.instance, p.name)} className={styles.cardLink}>
                {p.name || truncateAddress(p.instance)}
              </Link>
              <span className={styles.cardAddr}>#{p.tokenId.toString()}</span>
            </div>
            <dl className={styles.stats}>
              <div className={styles.stat}>
                <dt>{p.isCreatorDeposit ? 'deposit' : 'your bid'}</dt>
                <dd>{fmtEth(p.amount)} ETH</dd>
              </div>
              <div className={styles.stat}>
                <dt>ends</dt>
                <dd>{fmtEndTime(p.endTime)}</dd>
              </div>
            </dl>
            <p className={styles.escrowNote}>{escrowNote(p)}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * The notice shown when the portfolio read did not cover every collection.
 *
 * It must render in the EMPTY case above all: a partially-hidden portfolio at least shows something,
 * but a fully-hidden one renders "nothing held yet" — the opposite of the truth — so the empty state
 * is exactly where the caveat is load-bearing. It sat below the empty-state early return until
 * noesis-327, which is the one place it could never appear.
 *
 * The copy names what was checked rather than what is shown, because in the empty case nothing is
 * being shown at all.
 */
function TruncationNotice({ testId, subject }: { testId: string; subject: string }) {
  return (
    <p className={styles.warn} data-testid={testId}>
      only the first 50 collections were checked — {subject} outside that set are not shown.
    </p>
  )
}

export function HeldPanel({ data, isPending, isError, truncated }: PanelProps) {
  if (isPending) return <StateBlock variant="loading">hanging the work…</StateBlock>
  if (isError)
    return (
      <StateBlock variant="error">
        could not reach the aggregator — no response from the network.
      </StateBlock>
    )
  if (isPortfolioEmpty(data))
    return (
      <>
        {truncated && <TruncationNotice testId="portfolio-truncated" subject="holdings" />}
        <StateBlock variant="empty" boxed testId="portfolio-empty">
          nothing held yet — go mint or bid.
        </StateBlock>
      </>
    )
  return (
    <div data-testid="portfolio-holdings">
      {truncated && <TruncationNotice testId="portfolio-truncated" subject="holdings" />}
      <Erc404Cards holdings={data?.[0] ?? []} />
      <Erc1155Cards holdings={data?.[1] ?? []} />
      <AuctionPositions positions={auctionPositions(data)} />
    </div>
  )
}

/** Per-vault Claim affordance. The real write (`claimFees`) lands with the Aave alignment vault
 * (pending T4) — the current ABI stubs it as `pure`, so the action is shown but honestly disabled
 * rather than faked against a stub. Wire it to `useTxAction` once the vault ships. */
function ClaimButton() {
  return (
    <button
      type="button"
      className={styles.claimBtn}
      disabled
      title="Claims land with the Aave alignment vault (pending T4)"
      data-testid="vault-claim"
    >
      Claim
    </button>
  )
}

export function VaultsPanel({
  data,
  isPending,
  isError,
  truncated,
  isOwn,
}: PanelProps & { isOwn?: boolean }) {
  if (isPending) return <StateBlock variant="loading">hanging the work…</StateBlock>
  if (isError)
    return (
      <StateBlock variant="error">
        could not reach the aggregator — no response from the network.
      </StateBlock>
    )

  const positions: readonly VaultPosition[] = data?.[2] ?? []
  const claimable = data?.[3] ?? 0n
  // Two-sided: inbound = works aligned TO you (fees owed → claimable); outbound = what YOU align to
  // (your contribution / inspiration). The alignment economy made legible at the person level.
  const inbound = positions.filter((v) => v.claimable > 0n)
  const outbound = positions.filter((v) => v.contribution > 0n || v.shares > 0n)

  return (
    <div data-testid="portfolio-vaults">
      {truncated && <TruncationNotice testId="vaults-truncated" subject="alignments" />}
      {/* Claimable hero — the bind grammar at the person level: aligned-to-you → claimable. */}
      <div className={`noesis-claimbox ${styles.claimbox}`}>
        <div className="cell">
          aligned to you<b>{inbound.length}</b>
        </div>
        <div className="arrow">→</div>
        <div className="cell got">
          claimable<b>{fmtEth(claimable)} ETH</b>
        </div>
      </div>

      <section className={styles.section}>
        <p className={styles.sectionTitle}>Inbound · aligned to you</p>
        {inbound.length === 0 ? (
          <StateBlock variant="empty" boxed>
            nothing aligns to you yet — when a collection binds to your work, its fees land here.
          </StateBlock>
        ) : (
          <div className="noesis-ledger">
            <div className="noesis-ledger-head">
              <span>Vault</span>
              <span>Claimable</span>
            </div>
            {inbound.map((v) => (
              <div className="noesis-ledger-row" key={v.vault}>
                <span className="n" />
                <span>
                  {v.name || truncateAddress(v.vault)}
                  <small>{truncateAddress(v.vault)}</small>
                </span>
                <span className={`v ${styles.claimCell}`}>
                  {fmtEth(v.claimable)} ETH
                  {isOwn && <ClaimButton />}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={styles.section}>
        <p className={styles.sectionTitle}>Outbound · what you align to</p>
        {outbound.length === 0 ? (
          <StateBlock variant="empty" boxed>
            you haven&rsquo;t bound to anything — what you align to (your inspiration) shows here.
          </StateBlock>
        ) : (
          <div className="noesis-ledger">
            <div className="noesis-ledger-head">
              <span>Vault</span>
              <span>Contribution</span>
            </div>
            {outbound.map((v) => (
              <div className="noesis-ledger-row" key={v.vault}>
                <span className="n" />
                <span>
                  {v.name || truncateAddress(v.vault)}
                  <small>{truncateAddress(v.vault)}</small>
                </span>
                <span className="v">{fmtEth(v.contribution)} ETH</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
