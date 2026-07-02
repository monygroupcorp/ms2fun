/**
 * Exec404Portfolio (N1/N3) — the connected wallet's position in the EXEC404 fossil: fungible EXEC
 * balance, DN404 NFT count + a gallery of the held pieces (enumerated from the mirror's Transfer log),
 * and the three holder actions:
 *   send EXEC  → base.transfer(to, amount)                     (fungible ERC-20 send)
 *   reroll     → base.transfer(self, balanceOf(self))          (DN404 self-send re-shuffles NFT ids)
 *   send piece → mirror.transferFrom(self, to, id)             (move one NFT)
 * Balances/holdings refetch after every confirmed action so the panel stays live.
 */
import { useEffect, useState } from 'react'
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
import { resolveUri } from '../../lib/metadata'
import { AmountField } from '../ui/AmountField'
import { parseAmount } from '../ui/parseAmount'
import { txErrorReason } from '../ui/useTxAction'
import { useExec404Nfts } from './useExec404Nfts'
import styles from './Exec404Portfolio.module.css'

export function Exec404Portfolio() {
  const { address, isConnected } = useAccount()

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
  const { nfts, isPending: nftsPending, refetch: refetchNfts } = useExec404Nfts(address)

  const balance = balanceRead.data ?? 0n
  const nftCount = nftCountRead.data ?? 0n

  function refetchAll(): void {
    void balanceRead.refetch()
    void nftCountRead.refetch()
    refetchNfts()
  }

  if (!isConnected) {
    return (
      <section className={styles.card} data-testid="exec404-portfolio">
        <h2 className={styles.title}>Your position</h2>
        <p className={styles.note}>connect wallet to see your EXEC balance and pieces.</p>
      </section>
    )
  }

  return (
    <section className={styles.card} data-testid="exec404-portfolio">
      <h2 className={styles.title}>Your position</h2>

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

      <BalanceMint balance={balance} onDone={refetchAll} />
      <RerollButton owner={address} balance={balance} onDone={refetchAll} />
      <SendExec balance={balance} onDone={refetchAll} />

      <div className={styles.pieces}>
        <p className={styles.piecesHead}>Pieces</p>
        {nftsPending ? (
          <p className={styles.note}>loading pieces…</p>
        ) : nfts.length === 0 ? (
          <p className={styles.note} data-testid="exec404-portfolio-empty">
            no EXEC NFTs held. Buy ≥ 1 whole EXEC (with skip-NFT off) to mint pieces.
          </p>
        ) : (
          <ul className={styles.grid} data-testid="exec404-portfolio-nfts">
            {nfts.map((nft) => (
              <NftCard key={nft.id.toString()} owner={address} nft={nft} onDone={refetchAll} />
            ))}
          </ul>
        )}
      </div>
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
        materialize NFTs you already hold as EXEC · up to {maxMintable.toString()} from this balance.
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
      <span className={styles.hint}>self-sends your balance — re-shuffles which NFT ids you hold.</span>
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
  const canSend =
    toValid && amountWei !== undefined && amountWei > 0n && !overBalance && !busy

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

function NftCard({
  owner,
  nft,
  onDone,
}: {
  owner: `0x${string}`
  nft: { id: bigint; image: string | undefined }
  onDone: () => void
}) {
  const [to, setTo] = useState('')
  const [open, setOpen] = useState(false)
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract()
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

  useEffect(() => {
    if (!isSuccess) return
    reset()
    setTo('')
    setOpen(false)
    onDone()
  }, [isSuccess, reset, onDone])

  return (
    <li className={styles.tile}>
      {nft.image ? (
        <img src={resolveUri(nft.image)} alt={`EXEC #${nft.id.toString()}`} className={styles.thumb} />
      ) : (
        <div className={styles.thumbGlyph}>✕</div>
      )}
      <span className={styles.tileId}>#{nft.id.toString()}</span>
      {open ? (
        <div className={styles.tileSend}>
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
            {isPending ? 'confirm…' : isLoading ? 'sending…' : 'send'}
          </button>
          {reason && <p className={`${styles.note} ${styles.err}`}>{reason}</p>}
        </div>
      ) : (
        <button className={styles.tileSendToggle} onClick={() => setOpen(true)}>
          send
        </button>
      )}
    </li>
  )
}
