/**
 * MetadataHolderPanel (noesis-010) — the holder-side controls for a token whose collection has a
 * `MetadataOverlayModule` wired (ADR-0006/0007): unlock a pay-gated commission/wave, and pin the
 * displayed version (AUTO / BASE / COMMISSION / a specific wave). Mounted on `TokenDetailPage` for
 * ERC404 tokens; only rendered for the connected wallet that owns this token id (the on-chain
 * `NotHolder` check is the actual enforcement either way — this is UX, not the gate).
 *
 * Renders nothing when the collection has no overlay module wired (`useOverlayModule`).
 */
import { formatEther } from 'viem'
import { metadataOverlayModuleAbi } from '../../../generated/contracts'
import { forkChainId } from '../../../lib/addresses'
import { AdminSection, ActionRow } from '../../ui/AdminSection'
import { TxButton } from '../../ui/TxButton'
import { useTxAction } from '../../ui/useTxAction'
import { useOverlayModule } from './useOverlayModule'
import {
  useOverlayHolderState,
  SEL_AUTO,
  SEL_BASE,
  SEL_COMMISSION,
  WAVE_OFFSET,
  type OverlayHolderState,
  type OverlayWaveView,
} from './useOverlayHolderState'
import styles from './MetadataHolderPanel.module.css'

const WAVE_COND_LABEL = ['open to all', 'staked ≥ threshold', 'pay to unlock'] as const
const COMM_COND_LABEL = ['free', 'pay to unlock'] as const

function selectionLabel(selection: bigint): string {
  if (selection === SEL_AUTO) return 'AUTO (newest eligible wave)'
  if (selection === SEL_BASE) return 'BASE (original — no augmentation)'
  if (selection === SEL_COMMISSION) return 'COMMISSION (your bespoke piece)'
  return `WAVE #${(selection - WAVE_OFFSET).toString()}`
}

export function MetadataHolderPanel({
  instance,
  id,
  holder,
}: {
  instance: `0x${string}`
  id: bigint
  holder: `0x${string}`
}) {
  const { overlay, isPending: overlayPending } = useOverlayModule(instance)
  const {
    data: state,
    refetch,
    isPending: statePending,
  } = useOverlayHolderState(overlay, instance, id, holder)

  if (overlayPending || !overlay) return null
  if (statePending || !state) {
    return (
      <AdminSection title="metadata" testId="metadata-holder-panel">
        <p className={styles.loading}>loading metadata state…</p>
      </AdminSection>
    )
  }

  return (
    <AdminSection title="metadata" testId="metadata-holder-panel">
      <ActionRow label="current version" hint="the version this token currently resolves to">
        <span className={styles.readout}>{selectionLabel(state.selection)}</span>
      </ActionRow>

      {state.commissionURI !== '' && (
        <CommissionRow
          instance={instance}
          id={id}
          overlay={overlay}
          state={state}
          onDone={refetch}
        />
      )}

      {state.waves.map((wave) => (
        <WaveRow
          key={wave.index}
          instance={instance}
          id={id}
          overlay={overlay}
          wave={wave}
          currentSelection={state.selection}
          onDone={refetch}
        />
      ))}

      <PinRow
        instance={instance}
        id={id}
        overlay={overlay}
        currentSelection={state.selection}
        onDone={refetch}
      />
    </AdminSection>
  )
}

// ── commission ───────────────────────────────────────────────────────────────

