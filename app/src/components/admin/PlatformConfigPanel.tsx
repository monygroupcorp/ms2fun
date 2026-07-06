/**
 * PlatformConfigPanel (W-K4) — protocol-admin console for the two "platform-wide" config surfaces of
 * Interface K:
 *
 *   1. Featured-queue config (FeaturedQueueManager): the economic knobs of the rentable featured
 *      slots — daily rent rate (ETH/day), daily decay rate, duration bounds (min/max), and the max
 *      number of featured slots.
 *   2. Agent delegation (MasterRegistry): the protocol-level "agents act for users/collections"
 *      controls — authorize/deauthorize an agent, emergency-revoke an agent, and set the address
 *      allowed to perform emergency revocations.
 *
 * Each section is gated INDEPENDENTLY on the `owner()` of its own registry (they may be different
 * Safes), via useOwnerGate. A non-owner of a registry sees nothing for that section. Everything goes
 * through the Phase-0 useTxAction + TxButton idiom inside AdminSection / ActionRow.
 *
 * Units (confirmed against src/generated/contracts.ts):
 *   - setDailyRate(uint256 _dailyRate) — ETH/day, parsed as 18-decimal wei.
 *   - setDailyDecayRate(uint256 _dailyDecayRate) — raw uint256 (entered raw, 0 decimals).
 *   - setDurationBounds(uint256 _min, uint256 _max) — SECONDS; entered as DAYS, converted ×86400.
 *   - setMaxFeaturedSize(uint256 _max) — raw count (entered raw, 0 decimals).
 *   - setAgent(address agent, bool authorized) — toggle an agent's authorization.
 *   - revokeAgent(address agent) — emergency single-agent revoke.
 *   - setEmergencyRevoker(address _revoker) — set who may emergency-revoke.
 */
import { useState } from 'react'
import { formatEther } from 'viem'
import {
  erc404FactoryAbi,
  featuredQueueManagerAbi,
  globalMessageRegistryAbi,
  masterRegistryV1Abi,
  useReadErc404FactoryCarveBracketParams,
  useReadErc404FactoryMinPoolEth,
  useReadGlobalMessageRegistryPostThreshold,
} from '../../generated/contracts'
import { AdminSection, ActionRow } from '../ui/AdminSection'
import { AmountField } from '../ui/AmountField'
import { TxButton } from '../ui/TxButton'
import { parseAmount } from '../ui/parseAmount'
import { useOwnerGate } from '../ui/useOwnerGate'
import { useTxAction } from '../ui/useTxAction'
import { forkAddresses, forkChainId } from '../../lib/addresses'
import styles from './PlatformConfigPanel.module.css'

