/**
 * Exec404Portfolio (N1/N3) — the connected wallet's position in the EXEC404 fossil: fungible EXEC
 * balance, DN404 NFT count + a gallery of the held pieces (enumerated from the mirror's Transfer log),
 * and the three holder actions:
 *   send EXEC  → base.transfer(to, amount)                     (fungible ERC-20 send)
 *   reroll     → base.transfer(self, balanceOf(self))          (DN404 self-send re-shuffles NFT ids)
 *   send piece → mirror.transferFrom(self, to, id)             (move one NFT)
 * Balances/holdings refetch after every confirmed action so the panel stays live.
 */
import { useEffect, useMemo, useState } from 'react'
import { isAddress } from 'viem'
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import {
  EXEC404_ADDRESS,
  EXEC404_CHAIN_ID,
  EXEC404_MIRROR_ADDRESS,
  ONE_EXEC,
  exec404Abi,
  exec404MirrorAbi,
} from '../../lib/exec404'
import { formatTokenAmount } from '../../lib/format'
import { AmountField } from '../ui/AmountField'
import { IpfsImage } from '../ui/IpfsImage'
import { parseAmount } from '../ui/parseAmount'
import { txErrorReason } from '../ui/useTxAction'
import { useExec404NftIds, useExec404NftPage, type Exec404Nft } from './useExec404Nfts'
import styles from './Exec404Portfolio.module.css'

const PAGE_SIZES = [12, 24, 48, 96] as const

