/**
 * AlignmentPanel (W-K2 protocol admin) — owner-only console for the AlignmentRegistry. Gated on
 * `useOwnerGate(forkAddresses.AlignmentRegistryV1).isOwner` (re-asserts the registry's on-chain
 * `owner()`); renders nothing for non-owners.
 *
 * Surfaces the Interface-K alignment actions through the Phase-0 AdminSection / ActionRow + useTxAction
 * + TxButton idiom:
 *   - registerAlignmentTarget(title, description, metadataURI, AlignmentAsset[]) — supports an EMPTY
 *     assets array or a single asset (token/symbol/info/metadataURI).
 *   - updateAlignmentTarget(targetId, description, metadataURI)
 *   - deactivateAlignmentTarget(targetId)
 *   - addAmbassador / removeAmbassador(targetId, address)
 *   - setCommunityPayout(targetId, payout)
 *
 * A single "inspect target" id drives the context reads (getAlignmentTarget / getAmbassadors /
 * getCommunityPayout) so the admin can see current state before mutating it.
 */
import { useState } from 'react'
import {
  alignmentRegistryV1Abi,
  useReadAlignmentRegistryV1GetAlignmentTarget,
  useReadAlignmentRegistryV1GetAmbassadors,
  useReadAlignmentRegistryV1GetCommunityPayout,
} from '../../generated/contracts'
import { AdminSection, ActionRow } from '../ui/AdminSection'
import { TxButton } from '../ui/TxButton'
import { useOwnerGate } from '../ui/useOwnerGate'
import { useTxAction } from '../ui/useTxAction'
import { forkAddresses, forkChainId } from '../../lib/addresses'
import styles from './AlignmentPanel.module.css'

const REGISTRY = forkAddresses.AlignmentRegistryV1
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/

/** Parse a non-negative integer targetId; undefined when blank/invalid. */
function parseTargetId(raw: string): bigint | undefined {
  const t = raw.trim()
  if (!/^\d+$/.test(t)) return undefined
  try {
    return BigInt(t)
  } catch {
    return undefined
  }
}

export function AlignmentPanel() {
  const { isOwner } = useOwnerGate(REGISTRY)
  if (!isOwner) return null

  return (
    <AdminSection title="alignment registry" testId="admin-alignment">
      <RegisterTargetRow />
      <InspectTargetRow />
      <UpdateTargetRow />
      <DeactivateTargetRow />
      <AmbassadorRow />
      <CommunityPayoutRow />
    </AdminSection>
  )
}

// ── registerAlignmentTarget(string,string,string,AlignmentAsset[]) ───────────────

