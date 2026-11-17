/**
 * Erc404AdminPanel (W-E) — per-instance creator admin for an ERC404 bonding collection. Renders ONLY
 * when the connected wallet owns the instance (`useOwnerGate`), laid out with the shared
 * AdminSection/ActionRow primitives; every action is a `useTxAction` + `<TxButton>` writing the
 * generated `erc404BondingInstanceAbi` on the fork chain, refetching the relevant read on success.
 *
 * Actions: bonding lifecycle (active toggle, open/maturity time), metadata/style URIs, vault
 * (migrate, claim all fees, flush a stranded graduation tithe), agent delegation, and (noesis-080)
 * configure allowlist — shown only when the instance has a gating module set (today the only deployed
 * gating module IS MerkleGatingModule; PasswordTierGating was dropped in noesis-065).
 *
 * The stranded-tithe row is the one action here that is not the owner's alone: a graduation cut the
 * alignment vault could not take is stashed on the liquidity module, and re-sending it is
 * permissionless by design. It is laid out with the other vault rows because the owner is who notices,
 * but anyone may send it.
 *
 * ABI note: the generated metadata setter is `setMetadataURI` (uppercase URI), not `setMetadataUri`.
 */
import { useMemo, useState } from 'react'
import { formatEther, type Log } from 'viem'
import { useBalance, useWaitForTransactionReceipt } from 'wagmi'
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
  useReadErc404BondingInstanceReserve,
  useReadErc404BondingInstanceStakingActive,
  useReadErc404BondingInstanceStakingReserve,
  useReadErc404BondingInstanceUnit,
} from '../../../generated/contracts'
import { formatPrice } from '../../../lib/format'
import { useCollection } from '../../useCollection'
import { useCollectionMetadata } from '../../useCollectionMetadata'
import { useCollectionAddresses, useCollectionChainId } from '../useCollectionChain'
import { ArtPointerNotice } from '../ArtPointerNotice'
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
import { epochFromLocalInput, localInputFromEpoch } from '../../../lib/time/scheduleInput'
import { useTxAction } from '../../ui/useTxAction'
import { MetadataArtistPanel } from './MetadataArtistPanel'
import { canDeployLiquidity, derivePhase } from './bondingPhase'
import { useBondingData } from './useBondingData'
import { useStrandedTithe } from './useStrandedTithe'
import { useNowSec } from './useNowSec'
import { useChainClock } from './useChainClock'
import {
  clockSkewNote,
  formatMoment,
  maturityQuickPicks,
  maturityWindow,
  openQuickPicks,
  openWindow,
  pickProblem,
  refusedSendCopy,
  zoneName,
  type QuickPick,
  type TimeWindow,
} from './bondingSchedule'
import styles from './Erc404AdminPanel.module.css'

interface Erc404AdminPanelProps {
  instance: `0x${string}`
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
            <BondingScheduleRows instance={instance} />
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
        <ArtPointerNotice instance={instance} />
        <ActivateStakingRow instance={instance} />
        {bonding && <DeployLiquidityRow instance={instance} closesSaleEarly={closesSaleEarly} />}
        <BondStatusRow instance={instance} />
        <MetadataArtistPanel instance={instance} />
        <MigrateVaultRow instance={instance} />
        <ClaimAllFeesRow instance={instance} />
        <WithdrawDustRow instance={instance} />
        <StrandedTitheRow instance={instance} />
        <SetAgentDelegationRow instance={instance} />
        <AllowlistConfigRow instance={instance} />
      </AdminSection>
    </Disclosure>
  )
}

// ── bonding schedule: open time → maturity time → arm ──────────────────────────
//
// The three writes have an order the contract enforces (maturity needs an open time; arming needs an
// open time) and bounds measured against the CHAIN's clock. Every bound is worked out before the
// creator picks (bondingSchedule.ts), stated in their own time zone, and fed to the picker as its
// min/max, so a value the chain would refuse cannot be sent. A refusal after the send carries no
// reason (the instance's delegatecall drops it), which is why the form has to be right beforehand.

