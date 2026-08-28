/**
 * FeaturedPanel — user-facing featured-queue economics for a single collection. This is monetization,
 * NOT owner-gated: anyone may boost a collection onto the featured queue, raise its rank, renew,
 * or prune an expired slot
 * (FeaturedQueueManager, Interface H). All ETH amounts are entered via AmountField/parseAmount;
 * durations are entered in days (plain number inputs) and converted to seconds. Each action goes
 * through useTxAction + TxButton and refetches getRentalInfo on success.
 *
 * value math (confirmed against contracts/src/master/FeaturedQueueManager.sol):
 *   rentFeatured(instance, durationSecs, rankBoostWei) →
 *     value = quoteDurationCost(durationSecs) + rankBoostWei   (excess refunds)
 *   boostRank(instance) → value = rankBoostWei                 (msg.value IS the boost)
 *   renewDuration(instance, addSecs) → value = quoteDurationCost(addSecs)  (excess refunds)
 *   pruneExpired(instance) → non-payable, permissionless
 */
import { useMemo, useState } from 'react'
import { decodeEventLog, type Log } from 'viem'
import { useWaitForTransactionReceipt } from 'wagmi'
import {
  featuredQueueManagerAbi,
  useReadFeaturedQueueManagerGetRentalInfo,
  useReadFeaturedQueueManagerQuoteDurationCost,
} from '../../generated/contracts'
import { forkAddresses, forkChainId } from '../../lib/addresses'
import { formatPrice, formatPriceTitle, truncateAddress } from '../../lib/format'
import { AmountField } from '../ui/AmountField'
import { parseAmount } from '../ui/parseAmount'
import { TxButton } from '../ui/TxButton'
import { Disclosure } from '../ui/Disclosure'
import { useTxAction } from '../ui/useTxAction'
import styles from './FeaturedPanel.module.css'

const FQM = forkAddresses.FeaturedQueueManager
const DAY_SECS = 86_400n
const MIN_DAYS = 7
const MAX_DAYS = 365

/** Parse a whole-day count string; undefined when empty/invalid/out of [MIN_DAYS, MAX_DAYS]. */
function parseDays(raw: string): number | undefined {
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return undefined
  const days = Number(trimmed)
  if (days < MIN_DAYS || days > MAX_DAYS) return undefined
  return days
}

// Reads the authoritative amount actually paid off the confirmed tx receipt — `rentFeatured` and
// `renewDuration` both refund `msg.value` in excess of the quoted cost
// (`FeaturedQueueManager.sol`), so a snapshot of the wei sent at click time can overstate the
// confirmation whenever that refund fires. `FeaturedRented.durationCost + rankBoost` and
// `DurationRenewed.cost` are the amounts the module actually forwarded to `protocolTreasury`.
function rentEventTotal(logs: readonly Log[]): bigint | undefined {
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: featuredQueueManagerAbi,
        data: log.data,
        topics: log.topics,
      })
      if (decoded.eventName === 'FeaturedRented') {
        return decoded.args.durationCost + decoded.args.rankBoost
      }
    } catch {
      // Not a FeaturedRented log (a different event, or a log from another contract in the same
      // tx) — decodeEventLog throws on a topic0 mismatch; skip it and keep scanning.
    }
  }
  return undefined
}

function renewEventTotal(logs: readonly Log[]): bigint | undefined {
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: featuredQueueManagerAbi,
        data: log.data,
        topics: log.topics,
      })
      if (decoded.eventName === 'DurationRenewed') {
        return decoded.args.cost
      }
    } catch {
      // Not a DurationRenewed log — decodeEventLog throws on a topic0 mismatch; skip and keep
      // scanning.
    }
  }
  return undefined
}

