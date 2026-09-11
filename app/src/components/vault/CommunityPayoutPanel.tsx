/**
 * CommunityPayoutPanel — the vault's target leg: where the community's cut is owed, what is waiting
 * in the vault for it, and the button that delivers it.
 *
 * Every alignment vault accrues a share for the community it is bound to (19% of trading fees on the
 * liquidity families, the target leg of harvested yield on the endowment one) and holds it whenever
 * no sink answers — accruing rather than reverting, so an unwired sink never blocks anyone else's
 * claim path. The sink is the registry's `getCommunityPayout(targetId)` and nothing else, on every
 * family — one read, the same one each vault does at send time, so the address this panel names is the
 * address the delivery below actually reaches. Getting it out is a separate, permissionless
 * call that takes no destination argument: `withdrawTargetFees()` on a liquidity vault,
 * `flushTargetFees()` on the endowment one. Until this panel there was no path to either in the app,
 * so a community's accrued cut could only be moved by hand-writing a contract call.
 *
 * The de-curation case is the one that made the gap matter. Withdrawing curation freezes every
 * ambassador's `execute` on an endowment vault, and the live pooled principal then has exactly one
 * way out — `releaseCorpusToCommunity()`, permissionless and hard-wired to the same registry sink,
 * which also sweeps any parked `roundResidue` into the same delivery. That escape
 * hatch is what makes the freeze a freeze rather than a seizure, and it is only true in practice if
 * someone can actually press it.
 *
 * The reads that decide what to render are the registry's, not the vault's stored copy: curation
 * state, the live sink, and how many ambassadors are still appointed — the authority that outlives
 * curation, said out loud on the page where the money sits.
 */
import { useCallback, useState } from 'react'
import { formatEther, isAddress } from 'viem'
import { useAccount, useReadContract } from 'wagmi'
import {
  alignmentRegistryV1Abi,
  useReadAlignmentRegistryV1AmbassadorCount,
  useReadAlignmentRegistryV1GetCommunityPayout,
  useReadAlignmentRegistryV1IsAlignmentTargetActive,
} from '../../generated/contracts'
import { forkAddresses, forkChainId } from '../../lib/addresses'
import { communityPayoutAbi } from '../../lib/vaults/communityPayoutAbi'
import { TxButton } from '../ui/TxButton'
import { useTxAction } from '../ui/useTxAction'
import styles from './CommunityPayoutPanel.module.css'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/** Four decimals, trailing zeros trimmed — the page's own figure format. */
function eth(value: bigint | undefined): string {
  if (value === undefined) return '—'
  const [whole, frac] = formatEther(value).split('.')
  return frac ? `${whole}.${frac.slice(0, 4).replace(/0+$/, '') || '0'}` : (whole ?? '0')
}

export interface CommunityPayoutPanelProps {
  vault: `0x${string}`
  /** The vault's bound registry target. Undefined (or 0) means nothing is bound and nothing renders. */
  targetId: bigint | undefined
  /** Endowment vaults carry a pooled principal and flush under a different name; LP vaults do not. */
  isEndowment: boolean
}

