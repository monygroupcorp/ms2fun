/**
 * Erc404AdminPanel (W-E) — per-instance creator admin for an ERC404 bonding collection. Renders ONLY
 * when the connected wallet owns the instance (`useOwnerGate`), laid out with the shared
 * AdminSection/ActionRow primitives; every action is a `useTxAction` + `<TxButton>` writing the
 * generated `erc404BondingInstanceAbi` on the fork chain, refetching the relevant read on success.
 *
 * Actions: bonding lifecycle (active toggle, open/maturity time), metadata/style URIs, vault
 * (migrate, claim all fees) and agent delegation.
 *
 * ABI note: the generated metadata setter is `setMetadataURI` (uppercase URI), not `setMetadataUri`.
 */
import { useState } from 'react'
import { formatEther } from 'viem'
import { useBlock } from 'wagmi'
import {
  deployBondEscrowAbi,
  erc404BondingInstanceAbi,
  useReadDeployBondEscrowBonds,
  useReadErc404BondingInstanceAgentDelegationEnabled,
  useReadErc404BondingInstanceBondingActive,
  useReadErc404BondingInstanceBondingMaturityTime,
  useReadErc404BondingInstanceBondingOpenTime,
  useReadErc404BondingInstanceDeclaredMaxAllowanceBps,
  useReadErc404BondingInstanceGraduated,
  useReadErc404BondingInstancePreviewCarve,
  useReadErc404BondingInstanceStakingActive,
} from '../../../generated/contracts'
import { forkAddresses, forkChainId } from '../../../lib/addresses'
import { parseBps } from '../../../lib/carve'
import { AdminSection, ActionRow } from '../../ui/AdminSection'
import { Disclosure } from '../../ui/Disclosure'
import { TxButton } from '../../ui/TxButton'
import { useOwnerGate } from '../../ui/useOwnerGate'
import { useTxAction } from '../../ui/useTxAction'
import { MetadataArtistPanel } from './MetadataArtistPanel'
import styles from './Erc404AdminPanel.module.css'

interface Erc404AdminPanelProps {
  instance: `0x${string}`
}

/** Parse a `datetime-local` value to unix seconds; undefined when empty/unparseable. */
function toUnixSeconds(value: string): bigint | undefined {
  const raw = value.trim()
  if (raw === '') return undefined
  const ms = Date.parse(raw)
  if (Number.isNaN(ms)) return undefined
  return BigInt(Math.floor(ms / 1000))
}

export function Erc404AdminPanel({ instance }: Erc404AdminPanelProps) {
  const { isOwner } = useOwnerGate(instance)
  if (!isOwner) return null

  return (
    <Disclosure summary="CREATOR ADMIN" testId="erc404-creator-admin">
      <AdminSection title="creator admin" testId="erc404-admin">
        <SetBondingActiveRow instance={instance} />
        <SetTimeRow
          instance={instance}
          functionName="setBondingOpenTime"
          label="bonding open time"
          hint="when the bonding sale opens"
          testId="erc404-admin-open-time"
          kind="open"
        />
        <SetTimeRow
          instance={instance}
          functionName="setBondingMaturityTime"
          label="bonding maturity time"
          hint="must be after open time and in the future"
          testId="erc404-admin-maturity"
          kind="maturity"
        />
        <SetUriRow
          instance={instance}
          functionName="setStyle"
          label="style uri"
          hint="collection style / render uri"
          placeholder="ipfs://, ar://, https://, or data:"
          testId="erc404-admin-style"
        />
        <SetUriRow
          instance={instance}
          functionName="setMetadataURI"
          label="metadata uri"
          hint="collection metadata uri"
          placeholder="ipfs://, ar://, https://, or data:"
          testId="erc404-admin-metadata"
        />
        <ActivateStakingRow instance={instance} />
        <DeployLiquidityRow instance={instance} />
        <BondStatusRow instance={instance} />
        <MetadataArtistPanel instance={instance} />
        <MigrateVaultRow instance={instance} />
        <ClaimAllFeesRow instance={instance} />
        <SetAgentDelegationRow instance={instance} />
      </AdminSection>
    </Disclosure>
  )
}

// ── bonding active toggle ──────────────────────────────────────────────────────

function SetBondingActiveRow({ instance }: { instance: `0x${string}` }) {
  const { data: active, refetch } = useReadErc404BondingInstanceBondingActive({
    address: instance,
    chainId: forkChainId,
  })
  const tx = useTxAction({ onSuccess: () => void refetch() })
  const next = !active

  return (
    <ActionRow
      label="bonding active"
      hint={active === undefined ? 'current: …' : `current: ${active ? 'active' : 'inactive'}`}
    >
      <TxButton
        state={tx.state}
        onClick={() =>
          tx.send({
            address: instance,
            abi: erc404BondingInstanceAbi,
            functionName: 'setBondingActive',
            args: [next],
            chainId: forkChainId,
          })
        }
        label={next ? 'activate bonding' : 'deactivate bonding'}
        successLabel="bonding state updated"
        onReset={tx.reset}
        disabled={active === undefined}
        className="btn btn-secondary"
        testId="erc404-admin-set-active"
      />
    </ActionRow>
  )
}