function RegisterTargetRow() {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [metadataURI, setMetadataURI] = useState('')
  const [withAsset, setWithAsset] = useState(false)
  const [assetToken, setAssetToken] = useState('')
  const [assetSymbol, setAssetSymbol] = useState('')
  const [assetInfo, setAssetInfo] = useState('')
  const [assetURI, setAssetURI] = useState('')

  const tx = useTxAction({
    onSuccess: () => {
      setTitle('')
      setDescription('')
      setMetadataURI('')
      setWithAsset(false)
      setAssetToken('')
      setAssetSymbol('')
      setAssetInfo('')
      setAssetURI('')
    },
  })

  const titleTrim = title.trim()
  const tokenTrim = assetToken.trim()
  // The contract reverts InvalidTitle on an empty title. An asset (when included) needs a valid token.
  const assetOk = !withAsset || ADDR_RE.test(tokenTrim)
  const canSubmit = titleTrim !== '' && assetOk

  function handleRegister(): void {
    if (!canSubmit) return
    const assets = withAsset
      ? ([
          {
            token: tokenTrim as `0x${string}`,
            symbol: assetSymbol.trim(),
            info: assetInfo.trim(),
            metadataURI: assetURI.trim(),
          },
        ] as const)
      : ([] as const)
    tx.send({
      address: REGISTRY,
      abi: alignmentRegistryV1Abi,
      functionName: 'registerAlignmentTarget',
      args: [titleTrim, description.trim(), metadataURI.trim(), assets],
      chainId: forkChainId,
    })
  }

  return (
    <ActionRow
      label="register target"
      hint="create an alignment target — assets are optional (leave off for an empty set, or add one)"
    >
      <div className={styles.form}>
        <input
          className={styles.input}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="title (required)"
          disabled={tx.isBusy}
          aria-label="target title"
        />
        <input
          className={styles.input}
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="description"
          disabled={tx.isBusy}
          aria-label="target description"
        />
        <input
          className={styles.input}
          type="text"
          value={metadataURI}
          onChange={(e) => setMetadataURI(e.target.value)}
          placeholder="metadataURI — data: or ipfs://"
          disabled={tx.isBusy}
          aria-label="target metadata URI"
        />
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={withAsset}
            onChange={(e) => setWithAsset(e.target.checked)}
            disabled={tx.isBusy}
            aria-label="include an alignment asset"
          />
          <span>include an asset</span>
        </label>
        {withAsset && (
          <>
            <input
              className={styles.input}
              type="text"
              value={assetToken}
              onChange={(e) => setAssetToken(e.target.value)}
              placeholder="asset token address (0x…)"
              disabled={tx.isBusy}
              aria-label="asset token address"
            />
            <input
              className={styles.input}
              type="text"
              value={assetSymbol}
              onChange={(e) => setAssetSymbol(e.target.value)}
              placeholder="asset symbol"
              disabled={tx.isBusy}
              aria-label="asset symbol"
            />
            <input
              className={styles.input}
              type="text"
              value={assetInfo}
              onChange={(e) => setAssetInfo(e.target.value)}
              placeholder="asset info"
              disabled={tx.isBusy}
              aria-label="asset info"
            />
            <input
              className={styles.input}
              type="text"
              value={assetURI}
              onChange={(e) => setAssetURI(e.target.value)}
              placeholder="asset metadataURI"
              disabled={tx.isBusy}
              aria-label="asset metadata URI"
            />
          </>
        )}
        <TxButton
          state={tx.state}
          onClick={handleRegister}
          label="register target"
          successLabel="target registered — tx confirmed."
          onReset={tx.reset}
          disabled={!canSubmit}
          errorText="register failed — try again"
          testId="admin-register-target"
        />
      </div>
    </ActionRow>
  )
}

// ── inspect (reads): getAlignmentTarget / getAmbassadors / getCommunityPayout ────

function InspectTargetRow() {
  const [raw, setRaw] = useState('')
  const targetId = parseTargetId(raw)
  const enabled = targetId !== undefined

  const { data: target } = useReadAlignmentRegistryV1GetAlignmentTarget({
    address: REGISTRY,
    args: enabled ? [targetId] : undefined,
    chainId: forkChainId,
    query: { enabled },
  })
  const { data: ambassadors } = useReadAlignmentRegistryV1GetAmbassadors({
    address: REGISTRY,
    args: enabled ? [targetId] : undefined,
    chainId: forkChainId,
    query: { enabled },
  })
  const { data: payout } = useReadAlignmentRegistryV1GetCommunityPayout({
    address: REGISTRY,
    args: enabled ? [targetId] : undefined,
    chainId: forkChainId,
    query: { enabled },
  })

  return (
    <ActionRow
      label="inspect target"
      hint="enter a target id to read its current title / status, ambassadors and community payout"
    >
      <div className={styles.form}>
        <input
          className={styles.input}
          type="text"
          inputMode="numeric"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="target id"
          aria-label="inspect target id"
          data-testid="admin-inspect-target"
        />
        {enabled && (
          <dl className={styles.readout} data-testid="admin-inspect-readout">
            <div className={styles.readRow}>
              <dt>title</dt>
              <dd>{target ? target.title || '—' : '…'}</dd>
            </div>
            <div className={styles.readRow}>
              <dt>active</dt>
              <dd>{target ? (target.active ? 'yes' : 'no') : '…'}</dd>
            </div>
            <div className={styles.readRow}>
              <dt>description</dt>
              <dd>{target ? target.description || '—' : '…'}</dd>
            </div>
            <div className={styles.readRow}>
              <dt>metadataURI</dt>
              <dd className={styles.mono}>{target ? target.metadataURI || '—' : '…'}</dd>
            </div>
            <div className={styles.readRow}>
              <dt>ambassadors</dt>
              <dd className={styles.mono}>
                {ambassadors === undefined
                  ? '…'
                  : ambassadors.length === 0
                    ? '—'
                    : ambassadors.join(', ')}
              </dd>
            </div>
            <div className={styles.readRow}>
              <dt>community payout</dt>
              <dd className={styles.mono}>{payout ?? '…'}</dd>
            </div>
          </dl>
        )}
      </div>
    </ActionRow>
  )
}

