/**
 * Erc404AdminPanel (W-E) — per-instance creator admin for an ERC404 bonding collection. Renders ONLY
 * when the connected wallet owns the instance (`useOwnerGate`), laid out with the shared
 * AdminSection/ActionRow primitives; every action is a `useTxAction` + `<TxButton>` writing the
 * generated `erc404BondingInstanceAbi` on the fork chain, refetching the relevant read on success.
 *
 * Actions: bonding lifecycle (active toggle, open/maturity time), metadata/style URIs, vault
 * (migrate, claim all fees), agent delegation, and (noesis-080) configure allowlist — shown only when
 * the instance has a gating module set (today the only deployed gating module IS MerkleGatingModule;
 * PasswordTierGating was dropped in noesis-065).
 *
 * ABI note: the generated metadata setter is `setMetadataURI` (uppercase URI), not `setMetadataUri`.
 */
import { useMemo, useState } from 'react'
import { formatEther, type Log } from 'viem'
import { useBlock, useWaitForTransactionReceipt } from 'wagmi'
import {
  deployBondEscrowAbi,
  erc404BondingInstanceAbi,
  masterRegistryV1Abi,
  merkleGatingModuleAbi,
  useReadDeployBondEscrowBonds,
  useReadErc404BondingInstanceAgentDelegationEnabled,
  useReadErc404BondingInstanceBondingActive,
  useReadErc404BondingInstanceBondingMaturityTime,
  useReadErc404BondingInstanceBondingOpenTime,
  useReadErc404BondingInstanceDeclaredMaxAllowanceBps,
  useReadErc404BondingInstanceGatingModule,
  useReadErc404BondingInstanceGraduated,
  useReadErc404BondingInstancePreviewCarve,
  useReadErc404BondingInstanceStakingActive,
} from '../../../generated/contracts'
import { useCollection } from '../../useCollection'
import { useCollectionMetadata } from '../../useCollectionMetadata'
import { useCollectionAddresses, useCollectionChainId } from '../useCollectionChain'
import { carveCreatorNet, parseBps } from '../../../lib/carve'
import { carveSettlementFromLogs } from '../../../lib/carveReceipt'
import { collectionToDataUri } from '../../../lib/metadata'
import type { MoneyReceipt } from '../../ui/receipt'
import {
  buildAllowlistFromPaste,
  buildAllowlistFromUri,
  isAllowlistBuildError,
  patchAllowlistRow,
  toMerkleConfig,
  type AllowlistBuildOutcome,
} from '../../../lib/collection/allowlistConfig'
import { hasGatingModule } from './gating'
import { AdminSection, ActionRow } from '../../ui/AdminSection'
import { Disclosure } from '../../ui/Disclosure'
import { TxButton } from '../../ui/TxButton'
import { useOwnerGate } from '../../ui/useOwnerGate'
import { useTxAction } from '../../ui/useTxAction'
import { MetadataArtistPanel } from './MetadataArtistPanel'
import { canDeployLiquidity, derivePhase } from './bondingPhase'
import { useBondingData } from './useBondingData'
import { useNowSec } from './useNowSec'
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
  const { view } = useBondingData(instance)
  const nowSec = useNowSec()
  // Phase gate (noesis-209): the panel's own reads were never consulted, so a graduated collection
  // kept offering "activate bonding" / "deploy liquidity" / the bonding-time setters alongside the
  // page's own "graduated to DEX" notice. `deployLiquidity` visibility is keyed on the PHASE alone
  // (bonding), not on `canDeployLiquidity` — that helper is stricter than the contract (it also
  // requires full-or-matured) and would hide the button on a sold-out curve or a deliberate early
  // graduation; it is used below only to choose the hint text under a still-visible button.
  const phase = view !== undefined ? derivePhase(view, nowSec) : undefined
  const graduated = phase === 'graduated'
  const bonding = phase === 'bonding'
  const closesSaleEarly = bonding && view !== undefined && !canDeployLiquidity(view, nowSec)

  if (!isOwner) return null

  return (
    <Disclosure summary="CREATOR ADMIN" testId="erc404-creator-admin">
      <AdminSection title="creator admin" testId="erc404-admin">
        {graduated ? (
          <p className={styles.hint} data-testid="erc404-admin-graduated-note">
            bonding is complete — this collection graduated
          </p>
        ) : (
          <>
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
          </>
        )}
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
        {bonding && <DeployLiquidityRow instance={instance} closesSaleEarly={closesSaleEarly} />}
        <BondStatusRow instance={instance} />
        <MetadataArtistPanel instance={instance} />
        <MigrateVaultRow instance={instance} />
        <ClaimAllFeesRow instance={instance} />
        <SetAgentDelegationRow instance={instance} />
        <AllowlistConfigRow instance={instance} />
      </AdminSection>
    </Disclosure>
  )
}

