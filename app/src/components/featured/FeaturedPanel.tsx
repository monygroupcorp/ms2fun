/**
 * FeaturedPanel — user-facing featured-queue economics for a single collection. This is monetization,
 * NOT owner-gated: anyone may rent a featured slot, boost rank, renew, or prune an expired slot
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
import { useState } from 'react'
import { formatEther } from 'viem'
import {
  featuredQueueManagerAbi,
  useReadFeaturedQueueManagerGetRentalInfo,
  useReadFeaturedQueueManagerQuoteDurationCost,
} from '../../generated/contracts'
import { forkAddresses, forkChainId } from '../../lib/addresses'
import { truncateAddress } from '../../lib/format'
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

  function handleBoost(): void {
    if (boostWei === undefined || boostWei === 0n) return
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
    <Disclosure summary="FEATURED QUEUE" testId="featured-panel">
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
              ? 'this collection’s featured slot has expired — rent again below or prune it.'
              : 'this collection is not currently featured. rent a slot below to boost its visibility.'}
          </p>
        )}
      </div>

      {/* ---- Rent ------------------------------------------------------ */}
      <div className={styles.action}>
        <h3 className={styles.actionTitle}>rent a featured slot</h3>
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
            ariaLabel="rent rank boost in ETH"
          />
        </div>
        <p className={styles.quote}>
          {rentDurationSecs === undefined
            ? `enter a duration between ${MIN_DAYS} and ${MAX_DAYS} days`
            : rentQuote === undefined
              ? 'fetching cost…'
              : !rentBoostValid
                ? 'invalid rank boost amount'
                : `cost: ${formatEther(rentQuote)} ETH duration${
                    rentBoostWei && rentBoostWei > 0n
                      ? ` + ${formatEther(rentBoostWei)} ETH boost`
                      : ''
                  } = ${rentValue !== undefined ? formatEther(rentValue) : '—'} ETH`}
        </p>
        <TxButton
          state={rentTx.state}
          onClick={handleRent}
          label="rent featured"
          disabled={rentDurationSecs === undefined || rentValue === undefined}
          onReset={rentTx.reset}
          successLabel="featured slot rented ✓"
          testId="featured-rent"
        />
      </div>

      {/* ---- Boost ----------------------------------------------------- */}
      <div className={styles.action}>
        <h3 className={styles.actionTitle}>boost rank</h3>
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
          label="boost rank"
          className="btn btn-secondary"
          disabled={boostWei === undefined || boostWei === 0n}
          onReset={boostTx.reset}
          successLabel="rank boosted ✓"
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
        <p className={styles.quote}>
          {renewSecs === undefined
            ? `enter ${MIN_DAYS}–${MAX_DAYS} additional days`
            : renewQuote === undefined
              ? 'fetching cost…'
              : `cost: ${formatEther(renewQuote)} ETH`}
        </p>
        <TxButton
          state={renewTx.state}
          onClick={handleRenew}
          label="renew duration"
          className="btn btn-secondary"
          disabled={renewSecs === undefined || renewQuote === undefined}
          onReset={renewTx.reset}
          successLabel="duration renewed ✓"
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
            successLabel="slot pruned ✓"
            testId="featured-prune"
          />
        </div>
      )}
    </Disclosure>
  )
}