// ── open / maturity time setters ───────────────────────────────────────────────

function SetTimeRow({
  instance,
  functionName,
  label,
  hint,
  testId,
  kind,
}: {
  instance: `0x${string}`
  functionName: 'setBondingOpenTime' | 'setBondingMaturityTime'
  label: string
  hint: string
  testId: string
  kind: 'open' | 'maturity'
}) {
  const [value, setValue] = useState('')
  const { data: openTime, refetch: refetchOpen } = useReadErc404BondingInstanceBondingOpenTime({
    address: instance,
    chainId: forkChainId,
  })
  const { data: maturityTime, refetch: refetchMaturity } =
    useReadErc404BondingInstanceBondingMaturityTime({ address: instance, chainId: forkChainId })

  const tx = useTxAction({
    onSuccess: () => {
      void refetchOpen()
      void refetchMaturity()
    },
  })

  const seconds = toUnixSeconds(value)
  // The contract checks `TimeMustBeInFuture` against `block.timestamp`, NOT the browser clock. Those
  // differ — a mainnet-fork's chain time runs hours ahead of the wall clock, and even on live networks
  // the two drift — so validating against `Date.now()` lets a value pass the UI and revert on-chain.
  // Use chain time; fall back to the wall clock only until the first block loads.
  const { data: block } = useBlock({ chainId: forkChainId, watch: true })
  const nowSec = block?.timestamp ?? BigInt(Math.floor(Date.now() / 1000))

  // Maturity must be > openTime AND in the future; surface the reason inline.
  let invalidReason: string | undefined
  if (seconds !== undefined) {
    if (seconds <= nowSec)
      invalidReason = `must be after chain time (${new Date(Number(nowSec) * 1000).toISOString()})`
    else if (kind === 'maturity' && openTime !== undefined && seconds <= openTime)
      invalidReason = 'must be after open time'
  }
  const canSubmit = seconds !== undefined && invalidReason === undefined

  const current = kind === 'open' ? openTime : maturityTime
  const currentHint =
    current === undefined || current === 0n
      ? hint
      : `${hint} · current: ${new Date(Number(current) * 1000).toISOString()}`

  return (
    <ActionRow label={label} hint={invalidReason ?? currentHint}>
      <div className={styles.control}>
        <input
          className={styles.input}
          type="datetime-local"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={tx.isBusy}
          aria-label={label}
          data-testid={`${testId}-input`}
        />
        <TxButton
          state={tx.state}
          onClick={() => {
            if (seconds === undefined) return
            tx.send({
              address: instance,
              abi: erc404BondingInstanceAbi,
              functionName,
              args: [seconds],
              chainId: forkChainId,
            })
          }}
          label="set time"
          successLabel="time updated"
          onReset={() => {
            tx.reset()
            setValue('')
          }}
          disabled={!canSubmit}
          className="btn btn-primary"
          testId={testId}
        />
      </div>
    </ActionRow>
  )
}

// ── string-uri setters (style / metadata) ──────────────────────────────────────

function SetUriRow({
  instance,
  functionName,
  label,
  hint,
  placeholder,
  testId,
}: {
  instance: `0x${string}`
  functionName: 'setStyle' | 'setMetadataURI'
  label: string
  hint: string
  placeholder: string
  testId: string
}) {
  const [uri, setUri] = useState('')
  const tx = useTxAction()
  const canSubmit = uri.trim() !== '' && !tx.isBusy

  return (
    <ActionRow label={label} hint={hint}>
      <div className={styles.control}>
        <input
          className={styles.input}
          type="text"
          value={uri}
          onChange={(e) => setUri(e.target.value)}
          placeholder={placeholder}
          disabled={tx.isBusy}
          aria-label={label}
          data-testid={`${testId}-input`}
        />
        <TxButton
          state={tx.state}
          onClick={() => {
            if (!canSubmit) return
            tx.send({
              address: instance,
              abi: erc404BondingInstanceAbi,
              functionName,
              args: [uri.trim()],
              chainId: forkChainId,
            })
          }}
          label="update uri"
          successLabel="uri updated"
          onReset={() => {
            tx.reset()
            setUri('')
          }}
          disabled={!canSubmit}
          className="btn btn-primary"
          testId={testId}
        />
      </div>
    </ActionRow>
  )
}

