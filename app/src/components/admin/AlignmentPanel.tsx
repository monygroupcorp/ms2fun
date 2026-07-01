/**
 * AlignmentPanel (W-K2 protocol admin) — owner-only console for the AlignmentRegistry. Gated on
 * `useOwnerGate(forkAddresses.AlignmentRegistryV1).isOwner` (re-asserts the registry's on-chain
 * `owner()`); renders nothing for non-owners.
 *
 * Surfaces the Interface-K alignment actions through the Phase-0 AdminSection / ActionRow + useTxAction
 * + TxButton idiom:
 *   - registerAlignmentTarget(title, description, metadataURI, AlignmentAsset[]) — requires a title and
 *     ≥1 asset (token/symbol/info/metadataURI); the contract reverts NoAssets on an empty asset array.
 *   - updateAlignmentTarget(targetId, description, metadataURI)
 *   - deactivateAlignmentTarget(targetId)
 *   - addAmbassador / removeAmbassador(targetId, address)
 *   - setCommunityPayout(targetId, payout)
 *
 * A single "inspect target" id drives the context reads (getAlignmentTarget / getAmbassadors /
 * getCommunityPayout) so the admin can see current state before mutating it.
 */
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { formatEther } from 'viem'
import {
  alignmentRegistryV1Abi,
  alignmentTargetRequestRegistryAbi,
  useReadAlignmentRegistryV1GetAlignmentTarget,
  useReadAlignmentRegistryV1GetAmbassadors,
  useReadAlignmentRegistryV1GetCommunityPayout,
  useReadAlignmentTargetRequestRegistryGetPending,
} from '../../generated/contracts'
import { AdminSection, ActionRow } from '../ui/AdminSection'
import { StateBlock } from '../ui/StateBlock'
import { TxButton } from '../ui/TxButton'
import { useOwnerGate } from '../ui/useOwnerGate'
import { useTxAction } from '../ui/useTxAction'
import { forkAddresses, forkChainId } from '../../lib/addresses'
import { requestStatusLabel } from '../../lib/targetRequests'
import { truncateAddress } from '../../lib/format'
import styles from './AlignmentPanel.module.css'