// ── bonding active toggle ──────────────────────────────────────────────────────

function SetBondingActiveRow({ instance }: { instance: `0x${string}` }) {
  const chainId = useCollectionChainId()
  const { data: active, refetch } = useReadErc404BondingInstanceBondingActive({
    address: instance,
    chainId: chainId,
  })
  const tx = useTxAction({ onSuccess: () => void refetch(), instance })
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
            chainId: chainId,
          })
        }
        label={next ? 'activate bonding' : 'deactivate bonding'}
        successLabel={'bonding state updated'}
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
  const chainId = useCollectionChainId()
  const [value, setValue] = useState('')
  const { data: openTime, refetch: refetchOpen } = useReadErc404BondingInstanceBondingOpenTime({
    address: instance,
    chainId: chainId,
  })
  const { data: maturityTime, refetch: refetchMaturity } =
    useReadErc404BondingInstanceBondingMaturityTime({ address: instance, chainId: chainId })

  const tx = useTxAction({
    onSuccess: () => {
      void refetchOpen()
      void refetchMaturity()
    },
    instance,
  })

  const seconds = toUnixSeconds(value)
  // The contract checks `TimeMustBeInFuture` against `block.timestamp`, NOT the browser clock. Those
  // differ — a mainnet-fork's chain time runs hours ahead of the wall clock, and even on live networks
  // the two drift — so validating against `Date.now()` lets a value pass the UI and revert on-chain.
  // Use chain time; fall back to the wall clock only until the first block loads.
  const { data: block } = useBlock({ chainId: chainId, watch: true })
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
              chainId: chainId,
            })
          }}
          label="set time"
          successLabel={'time updated'}
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
  const chainId = useCollectionChainId()
  const [uri, setUri] = useState('')
  const tx = useTxAction({ instance })
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
              chainId: chainId,
            })
          }}
          label="update uri"
          successLabel={'uri updated'}
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
  const chainId = useCollectionChainId()
  const { data: active, refetch } = useReadErc404BondingInstanceStakingActive({
    address: instance,
    chainId: chainId,
  })
  const tx = useTxAction({ onSuccess: () => void refetch(), instance })

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
            chainId: chainId,
          })
        }
        label="activate staking"
        successLabel={'staking activated'}
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

// The creator's in-session confirmation for a graduation tx, formatted from the settled figures.
// The arithmetic underneath it — the union of `CreatorCarvePaid.paid` and
// `GraduationExcessTithed.amount`, then the 1/19/80 split — lives in `lib/carveReceipt.ts` and is
// shared with the public collection page, which reads the same settlement from chain history. One
// implementation, two call sites: a second hand-rolled decode is how the capped-`paid` reading
// (which understates whenever the parity clamp leaves excess) comes back.
//
// `undefined` when nothing was carved, so the caller falls back to an amountless success label.
export function carveReceiptFromLogs(logs: readonly Log[]): MoneyReceipt | undefined {
  const s = carveSettlementFromLogs(logs)
  if (s.gross === 0n) return undefined
  return {
    verb: 'graduated with a creator carve',
    net: { label: 'you received', wei: s.creatorNet },
    legs: [
      { label: 'protocol', wei: s.protocol },
      { label: 'vault', wei: s.vault },
    ],
  }
}