// ── activate staking (creator action; onlyOwner on-chain) ──────────────────────

function ActivateStakingRow({ instance }: { instance: `0x${string}` }) {
  const { data: active, refetch } = useReadErc404BondingInstanceStakingActive({
    address: instance,
    chainId: forkChainId,
  })
  const tx = useTxAction({ onSuccess: () => void refetch() })

  return (
    <ActionRow
      label="activate staking"
      hint={
        active === undefined
          ? 'open staking so holders can stake for rewards · current: …'
          : active
            ? 'staking is already active'
            : 'open staking so holders can stake for rewards'
      }
    >
      <TxButton
        state={tx.state}
        onClick={() =>
          tx.send({
            address: instance,
            abi: erc404BondingInstanceAbi,
            functionName: 'activateStaking',
            args: [],
            chainId: forkChainId,
          })
        }
        label="activate staking"
        successLabel="staking activated"
        onReset={tx.reset}
        disabled={active === undefined || active === true}
        className="btn btn-primary"
        testId="erc404-admin-activate-staking"
      />
    </ActionRow>
  )
}

// ── deploy liquidity / graduate (creator action; onlyOwner on-chain) ───────────
// Graduation takes an optional creator CARVE: deployLiquidity(carveRequestBps) where the request is
// a fraction of the protocol carve allowance, hard-capped on-chain by the create-time
// declaredMaxAllowanceBps and the factory's live brackets + pool floor. The control below is capped
// at the instance's declared max and previews the resolved ETH via the on-chain previewCarve view.

function DeployLiquidityRow({ instance }: { instance: `0x${string}` }) {
  const [carveInput, setCarveInput] = useState('0') // bps, default 0 = plain graduation
  const tx = useTxAction()

  const { data: declaredMax } = useReadErc404BondingInstanceDeclaredMaxAllowanceBps({
    address: instance,
    chainId: forkChainId,
  })
  const maxBps = declaredMax ?? 0
  const requestBps = Math.min(parseBps(carveInput, 0), maxBps)

  // Live-computed effective max (full request) + the resolved carve for the CURRENT request.
  const { data: maxCarveWei } = useReadErc404BondingInstancePreviewCarve({
    address: instance,
    chainId: forkChainId,
    args: [10_000n],
    query: { enabled: maxBps > 0 },
  })
  const { data: carveWei } = useReadErc404BondingInstancePreviewCarve({
    address: instance,
    chainId: forkChainId,
    args: [BigInt(requestBps)],
    query: { enabled: requestBps > 0 },
  })

  const resolved = requestBps > 0 ? carveWei : 0n
  const hint =
    maxBps === 0
      ? 'graduate to the DEX — this collection declared no carve rights (carve is 0)'
      : `graduate to the DEX with an optional creator carve — declared max ${maxBps} bps, ` +
        `effective max ${maxCarveWei !== undefined ? formatEther(maxCarveWei) : '…'} ETH now; ` +
        `this request carves ${resolved !== undefined ? formatEther(resolved) : '…'} ETH ` +
        '(tithed 80/19/1 — you / vault / protocol)'

  return (
    <ActionRow label="deploy liquidity (graduate)" hint={hint}>
      <div className={styles.control}>
        {maxBps > 0 && (
          <input
            className={styles.input}
            type="number"
            min={0}
            max={maxBps}
            step={100}
            value={carveInput}
            onChange={(e) => setCarveInput(e.target.value)}
            disabled={tx.isBusy}
            aria-label="carve request in bps (0 = no carve)"
            data-testid="erc404-admin-carve-bps-input"
          />
        )}
        <TxButton
          state={tx.state}
          onClick={() =>
            tx.send({
              address: instance,
              abi: erc404BondingInstanceAbi,
              functionName: 'deployLiquidity',
              args: [BigInt(requestBps)],
              chainId: forkChainId,
            })
          }
          label={requestBps > 0 ? `graduate + carve ${requestBps} bps` : 'deploy liquidity'}
          successLabel="liquidity deployed"
          onReset={tx.reset}
          className="btn btn-primary btn-chromatic"
          testId="erc404-admin-deploy-liquidity"
        />
      </div>
    </ActionRow>
  )
}

// ── deploy bond (N12): status + reclaim on graduation ──────────────────────────
// The bond is escrowed at create (when the lever is on) and refunded in full once the collection
// graduates. `refund` is permissionless on-chain, but it always pays the recorded creator, so we
// surface it here in the creator panel. Renders nothing when no bond was posted for this instance.