export function CommunityPayoutPanel({ vault, targetId, isEndowment }: CommunityPayoutPanelProps) {
  const bound = targetId !== undefined && targetId > 0n
  const targetArgs = bound ? ([targetId] as const) : undefined

  const { data: sink, refetch: refetchSink } = useReadAlignmentRegistryV1GetCommunityPayout({
    address: forkAddresses.AlignmentRegistryV1,
    chainId: forkChainId,
    args: targetArgs,
    query: { enabled: bound },
  })
  const { data: curated } = useReadAlignmentRegistryV1IsAlignmentTargetActive({
    address: forkAddresses.AlignmentRegistryV1,
    chainId: forkChainId,
    args: targetArgs,
    query: { enabled: bound },
  })
  const { data: seats } = useReadAlignmentRegistryV1AmbassadorCount({
    address: forkAddresses.AlignmentRegistryV1,
    chainId: forkChainId,
    args: targetArgs,
    query: { enabled: bound },
  })

  const { data: waiting, refetch: refetchWaiting } = useReadContract({
    address: vault,
    abi: communityPayoutAbi,
    functionName: 'accumulatedTargetFees',
    chainId: forkChainId,
    query: { enabled: bound },
  })
  const { data: corpus, refetch: refetchCorpus } = useReadContract({
    address: vault,
    abi: communityPayoutAbi,
    functionName: 'deployableCorpus',
    chainId: forkChainId,
    query: { enabled: bound && isEndowment },
  })
  const { data: residue, refetch: refetchResidue } = useReadContract({
    address: vault,
    abi: communityPayoutAbi,
    functionName: 'roundResidue',
    chainId: forkChainId,
    query: { enabled: bound && isEndowment },
  })
  const refetch = useCallback(() => {
    void refetchSink()
    void refetchWaiting()
    void refetchCorpus()
    void refetchResidue()
  }, [refetchSink, refetchWaiting, refetchCorpus, refetchResidue])

  const deliver = useTxAction({ onSuccess: refetch })
  const release = useTxAction({ onSuccess: refetch })
  const rotate = useTxAction({ onSuccess: refetch })
  const flushResidue = useTxAction({ onSuccess: refetch })

  const { address: connected } = useAccount()
  const [rotateTo, setRotateTo] = useState('')

  if (!bound) return null

  // The registry's answer is the whole of it, on every vault family — the same single read each of
  // them does at send time, so the address shown is the one the money goes to. The endowment vault
  // used to carry an owner-writable fallback of its own and no longer does.
  const paidTo = sink !== undefined && sink !== ZERO_ADDRESS ? sink : undefined
  const sinkWired = paidTo !== undefined
  // `curated` is undefined until the read lands; treat only an explicit false as de-curated, so the
  // page never flashes a freeze notice at a community that is fine.
  const decurated = curated === false
  // The contract's own authority rule, restated in the UI rather than left to a revert: only the
  // address currently receiving the payout may move it on. Showing this row to anyone else would be
  // offering a button that cannot work, and showing it as enabled would be a lie about who is in
  // control of a community's money.
  const isPayee =
    paidTo !== undefined &&
    connected !== undefined &&
    connected.toLowerCase() === paidTo.toLowerCase()
  const rotateTrim = rotateTo.trim()
  const rotateOk = isAddress(rotateTrim) && rotateTrim !== ZERO_ADDRESS
  const hasWaiting = waiting !== undefined && waiting > 0n
  const hasResidue = residue !== undefined && residue > 0n
  // What `releaseCorpusToCommunity` actually delivers once de-curated: corpus redeemed now plus any
  // residue already parked, in one call.
  const releasable = (corpus ?? 0n) + (residue ?? 0n)
  const hasReleasable = releasable > 0n

  // Why each button is greyed, so a disabled control reads as "here is what is missing" rather than
  // as a capability the app does not have.
  const deliverHint = !sinkWired
    ? 'nothing can be delivered until a payout address is set'
    : !hasWaiting
      ? 'nothing has accrued for the community yet'
      : undefined
  const residueHint = !sinkWired
    ? 'the residue waits in the vault until a payout address is set'
    : !hasResidue
      ? 'no round residue is waiting'
      : undefined
  const releaseHint = !sinkWired
    ? 'the principal waits in the vault until a payout address is set'
    : !hasReleasable
      ? 'no principal is left to release'
      : undefined

  function sendDeliver(): void {
    deliver.send({
      address: vault,
      abi: communityPayoutAbi,
      functionName: isEndowment ? 'flushTargetFees' : 'withdrawTargetFees',
      chainId: forkChainId,
    })
  }

  function sendRelease(): void {
    release.send({
      address: vault,
      abi: communityPayoutAbi,
      functionName: 'releaseCorpusToCommunity',
      chainId: forkChainId,
    })
  }

  function sendFlushResidue(): void {
    flushResidue.send({
      address: vault,
      abi: communityPayoutAbi,
      functionName: 'flushRoundResidue',
      chainId: forkChainId,
    })
  }

  function sendRotate(): void {
    if (targetId === undefined || !rotateOk) return
    rotate.send({
      address: forkAddresses.AlignmentRegistryV1,
      abi: alignmentRegistryV1Abi,
      functionName: 'rotateCommunityPayout',
      args: [targetId, rotateTrim as `0x${string}`],
      chainId: forkChainId,
    })
  }

  return (
    <section className={styles.panel} data-testid="vault-community-payout">
      <h2 className={styles.sectionTitle}>Community payout</h2>

      <dl className={styles.rows}>
        <div className={styles.row}>
          <dt className={styles.label}>paid to</dt>
          <dd className={styles.value} data-testid="vault-payout-sink">
            {paidTo !== undefined ? (
              <span className={styles.mono}>{paidTo}</span>
            ) : (
              <span className={styles.unset}>
                not wired yet — the community&rsquo;s cut accrues in the vault until the registry
                owner sets a payout address for this target.
              </span>
            )}
          </dd>
        </div>

        <div className={styles.row}>
          <dt className={styles.label}>curation</dt>
          <dd className={styles.value} data-testid="vault-payout-curation">
            {curated === undefined ? '—' : decurated ? 'withdrawn' : 'active'}
          </dd>
        </div>

        <div className={styles.row}>
          <dt className={styles.label}>ambassadors appointed</dt>
          <dd className={styles.value} data-testid="vault-payout-seats">
            {seats === undefined ? '—' : seats.toString()}
          </dd>
        </div>
      </dl>

      {decurated && (
        <p className={styles.notice} data-testid="vault-payout-decurated">
          Curation of this community has been withdrawn. Its ambassadors keep the seat and can still
          edit the community&rsquo;s description, but they can no longer spend from this vault
          {isEndowment ? ' — the principal leaves only by the release below.' : '.'}
        </p>
      )}

      {isPayee && (
        <div className={styles.action} data-testid="vault-payout-rotate">
          <div className={styles.amount}>
            <span className={styles.label}>move this payout</span>
            <span className={styles.figure}>you are the address receiving it</span>
          </div>
          <input
            className={styles.input}
            value={rotateTo}
            onChange={(e) => setRotateTo(e.target.value)}
            placeholder="0x… the address it should go to from here on"
            aria-label="new community payout address"
            data-testid="vault-payout-rotate-input"
          />
          <TxButton
            state={rotate.state}
            onClick={sendRotate}
            label="move the payout"
            className="btn btn-secondary"
            disabled={!rotateOk}
            {...(rotateOk ? {} : { disabledHint: 'enter the address the payout should go to' })}
            successLabel="payout moved — tx confirmed."
            errorText="move failed — only the address currently receiving the payout can move it"
            onReset={rotate.reset}
            testId="vault-payout-rotate-btn"
          />
          <p className={styles.note}>
            The protocol cannot do this for you and cannot undo it: a payout is pinned once, and
            from then on only the address receiving it can move it on. Check the address before you
            send.
          </p>
        </div>
      )}

      <div className={styles.action}>
        <div className={styles.amount}>
          <span className={styles.label}>waiting to be delivered</span>
          <span className={styles.figure} data-testid="vault-payout-waiting">
            {eth(waiting)} ETH
          </span>
        </div>
        <TxButton
          state={deliver.state}
          onClick={sendDeliver}
          label="deliver to the community"
          className="btn btn-secondary"
          disabled={!sinkWired || !hasWaiting}
          {...(deliverHint ? { disabledHint: deliverHint } : {})}
          successLabel="delivered — tx confirmed."
          errorText="delivery failed — try again"
          onReset={deliver.reset}
          testId="vault-payout-deliver"
        />
        <p className={styles.note}>
          permissionless — the destination is read from the registry, not from whoever presses this.
        </p>
      </div>

      {isEndowment && !decurated && (
        <div className={styles.action} data-testid="vault-payout-residue">
          <div className={styles.amount}>
            <span className={styles.label}>round residue</span>
            <span className={styles.figure} data-testid="vault-payout-residue-figure">
              {eth(residue)} ETH
            </span>
          </div>
          <TxButton
            state={flushResidue.state}
            onClick={sendFlushResidue}
            label="deliver the residue"
            className="btn btn-secondary"
            disabled={!sinkWired || !hasResidue}
            {...(residueHint ? { disabledHint: residueHint } : {})}
            successLabel="delivered — tx confirmed."
            errorText="delivery failed — try again"
            onReset={flushResidue.reset}
            testId="vault-payout-flush-residue"
          />
          <p className={styles.note}>
            permissionless — dust left over from a round close, delivered to the same address as
            above.
          </p>
        </div>
      )}

      {isEndowment && decurated && (
        <div className={styles.action} data-testid="vault-payout-release">
          <div className={styles.amount}>
            <span className={styles.label}>frozen principal</span>
            <span className={styles.figure} data-testid="vault-payout-corpus">
              {eth(releasable)} ETH
            </span>
          </div>
          <TxButton
            state={release.state}
            onClick={sendRelease}
            label="release the principal"
            className="btn btn-secondary"
            disabled={!sinkWired || !hasReleasable}
            {...(releaseHint ? { disabledHint: releaseHint } : {})}
            successLabel="released — tx confirmed."
            errorText="release failed — try again"
            onReset={release.reset}
            testId="vault-payout-release-btn"
          />
          <p className={styles.note}>permissionless, and the whole remaining principal at once.</p>
        </div>
      )}
    </section>
  )
}
