/**
 * RequestTargetPage (`/request-target`) — the public front door to propose a new alignment target
 * (D8 minimal browse). Two parts, no owner gate:
 *   1. Request form — token + proposed title/description/metadataURI + a repeatable asset list. Reads
 *      requestDeposit() and submits submitRequest(...) with exactly that value (refundable on approve).
 *   2. My requests — indexes RequestSubmitted filtered to the connected address, then reads
 *      getRequest(id) for each to show the current status + deposit.
 *
 * Validation mirrors the contract via ../lib/targetRequests (nonzero token, non-empty title, ≥1 asset
 * with a nonzero token) so submit is disabled before a guaranteed revert.
 */
import { useState } from 'react'
import { Link } from 'wouter'
import { formatEther } from 'viem'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAccount, usePublicClient } from 'wagmi'
import {
  alignmentTargetRequestRegistryAbi,
  useReadAlignmentTargetRequestRegistryRefunds,
  useReadAlignmentTargetRequestRegistryRequestDeposit,
} from '../generated/contracts'
import { deployBlock, forkAddresses, forkChainId } from '../lib/addresses'
import { scanBackward } from '../lib/logScan'
import {
  pickMyRequestIds,
  requestStatusLabel,
  toContractAssets,
  validateRequestForm,
  type AssetInput,
} from '../lib/targetRequests'
import { TxButton } from '../components/ui/TxButton'
import { useTxAction } from '../components/ui/useTxAction'
import { StateBlock } from '../components/ui/StateBlock'
import styles from './RequestTargetPage.module.css'

const REQUEST_REGISTRY = forkAddresses.AlignmentTargetRequestRegistry

const emptyAsset = (): AssetInput => ({ token: '', symbol: '', info: '', metadataURI: '' })

export function RequestTargetPage() {
  return (
    <div className={styles.page} data-testid="request-target-page">
      <nav>
        <Link href="/" className={styles.reqMeta}>
          ← noesis
        </Link>
      </nav>
      <header>
        <h1 className={styles.title}>Request an alignment target</h1>
        <p className={styles.sub}>
          Propose a community + its token for the curated alignment registry. Submitting takes a
          refundable deposit — it comes back when an admin approves your request, and is only kept
          if it&apos;s rejected as spam.
        </p>
      </header>
      <RequestForm />
      <MyRequests />
    </div>
  )
}

function RequestForm() {
  const { isConnected } = useAccount()
  const queryClient = useQueryClient()

  const { data: requestDeposit } = useReadAlignmentTargetRequestRegistryRequestDeposit({
    address: REQUEST_REGISTRY,
    chainId: forkChainId,
  })

  const [token, setToken] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [metadataURI, setMetadataURI] = useState('')
  const [assets, setAssets] = useState<AssetInput[]>([emptyAsset()])

  const tx = useTxAction({
    onSuccess: () => {
      setToken('')
      setTitle('')
      setDescription('')
      setMetadataURI('')
      setAssets([emptyAsset()])
      void queryClient.invalidateQueries({ queryKey: ['my-target-requests'] })
    },
  })

  const v = validateRequestForm({ token, title, assets, requestDeposit })

  function setAsset(idx: number, field: keyof AssetInput, value: string) {
    setAssets((prev) => prev.map((a, i) => (i === idx ? { ...a, [field]: value } : a)))
  }
  function addAsset() {
    setAssets((prev) => [...prev, emptyAsset()])
  }
  function removeAsset(idx: number) {
    setAssets((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)))
  }

  function handleSubmit(): void {
    if (!v.canSubmit || requestDeposit === undefined) return
    tx.send({
      address: REQUEST_REGISTRY,
      abi: alignmentTargetRequestRegistryAbi,
      functionName: 'submitRequest',
      args: [
        token.trim() as `0x${string}`,
        title.trim(),
        description.trim(),
        metadataURI.trim(),
        toContractAssets(assets),
      ],
      value: requestDeposit,
      chainId: forkChainId,
    })
  }

  return (
    <section className={styles.section} data-testid="request-form">
      <h2 className={styles.sectionTitle}>New request</h2>
      <div className={styles.form}>
        <input
          className={styles.input}
          type="text"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="community token address (0x…, required)"
          disabled={tx.isBusy}
          aria-label="community token address"
        />
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

        {assets.map((a, idx) => (
          <div className={styles.assetCard} key={idx} data-testid={`asset-${idx}`}>
            <div className={styles.assetHead}>
              <span>asset {idx + 1}</span>
              <button
                type="button"
                className={styles.linkBtn}
                onClick={() => removeAsset(idx)}
                disabled={tx.isBusy || assets.length <= 1}
                aria-label={`remove asset ${idx + 1}`}
              >
                remove
              </button>
            </div>
            <input
              className={styles.input}
              type="text"
              value={a.token}
              onChange={(e) => setAsset(idx, 'token', e.target.value)}
              placeholder="asset token address (0x…, required)"
              disabled={tx.isBusy}
              aria-label={`asset ${idx + 1} token address`}
            />
            <input
              className={styles.input}
              type="text"
              value={a.symbol}
              onChange={(e) => setAsset(idx, 'symbol', e.target.value)}
              placeholder="asset symbol"
              disabled={tx.isBusy}
              aria-label={`asset ${idx + 1} symbol`}
            />
            <input
              className={styles.input}
              type="text"
              value={a.info}
              onChange={(e) => setAsset(idx, 'info', e.target.value)}
              placeholder="asset info"
              disabled={tx.isBusy}
              aria-label={`asset ${idx + 1} info`}
            />
            <input
              className={styles.input}
              type="text"
              value={a.metadataURI}
              onChange={(e) => setAsset(idx, 'metadataURI', e.target.value)}
              placeholder="asset metadataURI"
              disabled={tx.isBusy}
              aria-label={`asset ${idx + 1} metadata URI`}
            />
          </div>
        ))}
        <button
          type="button"
          className={styles.linkBtn}
          onClick={addAsset}
          disabled={tx.isBusy}
          data-testid="add-asset"
        >
          + add another asset
        </button>

        <p className={styles.deposit} data-testid="request-deposit">
          {requestDeposit === undefined
            ? 'loading the required deposit…'
            : `a refundable ${formatEther(requestDeposit)} ETH deposit — returned when an admin approves your request.`}
        </p>

        {!isConnected ? (
          <StateBlock variant="empty" boxed>
            connect your wallet to submit a request.
          </StateBlock>
        ) : (
          <TxButton
            state={tx.state}
            onClick={handleSubmit}
            label="submit request"
            successLabel="request submitted — track it in “my requests” below."
            onReset={tx.reset}
            disabled={!v.canSubmit}
            errorText="submit failed — check the deposit + fields and try again"
            testId="submit-request"
          />
        )}
      </div>
    </section>
  )
}