function BondStatusRow({ instance }: { instance: `0x${string}` }) {
  const { data: bond, refetch } = useReadDeployBondEscrowBonds({
    address: forkAddresses.DeployBondEscrow,
    chainId: forkChainId,
    args: [instance],
  })
  const { data: graduated } = useReadErc404BondingInstanceGraduated({
    address: instance,
    chainId: forkChainId,
  })
  const tx = useTxAction({ onSuccess: () => void refetch() })

  // bonds(instance) tuple: [creator, amount, createdAt, settled]
  const amount = bond?.[1] ?? 0n
  const createdAt = bond?.[2] ?? 0
  const settled = bond?.[3] ?? false
  if (createdAt === 0) return null // no bond posted for this collection → hide the row

  const canReclaim = amount > 0n && !settled && graduated === true
  const status = settled
    ? 'reclaimed / settled'
    : graduated
      ? 'ready to reclaim'
      : 'held until graduation'

  return (
    <ActionRow
      label="deploy deposit"
      hint={`refundable creator bond escrowed at create — ${formatEther(
        amount,
      )} ETH · ${status}. Returned in full on graduation.`}
    >
      <div className={styles.control}>
        <TxButton
          state={tx.state}
          onClick={() =>
            tx.send({
              address: forkAddresses.DeployBondEscrow,
              abi: deployBondEscrowAbi,
              functionName: 'refund',
              args: [instance],
              chainId: forkChainId,
            })
          }
          label="reclaim deposit"
          successLabel="deposit reclaimed — tx confirmed."
          onReset={tx.reset}
          disabled={!canReclaim}
          errorText="reclaim failed — try again"
          testId="erc404-admin-reclaim-bond"
        />
      </div>
    </ActionRow>
  )
}

// ── vault: migrate ─────────────────────────────────────────────────────────────

function MigrateVaultRow({ instance }: { instance: `0x${string}` }) {
  const [addr, setAddr] = useState('')
  const tx = useTxAction()
  const isAddress = /^0x[0-9a-fA-F]{40}$/.test(addr.trim())
  const canSubmit = isAddress && !tx.isBusy

  return (
    <ActionRow label="migrate vault" hint="point the instance at a new alignment vault">
      <div className={styles.control}>
        <input
          className={styles.input}
          type="text"
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
          placeholder="0x… new vault address"
          disabled={tx.isBusy}
          aria-label="new vault address"
          data-testid="erc404-admin-migrate-vault-input"
        />
        <TxButton
          state={tx.state}
          onClick={() => {
            if (!canSubmit) return
            tx.send({
              address: instance,
              abi: erc404BondingInstanceAbi,
              functionName: 'migrateVault',
              args: [addr.trim() as `0x${string}`],
              chainId: forkChainId,
            })
          }}
          label="migrate vault"
          successLabel="vault migrated"
          onReset={() => {
            tx.reset()
            setAddr('')
          }}
          disabled={!canSubmit}
          className="btn btn-primary"
          testId="erc404-admin-migrate-vault"
        />
      </div>
    </ActionRow>
  )
}

// ── vault: claim all fees ──────────────────────────────────────────────────────

function ClaimAllFeesRow({ instance }: { instance: `0x${string}` }) {
  const tx = useTxAction()

  return (
    <ActionRow label="claim all fees" hint="sweep all accrued fees to the creator">
      <TxButton
        state={tx.state}
        onClick={() =>
          tx.send({
            address: instance,
            abi: erc404BondingInstanceAbi,
            functionName: 'claimAllFees',
            args: [],
            chainId: forkChainId,
          })
        }
        label="claim all fees"
        successLabel="fees claimed"
        onReset={tx.reset}
        className="btn btn-secondary"
        testId="erc404-admin-claim-all-fees"
      />
    </ActionRow>
  )
}

// ── agent delegation toggle ────────────────────────────────────────────────────

function SetAgentDelegationRow({ instance }: { instance: `0x${string}` }) {
  const { data: enabled, refetch } = useReadErc404BondingInstanceAgentDelegationEnabled({
    address: instance,
    chainId: forkChainId,
  })
  const tx = useTxAction({ onSuccess: () => void refetch() })
  const next = !enabled

  return (
    <ActionRow
      label="agent delegation"
      hint={
        enabled === undefined
          ? 'let approved agents act for this collection · current: …'
          : `let approved agents act for this collection · current: ${enabled ? 'on' : 'off'}`
      }
    >
      <TxButton
        state={tx.state}
        onClick={() =>
          tx.send({
            address: instance,
            abi: erc404BondingInstanceAbi,
            functionName: 'setAgentDelegation',
            args: [next],
            chainId: forkChainId,
          })
        }
        label={next ? 'enable delegation' : 'disable delegation'}
        successLabel="delegation updated"
        onReset={tx.reset}
        disabled={enabled === undefined}
        className="btn btn-secondary"
        testId="erc404-admin-delegation"
      />
    </ActionRow>
  )
}
