/**
 * ActivityComposer — the well of the activity box, decided once.
 *
 * `ActivityBox` unified the chrome, `ActivityLine` the transcript and `ActivityStates` what a bare
 * transcript says. What was left hand-rolled at every call site was the floor of the box: whether
 * you may speak, and what it costs you to. Four surfaces answered that four ways.
 *
 * The salon told a wallet-less visitor "connect your wallet to post — every voice on the board is
 * attributed"; a collection told them the same fact in different words and boxed it differently;
 * a profile wall said nothing, which is right there and for its own reason; and the vault page
 * asked nobody at all — it docked a live composer for a visitor with no wallet, who could type a
 * post and queue it into the board cart with nothing able to sign it. The signature note under the
 * composer went the same way: the salon and the collection each carried one, in near-identical
 * words over byte-identical CSS, and the vault and the wall carried none, so the same act was
 * permanent-and-attributed on two surfaces and unremarked on two others.
 *
 * What stays the surface's own is the one thing that actually differs: where a post lands
 * (`lands`). Whether there is a well at all stays the caller's too — a wall nobody can post to
 * omits it, and the box then ends at the transcript.
 */
import { useAccount } from 'wagmi'
import { truncateAddress } from '../../lib/format'
import { MessageComposer } from '../MessageComposer'
import { StateBlock } from '../ui/StateBlock'
import styles from './ActivityComposer.module.css'

export function ActivityComposer({
  channel,
  lands,
}: {
  /**
   * The address posted to — a collection, a vault, or a wall. A wall's channel IS the poster's own
   * address (the per-wall convention), so those surfaces pass the connected wallet, which is
   * undefined in exactly the case where there is nothing to post with anyway.
   */
  channel: `0x${string}` | undefined
  /** Where a post lands, completing "posts appear …": "in this collection's activity". */
  lands: string
}) {
  const { address: connected } = useAccount()

  if (connected === undefined || channel === undefined) {
    return (
      <StateBlock variant="empty">
        connect your wallet to post — every voice here is attributed on-chain, and permanent.
      </StateBlock>
    )
  }

  return (
    <>
      <MessageComposer channel={channel} />
      <p className={styles.note}>
        signed by {truncateAddress(connected)} · permanent — posts appear {lands}
      </p>
    </>
  )
}