export function Exec404Portfolio() {
  const { address, isConnected } = useAccount()
  const [selected, setSelected] = useState<Exec404Nft | null>(null)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState<number>(24)

  const balanceRead = useReadContract({
    address: EXEC404_ADDRESS,
    abi: exec404Abi,
    functionName: 'balanceOf',
    chainId: EXEC404_CHAIN_ID,
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  })
  const nftCountRead = useReadContract({
    address: EXEC404_MIRROR_ADDRESS,
    abi: exec404MirrorAbi,
    functionName: 'balanceOf',
    chainId: EXEC404_CHAIN_ID,
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  })
  const { ids, isPending: idsPending, refetch: refetchIds } = useExec404NftIds(address)

  // Paginate the (cheap) id list; only the current page's metadata is fetched.
  const total = ids.length
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const clampedPage = Math.min(page, pageCount - 1)
  const pageIds = useMemo(
    () => ids.slice(clampedPage * pageSize, clampedPage * pageSize + pageSize),
    [ids, clampedPage, pageSize],
  )
  const { nfts, isPending: nftsPending } = useExec404NftPage(pageIds)

  const balance = balanceRead.data ?? 0n
  const nftCount = nftCountRead.data ?? 0n

  // Reset to the first page when the wallet or page size changes.
  useEffect(() => {
    setPage(0)
  }, [address, pageSize])

  function refetchAll(): void {
    void balanceRead.refetch()
    void nftCountRead.refetch()
    refetchIds()
  }

  if (!isConnected || !address) {
    return (
      <section className={styles.card} data-testid="exec404-portfolio">
        <h2 className={styles.title}>Portfolio</h2>
        <p className={styles.note}>connect wallet to see your EXEC balance and pieces.</p>
      </section>
    )
  }

  return (
    <section className={styles.card} data-testid="exec404-portfolio">
      <h2 className={styles.title}>Portfolio</h2>

      <div className={styles.figures}>
        <div className={styles.figure}>
          <span className={styles.figLabel}>EXEC</span>
          <span className={styles.figValue} data-testid="exec404-portfolio-balance">
            {formatTokenAmount(balance, 18, 4)}
          </span>
        </div>
        <div className={styles.figure}>
          <span className={styles.figLabel}>NFTs</span>
          <span className={styles.figValue}>{nftCount.toString()}</span>
        </div>
      </div>

      {/* Pieces lead the portfolio — the work first, the actions (mint/reroll/send) below. */}
      <div className={styles.pieces}>
        <div className={styles.piecesHeadRow}>
          <p className={styles.piecesHead}>Pieces {total > 0 && <span>· {total}</span>}</p>
          {total > pageSize && (
            <label className={styles.perPage}>
              per page
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                data-testid="exec404-page-size"
              >
                {PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {idsPending ? (
          <p className={styles.note}>loading pieces…</p>
        ) : total === 0 ? (
          <p className={styles.note} data-testid="exec404-portfolio-empty">
            no EXEC NFTs held. Buy ≥ 1 whole EXEC (with skip-NFT off) to mint pieces.
          </p>
        ) : (
          <>
            <ul className={styles.grid} data-testid="exec404-portfolio-nfts">
              {pageIds.map((id) => {
                const nft = nfts.find((n) => n.id === id)
                return nft ? (
                  <NftCard key={id.toString()} nft={nft} onView={() => setSelected(nft)} />
                ) : (
                  <li key={id.toString()} className={styles.tile}>
                    <div className={styles.thumbGlyph}>{nftsPending ? '…' : '✕'}</div>
                    <span className={styles.tileId}>#{id.toString()}</span>
                  </li>
                )
              })}
            </ul>
            {pageCount > 1 && (
              <div className={styles.pager} data-testid="exec404-pager">
                <button
                  className="btn btn-secondary"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={clampedPage === 0}
                >
                  ← prev
                </button>
                <span className={styles.pagerLabel}>
                  {clampedPage * pageSize + 1}–{Math.min(total, (clampedPage + 1) * pageSize)} of{' '}
                  {total}
                </span>
                <button
                  className="btn btn-secondary"
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  disabled={clampedPage >= pageCount - 1}
                >
                  next →
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <BalanceMint balance={balance} onDone={refetchAll} />
      <SendExec balance={balance} onDone={refetchAll} />

      {/* Reroll is destructive-ish (it re-shuffles which ids you hold) — shield it behind a
          disclosure so it's a deliberate choice, not a stray tap. */}
      <details className={styles.shielded}>
        <summary className={styles.shieldedSummary} data-testid="exec404-reroll-disclosure">
          Advanced · reroll pieces
        </summary>
        <RerollButton owner={address} balance={balance} onDone={refetchAll} />
      </details>

      {selected && (
        <PieceModal
          owner={address}
          nft={selected}
          onClose={() => setSelected(null)}
          onDone={() => {
            refetchAll()
            setSelected(null)
          }}
        />
      )}
    </section>
  )
}

/** Balance-mint: materialize whole-token NFTs from the fungible EXEC balance (EXEC's balanceMint).
 *  `count` is a number of NFTs, capped at floor(balance / 1 EXEC) — the contract enforces the rest. */
function BalanceMint({ balance, onDone }: { balance: bigint; onDone: () => void }) {
  const maxMintable = balance / ONE_EXEC
  const [count, setCount] = useState('1')
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract()
  const { isLoading, isSuccess } = useWaitForTransactionReceipt({ hash })
  const reason = txErrorReason(error)
  const busy = isPending || isLoading

  const parsed = /^\d+$/.test(count.trim()) ? BigInt(count.trim()) : undefined
  const valid = parsed !== undefined && parsed > 0n && parsed <= maxMintable

  function handleMint(): void {
    if (parsed === undefined) return
    writeContract({
      address: EXEC404_ADDRESS,
      abi: exec404Abi,
      functionName: 'balanceMint',
      chainId: EXEC404_CHAIN_ID,
      args: [parsed],
    })
  }

  useEffect(() => {
    if (!isSuccess) return
    reset()
    setCount('1')
    onDone()
  }, [isSuccess, reset, onDone])

  return (
    <div className={styles.action}>
      <p className={styles.actionTitle}>mint pieces from balance</p>
      <input
        className={styles.addrInput}
        type="number"
        min={1}
        max={maxMintable.toString()}
        inputMode="numeric"
        value={count}
        onChange={(e) => setCount(e.target.value)}
        disabled={busy || maxMintable === 0n}
        aria-label="number of pieces to mint from balance"
        data-testid="exec404-balancemint-count"
      />
      <span className={styles.hint}>
        materialize NFTs you already hold as EXEC · up to {maxMintable.toString()} from this
        balance.
      </span>
      <button
        className="btn btn-primary"
        onClick={handleMint}
        disabled={!valid || busy}
        data-testid="exec404-balancemint"
      >
        {isPending ? 'confirm in wallet…' : isLoading ? 'minting…' : 'mint pieces'}
      </button>
      {reason && <p className={`${styles.note} ${styles.err}`}>mint failed: {reason}</p>}
    </div>
  )
}

/** DN404 reroll: a self-transfer of the whole balance re-shuffles which NFT ids you hold. */
function RerollButton({
  owner,
  balance,
  onDone,
}: {
  owner: `0x${string}`
  balance: bigint
  onDone: () => void
}) {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract()
  const { isLoading, isSuccess } = useWaitForTransactionReceipt({ hash })
  const reason = txErrorReason(error)
  const busy = isPending || isLoading

  function handleReroll(): void {
    writeContract({
      address: EXEC404_ADDRESS,
      abi: exec404Abi,
      functionName: 'transfer',
      chainId: EXEC404_CHAIN_ID,
      args: [owner, balance],
    })
  }

  useEffect(() => {
    if (!isSuccess) return
    reset()
    onDone()
  }, [isSuccess, reset, onDone])

  return (
    <div className={styles.action}>
      <button
        className="btn btn-secondary"
        onClick={handleReroll}
        disabled={busy || balance === 0n}
        data-testid="exec404-reroll"
      >
        {isPending ? 'confirm in wallet…' : isLoading ? 'rerolling…' : 'reroll pieces'}
      </button>
      <span className={styles.hint}>
        self-sends your balance — re-shuffles which NFT ids you hold.
      </span>
      {reason && <p className={`${styles.note} ${styles.err}`}>reroll failed: {reason}</p>}
    </div>
  )
}

function SendExec({ balance, onDone }: { balance: bigint; onDone: () => void }) {
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract()
  const { isLoading, isSuccess } = useWaitForTransactionReceipt({ hash })
  const reason = txErrorReason(error)
  const busy = isPending || isLoading

  const amountWei = parseAmount(amount)
  const toValid = isAddress(to)
  const overBalance = amountWei !== undefined && amountWei > balance
  const canSend = toValid && amountWei !== undefined && amountWei > 0n && !overBalance && !busy

  function handleSend(): void {
    if (!toValid || amountWei === undefined) return
    writeContract({
      address: EXEC404_ADDRESS,
      abi: exec404Abi,
      functionName: 'transfer',
      chainId: EXEC404_CHAIN_ID,
      args: [to as `0x${string}`, amountWei],
    })
  }

  useEffect(() => {
    if (!isSuccess) return
    reset()
    setAmount('')
    setTo('')
    onDone()
  }, [isSuccess, reset, onDone])

  return (
    <div className={styles.action}>
      <p className={styles.actionTitle}>send EXEC</p>
      <input
        className={styles.addrInput}
        type="text"
        placeholder="0x recipient"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        disabled={busy}
        aria-label="EXEC recipient address"
        data-testid="exec404-send-to"
      />
      <AmountField
        value={amount}
        onChange={setAmount}
        unit="EXEC"
        placeholder="0.0"
        ariaLabel="amount of EXEC to send"
      />
      {overBalance && <span className={`${styles.hint} ${styles.err}`}>over your balance</span>}
      <button
        className="btn btn-primary"
        onClick={handleSend}
        disabled={!canSend}
        data-testid="exec404-send"
      >
        {isPending ? 'confirm in wallet…' : isLoading ? 'sending…' : 'send'}
      </button>
      {reason && <p className={`${styles.note} ${styles.err}`}>send failed: {reason}</p>}
    </div>
  )
}

/** A piece in the grid — click to open its detail (art + metadata + send). */
function NftCard({ nft, onView }: { nft: Exec404Nft; onView: () => void }) {
  return (
    <li className={styles.tile}>
      <button
        type="button"
        className={styles.tileView}
        onClick={onView}
        data-testid="exec404-nft-view"
        aria-label={`view EXEC #${nft.id.toString()}`}
      >
        <IpfsImage
          uri={nft.image ?? ''}
          alt={nft.name || `EXEC #${nft.id.toString()}`}
          className={styles.thumb}
          fallback={<div className={styles.thumbGlyph}>✕</div>}
        />
        <span className={styles.tileId}>{nft.name || `#${nft.id.toString()}`}</span>
      </button>
    </li>
  )
}

/** Piece detail — large art, on-chain metadata (name/description/traits), and the per-NFT send. */
function PieceModal({
  owner,
  nft,
  onClose,
  onDone,
}: {
  owner: `0x${string}`
  nft: Exec404Nft
  onClose: () => void
  onDone: () => void
}) {
  const [to, setTo] = useState('')
  const { writeContract, data: hash, isPending, error } = useWriteContract()
  const { isLoading, isSuccess } = useWaitForTransactionReceipt({ hash })
  const reason = txErrorReason(error)
  const busy = isPending || isLoading
  const toValid = isAddress(to)

  function handleSend(): void {
    if (!toValid) return
    writeContract({
      address: EXEC404_MIRROR_ADDRESS,
      abi: exec404MirrorAbi,
      functionName: 'transferFrom',
      chainId: EXEC404_CHAIN_ID,
      args: [owner, to as `0x${string}`, nft.id],
    })
  }

  // A confirmed send closes the modal + refetches (the modal unmounts, discarding the write state).
  useEffect(() => {
    if (isSuccess) onDone()
  }, [isSuccess, onDone])

  return (
    <div
      className={styles.modalScrim}
      role="dialog"
      aria-modal="true"
      aria-label={`EXEC #${nft.id.toString()}`}
      onClick={onClose}
      data-testid="exec404-piece-modal"
    >
      {/* Stop clicks inside the panel from closing the modal. */}
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.modalClose} onClick={onClose} aria-label="close">
          ✕
        </button>
        <IpfsImage
          uri={nft.image ?? ''}
          alt={nft.name || `EXEC #${nft.id.toString()}`}
          className={styles.modalArt}
          loading="eager"
          fallback={<div className={styles.modalArtGlyph}>✕</div>}
        />
        <h3 className={styles.modalTitle}>{nft.name || `EXEC #${nft.id.toString()}`}</h3>
        <p className={styles.modalId}>#{nft.id.toString()}</p>
        {nft.description && <p className={styles.modalDesc}>{nft.description}</p>}

        {nft.attributes.length > 0 && (
          <dl className={styles.traits} data-testid="exec404-piece-traits">
            {nft.attributes.map((a, i) => (
              <div key={`${a.trait_type}-${i}`} className={styles.trait}>
                <dt>{a.trait_type || 'trait'}</dt>
                <dd>{a.value}</dd>
              </div>
            ))}
          </dl>
        )}

        <div className={styles.action}>
          <p className={styles.actionTitle}>send this piece</p>
          <input
            className={styles.addrInput}
            type="text"
            placeholder="0x recipient"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            disabled={busy}
            aria-label={`send EXEC #${nft.id.toString()} to`}
          />
          <button
            className="btn btn-primary"
            onClick={handleSend}
            disabled={!toValid || busy}
            data-testid="exec404-nft-send"
          >
            {isPending ? 'confirm in wallet…' : isLoading ? 'sending…' : 'send'}
          </button>
          {reason && <p className={`${styles.note} ${styles.err}`}>send failed: {reason}</p>}
        </div>
      </div>
    </div>
  )
}
