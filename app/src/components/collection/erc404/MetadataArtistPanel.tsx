/**
 * MetadataArtistPanel (noesis-010) — post-create artist actions for the `MetadataOverlayModule`
 * wired to an ERC404 instance (ADR-0006/0007): publish an event wave, set a holder's commission, and
 * toggle collection-wide auto-latest. Renders nothing when the instance has no overlay module wired
 * (`useOverlayModule`), mirroring `ConfigureGatingRow`'s self-hiding shape.
 *
 * Built on the Phase-0 admin primitives (AdminSection/ActionRow + useTxAction/TxButton) so it looks
 * and behaves exactly like every other creator-admin surface. Meant to be mounted inside
 * `Erc404AdminPanel`, which already gates on `useOwnerGate(instance).isOwner` — the on-chain
 * `NotInstanceOwner` check is the actual enforcement either way.
 */
import { useState } from 'react'
import {
  metadataOverlayModuleAbi,
  useReadMetadataOverlayModuleAutoLatest,
  useReadMetadataOverlayModuleWaveCount,
} from '../../../generated/contracts'
import { forkChainId } from '../../../lib/addresses'
import { parseAmount } from '../../ui/parseAmount'
import { AmountField } from '../../ui/AmountField'
import { ActionRow } from '../../ui/AdminSection'
import { TxButton } from '../../ui/TxButton'
import { useTxAction } from '../../ui/useTxAction'
import { useOverlayModule } from './useOverlayModule'
import styles from './MetadataArtistPanel.module.css'

// Enum literals mirror MetadataOverlayModule.sol (WaveCond/CommCond/Payout) and the wizard's
// metadataConfig.ts encoding — kept local since these three rows are the only writers of them.
const WAVE_COND = { NONE: 0, STAKE: 1, PAY: 2 } as const
const COMM_COND = { NONE: 0, PAY: 1 } as const
const PAYOUT = { ARTIST: 0, SPLIT: 1 } as const

export function MetadataArtistPanel({ instance }: { instance: `0x${string}` }) {
  const { overlay, isPending } = useOverlayModule(instance)
  if (isPending || !overlay) return null

  return (
    <>
      <PublishWaveRow instance={instance} overlay={overlay} />
      <SetCommissionRow instance={instance} overlay={overlay} />
      <SetAutoLatestRow instance={instance} overlay={overlay} />
    </>
  )
}

// ── publish wave ─────────────────────────────────────────────────────────────