function BondingScheduleRows({ instance }: { instance: `0x${string}` }) {
  const chainId = useCollectionChainId()
  const { data: openTime, refetch: refetchOpen } = useReadErc404BondingInstanceBondingOpenTime({
    address: instance,
    chainId: chainId,
  })
  const { data: maturityTime, refetch: refetchMaturity } =
    useReadErc404BondingInstanceBondingMaturityTime({ address: instance, chainId: chainId })
  const { chainNow, wallNow, synced } = useChainClock(chainId)
  const clock = { chainNow, wallNow }

  const open = Number(openTime ?? 0n)
  const maturity = Number(maturityTime ?? 0n)
  const openWin = openWindow(chainNow, maturity)
  const maturityWin = maturityWindow(chainNow, open)
  const skew = clockSkewNote(clock)
  const refetch = () => {
    void refetchOpen()
    void refetchMaturity()
  }

  return (
    <>
      <div className={styles.schedule} data-testid="erc404-admin-schedule-rules">
        <p className={styles.hint}>
          Bonding runs on a schedule you set in this order. Times are in your time zone (
          {zoneName(undefined, wallNow)}).
        </p>
        <ol className={styles.scheduleSteps}>
          <li>
            <b>Open time</b>: when buying starts. Pick {formatMoment(openWin.earliest, clock)} or
            later.
          </li>
          <li>
            <b>Maturity time</b> (optional): when the sale is planned to end. It must come after the
            open time and no more than 210 days after it.
          </li>
          <li>
            <b>Activate bonding</b>: turns the sale on. It needs an open time; buying starts at that
            time.
          </li>
        </ol>
        {skew && (
          <p className={styles.hint} data-testid="erc404-admin-clock-skew">
            {skew}
          </p>
        )}
      </div>
      <SetTimeRow
        instance={instance}
        functionName="setBondingOpenTime"
        kind="open"
        label="1 · bonding open time"
        testId="erc404-admin-open-time"
        stored={open}
        window={openWin}
        quickPicks={openQuickPicks(chainNow, openWin)}
        clock={clock}
        synced={synced}
        onWritten={refetch}
      />
      <SetTimeRow
        instance={instance}
        functionName="setBondingMaturityTime"
        kind="maturity"
        label="2 · bonding maturity time"
        testId="erc404-admin-maturity"
        stored={maturity}
        window={maturityWin}
        quickPicks={maturityQuickPicks(open, maturityWin)}
        clock={clock}
        synced={synced}
        onWritten={refetch}
      />
      <SetBondingActiveRow instance={instance} openTime={openTime} />
    </>
  )
}