interface MyRequest {
  id: bigint
  title: string
  status: number
  deposit: bigint
}

function useMyRequests(): {
  data: MyRequest[] | undefined
  isPending: boolean
  isError: boolean
} {
  const { address } = useAccount()
  const client = usePublicClient({ chainId: forkChainId })

  const { data, isPending, isError } = useQuery({
    queryKey: ['my-target-requests', address],
    enabled: !!client && !!address,
    staleTime: 15_000,
    queryFn: async (): Promise<MyRequest[]> => {
      if (!client || !address) return []
      // requester is an indexed topic, so this filters server-side; pickMyRequestIds is the guard.
      const latest = await client.getBlockNumber()
      const logs = await scanBackward(
        (fromBlock, toBlock) =>
          client.getContractEvents({
            address: REQUEST_REGISTRY,
            abi: alignmentTargetRequestRegistryAbi,
            eventName: 'RequestSubmitted',
            args: { requester: address },
            fromBlock,
            toBlock,
          }),
        { latest, floor: deployBlock },
      )
      const entries: { id: bigint; requester: string }[] = []
      for (const log of logs) {
        const { id, requester } = log.args
        if (id === undefined || requester === undefined) continue
        entries.push({ id, requester })
      }
      const ids = pickMyRequestIds(entries, address)
      if (ids.length === 0) return []

      const results = await client.multicall({
        allowFailure: true,
        contracts: ids.map(
          (id) =>
            ({
              address: REQUEST_REGISTRY,
              abi: alignmentTargetRequestRegistryAbi,
              functionName: 'getRequest',
              args: [id],
            }) as const,
        ),
      })
      const out: MyRequest[] = []
      ids.forEach((id, i) => {
        const r = results[i]
        if (!r || r.status !== 'success') return
        out.push({ id, title: r.result.title, status: r.result.status, deposit: r.result.deposit })
      })
      return out
    },
  })

  return { data, isPending, isError }
}

function ClaimRefund() {
  const { address, isConnected } = useAccount()
  const queryClient = useQueryClient()
  const { data: owed, refetch } = useReadAlignmentTargetRequestRegistryRefunds({
    address: REQUEST_REGISTRY,
    args: address ? [address] : undefined,
    chainId: forkChainId,
    query: { enabled: !!address },
  })
  const tx = useTxAction({
    onSuccess: () => {
      void refetch()
      void queryClient.invalidateQueries({ queryKey: ['my-target-requests'] })
    },
  })

  if (!isConnected || owed === undefined || owed === 0n) return null

  return (
    <div className={styles.claim} data-testid="claim-refund">
      <span>
        <b>{formatEther(owed)} ETH</b> refund available — from an approved, rejected, or expired
        request.
      </span>
      <TxButton
        state={tx.state}
        onClick={() =>
          tx.send({
            address: REQUEST_REGISTRY,
            abi: alignmentTargetRequestRegistryAbi,
            functionName: 'withdrawRefund',
            chainId: forkChainId,
          })
        }
        label="claim refund"
        successLabel="refund claimed."
        onReset={tx.reset}
        testId="withdraw-refund"
      />
    </div>
  )
}

function MyRequests() {
  const { isConnected } = useAccount()
  const { data, isPending, isError } = useMyRequests()

  return (
    <section className={styles.section} data-testid="my-requests">
      <h2 className={styles.sectionTitle}>My requests</h2>
      <ClaimRefund />
      {!isConnected && (
        <StateBlock variant="empty" boxed>
          connect your wallet to see your requests.
        </StateBlock>
      )}
      {isConnected && isPending && (
        <StateBlock variant="loading">loading your requests…</StateBlock>
      )}
      {isConnected && isError && (
        <StateBlock variant="error">couldn&apos;t load your requests — is the fork up?</StateBlock>
      )}
      {isConnected && !isPending && !isError && (data === undefined || data.length === 0) && (
        <StateBlock variant="empty" boxed testId="my-requests-empty">
          you haven&apos;t submitted any requests yet.
        </StateBlock>
      )}
      {isConnected && data && data.length > 0 && (
        <ul className={styles.list}>
          {data.map((r) => (
            <li key={String(r.id)} className={styles.reqRow} data-testid={`my-request-${r.id}`}>
              <span>
                <span className={styles.reqTitle}>{r.title || `request #${r.id}`}</span>{' '}
                <span className={styles.reqMeta}>#{String(r.id)}</span>
              </span>
              <span className={styles.reqMeta}>
                {formatEther(r.deposit)} ETH ·{' '}
                <span className={styles.status}>{requestStatusLabel(r.status)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