function DeployLiquidityRow({
  instance,
  closesSaleEarly,
}: {
  instance: `0x${string}`
  closesSaleEarly: boolean
}) {
  const chainId = useCollectionChainId()
  const [carveInput, setCarveInput] = useState('0') // bps, default 0 = plain graduation
  const tx = useTxAction({ instance })
  const { data: receipt } = useWaitForTransactionReceipt({ hash: tx.hash })
  const carveReceipt = useMemo(
    () => (receipt !== undefined ? carveReceiptFromLogs(receipt.logs) : undefined),
    [receipt],
  )

  const { data: declaredMax } = useReadErc404BondingInstanceDeclaredMaxAllowanceBps({
    address: instance,
    chainId: chainId,
  })
  const maxBps = declaredMax ?? 0
  const requestBps = Math.min(parseBps(carveInput, 0), maxBps)

  // Live-computed effective max (full request) + the resolved carve for the CURRENT request.
  const { data: maxCarveWei } = useReadErc404BondingInstancePreviewCarve({
    address: instance,
    chainId: chainId,
    args: [10_000n],
    query: { enabled: maxBps > 0 },
  })
  const { data: carveWei } = useReadErc404BondingInstancePreviewCarve({
    address: instance,
    chainId: chainId,
    args: [BigInt(requestBps)],
    query: { enabled: requestBps > 0 },
  })

  const resolved = requestBps > 0 ? carveWei : 0n

  // Every ETH figure below is labelled GROSS or NET. `previewCarve` returns the gross carve — the ETH
  // that leaves the LP share — and the carve is itself tithed 1/19/80, so the wallet receives 80% of
  // it. The create wizard's disclosure table has always shown the net column; the panel shows both,
  // at the moment the choice is committed. Gross stays visible because it is what the pool loses, and
  // hiding that would be the same omission wearing the other face.
  const ethPair = (gross: bigint | undefined): string =>
    gross === undefined
      ? '… ETH'
      : `${formatEther(gross)} ETH gross / ${formatEther(carveCreatorNet(gross))} ETH net to you`
  const baseHint =
    maxBps === 0
      ? 'graduate to the DEX — this collection declared no carve rights (carve is 0)'
      : `graduate to the DEX with an optional creator carve — declared max ${maxBps} bps; ` +
        `effective max now ${ethPair(maxCarveWei)}; ` +
        `this request carves ${ethPair(resolved)} ` +
        '(the carve is tithed 80/19/1 — you / vault / protocol)'
  // The curve isn't full yet and hasn't matured — graduating now is a designed early-exit path, but
  // it closes the sale to buyers immediately. Surface that as a heads-up, never as a reason to hide
  // the button (see the panel-level comment on `closesSaleEarly`).
  const hint = closesSaleEarly
    ? `${baseHint} · curve not full yet — graduating now closes the sale early`
    : baseHint

  // Piece 1 (noesis-220): the permanence statement, at the ONE moment the carve can be chosen.
  // Graduation happens once, `deployLiquidity` resolves the carve inside that same transaction, and
  // there is no setter — so a request below the declared max forfeits the difference for good. The
  // forfeited figure is named in NET terms (what the wallet would have received) so the sentence is
  // priced rather than abstract. This is a STATEMENT, not a guardrail: 0 is a legal, defaulted choice
  // and the button is never disabled, gated, or given a confirm step.
  const forgoneNet =
    maxCarveWei === undefined
      ? undefined
      : carveCreatorNet(maxCarveWei) - carveCreatorNet(resolved ?? 0n)
  const forgoneText = forgoneNet === undefined ? '…' : formatEther(forgoneNet)
  const permanence =
    maxBps === 0 || requestBps >= maxBps
      ? undefined
      : 'this choice is permanent: a collection graduates once, deployLiquidity resolves the carve ' +
        'inside that same transaction, and there is no setter and no second chance. ' +
        (requestBps === 0
          ? `leaving the request at 0 forfeits the entire carve — ${forgoneText} ETH net to you — forever.`
          : `requesting ${requestBps} bps instead of the declared max ${maxBps} bps forfeits the ` +
            `difference — ${forgoneText} ETH net to you — forever.`)

  return (
    <ActionRow label="deploy liquidity (graduate)" hint={hint}>
      <div className={styles.control}>
        {permanence !== undefined && (
          <p className={styles.warning} data-testid="erc404-admin-carve-permanence">
            {permanence}
          </p>
        )}
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
              chainId: chainId,
            })
          }
          label={requestBps > 0 ? `graduate + carve ${requestBps} bps` : 'deploy liquidity'}
          receipt={carveReceipt}
          successLabel={
            carveReceipt !== undefined
              ? undefined
              : requestBps > 0
                ? 'graduated — carve details unavailable'
                : 'graduated to the DEX — no creator carve requested'
          }
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
  const chainId = useCollectionChainId()
  const addresses = useCollectionAddresses()
  const { data: bond, refetch } = useReadDeployBondEscrowBonds({
    address: addresses.DeployBondEscrow,
    chainId: chainId,
    args: [instance],
  })
  const { data: graduated } = useReadErc404BondingInstanceGraduated({
    address: instance,
    chainId: chainId,
  })
  const tx = useTxAction({ onSuccess: () => void refetch(), instance })

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
              address: addresses.DeployBondEscrow,
              abi: deployBondEscrowAbi,
              functionName: 'refund',
              args: [instance],
              chainId: chainId,
            })
          }
          label="reclaim deposit"
          receipt={{ verb: 'deposit reclaimed', net: { label: 'you received', wei: amount } }}
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
  const chainId = useCollectionChainId()
  const [addr, setAddr] = useState('')
  const tx = useTxAction({ instance })
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
              chainId: chainId,
            })
          }}
          label="migrate vault"
          successLabel={'vault migrated'}
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
  const chainId = useCollectionChainId()
  const tx = useTxAction({ instance })

  return (
    // claimAllFees pulls accrued vault fees into the INSTANCE's own balance (crediting the staking
    // reserve when staking is active) — it does not send ETH to the caller's wallet directly, so
    // there is no wallet-level amount to receipt here. The creator's own payout happens through a
    // separate withdraw path, out of this row's scope.
    <ActionRow label="claim all fees" hint="sweep accrued vault fees into the instance balance">
      <TxButton
        state={tx.state}
        onClick={() =>
          tx.send({
            address: instance,
            abi: erc404BondingInstanceAbi,
            functionName: 'claimAllFees',
            args: [],
            chainId: chainId,
          })
        }
        label="claim all fees"
        successLabel={'fee sweep confirmed'}
        onReset={tx.reset}
        className="btn btn-secondary"
        testId="erc404-admin-claim-all-fees"
      />
    </ActionRow>
  )
}