const SECONDS_PER_DAY = 86_400n
const isAddress = (v: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(v.trim())

export function PlatformConfigPanel() {
  return (
    <div className={styles.panel}>
      <FeaturedConfigSection />
      <AgentsSection />
      <MessageBoardSection />
      <CarveEconomicsSection />
    </div>
  )
}

// ── Section 1: Featured-queue config (FeaturedQueueManager) ──────────────────────

function FeaturedConfigSection() {
  const { isOwner } = useOwnerGate(forkAddresses.FeaturedQueueManager)
  if (!isOwner) return null

  return (
    <AdminSection title="featured-queue config" testId="admin-featured-config">
      <DailyRateRow />
      <DecayRateRow />
      <DurationBoundsRow />
      <MaxSizeRow />
    </AdminSection>
  )
}

function DailyRateRow() {
  const [rate, setRate] = useState('')
  const tx = useTxAction({ onSuccess: () => setRate('') })
  const value = parseAmount(rate) // ETH/day → wei (18 decimals)
  const canSubmit = value !== undefined

  return (
    <ActionRow label="daily rate" hint="rent charged per featured slot per day (ETH/day)">
      <div className={styles.form}>
        <AmountField
          value={rate}
          onChange={setRate}
          placeholder="daily rate"
          unit="ETH"
          disabled={tx.isBusy}
          ariaLabel="featured daily rate in ETH"
          testId="admin-daily-rate-input"
        />
        <TxButton
          state={tx.state}
          onClick={() => {
            if (value === undefined) return
            tx.send({
              address: forkAddresses.FeaturedQueueManager,
              abi: featuredQueueManagerAbi,
              functionName: 'setDailyRate',
              args: [value],
              chainId: forkChainId,
            })
          }}
          label="set daily rate"
          successLabel="daily rate set — tx confirmed."
          onReset={tx.reset}
          disabled={!canSubmit}
          errorText="set failed — try again"
          testId="admin-set-daily-rate"
        />
      </div>
    </ActionRow>
  )
}

function DecayRateRow() {
  const [decay, setDecay] = useState('')
  const tx = useTxAction({ onSuccess: () => setDecay('') })
  const value = parseAmount(decay, 0) // raw uint256
  const canSubmit = value !== undefined

  return (
    <ActionRow label="daily decay rate" hint="per-day decay applied to featured rent (raw uint)">
      <div className={styles.form}>
        <AmountField
          value={decay}
          onChange={setDecay}
          placeholder="decay rate"
          disabled={tx.isBusy}
          ariaLabel="featured daily decay rate"
          testId="admin-decay-input"
        />
        <TxButton
          state={tx.state}
          onClick={() => {
            if (value === undefined) return
            tx.send({
              address: forkAddresses.FeaturedQueueManager,
              abi: featuredQueueManagerAbi,
              functionName: 'setDailyDecayRate',
              args: [value],
              chainId: forkChainId,
            })
          }}
          label="set decay rate"
          className="btn btn-secondary"
          successLabel="decay rate set — tx confirmed."
          onReset={tx.reset}
          disabled={!canSubmit}
          errorText="set failed — try again"
          testId="admin-set-decay"
        />
      </div>
    </ActionRow>
  )
}

function DurationBoundsRow() {
  const [min, setMin] = useState('')
  const [max, setMax] = useState('')
  const tx = useTxAction({
    onSuccess: () => {
      setMin('')
      setMax('')
    },
  })
  // Entered as DAYS, sent as SECONDS (the contract stores bounds in seconds).
  const minDays = parseAmount(min, 0)
  const maxDays = parseAmount(max, 0)
  const canSubmit = minDays !== undefined && maxDays !== undefined && maxDays >= minDays

  return (
    <ActionRow
      label="duration bounds"
      hint="min / max featured duration in DAYS (sent on-chain as seconds)"
    >
      <div className={styles.form}>
        <div className={styles.pair}>
          <AmountField
            value={min}
            onChange={setMin}
            placeholder="min"
            unit="days"
            disabled={tx.isBusy}
            ariaLabel="minimum featured duration in days"
            testId="admin-bounds-min"
          />
          <AmountField
            value={max}
            onChange={setMax}
            placeholder="max"
            unit="days"
            disabled={tx.isBusy}
            ariaLabel="maximum featured duration in days"
            testId="admin-bounds-max"
          />
        </div>
        <TxButton
          state={tx.state}
          onClick={() => {
            if (minDays === undefined || maxDays === undefined) return
            tx.send({
              address: forkAddresses.FeaturedQueueManager,
              abi: featuredQueueManagerAbi,
              functionName: 'setDurationBounds',
              args: [minDays * SECONDS_PER_DAY, maxDays * SECONDS_PER_DAY],
              chainId: forkChainId,
            })
          }}
          label="set bounds"
          className="btn btn-secondary"
          successLabel="duration bounds set — tx confirmed."
          onReset={tx.reset}
          disabled={!canSubmit}
          errorText="set failed — try again"
          testId="admin-set-bounds"
        />
      </div>
    </ActionRow>
  )
}

function MaxSizeRow() {
  const [size, setSize] = useState('')
  const tx = useTxAction({ onSuccess: () => setSize('') })
  const value = parseAmount(size, 0) // raw count
  const canSubmit = value !== undefined

  return (
    <ActionRow label="max featured size" hint="maximum number of simultaneously-featured slots">
      <div className={styles.form}>
        <AmountField
          value={size}
          onChange={setSize}
          placeholder="max size"
          unit="slots"
          disabled={tx.isBusy}
          ariaLabel="maximum featured size"
          testId="admin-max-size-input"
        />
        <TxButton
          state={tx.state}
          onClick={() => {
            if (value === undefined) return
            tx.send({
              address: forkAddresses.FeaturedQueueManager,
              abi: featuredQueueManagerAbi,
              functionName: 'setMaxFeaturedSize',
              args: [value],
              chainId: forkChainId,
            })
          }}
          label="set max size"
          className="btn btn-secondary"
          successLabel="max size set — tx confirmed."
          onReset={tx.reset}
          disabled={!canSubmit}
          errorText="set failed — try again"
          testId="admin-set-max-size"
        />
      </div>
    </ActionRow>
  )
}

// ── Section 2: Agent delegation (MasterRegistry) ─────────────────────────────────

function AgentsSection() {
  const { isOwner } = useOwnerGate(forkAddresses.MasterRegistryV1)
  if (!isOwner) return null

  return (
    <AdminSection title="agent delegation" testId="admin-agents">
      <SetAgentRow />
      <RevokeAgentRow />
      <SetRevokerRow />
    </AdminSection>
  )
}

function SetAgentRow() {
  const [agent, setAgent] = useState('')
  const [authorized, setAuthorized] = useState(true)
  const tx = useTxAction({ onSuccess: () => setAgent('') })
  const valid = isAddress(agent)

  return (
    <ActionRow
      label="set agent"
      hint="authorize or deauthorize an agent to act for users / collections"
    >
      <div className={styles.form}>
        <input
          className={styles.addrInput}
          type="text"
          value={agent}
          onChange={(e) => setAgent(e.target.value)}
          placeholder="agent address (0x…)"
          disabled={tx.isBusy}
          aria-label="agent address"
        />
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={authorized}
            onChange={(e) => setAuthorized(e.target.checked)}
            disabled={tx.isBusy}
            aria-label="agent authorized"
          />
          <span>{authorized ? 'authorized' : 'deauthorized'}</span>
        </label>
        <TxButton
          state={tx.state}
          onClick={() => {
            if (!valid) return
            tx.send({
              address: forkAddresses.MasterRegistryV1,
              abi: masterRegistryV1Abi,
              functionName: 'setAgent',
              args: [agent.trim() as `0x${string}`, authorized],
              chainId: forkChainId,
            })
          }}
          label="set agent"
          successLabel="agent updated — tx confirmed."
          onReset={tx.reset}
          disabled={!valid}
          errorText="set failed — try again"
          testId="admin-set-agent"
        />
      </div>
    </ActionRow>
  )
}

function RevokeAgentRow() {
  const [agent, setAgent] = useState('')
  const tx = useTxAction({ onSuccess: () => setAgent('') })
  const valid = isAddress(agent)

  return (
    <ActionRow label="revoke agent" hint="emergency: immediately revoke an agent's authorization">
      <div className={styles.form}>
        <input
          className={styles.addrInput}
          type="text"
          value={agent}
          onChange={(e) => setAgent(e.target.value)}
          placeholder="agent address (0x…)"
          disabled={tx.isBusy}
          aria-label="agent address to revoke"
        />
        <TxButton
          state={tx.state}
          onClick={() => {
            if (!valid) return
            tx.send({
              address: forkAddresses.MasterRegistryV1,
              abi: masterRegistryV1Abi,
              functionName: 'revokeAgent',
              args: [agent.trim() as `0x${string}`],
              chainId: forkChainId,
            })
          }}
          label="revoke agent"
          className="btn btn-secondary"
          successLabel="agent revoked — tx confirmed."
          onReset={tx.reset}
          disabled={!valid}
          errorText="revoke failed — try again"
          testId="admin-revoke-agent"
        />
      </div>
    </ActionRow>
  )
}

function SetRevokerRow() {
  const [revoker, setRevoker] = useState('')
  const tx = useTxAction({ onSuccess: () => setRevoker('') })
  const valid = isAddress(revoker)

  return (
    <ActionRow
      label="emergency revoker"
      hint="set the address allowed to perform emergency revokes"
    >
      <div className={styles.form}>
        <input
          className={styles.addrInput}
          type="text"
          value={revoker}
          onChange={(e) => setRevoker(e.target.value)}
          placeholder="revoker address (0x…)"
          disabled={tx.isBusy}
          aria-label="emergency revoker address"
        />
        <TxButton
          state={tx.state}
          onClick={() => {
            if (!valid) return
            tx.send({
              address: forkAddresses.MasterRegistryV1,
              abi: masterRegistryV1Abi,
              functionName: 'setEmergencyRevoker',
              args: [revoker.trim() as `0x${string}`],
              chainId: forkChainId,
            })
          }}
          label="set revoker"
          className="btn btn-secondary"
          successLabel="revoker set — tx confirmed."
          onReset={tx.reset}
          disabled={!valid}
          errorText="set failed — try again"
          testId="admin-set-revoker"
        />
      </div>
    </ActionRow>
  )
}

// ── Section 3: Message board (GlobalMessageRegistry) ─────────────────────────────

function MessageBoardSection() {
  const { isOwner } = useOwnerGate(forkAddresses.GlobalMessageRegistry)
  if (!isOwner) return null

  return (
    <AdminSection title="message board" testId="admin-message-board">
      <PostThresholdRow />
    </AdminSection>
  )
}

/**
 * The N12 spam lever. Raising the threshold hides feed posts whose attached ETH is below it (a
 * display filter — posting below it is NOT rejected on-chain). Enter 0 to show every post again.
 */
function PostThresholdRow() {
  const [amount, setAmount] = useState('')
  const { data: current, refetch } = useReadGlobalMessageRegistryPostThreshold({
    address: forkAddresses.GlobalMessageRegistry,
    chainId: forkChainId,
  })
  const tx = useTxAction({
    onSuccess: () => {
      setAmount('')
      void refetch()
    },
  })
  const value = parseAmount(amount) // ETH → wei (0 is valid: lowers the lever back down)
  const canSubmit = value !== undefined

  return (
    <ActionRow
      label="post threshold"
      hint={`feed hides posts below this (enter 0 to show all). current: ${
        current !== undefined ? formatEther(current) : '…'
      } ETH`}
    >
      <div className={styles.form}>
        <AmountField
          value={amount}
          onChange={setAmount}
          placeholder="0"
          unit="ETH"
          disabled={tx.isBusy}
          ariaLabel="post threshold in ETH"
          testId="admin-post-threshold-input"
        />
        <TxButton
          state={tx.state}
          onClick={() => {
            if (value === undefined) return
            tx.send({
              address: forkAddresses.GlobalMessageRegistry,
              abi: globalMessageRegistryAbi,
              functionName: 'setPostThreshold',
              args: [value],
              chainId: forkChainId,
            })
          }}
          label="set threshold"
          successLabel="threshold set — tx confirmed."
          onReset={tx.reset}
          disabled={!canSubmit}
          errorText="set failed — try again"
          testId="admin-set-post-threshold"
        />
      </div>
    </ActionRow>
  )
}

// ── Section 4: ERC404 graduation economics (ERC404Factory) ───────────────────────
// The creator-carve levers: the pool floor (a carve-CLAMP, never a graduation gate) and the
// progressive allowance brackets (50%/25%/10% at 4/20 ETH by default). Gated on the factory's
// owner() — the PROTOCOL_ROLE holder in practice (same address at deploy).

function CarveEconomicsSection() {
  const { isOwner } = useOwnerGate(forkAddresses.ERC404Factory)
  if (!isOwner) return null

  return (
    <AdminSection title="graduation economics (erc404)" testId="admin-carve-economics">
      <MinPoolEthRow />
      <CarveBracketsRow />
    </AdminSection>
  )
}

function MinPoolEthRow() {
  const [amount, setAmount] = useState('')
  const { data: current, refetch } = useReadErc404FactoryMinPoolEth({
    address: forkAddresses.ERC404Factory,
    chainId: forkChainId,
  })
  const tx = useTxAction({
    onSuccess: () => {
      setAmount('')
      void refetch()
    },
  })
  const value = parseAmount(amount) // ETH → wei
  const canSubmit = value !== undefined

  return (
    <ActionRow
      label="graduation pool floor"
      hint={`minimum ETH the LP pool keeps at graduation — clamps the creator carve, never blocks graduation. current: ${
        current !== undefined ? formatEther(current) : '…'
      } ETH`}
    >
      <div className={styles.form}>
        <AmountField
          value={amount}
          onChange={setAmount}
          placeholder="1"
          unit="ETH"
          disabled={tx.isBusy}
          ariaLabel="graduation pool floor in ETH"
          testId="admin-min-pool-eth-input"
        />
        <TxButton
          state={tx.state}
          onClick={() => {
            if (value === undefined) return
            tx.send({
              address: forkAddresses.ERC404Factory,
              abi: erc404FactoryAbi,
              functionName: 'setMinPoolEth',
              args: [value],
              chainId: forkChainId,
            })
          }}
          label="set pool floor"
          successLabel="pool floor set — tx confirmed."
          onReset={tx.reset}
          disabled={!canSubmit}
          errorText="set failed — try again"
          testId="admin-set-min-pool-eth"
        />
      </div>
    </ActionRow>
  )
}

function CarveBracketsRow() {
  const [b1, setB1] = useState('')
  const [b2, setB2] = useState('')
  const [r1, setR1] = useState('')
  const [r2, setR2] = useState('')
  const [r3, setR3] = useState('')
  const { data: current, refetch } = useReadErc404FactoryCarveBracketParams({
    address: forkAddresses.ERC404Factory,
    chainId: forkChainId,
  })
  const tx = useTxAction({
    onSuccess: () => {
      setB1('')
      setB2('')
      setR1('')
      setR2('')
      setR3('')
      void refetch()
    },
  })

  const b1Wei = parseAmount(b1) // ETH breakpoints → wei
  const b2Wei = parseAmount(b2)
  const r1Bps = parseAmount(r1, 0) // bps rates, raw
  const r2Bps = parseAmount(r2, 0)
  const r3Bps = parseAmount(r3, 0)
  const canSubmit =
    b1Wei !== undefined &&
    b2Wei !== undefined &&
    r1Bps !== undefined &&
    r2Bps !== undefined &&
    r3Bps !== undefined &&
    b2Wei >= b1Wei &&
    r1Bps <= 10_000n &&
    r2Bps <= 10_000n &&
    r3Bps <= 10_000n

  const currentHint = current
    ? `current: ${current.r1}/${current.r2}/${current.r3} bps at ${formatEther(current.b1)}/${formatEther(current.b2)} ETH`
    : 'current: …'

  return (
    <ActionRow
      label="carve allowance brackets"
      hint={`progressive creator-carve rates: r1 of the first b1 ETH, r2 up to b2, r3 beyond. ${currentHint}`}
    >
      <div className={styles.form}>
        <div className={styles.pair}>
          <AmountField
            value={b1}
            onChange={setB1}
            placeholder="b1"
            unit="ETH"
            disabled={tx.isBusy}
            ariaLabel="first bracket breakpoint in ETH"
            testId="admin-carve-b1"
          />
          <AmountField
            value={b2}
            onChange={setB2}
            placeholder="b2"
            unit="ETH"
            disabled={tx.isBusy}
            ariaLabel="second bracket breakpoint in ETH"
            testId="admin-carve-b2"
          />
        </div>
        <div className={styles.pair}>
          <AmountField
            value={r1}
            onChange={setR1}
            placeholder="r1"
            unit="bps"
            disabled={tx.isBusy}
            ariaLabel="first bracket rate in bps"
            testId="admin-carve-r1"
          />
          <AmountField
            value={r2}
            onChange={setR2}
            placeholder="r2"
            unit="bps"
            disabled={tx.isBusy}
            ariaLabel="second bracket rate in bps"
            testId="admin-carve-r2"
          />
          <AmountField
            value={r3}
            onChange={setR3}
            placeholder="r3"
            unit="bps"
            disabled={tx.isBusy}
            ariaLabel="third bracket rate in bps"
            testId="admin-carve-r3"
          />
        </div>
        <TxButton
          state={tx.state}
          onClick={() => {
            if (
              b1Wei === undefined ||
              b2Wei === undefined ||
              r1Bps === undefined ||
              r2Bps === undefined ||
              r3Bps === undefined
            )
              return
            tx.send({
              address: forkAddresses.ERC404Factory,
              abi: erc404FactoryAbi,
              functionName: 'setCarveBrackets',
              args: [
                {
                  b1: b1Wei,
                  b2: b2Wei,
                  r1: Number(r1Bps),
                  r2: Number(r2Bps),
                  r3: Number(r3Bps),
                },
              ],
              chainId: forkChainId,
            })
          }}
          label="set brackets"
          className="btn btn-secondary"
          successLabel="brackets set — tx confirmed."
          onReset={tx.reset}
          disabled={!canSubmit}
          errorText="set failed — try again"
          testId="admin-set-carve-brackets"
        />
      </div>
    </ActionRow>
  )
}