function CommissionRow({
  instance,
  id,
  overlay,
  state,
  onDone,
}: {
  instance: `0x${string}`
  id: bigint
  overlay: `0x${string}`
  state: OverlayHolderState
  onDone: () => void
}) {
  const tx = useTxAction({ onSuccess: onDone })
  const needsPay = state.commissionCond === 1 && !state.commissionPaid

  return (
    <ActionRow
      label="commission"
      hint={`${COMM_COND_LABEL[state.commissionCond] ?? 'unknown'}${
        state.commissionCond === 1 ? ` · ${formatEther(state.commissionPrice)} ETH` : ''
      }${!state.commissionVisible ? ' · not yet visible' : ''}`}
    >
      {needsPay ? (
        <TxButton
          state={tx.state}
          onClick={() =>
            tx.send({
              address: overlay,
              abi: metadataOverlayModuleAbi,
              functionName: 'unlock',
              args: [instance, id],
              value: state.commissionPrice,
              chainId: forkChainId,
            })
          }
          label={`unlock for ${formatEther(state.commissionPrice)} ETH`}
          successLabel="commission unlocked — tx confirmed."
          onReset={tx.reset}
          className="btn btn-primary"
          errorText="unlock failed — try again"
          testId="metadata-holder-unlock-commission"
        />
      ) : (
        <span className={styles.readout}>{state.commissionPaid ? 'unlocked' : 'available'}</span>
      )}
    </ActionRow>
  )
}

// ── one wave row ─────────────────────────────────────────────────────────────

function WaveRow({
  instance,
  id,
  overlay,
  wave,
  currentSelection,
  onDone,
}: {
  instance: `0x${string}`
  id: bigint
  overlay: `0x${string}`
  wave: OverlayWaveView
  currentSelection: bigint
  onDone: () => void
}) {
  const tx = useTxAction({ onSuccess: onDone })
  const needsPay = wave.cond === 2 && !wave.paid
  const ptr = WAVE_OFFSET + BigInt(wave.index)
  const isPinned = currentSelection === ptr

  return (
    <ActionRow
      label={`wave #${wave.index}`}
      hint={`${WAVE_COND_LABEL[wave.cond] ?? 'unknown'}${
        wave.cond === 1 ? ` (≥ ${wave.threshold.toString()})` : ''
      }${wave.cond === 2 ? ` · ${formatEther(wave.price)} ETH` : ''}${
        wave.eligible ? '' : ' · not yet eligible'
      }${isPinned ? ' · pinned' : ''}`}
    >
      {needsPay && (
        <TxButton
          state={tx.state}
          onClick={() =>
            tx.send({
              address: overlay,
              abi: metadataOverlayModuleAbi,
              functionName: 'unlockWave',
              args: [instance, id, BigInt(wave.index)],
              value: wave.price,
              chainId: forkChainId,
            })
          }
          label={`unlock for ${formatEther(wave.price)} ETH`}
          successLabel="wave unlocked — tx confirmed."
          onReset={tx.reset}
          className="btn btn-primary"
          errorText="unlock failed — try again"
          testId={`metadata-holder-unlock-wave-${wave.index}`}
        />
      )}
    </ActionRow>
  )
}

// ── pin selection ────────────────────────────────────────────────────────────

function PinRow({
  instance,
  id,
  overlay,
  currentSelection,
  onDone,
}: {
  instance: `0x${string}`
  id: bigint
  overlay: `0x${string}`
  currentSelection: bigint
  onDone: () => void
}) {
  const tx = useTxAction({ onSuccess: onDone })

  function pin(ptr: bigint): void {
    if (ptr === currentSelection) return
    tx.send({
      address: overlay,
      abi: metadataOverlayModuleAbi,
      functionName: 'select',
      args: [instance, id, ptr],
      chainId: forkChainId,
    })
  }

  return (
    <ActionRow label="pin version" hint="switch which version this token displays">
      <div className={styles.pins}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => pin(SEL_AUTO)}
          disabled={tx.isBusy || currentSelection === SEL_AUTO}
          data-testid="metadata-holder-pin-auto"
        >
          auto
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => pin(SEL_BASE)}
          disabled={tx.isBusy || currentSelection === SEL_BASE}
          data-testid="metadata-holder-pin-base"
        >
          base (original)
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => pin(SEL_COMMISSION)}
          disabled={tx.isBusy || currentSelection === SEL_COMMISSION}
          data-testid="metadata-holder-pin-commission"
        >
          commission
        </button>
      </div>
      {tx.state === 'error' && <p className={styles.error}>pin failed — try again</p>}
    </ActionRow>
  )
}