// ── agent delegation toggle ────────────────────────────────────────────────────

function SetAgentDelegationRow({ instance }: { instance: `0x${string}` }) {
  const chainId = useCollectionChainId()
  const { data: enabled, refetch } = useReadErc404BondingInstanceAgentDelegationEnabled({
    address: instance,
    chainId: chainId,
  })
  const tx = useTxAction({ onSuccess: () => void refetch(), instance })
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
            chainId: chainId,
          })
        }
        label={next ? 'enable delegation' : 'disable delegation'}
        successLabel={'delegation updated'}
        onReset={tx.reset}
        disabled={enabled === undefined}
        className="btn btn-secondary"
        testId="erc404-admin-delegation"
      />
    </ActionRow>
  )
}

// ── Configure allowlist (noesis-080) ──────────────────────────────────────────
//
// Only shown when the instance has a gating module set — today that can only be MerkleGatingModule
// (PasswordTierGating was dropped in noesis-065). ERC404 has no per-edition concept: editionId/tierIndex
// are always 0. Two independently-retryable transactions — see the erc1155/CreatorAdminPanel.tsx twin
// for the full rationale (configureFor auth vs updateInstanceMetadata's creator-vs-owner asymmetry).

function AllowlistConfigRow({ instance }: { instance: `0x${string}` }) {
  const chainId = useCollectionChainId()
  const addresses = useCollectionAddresses()
  const { data: gatingModule } = useReadErc404BondingInstanceGatingModule({
    address: instance,
    chainId: chainId,
  })
  // `useCollection` doesn't expose a refetch — react-query's own staleTime naturally picks up the
  // new metadataURI on the collection page's next mount/refetch; nothing to force here.
  const { data: card } = useCollection(instance, { chainId, addresses })
  const metadata = useCollectionMetadata(card?.metadataURI)

  const [mode, setMode] = useState<'hosted' | 'paste'>('hosted')
  const [input, setInput] = useState('')
  const [build, setBuild] = useState<AllowlistBuildOutcome | undefined>(undefined)
  const [checking, setChecking] = useState(false)

  const configureTx = useTxAction({ instance })
  const metadataTx = useTxAction({ instance })

  if (!hasGatingModule(gatingModule)) return null

  async function handleCheck(): Promise<void> {
    setChecking(true)
    try {
      const result =
        mode === 'hosted' ? await buildAllowlistFromUri(input) : buildAllowlistFromPaste(input)
      setBuild(result)
    } finally {
      setChecking(false)
    }
  }

  function handleSubmitRoot(): void {
    if (build === undefined || isAllowlistBuildError(build) || gatingModule === undefined) return
    configureTx.send({
      address: gatingModule,
      abi: merkleGatingModuleAbi,
      functionName: 'configureFor',
      args: [instance, toMerkleConfig(build.root)],
      chainId: chainId,
    })
  }

  function handlePersistListUri(): void {
    if (build === undefined || isAllowlistBuildError(build) || metadata === undefined) return
    const patched = patchAllowlistRow(metadata, {
      editionId: 0,
      tierIndex: 0,
      listURI: build.listURI,
    })
    metadataTx.send({
      address: addresses.MasterRegistryV1,
      abi: masterRegistryV1Abi,
      functionName: 'updateInstanceMetadata',
      args: [instance, collectionToDataUri(patched)],
      chainId: chainId,
    })
  }

  const summary =
    build !== undefined && !isAllowlistBuildError(build)
      ? `${build.count} addresses · root ${build.root.slice(0, 10)}… ✓${
          build.invalid.length > 0 ? ` (${build.invalid.length} invalid rows skipped)` : ''
        }`
      : undefined
  const buildError = build !== undefined && isAllowlistBuildError(build) ? build.error : undefined
  const canSubmit = build !== undefined && !isAllowlistBuildError(build)

  return (
    <ActionRow
      label="configure allowlist"
      hint="submit a merkle root on-chain and persist the listURI (two transactions)"
    >
      <div className={styles.control}>
        <div>
          <button
            type="button"
            className={mode === 'hosted' ? 'btn btn-primary' : 'btn btn-secondary'}
            onClick={() => {
              setMode('hosted')
              setBuild(undefined)
            }}
            data-testid="erc404-allowlist-mode-hosted"
          >
            hosted URL
          </button>
          <button
            type="button"
            className={mode === 'paste' ? 'btn btn-primary' : 'btn btn-secondary'}
            onClick={() => {
              setMode('paste')
              setBuild(undefined)
            }}
            data-testid="erc404-allowlist-mode-paste"
          >
            paste addresses
          </button>
        </div>
        {mode === 'hosted' ? (
          <input
            className={styles.input}
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              setBuild(undefined)
            }}
            placeholder="ipfs://, ar://, or https:// listURI"
            aria-label="allowlist listURI"
            data-testid="erc404-allowlist-uri"
          />
        ) : (
          <textarea
            className={styles.input}
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              setBuild(undefined)
            }}
            placeholder={'one per line: 0xADDRESS,maxQty'}
            rows={4}
            aria-label="pasted allowlist"
            data-testid="erc404-allowlist-paste"
          />
        )}
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void handleCheck()}
          disabled={checking || input.trim() === ''}
          data-testid="erc404-allowlist-check"
        >
          {checking ? 'checking…' : 'check'}
        </button>
        {summary !== undefined && <p className={styles.hint}>{summary}</p>}
        {buildError !== undefined && (
          <p className={`${styles.hint} ${styles.txError}`}>{buildError}</p>
        )}

        <TxButton
          state={configureTx.state}
          onClick={handleSubmitRoot}
          onReset={configureTx.reset}
          label="1. submit root on-chain"
          successLabel={'root submitted — tx confirmed.'}
          disabled={!canSubmit}
          errorText={configureTx.reason ?? 'submit failed — try again'}
          testId="erc404-allowlist-configure"
        />
        <TxButton
          state={metadataTx.state}
          onClick={handlePersistListUri}
          onReset={metadataTx.reset}
          label="2. persist listURI"
          successLabel={'listURI persisted — tx confirmed.'}
          disabled={!canSubmit || metadata === undefined}
          errorText={
            metadataTx.reason ??
            'persist failed — try again (this write requires the ORIGINAL creator wallet, which may differ from the current owner)'
          }
          testId="erc404-allowlist-persist"
        />
      </div>
    </ActionRow>
  )
}