// ── updateAlignmentTarget(uint256,string,string) ────────────────────────────────

function UpdateTargetRow() {
  const [raw, setRaw] = useState('')
  const [description, setDescription] = useState('')
  const [metadataURI, setMetadataURI] = useState('')
  const tx = useTxAction({
    onSuccess: () => {
      setDescription('')
      setMetadataURI('')
    },
  })
  const targetId = parseTargetId(raw)
  const canSubmit = targetId !== undefined

  return (
    <ActionRow label="update target" hint="overwrite a target's description and metadataURI">
      <div className={styles.form}>
        <input
          className={styles.input}
          type="text"
          inputMode="numeric"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="target id"
          disabled={tx.isBusy}
          aria-label="update target id"
        />
        <input
          className={styles.input}
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="new description"
          disabled={tx.isBusy}
          aria-label="updated description"
        />
        <input
          className={styles.input}
          type="text"
          value={metadataURI}
          onChange={(e) => setMetadataURI(e.target.value)}
          placeholder="new metadataURI"
          disabled={tx.isBusy}
          aria-label="updated metadata URI"
        />
        <TxButton
          state={tx.state}
          onClick={() => {
            if (targetId === undefined) return
            tx.send({
              address: REGISTRY,
              abi: alignmentRegistryV1Abi,
              functionName: 'updateAlignmentTarget',
              args: [targetId, description.trim(), metadataURI.trim()],
              chainId: forkChainId,
            })
          }}
          label="update target"
          className="btn btn-secondary"
          successLabel="target updated — tx confirmed."
          onReset={tx.reset}
          disabled={!canSubmit}
          errorText="update failed — try again"
          testId="admin-update-target"
        />
      </div>
    </ActionRow>
  )
}

// ── deactivateAlignmentTarget(uint256) ──────────────────────────────────────────

function DeactivateTargetRow() {
  const [raw, setRaw] = useState('')
  const tx = useTxAction({ onSuccess: () => setRaw('') })
  const targetId = parseTargetId(raw)
  const canSubmit = targetId !== undefined

  return (
    <ActionRow label="deactivate target" hint="mark a target inactive (irreversible from here)">
      <div className={styles.form}>
        <input
          className={styles.input}
          type="text"
          inputMode="numeric"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="target id"
          disabled={tx.isBusy}
          aria-label="deactivate target id"
        />
        <TxButton
          state={tx.state}
          onClick={() => {
            if (targetId === undefined) return
            tx.send({
              address: REGISTRY,
              abi: alignmentRegistryV1Abi,
              functionName: 'deactivateAlignmentTarget',
              args: [targetId],
              chainId: forkChainId,
            })
          }}
          label="deactivate target"
          className="btn btn-secondary"
          successLabel="target deactivated — tx confirmed."
          onReset={tx.reset}
          disabled={!canSubmit}
          errorText="deactivate failed — try again"
          testId="admin-deactivate-target"
        />
      </div>
    </ActionRow>
  )
}