function PublishWaveRow({
  instance,
  overlay,
}: {
  instance: `0x${string}`
  overlay: `0x${string}`
}) {
  const { data: waveCount, refetch } = useReadMetadataOverlayModuleWaveCount({
    address: overlay,
    chainId: forkChainId,
    args: [instance],
  })

  const [baseURI, setBaseURI] = useState('')
  const [cond, setCond] = useState<number>(WAVE_COND.NONE)
  const [threshold, setThreshold] = useState('')
  const [price, setPrice] = useState('')
  const [payout, setPayout] = useState<number>(PAYOUT.ARTIST)

  const tx = useTxAction({ onSuccess: () => void refetch() })

  const parsedPrice = cond === WAVE_COND.PAY ? parseAmount(price) : 0n
  const trimmedThreshold = threshold.trim()
  const parsedThreshold =
    cond === WAVE_COND.STAKE && /^\d+$/.test(trimmedThreshold) ? BigInt(trimmedThreshold) : 0n
  const canSubmit =
    baseURI.trim() !== '' &&
    !tx.isBusy &&
    (cond !== WAVE_COND.PAY || (parsedPrice !== undefined && parsedPrice > 0n)) &&
    (cond !== WAVE_COND.STAKE || /^\d+$/.test(trimmedThreshold))

  function handleReset(): void {
    tx.reset()
    setBaseURI('')
    setCond(WAVE_COND.NONE)
    setThreshold('')
    setPrice('')
    setPayout(PAYOUT.ARTIST)
    void refetch()
  }

  return (
    <ActionRow
      label="publish wave"
      hint={`${waveCount ?? '…'} wave${waveCount === 1n ? '' : 's'} published — waves are append-only`}
    >
      <div className={styles.form}>
        {tx.state !== 'success' && (
          <>
            <input
              className={styles.input}
              type="text"
              value={baseURI}
              onChange={(e) => setBaseURI(e.target.value)}
              placeholder="wave base uri (ipfs://, ar://, https://, data:)"
              disabled={tx.isBusy}
              aria-label="wave base uri"
              data-testid="metadata-artist-wave-uri"
            />
            <select
              className={styles.select}
              value={cond}
              onChange={(e) => setCond(Number(e.target.value))}
              disabled={tx.isBusy}
              aria-label="wave eligibility condition"
              data-testid="metadata-artist-wave-cond"
            >
              <option value={WAVE_COND.NONE}>open to all holders</option>
              <option value={WAVE_COND.STAKE}>staked ≥ threshold</option>
              <option value={WAVE_COND.PAY}>pay to unlock</option>
            </select>
            {cond === WAVE_COND.STAKE && (
              <input
                className={styles.input}
                type="number"
                min={0}
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                placeholder="stake threshold"
                disabled={tx.isBusy}
                aria-label="stake threshold"
                data-testid="metadata-artist-wave-threshold"
              />
            )}
            {cond === WAVE_COND.PAY && (
              <>
                <AmountField
                  value={price}
                  onChange={setPrice}
                  placeholder="price"
                  disabled={tx.isBusy}
                  unit="ETH"
                  ariaLabel="wave price in ETH"
                  testId="metadata-artist-wave-price"
                />
                <select
                  className={styles.select}
                  value={payout}
                  onChange={(e) => setPayout(Number(e.target.value))}
                  disabled={tx.isBusy}
                  aria-label="wave payout routing"
                  data-testid="metadata-artist-wave-payout"
                >
                  <option value={PAYOUT.ARTIST}>payout: artist</option>
                  <option value={PAYOUT.SPLIT}>payout: split (vault/protocol/artist)</option>
                </select>
              </>
            )}
          </>
        )}
        <TxButton
          state={tx.state}
          onClick={() => {
            if (!canSubmit) return
            tx.send({
              address: overlay,
              abi: metadataOverlayModuleAbi,
              functionName: 'publishWave',
              args: [
                instance,
                baseURI.trim(),
                cond,
                cond === WAVE_COND.STAKE ? parsedThreshold : 0n,
                cond === WAVE_COND.PAY ? (parsedPrice ?? 0n) : 0n,
                payout,
              ],
              chainId: forkChainId,
            })
          }}
          label="publish wave"
          successLabel="wave published — tx confirmed."
          onReset={handleReset}
          disabled={!canSubmit}
          className="btn btn-primary"
          errorText="publish failed — try again"
          testId="metadata-artist-publish-wave"
        />
      </div>
    </ActionRow>
  )
}

// ── set commission (per token id) ───────────────────────────────────────────