function SetTimeRow({
  instance,
  functionName,
  kind,
  label,
  testId,
  stored,
  window,
  quickPicks,
  clock,
  synced,
  onWritten,
}: {
  instance: `0x${string}`
  functionName: 'setBondingOpenTime' | 'setBondingMaturityTime'
  kind: 'open' | 'maturity'
  label: string
  testId: string
  stored: number
  window: TimeWindow
  quickPicks: QuickPick[]
  clock: { chainNow: number; wallNow: number }
  /** False until the chain's clock has been read; the bounds rest on the wall clock until then. */
  synced: boolean
  onWritten: () => void
}) {
  const chainId = useCollectionChainId()
  const [value, setValue] = useState('')
  const tx = useTxAction({ onSuccess: onWritten, instance })

  const picked = epochFromLocalInput(value)
  const problem = picked === null ? undefined : pickProblem(picked, window, clock)
  // Until the chain's clock is read the bounds are the wall clock's, which a chain running ahead would
  // refuse; hold the send for that one read rather than let it revert.
  const canSubmit = synced && picked !== null && problem === undefined

  const range =
    window.latest === null
      ? `${formatMoment(window.earliest, clock)} or later`
      : `between ${formatMoment(window.earliest, clock)} and ${formatMoment(window.latest, clock)}`
  const rule = window.blocked
    ? window.blocked
    : kind === 'open'
      ? window.latest === null
        ? `When buying starts. Pick ${range}.`
        : `When buying starts. Pick a time ${range}, so it stays before the maturity time.`
      : `Optional. Pick a time ${range} (up to 210 days after the open time).`
  const current = stored > 0 ? ` Now set to ${formatMoment(stored, clock)}.` : ' Not set yet.'
  // A wallet rejection is the creator's own choice and keeps the button's default wording; any other
  // failure is a refusal whose reason the instance dropped, and the likeliest one is named.
  const rejected = tx.reason !== undefined && /reject|denied/i.test(tx.reason)

  return (
    <ActionRow label={label} hint={rule + current}>
      <div className={styles.control}>
        {quickPicks.length > 0 && (
          <div className={styles.quickPicks} data-testid={`${testId}-quick`}>
            {quickPicks.map((q) => (
              <button
                key={q.label}
                type="button"
                className="btn btn-secondary"
                disabled={!q.allowed || tx.isBusy}
                title={formatMoment(q.at, clock)}
                onClick={() => setValue(localInputFromEpoch(q.at))}
              >
                {q.label}
              </button>
            ))}
          </div>
        )}
        <input
          className={styles.input}
          type="datetime-local"
          value={value}
          min={localInputFromEpoch(window.earliest)}
          max={window.latest === null ? undefined : localInputFromEpoch(window.latest)}
          onChange={(e) => setValue(e.target.value)}
          disabled={tx.isBusy || window.blocked !== undefined}
          aria-label={label}
          aria-invalid={problem !== undefined}
          data-testid={`${testId}-input`}
        />
        {problem !== undefined ? (
          <p
            className={`${styles.hint} ${styles.txError}`}
            role="alert"
            data-testid={`${testId}-problem`}
          >
            {problem}
          </p>
        ) : (
          picked !== null && (
            <p className={styles.hint} data-testid={`${testId}-preview`}>
              {kind === 'open' ? 'Opens' : 'Matures'} {formatMoment(picked, clock)}.
            </p>
          )
        )}
        <TxButton
          state={tx.state}
          onClick={() => {
            if (!canSubmit || picked === null) return
            tx.send({
              address: instance,
              abi: erc404BondingInstanceAbi,
              functionName,
              args: [BigInt(picked)],
              chainId: chainId,
            })
          }}
          label={kind === 'open' ? 'set open time' : 'set maturity time'}
          successLabel={'time updated'}
          {...(rejected ? {} : { errorText: refusedSendCopy(kind) })}
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

// ── bonding active toggle ──────────────────────────────────────────────────────

function SetBondingActiveRow({
  instance,
  openTime,
}: {
  instance: `0x${string}`
  openTime: bigint | undefined
}) {
  const chainId = useCollectionChainId()
  const { data: active, refetch } = useReadErc404BondingInstanceBondingActive({
    address: instance,
    chainId: chainId,
  })
  const tx = useTxAction({ onSuccess: () => void refetch(), instance })
  const next = !active
  // `setBondingActive` reverts `OpenTimeNotSet` with no open time; say so instead of offering it.
  const needsOpenTime = openTime === 0n

  return (
    <ActionRow
      label="3 · bonding active"
      hint={
        active === undefined
          ? 'current: …'
          : needsOpenTime
            ? 'Set the open time first (step 1), then activate.'
            : `current: ${active ? 'active' : 'inactive'}`
      }
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
        disabled={active === undefined || needsOpenTime}
        className="btn btn-secondary"
        testId="erc404-admin-set-active"
      />
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

  // bonds(instance) tuple: [creator, amount, createdAt, settled, maxBondDuration, graceDays]
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

// ── sweep the surplus a fee claim leaves behind ────────────────────────────────

function WithdrawDustRow({ instance }: { instance: `0x${string}` }) {
  const chainId = useCollectionChainId()
  const { data: balance, refetch: refetchBalance } = useBalance({ address: instance, chainId })
  const { data: reserve, refetch: refetchReserve } = useReadErc404BondingInstanceReserve({
    address: instance,
    chainId: chainId,
  })
  const { data: stakingReserve, refetch: refetchStaking } =
    useReadErc404BondingInstanceStakingReserve({ address: instance, chainId: chainId })
  const tx = useTxAction({
    onSuccess: () => {
      void refetchBalance()
      void refetchReserve()
      void refetchStaking()
    },
    instance,
  })

  // The contract's own guard, mirrored: everything above the two tracked liabilities is sweepable,
  // and it reverts `NothingToWithdraw` at or below them. `reserve` backs sellBonding refunds and
  // `stakingReserve` is ETH owed to stakers — neither is the creator's to take, ever.
  const locked = (reserve ?? 0n) + (stakingReserve ?? 0n)
  const known = balance !== undefined && reserve !== undefined && stakingReserve !== undefined
  const surplus = known && balance.value > locked ? balance.value - locked : 0n

  return (
    <ActionRow
      label="sweep surplus"
      hint={
        !known
          ? 'recover ETH held here that backs neither a sell refund nor a staker'
          : surplus === 0n
            ? 'nothing to sweep — every wei here backs a sell refund or a staker'
            : `${formatEther(surplus)} ETH here backs neither a sell refund nor a staker. Claiming fees leaves it behind; this is what takes it.`
      }
    >
      <div className={styles.control}>
        <TxButton
          state={tx.state}
          onClick={() =>
            tx.send({
              address: instance,
              abi: erc404BondingInstanceAbi,
              functionName: 'withdrawDust',
              args: [],
              chainId: chainId,
            })
          }
          label="sweep surplus"
          className="btn btn-secondary"
          receipt={
            surplus > 0n
              ? { verb: 'surplus swept', net: { label: 'you received', wei: surplus } }
              : undefined
          }
          onReset={tx.reset}
          disabled={known && surplus === 0n}
          disabledHint="the sweep reverts with nothing above the locked balances"
          errorText="sweep failed — try again"
          testId="erc404-admin-withdraw-dust"
        />
      </div>
    </ActionRow>
  )
}

// ── vault: flush a stranded graduation tithe (permissionless) ──────────────────

function StrandedTitheRow({ instance }: { instance: `0x${string}` }) {
  const { amount, canFlush, flush, tx } = useStrandedTithe(instance)

  return (
    <ActionRow
      label="flush stranded tithe"
      hint={
        amount === undefined
          ? 'permissionless — re-send a graduation cut the alignment vault could not take'
          : amount === 0n
            ? 'nothing stranded — the graduation cut was delivered'
            : `${formatPrice(amount)} stranded on the liquidity module — permissionless to re-send`
      }
    >
      <TxButton
        state={tx.state}
        onClick={flush}
        label="flush tithe"
        successLabel="stranded tithe re-sent — tx confirmed."
        onReset={tx.reset}
        className="btn btn-secondary"
        disabled={!canFlush}
        disabledHint="the flush reverts with nothing stashed"
        errorText="flush failed — try again"
        testId="erc404-admin-flush-tithe"
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
//
// The cap is authored in NFTs and rooted at `unit()` (noesis-266): this family forwards coin, at wei
// scale, to the gating module, so a leaf holding the creator's raw number would deny every listed
// wallet. Nothing can be rooted before `unit()` lands — a root built at the wrong scale is submitted
// on-chain and only reveals itself when buyers report reverts.

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
  const { data: unit } = useReadErc404BondingInstanceUnit({ address: instance, chainId: chainId })

  const [mode, setMode] = useState<'hosted' | 'paste'>('hosted')
  const [input, setInput] = useState('')
  const [build, setBuild] = useState<AllowlistBuildOutcome | undefined>(undefined)
  const [checking, setChecking] = useState(false)

  const configureTx = useTxAction({ instance })
  const metadataTx = useTxAction({ instance })

  if (!hasGatingModule(gatingModule)) return null

  async function handleCheck(): Promise<void> {
    if (unit === undefined) return
    setChecking(true)
    try {
      const result =
        mode === 'hosted'
          ? await buildAllowlistFromUri(input, unit)
          : buildAllowlistFromPaste(input, unit)
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
      ? `${build.count} addresses · caps read as NFTs, rooted in coin · root ${build.root.slice(0, 10)}… ✓${
          build.invalid.length > 0 ? ` (${build.invalid.length} invalid rows skipped)` : ''
        }`
      : undefined
  const buildError = build !== undefined && isAllowlistBuildError(build) ? build.error : undefined
  const canSubmit = build !== undefined && !isAllowlistBuildError(build)

  return (
    <ActionRow
      label="configure allowlist"
      hint="submit a merkle root on-chain and persist the listURI (two transactions). maxQty is a number of NFTs — one row per wallet, and the cap is scaled to this collection's coin for you."
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
            placeholder={'one per line: 0xADDRESS,maxQty — maxQty in NFTs, e.g. 0xabc…,5'}
            rows={4}
            aria-label="pasted allowlist"
            data-testid="erc404-allowlist-paste"
          />
        )}
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void handleCheck()}
          disabled={checking || input.trim() === '' || unit === undefined}
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