// ── addAmbassador / removeAmbassador(uint256,address) ───────────────────────────

function AmbassadorRow() {
  const [raw, setRaw] = useState('')
  const [account, setAccount] = useState('')
  const addTx = useTxAction()
  const removeTx = useTxAction()

  const targetId = parseTargetId(raw)
  const accountTrim = account.trim()
  const ok = targetId !== undefined && ADDR_RE.test(accountTrim)

  function send(
    tx: ReturnType<typeof useTxAction>,
    fn: 'addAmbassador' | 'removeAmbassador',
  ): void {
    if (!ok || targetId === undefined) return
    tx.send({
      address: REGISTRY,
      abi: alignmentRegistryV1Abi,
      functionName: fn,
      args: [targetId, accountTrim as `0x${string}`],
      chainId: forkChainId,
    })
  }

  return (
    <ActionRow label="ambassadors" hint="add or remove an ambassador address for a target">
      <div className={styles.form}>
        <input
          className={styles.input}
          type="text"
          inputMode="numeric"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="target id"
          disabled={addTx.isBusy || removeTx.isBusy}
          aria-label="ambassador target id"
        />
        <input
          className={styles.input}
          type="text"
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          placeholder="ambassador address (0x…)"
          disabled={addTx.isBusy || removeTx.isBusy}
          aria-label="ambassador address"
        />
        <div className={styles.btnRow}>
          <TxButton
            state={addTx.state}
            onClick={() => send(addTx, 'addAmbassador')}
            label="add ambassador"
            className="btn btn-secondary"
            successLabel="ambassador added — tx confirmed."
            onReset={addTx.reset}
            disabled={!ok}
            errorText="add failed — try again"
            testId="admin-add-ambassador"
          />
          <TxButton
            state={removeTx.state}
            onClick={() => send(removeTx, 'removeAmbassador')}
            label="remove ambassador"
            className="btn btn-secondary"
            successLabel="ambassador removed — tx confirmed."
            onReset={removeTx.reset}
            disabled={!ok}
            errorText="remove failed — try again"
            testId="admin-remove-ambassador"
          />
        </div>
      </div>
    </ActionRow>
  )
}

// ── setCommunityPayout(uint256,address) ─────────────────────────────────────────

function CommunityPayoutRow() {
  const [raw, setRaw] = useState('')
  const [payout, setPayout] = useState('')
  const tx = useTxAction({ onSuccess: () => setPayout('') })

  const targetId = parseTargetId(raw)
  const payoutTrim = payout.trim()
  const ok = targetId !== undefined && ADDR_RE.test(payoutTrim)

  return (
    <ActionRow
      label="community payout"
      hint="set the payout address for a target's community share"
    >
      <div className={styles.form}>
        <input
          className={styles.input}
          type="text"
          inputMode="numeric"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="target id"
          disabled={tx.isBusy}
          aria-label="payout target id"
        />
        <input
          className={styles.input}
          type="text"
          value={payout}
          onChange={(e) => setPayout(e.target.value)}
          placeholder="payout address (0x…)"
          disabled={tx.isBusy}
          aria-label="community payout address"
        />
        <TxButton
          state={tx.state}
          onClick={() => {
            if (!ok || targetId === undefined) return
            tx.send({
              address: REGISTRY,
              abi: alignmentRegistryV1Abi,
              functionName: 'setCommunityPayout',
              args: [targetId, payoutTrim as `0x${string}`],
              chainId: forkChainId,
            })
          }}
          label="set payout"
          className="btn btn-secondary"
          successLabel="payout set — tx confirmed."
          onReset={tx.reset}
          disabled={!ok}
          errorText="set payout failed — try again"
          testId="admin-set-payout"
        />
      </div>
    </ActionRow>
  )
}