function SetCommissionRow({
  instance,
  overlay,
}: {
  instance: `0x${string}`
  overlay: `0x${string}`
}) {
  const [id, setId] = useState('')
  const [uri, setUri] = useState('')
  const [cond, setCond] = useState<number>(COMM_COND.NONE)
  const [price, setPrice] = useState('')
  const [payout, setPayout] = useState<number>(PAYOUT.ARTIST)
  const tx = useTxAction()

  const parsedId = id.trim() !== '' && /^\d+$/.test(id.trim()) ? BigInt(id.trim()) : undefined
  const parsedPrice = cond === COMM_COND.PAY ? parseAmount(price) : 0n
  const canSubmit =
    parsedId !== undefined &&
    uri.trim() !== '' &&
    !tx.isBusy &&
    (cond !== COMM_COND.PAY || (parsedPrice !== undefined && parsedPrice > 0n))

  function handleReset(): void {
    tx.reset()
    setId('')
    setUri('')
    setCond(COMM_COND.NONE)
    setPrice('')
    setPayout(PAYOUT.ARTIST)
  }

  return (
    <ActionRow
      label="set commission"
      hint="publish a bespoke augmentation for one token id — locks once paid"
    >
      <div className={styles.form}>
        {tx.state !== 'success' && (
          <>
            <input
              className={styles.input}
              type="number"
              min={0}
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="token id"
              disabled={tx.isBusy}
              aria-label="token id"
              data-testid="metadata-artist-commission-id"
            />
            <input
              className={styles.input}
              type="text"
              value={uri}
              onChange={(e) => setUri(e.target.value)}
              placeholder="commission uri"
              disabled={tx.isBusy}
              aria-label="commission uri"
              data-testid="metadata-artist-commission-uri"
            />
            <select
              className={styles.select}
              value={cond}
              onChange={(e) => setCond(Number(e.target.value))}
              disabled={tx.isBusy}
              aria-label="commission condition"
              data-testid="metadata-artist-commission-cond"
            >
              <option value={COMM_COND.NONE}>free (by request)</option>
              <option value={COMM_COND.PAY}>pay to unlock</option>
            </select>
            {cond === COMM_COND.PAY && (
              <>
                <AmountField
                  value={price}
                  onChange={setPrice}
                  placeholder="price"
                  disabled={tx.isBusy}
                  unit="ETH"
                  ariaLabel="commission price in ETH"
                  testId="metadata-artist-commission-price"
                />
                <select
                  className={styles.select}
                  value={payout}
                  onChange={(e) => setPayout(Number(e.target.value))}
                  disabled={tx.isBusy}
                  aria-label="commission payout routing"
                  data-testid="metadata-artist-commission-payout"
                >
                  <option value={PAYOUT.ARTIST}>payout: artist</option>
                  <option value={PAYOUT.SPLIT}>payout: split (vault/protocol/artist)</option>
                </select>
              </>
            )}
          </>
        )}
        <TxButton
          state={tx.state}
          onClick={() => {
            if (!canSubmit || parsedId === undefined) return
            tx.send({
              address: overlay,
              abi: metadataOverlayModuleAbi,
              functionName: 'setCommission',
              args: [
                instance,
                parsedId,
                uri.trim(),
                cond,
                cond === COMM_COND.PAY ? (parsedPrice ?? 0n) : 0n,
                payout,
              ],
              chainId: forkChainId,
            })
          }}
          label="set commission"
          successLabel="commission set — tx confirmed."
          onReset={handleReset}
          disabled={!canSubmit}
          className="btn btn-primary"
          errorText="set commission failed — try again"
          testId="metadata-artist-set-commission"
        />
      </div>
    </ActionRow>
  )
}

// ── auto-latest toggle ───────────────────────────────────────────────────────

function SetAutoLatestRow({
  instance,
  overlay,
}: {
  instance: `0x${string}`
  overlay: `0x${string}`
}) {
  const { data: autoLatest, refetch } = useReadMetadataOverlayModuleAutoLatest({
    address: overlay,
    chainId: forkChainId,
    args: [instance],
  })
  const tx = useTxAction({ onSuccess: () => void refetch() })
  const next = !autoLatest

  return (
    <ActionRow
      label="auto-latest"
      hint={
        autoLatest === undefined
          ? 'staked holders auto-see the newest eligible wave · current: …'
          : `staked holders auto-see the newest eligible wave · current: ${autoLatest ? 'on' : 'off'}`
      }
    >
      <TxButton
        state={tx.state}
        onClick={() =>
          tx.send({
            address: overlay,
            abi: metadataOverlayModuleAbi,
            functionName: 'setAutoLatest',
            args: [instance, next],
            chainId: forkChainId,
          })
        }
        label={next ? 'enable auto-latest' : 'disable auto-latest'}
        successLabel="policy updated"
        onReset={tx.reset}
        disabled={autoLatest === undefined}
        className="btn btn-secondary"
        testId="metadata-artist-auto-latest"
      />
    </ActionRow>
  )
}