const REGISTRY = forkAddresses.AlignmentRegistryV1
const REQUEST_REGISTRY = forkAddresses.AlignmentTargetRequestRegistry
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
  const [assetToken, setAssetToken] = useState('')
  const [assetSymbol, setAssetSymbol] = useState('')
  const [assetInfo, setAssetInfo] = useState('')
  const [assetURI, setAssetURI] = useState('')

  const tx = useTxAction({
    onSuccess: () => {
      setTitle('')
      setDescription('')
      setMetadataURI('')
      setAssetToken('')
      setAssetSymbol('')
      setAssetInfo('')
      setAssetURI('')
    },
  })

  const titleTrim = title.trim()
  const tokenTrim = assetToken.trim()
  // The contract reverts InvalidTitle on an empty title and NoAssets on an empty asset array — so at
  // least one asset (with a valid nonzero token) is REQUIRED, not optional.
  const assetOk = ADDR_RE.test(tokenTrim)
  const canSubmit = titleTrim !== '' && assetOk

  function handleRegister(): void {
    if (!canSubmit) return
    const assets = [
      {
        token: tokenTrim as `0x${string}`,
        symbol: assetSymbol.trim(),
        info: assetInfo.trim(),
        metadataURI: assetURI.trim(),
      },
    ] as const
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
      hint="create an alignment target — a title and at least one asset (with a nonzero token) are required"
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
        <input
          className={styles.input}
          type="text"
          value={assetToken}
          onChange={(e) => setAssetToken(e.target.value)}
          placeholder="asset token address (0x…, required)"
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

// ── target requests (AlignmentTargetRequestRegistry review console) ─────────────

interface PendingAsset {
  token: `0x${string}`
  symbol: string
  info: string
  metadataURI: string
}

interface PendingRequest {
  id: bigint
  requester: `0x${string}`
  token: `0x${string}`
  title: string
  description: string
  metadataURI: string
  deposit: bigint
  status: number
  assets: PendingAsset[]
}

/**
 * Read the request registry's current pending set (`getPending()`), then one multicall over
 * `getRequest(id)` + `getRequestAssets(id)` per id — mirrors useRegisteredVaults. Keyed on the id list
 * so an approve/reject (which delists) refetches once the pending read updates.
 */
function usePendingRequests(): {
  data: PendingRequest[] | undefined
  isPending: boolean
  isError: boolean
  refetch: () => void
} {
  const client = usePublicClient({ chainId: forkChainId })
  const queryClient = useQueryClient()
  const { data: pendingIds, refetch: refetchPending } =
    useReadAlignmentTargetRequestRegistryGetPending({
      address: REQUEST_REGISTRY,
      chainId: forkChainId,
    })
  const ids = pendingIds ?? []
  const key = ids.map(String)

  const { data, isPending, isError } = useQuery({
    queryKey: ['pending-target-requests', key],
    enabled: !!client && pendingIds !== undefined,
    staleTime: 15_000,
    queryFn: async (): Promise<PendingRequest[]> => {
      if (!client || ids.length === 0) return []
      const results = await client.multicall({
        allowFailure: true,
        contracts: ids.flatMap((id) => [
          {
            address: REQUEST_REGISTRY,
            abi: alignmentTargetRequestRegistryAbi,
            functionName: 'getRequest',
            args: [id],
          } as const,
          {
            address: REQUEST_REGISTRY,
            abi: alignmentTargetRequestRegistryAbi,
            functionName: 'getRequestAssets',
            args: [id],
          } as const,
        ]),
      })
      const out: PendingRequest[] = []
      ids.forEach((id, i) => {
        const reqR = results[i * 2]
        const assetsR = results[i * 2 + 1]
        if (!reqR || reqR.status !== 'success') return
        // multicall infers a union of the two return shapes per index — narrow to the Request struct.
        const r = reqR.result as {
          requester: `0x${string}`
          token: `0x${string}`
          title: string
          description: string
          metadataURI: string
          deposit: bigint
          submittedAt: number
          status: number
        }
        const assets =
          assetsR?.status === 'success' ? (assetsR.result as readonly PendingAsset[]) : []
        out.push({
          id,
          requester: r.requester,
          token: r.token,
          title: r.title,
          description: r.description,
          metadataURI: r.metadataURI,
          deposit: r.deposit,
          status: r.status,
          assets: assets.map((a) => ({ ...a })),
        })
      })
      return out
    },
  })

  const refetch = () => {
    // Refetch the pending-id set first (approve/reject delists on-chain), then the per-id detail query.
    void refetchPending()
    void queryClient.invalidateQueries({ queryKey: ['pending-target-requests'] })
  }

  return { data, isPending, isError, refetch }
}

/**
 * TargetRequestsPanel — the admin review console for AlignmentTargetRequestRegistry. Self-gated on the
 * request registry's own `owner()` (distinct from AlignmentRegistryV1's owner) so it renders whenever
 * the connected wallet owns the request contract. Lists each pending request with the two D7 admin txs:
 * (1) register the target on AlignmentRegistryV1 from the proposed data, then (2) approve the request
 * (refunds the requester's deposit + delists) — plus a reject control with a forfeit toggle.
 */
export function TargetRequestsPanel() {
  const { isOwner } = useOwnerGate(REQUEST_REGISTRY)
  const { data, isPending, isError, refetch } = usePendingRequests()
  if (!isOwner) return null

  return (
    <AdminSection title="target requests" testId="admin-target-requests">
      {isPending && <StateBlock variant="loading">loading pending requests…</StateBlock>}
      {isError && (
        <StateBlock variant="error">couldn&apos;t load requests — is the fork up?</StateBlock>
      )}
      {!isPending && !isError && (data === undefined || data.length === 0) && (
        <StateBlock variant="empty" boxed testId="admin-target-requests-empty">
          no pending requests — the intake queue is clear.
        </StateBlock>
      )}
      {data?.map((req) => (
        <PendingRequestRow key={String(req.id)} req={req} onChanged={refetch} />
      ))}
    </AdminSection>
  )
}

function PendingRequestRow({ req, onChanged }: { req: PendingRequest; onChanged: () => void }) {
  const [forfeit, setForfeit] = useState(false)
  const registerTx = useTxAction()
  const approveTx = useTxAction({ onSuccess: onChanged })
  const rejectTx = useTxAction({ onSuccess: onChanged })

  const canRegister = req.title.trim() !== '' && req.assets.length > 0

  function handleRegister(): void {
    if (!canRegister) return
    registerTx.send({
      address: REGISTRY,
      abi: alignmentRegistryV1Abi,
      functionName: 'registerAlignmentTarget',
      args: [
        req.title,
        req.description,
        req.metadataURI,
        req.assets.map((a) => ({
          token: a.token,
          symbol: a.symbol,
          info: a.info,
          metadataURI: a.metadataURI,
        })),
      ],
      chainId: forkChainId,
    })
  }

  return (
    <ActionRow
      label={`request #${req.id}`}
      hint="register the target from this request, then approve to refund the deposit (two txs, D7)"
    >
      <div className={styles.form}>
        <dl className={styles.readout} data-testid={`request-${req.id}-readout`}>
          <div className={styles.readRow}>
            <dt>requester</dt>
            <dd className={styles.mono}>{truncateAddress(req.requester)}</dd>
          </div>
          <div className={styles.readRow}>
            <dt>token</dt>
            <dd className={styles.mono}>{truncateAddress(req.token)}</dd>
          </div>
          <div className={styles.readRow}>
            <dt>title</dt>
            <dd>{req.title || '—'}</dd>
          </div>
          <div className={styles.readRow}>
            <dt>description</dt>
            <dd>{req.description || '—'}</dd>
          </div>
          <div className={styles.readRow}>
            <dt>metadataURI</dt>
            <dd className={styles.mono}>{req.metadataURI || '—'}</dd>
          </div>
          <div className={styles.readRow}>
            <dt>deposit</dt>
            <dd>{formatEther(req.deposit)} ETH</dd>
          </div>
          <div className={styles.readRow}>
            <dt>status</dt>
            <dd>{requestStatusLabel(req.status)}</dd>
          </div>
          <div className={styles.readRow}>
            <dt>assets</dt>
            <dd className={styles.mono}>
              {req.assets.length === 0
                ? '—'
                : req.assets
                    .map((a) => `${a.symbol || '?'} ${truncateAddress(a.token)}`)
                    .join(', ')}
            </dd>
          </div>
        </dl>

        <TxButton
          state={registerTx.state}
          onClick={handleRegister}
          label="1 · register target"
          successLabel="target registered — now approve the request."
          onReset={registerTx.reset}
          disabled={!canRegister}
          errorText="register failed — try again"
          testId={`request-${req.id}-register`}
        />
        <TxButton
          state={approveTx.state}
          onClick={() =>
            approveTx.send({
              address: REQUEST_REGISTRY,
              abi: alignmentTargetRequestRegistryAbi,
              functionName: 'approveRequest',
              args: [req.id],
              chainId: forkChainId,
            })
          }
          label="2 · approve (refund deposit)"
          className="btn btn-secondary"
          successLabel="approved — deposit refunded to the requester."
          onReset={approveTx.reset}
          errorText="approve failed — try again"
          testId={`request-${req.id}-approve`}
        />
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={forfeit}
            onChange={(e) => setForfeit(e.target.checked)}
            disabled={rejectTx.isBusy}
            aria-label="forfeit deposit on reject"
          />
          <span>forfeit deposit (spam — send to treasury)</span>
        </label>
        <TxButton
          state={rejectTx.state}
          onClick={() =>
            rejectTx.send({
              address: REQUEST_REGISTRY,
              abi: alignmentTargetRequestRegistryAbi,
              functionName: 'rejectRequest',
              args: [req.id, forfeit],
              chainId: forkChainId,
            })
          }
          label={forfeit ? 'reject + forfeit deposit' : 'reject + refund'}
          className="btn btn-secondary"
          successLabel="rejected — deposit handled."
          onReset={rejectTx.reset}
          errorText="reject failed — try again"
          testId={`request-${req.id}-reject`}
        />
      </div>
    </ActionRow>
  )
}