export function FeaturedPanel({ instance }: { instance: `0x${string}` }) {
  const { data: rental, refetch } = useReadFeaturedQueueManagerGetRentalInfo({
    address: FQM,
    chainId: forkChainId,
    args: [instance],
  })

  const [renter, effectiveRank, expiresAt, isActive] = rental ?? [
    undefined,
    undefined,
    undefined,
    undefined,
  ]

  const nowSecs = BigInt(Math.floor(Date.now() / 1000))
  const expired = expiresAt !== undefined && expiresAt > 0n && expiresAt <= nowSecs
  const featured = isActive === true && !expired

  // ---- Rent ----------------------------------------------------------------
  const [rentDays, setRentDays] = useState('')
  const [rentBoost, setRentBoost] = useState('')
  const rentDaysParsed = parseDays(rentDays)
  const rentDurationSecs =
    rentDaysParsed !== undefined ? BigInt(rentDaysParsed) * DAY_SECS : undefined
  const rentBoostWei = rentBoost.trim() === '' ? 0n : parseAmount(rentBoost)
  const rentBoostValid = rentBoost.trim() === '' || rentBoostWei !== undefined

  const { data: rentQuote } = useReadFeaturedQueueManagerQuoteDurationCost({
    address: FQM,
    chainId: forkChainId,
    args: rentDurationSecs !== undefined ? [rentDurationSecs] : undefined,
    query: { enabled: rentDurationSecs !== undefined },
  })

  const rentValue =
    rentQuote !== undefined && rentBoostWei !== undefined ? rentQuote + rentBoostWei : undefined

  const rentTx = useTxAction({ onSuccess: refetch })
  const { data: rentReceiptData } = useWaitForTransactionReceipt({ hash: rentTx.hash })
  const rentPaidWei = useMemo(
    () => (rentReceiptData !== undefined ? rentEventTotal(rentReceiptData.logs) : undefined),
    [rentReceiptData],
  )

  function handleRent(): void {
    if (rentDurationSecs === undefined || rentBoostWei === undefined || rentValue === undefined)
      return
    rentTx.send({
      address: FQM,
      abi: featuredQueueManagerAbi,
      functionName: 'rentFeatured',
      args: [instance, rentDurationSecs, rentBoostWei],
      value: rentValue,
      chainId: forkChainId,
    })
  }

  // ---- Boost ---------------------------------------------------------------
  const [boost, setBoost] = useState('')
  const boostWei = parseAmount(boost)
  const boostTx = useTxAction({ onSuccess: refetch })
  const [boostSentWei, setBoostSentWei] = useState<bigint | undefined>(undefined)

  function handleBoost(): void {
    if (boostWei === undefined || boostWei === 0n) return
    setBoostSentWei(boostWei)
    boostTx.send({
      address: FQM,
      abi: featuredQueueManagerAbi,
      functionName: 'boostRank',
      args: [instance],
      value: boostWei,
      chainId: forkChainId,
    })
  }

  // ---- Renew ---------------------------------------------------------------
  const [renewDays, setRenewDays] = useState('')
  const renewDaysParsed = parseDays(renewDays)
  const renewSecs = renewDaysParsed !== undefined ? BigInt(renewDaysParsed) * DAY_SECS : undefined

  const { data: renewQuote } = useReadFeaturedQueueManagerQuoteDurationCost({
    address: FQM,
    chainId: forkChainId,
    args: renewSecs !== undefined ? [renewSecs] : undefined,
    query: { enabled: renewSecs !== undefined },
  })

  const renewTx = useTxAction({ onSuccess: refetch })
  const { data: renewReceiptData } = useWaitForTransactionReceipt({ hash: renewTx.hash })
  const renewPaidWei = useMemo(
    () => (renewReceiptData !== undefined ? renewEventTotal(renewReceiptData.logs) : undefined),
    [renewReceiptData],
  )

  function handleRenew(): void {
    if (renewSecs === undefined || renewQuote === undefined) return
    renewTx.send({
      address: FQM,
      abi: featuredQueueManagerAbi,
      functionName: 'renewDuration',
      args: [instance, renewSecs],
      value: renewQuote,
      chainId: forkChainId,
    })
  }

  // ---- Prune ---------------------------------------------------------------
  const pruneTx = useTxAction({ onSuccess: refetch })

  function handlePrune(): void {
    pruneTx.send({
      address: FQM,
      abi: featuredQueueManagerAbi,
      functionName: 'pruneExpired',
      args: [instance],
      chainId: forkChainId,
    })
  }

  const expiryLabel =
    expiresAt !== undefined && expiresAt > 0n
      ? new Date(Number(expiresAt) * 1000).toLocaleString()
      : '—'

  return (
    <Disclosure summary="BOOST" testId="featured-panel">
      <p className={styles.note}>
        Featuring puts this collection on the <b>front-page featured row</b> — paid placement,
        ranked by how much ETH is boosted. Permissionless: anyone can boost a collection or raise
        its rank.
      </p>
      {/* ---- Status ---------------------------------------------------- */}
      <div className={styles.status}>
        {featured ? (
          <>
            <div className={styles.statRow}>
              <span className={styles.statLabel}>status</span>
              <span className="badge badge-solid">featured</span>
            </div>
            <div className={styles.statRow}>
              <span className={styles.statLabel}>renter</span>
              <span className={styles.statValue}>{renter ? truncateAddress(renter) : '—'}</span>
            </div>
            <div className={styles.statRow}>
              <span className={styles.statLabel}>effective rank</span>
              <span className={styles.statValue}>
                {effectiveRank !== undefined ? effectiveRank.toString() : '—'}
              </span>
            </div>
            <div className={styles.statRow}>
              <span className={styles.statLabel}>expires</span>
              <span className={styles.statValue}>{expiryLabel}</span>
            </div>
          </>
        ) : (
          <p className={styles.note}>
            {expired
              ? 'this collection’s featured slot has expired — boost it again below or prune it.'
              : 'this collection is not currently featured. boost it below to get on the queue.'}
          </p>
        )}
      </div>

      {/* ---- Rent ------------------------------------------------------ */}
      <div className={styles.action}>
        <h3 className={styles.actionTitle}>boost this collection</h3>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="featured-rent-days">
            duration (days, {MIN_DAYS}–{MAX_DAYS})
          </label>
          <input
            id="featured-rent-days"
            className={styles.dayInput}
            type="number"
            min={MIN_DAYS}
            max={MAX_DAYS}
            inputMode="numeric"
            value={rentDays}
            onChange={(e) => setRentDays(e.target.value)}
            placeholder="30"
          />
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>rank boost (optional)</span>
          <AmountField
            value={rentBoost}
            onChange={setRentBoost}
            unit="ETH"
            placeholder="0"
            ariaLabel="additional rank boost in ETH"
          />
        </div>
        <p
          className={styles.quote}
          title={
            rentDurationSecs !== undefined && rentQuote !== undefined && rentBoostValid
              ? `cost: ${formatPriceTitle(rentQuote)} duration${
                  rentBoostWei && rentBoostWei > 0n
                    ? ` + ${formatPriceTitle(rentBoostWei)} boost`
                    : ''
                } = ${rentValue !== undefined ? formatPriceTitle(rentValue) : '—'}`
              : undefined
          }
        >
          {rentDurationSecs === undefined
            ? `enter a duration between ${MIN_DAYS} and ${MAX_DAYS} days`
            : rentQuote === undefined
              ? 'fetching cost…'
              : !rentBoostValid
                ? 'invalid rank boost amount'
                : `cost: ${formatPrice(rentQuote)} duration${
                    rentBoostWei && rentBoostWei > 0n ? ` + ${formatPrice(rentBoostWei)} boost` : ''
                  } = ${rentValue !== undefined ? formatPrice(rentValue) : '—'}`}
        </p>
        <TxButton
          state={rentTx.state}
          onClick={handleRent}
          label="boost"
          disabled={rentDurationSecs === undefined || rentValue === undefined}
          disabledHint={`enter a duration (${MIN_DAYS}–${MAX_DAYS} days) above to boost`}
          onReset={rentTx.reset}
          receipt={
            rentPaidWei !== undefined
              ? { verb: 'boosted', net: { label: 'paid', wei: rentPaidWei } }
              : undefined
          }
          successLabel={rentPaidWei === undefined ? 'boosted — confirmed.' : undefined}
          testId="featured-rent"
        />
      </div>

      {/* ---- Boost ----------------------------------------------------- */}
      <div className={styles.action}>
        <h3 className={styles.actionTitle}>raise rank</h3>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>add ETH to rank score</span>
          <AmountField
            value={boost}
            onChange={setBoost}
            unit="ETH"
            placeholder="0.01"
            ariaLabel="rank boost in ETH"
          />
        </div>
        <p className={styles.hint}>
          the full amount is added to this collection’s cumulative rank.
        </p>
        <TxButton
          state={boostTx.state}
          onClick={handleBoost}
          label="raise rank"
          className="btn btn-secondary"
          disabled={boostWei === undefined || boostWei === 0n}
          disabledHint="enter an ETH amount above to raise rank"
          onReset={boostTx.reset}
          receipt={
            boostSentWei !== undefined
              ? { verb: 'rank raised', net: { label: 'sent', wei: boostSentWei } }
              : undefined
          }
          testId="featured-boost"
        />
      </div>

      {/* ---- Renew ----------------------------------------------------- */}
      <div className={styles.action}>
        <h3 className={styles.actionTitle}>renew duration</h3>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="featured-renew-days">
            additional days ({MIN_DAYS}–{MAX_DAYS})
          </label>
          <input
            id="featured-renew-days"
            className={styles.dayInput}
            type="number"
            min={MIN_DAYS}
            max={MAX_DAYS}
            inputMode="numeric"
            value={renewDays}
            onChange={(e) => setRenewDays(e.target.value)}
            placeholder="14"
          />
        </div>
        <p
          className={styles.quote}
          title={renewQuote !== undefined ? `cost: ${formatPriceTitle(renewQuote)}` : undefined}
        >
          {renewSecs === undefined
            ? `enter ${MIN_DAYS}–${MAX_DAYS} additional days`
            : renewQuote === undefined
              ? 'fetching cost…'
              : `cost: ${formatPrice(renewQuote)}`}
        </p>
        <TxButton
          state={renewTx.state}
          onClick={handleRenew}
          label="renew duration"
          className="btn btn-secondary"
          disabled={renewSecs === undefined || renewQuote === undefined}
          disabledHint={`enter additional days (${MIN_DAYS}–${MAX_DAYS}) above to renew`}
          onReset={renewTx.reset}
          receipt={
            renewPaidWei !== undefined
              ? { verb: 'duration renewed', net: { label: 'paid', wei: renewPaidWei } }
              : undefined
          }
          successLabel={renewPaidWei === undefined ? 'duration renewed — confirmed.' : undefined}
          testId="featured-renew"
        />
      </div>

      {/* ---- Prune (only when slot looks expired) ---------------------- */}
      {expired && (
        <div className={styles.action}>
          <h3 className={styles.actionTitle}>prune expired slot</h3>
          <p className={styles.hint}>
            permissionless cleanup — removes the lapsed slot from the queue.
          </p>
          <TxButton
            state={pruneTx.state}
            onClick={handlePrune}
            label="prune expired"
            className="btn btn-secondary"
            onReset={pruneTx.reset}
            successLabel={'slot pruned ✓'}
            testId="featured-prune"
          />
        </div>
      )}
    </Disclosure>
  )
}
