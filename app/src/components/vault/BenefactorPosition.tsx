/**
 * BenefactorPosition — what the connected wallet's own stake in a liquidity vault is, and the three
 * things it can do about it.
 *
 * The vault page above this section is entirely vault-wide: total fees accrued, total benefactor
 * shares, how many collections align here. All of it is true of the vault and none of it is true of
 * the person reading it, so a benefactor who put ETH into this vault could see the pool grow and
 * never learn what part of it was theirs — or that there was anything to claim.
 *
 * A benefactor here is an address, not necessarily a collection: Uni and ZAMM credit `msg.sender`
 * from `receive()`, and all three credit whatever address `receiveContribution` names, which is
 * ungated. A wallet that sends a vault ETH is a benefactor with its own shares, its own claim and
 * its own delegation — which is exactly the position this section states.
 *
 * The reads are the four `IAlignmentVault` per-benefactor views, taken against the connected
 * address: contribution (what they put in), shares (their weight in the split), delegate (who may
 * claim on their behalf) and claimable.
 *
 * `calculateClaimableAmount` is a FLOOR and is labelled as one. It reports only what has already
 * been crystallized into the fee accumulator, whereas `claimFees` runs `_collectAndAccumulateVault-
 * Fees()` first and therefore pays that figure PLUS whatever the position has earned since. Printing
 * it as "you will receive X" would under-quote someone's own money, and building a `MoneyReceipt`
 * around it would state a number the transaction did not pay. So the figure is shown as a minimum
 * and the confirmation is amountless — the honest options, given the vault publishes no exact
 * pre-flight quote.
 *
 * The writes are the other half of the same interface:
 *  - **claim** — `claimFees()`, crediting the caller's own accrued share.
 *  - **delegate** — `delegateBenefactor(address)`, naming a delegate. Set to the zero address to
 *    revoke, which is how the contract spells "nobody".
 *  - **claim for others** — `claimFeesAsDelegate(address[])`, for a wallet some benefactor has
 *    delegated TO. The app cannot enumerate who delegated to whom (the vault stores the mapping one
 *    way and publishes no index), so this takes the addresses as input rather than pretending to a
 *    list it cannot build.
 *
 * Delegation on these vaults REDIRECTS THE MONEY; it is not a permission grant, and the panel says
 * so plainly because the name does not. With a delegate set, `claimFees()` pays the delegate and
 * not the benefactor who called it (`recipient = benefactorDelegate[benefactor]`, falling back to
 * the benefactor only when unset), and `claimFeesAsDelegate` pays its whole lump sum to
 * `msg.sender`. All three families agree on this. Someone who reads "delegate" as "let my ops
 * wallet press the button for me" and sets one has in fact assigned their yield away, so the
 * warning belongs next to the input rather than in a doc nobody opens.
 *
 * The endowment family is out of scope here and that is a contract fact, not an omission: it
 * implements all three of these writes by reverting `NotSupported`, having no tradable shares and
 * no delegation. Its payout path is `claimYieldPurse` / `vest`, which `VaultPanel` offers on the
 * collection page. See `benefactorPositionAbi` for the alias that records the same boundary.
 */
import { useCallback, useState } from 'react'
import { formatEther, isAddress } from 'viem'
import { useAccount, useReadContracts } from 'wagmi'
import { benefactorPositionAbi } from '../../lib/vaults/benefactorPositionAbi'
import { forkChainId } from '../../lib/addresses'
import { truncateAddress } from '../../lib/format'
import { TxButton } from '../ui/TxButton'
import { useTxAction } from '../ui/useTxAction'
import styles from './BenefactorPosition.module.css'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const

/** Four decimals, trailing zeros trimmed — the vault page's own figure format. */
function eth(value: bigint | undefined): string {
  if (value === undefined) return '—'
  const [whole, frac] = formatEther(value).split('.')
  return frac ? `${whole}.${frac.slice(0, 4).replace(/0+$/, '') || '0'}` : (whole ?? '0')
}

/** Split a comma/space/newline-separated list into the addresses it actually contains. */
export function parseAddressList(raw: string): `0x${string}`[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => isAddress(s))
    .map((s) => s as `0x${string}`)
}

export interface BenefactorPositionProps {
  vault: `0x${string}`
  /** The endowment family reverts every write this panel offers; it renders nothing for one. */
  isEndowment: boolean
}

export function BenefactorPosition({ vault, isEndowment }: BenefactorPositionProps) {
  const { address: connected } = useAccount()
  const [delegateInput, setDelegateInput] = useState('')
  const [claimForInput, setClaimForInput] = useState('')

  const enabled = !isEndowment && !!connected
  const args = [connected ?? ZERO_ADDRESS] as const
  const at = { address: vault, abi: benefactorPositionAbi, chainId: forkChainId } as const

  // allowFailure: a vault outside the three liquidity families does not answer these reads, and the
  // section simply does not render — the same tolerance VaultDeliveries applies per family.
  const { data, refetch } = useReadContracts({
    allowFailure: true,
    contracts: [
      { ...at, functionName: 'getBenefactorContribution', args },
      { ...at, functionName: 'getBenefactorShares', args },
      { ...at, functionName: 'getBenefactorDelegate', args },
      { ...at, functionName: 'calculateClaimableAmount', args },
    ],
    query: { enabled },
  })

  const refresh = useCallback(() => {
    void refetch()
  }, [refetch])

  const claimTx = useTxAction({ onSuccess: refresh })
  const delegateTx = useTxAction({ onSuccess: refresh })
  const delegateClaimTx = useTxAction({ onSuccess: refresh })

  const read = <T,>(i: number): T | undefined =>
    data?.[i]?.status === 'success' ? (data[i].result as T) : undefined

  const contribution = read<bigint>(0)
  const shares = read<bigint>(1)
  const delegate = read<`0x${string}`>(2)
  const claimable = read<bigint>(3)

  if (isEndowment) return null
  if (!connected) return null
  // Every read failed: not one of the three liquidity families, so there is no position to state.
  if (contribution === undefined && shares === undefined && claimable === undefined) return null

  const hasPosition = (contribution ?? 0n) > 0n || (shares ?? 0n) > 0n
  // `claimFees` reverts `NoShares` for an address with no shares, and that is the ONLY condition the
  // app can be sure about: a zero `calculateClaimableAmount` does not mean zero payout, because the
  // claim sweeps the position's fresh pool fees before it computes. Greying the button on the read
  // would hide a live claim, so it is greyed only on the revert that is certain.
  const hasShares = (shares ?? 0n) > 0n
  const delegateSet = delegate !== undefined && delegate !== ZERO_ADDRESS && delegate !== connected

  const delegateTarget = delegateInput.trim()
  // An empty box means revoke — the contract spells "nobody" as the zero address.
  const delegateValid = delegateTarget === '' || isAddress(delegateTarget)
  const claimForList = parseAddressList(claimForInput)

  return (
    <section className={styles.section} data-testid="vault-benefactor-position">
      <h2 className={styles.title}>Your position</h2>
      {!hasPosition && (
        <p className={styles.note} data-testid="vault-position-empty">
          This wallet has not contributed to this vault. The figures below are its own, not the
          vault&rsquo;s.
        </p>
      )}

      <dl className={styles.rows}>
        <div className={styles.row}>
          <dt className={styles.label}>you contributed</dt>
          <dd className={styles.value} data-testid="vault-position-contribution">
            {eth(contribution)} ETH
          </dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.label}>your shares</dt>
          <dd className={styles.value} data-testid="vault-position-shares">
            {shares === undefined ? '—' : shares.toString()}
          </dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.label}>claims paid to</dt>
          <dd className={styles.value} data-testid="vault-position-delegate">
            {delegate === undefined ? (
              '—'
            ) : delegateSet ? (
              <span className={styles.mono}>{delegate}</span>
            ) : (
              <span className={styles.unset}>this wallet — no delegate set</span>
            )}
          </dd>
        </div>
      </dl>

      <div className={styles.action}>
        <div className={styles.amount}>
          <span className={styles.label}>claimable — at least</span>
          <span className={styles.figure} data-testid="vault-position-claimable">
            {eth(claimable)} ETH
          </span>
        </div>
        <TxButton
          state={claimTx.state}
          onClick={() => claimTx.send({ ...at, functionName: 'claimFees' })}
          label="claim"
          className="btn btn-primary"
          disabled={!hasShares}
          {...(!hasShares
            ? {
                disabledHint:
                  'this wallet holds no shares in this vault — a contribution becomes shares at the next conversion',
              }
            : {})}
          successLabel="claimed — tx confirmed."
          errorText="claim failed — try again"
          onReset={claimTx.reset}
          testId="vault-position-claim"
        />
        <p className={styles.note}>
          A minimum, not a quote: the claim first sweeps the fees the position has earned since the
          last one, so it pays this figure or more.
          {delegateSet
            ? ' While a delegate is set, this pays the delegate below — not this wallet.'
            : ' It pays this wallet.'}
        </p>
      </div>

      <div className={styles.action} data-testid="vault-position-delegate-action">
        <label className={styles.label} htmlFor="vault-delegate-input">
          pay this wallet&rsquo;s claims to
        </label>
        <input
          id="vault-delegate-input"
          className={styles.input}
          value={delegateInput}
          onChange={(e) => setDelegateInput(e.target.value)}
          placeholder="0x… — leave empty to revoke"
          data-testid="vault-position-delegate-input"
        />
        <TxButton
          state={delegateTx.state}
          onClick={() =>
            delegateTx.send({
              ...at,
              functionName: 'delegateBenefactor',
              args: [delegateTarget === '' ? ZERO_ADDRESS : (delegateTarget as `0x${string}`)],
            })
          }
          label={delegateTarget === '' ? 'revoke delegate' : 'set delegate'}
          className="btn btn-secondary"
          disabled={!delegateValid}
          {...(!delegateValid ? { disabledHint: 'that is not an address' } : {})}
          successLabel="delegate updated — tx confirmed."
          errorText="delegation failed — try again"
          onReset={delegateTx.reset}
          testId="vault-position-delegate-btn"
        />
        <p className={styles.note} data-testid="vault-position-delegate-warning">
          This redirects the money, not just the button. While a delegate is set, every claim on
          this position pays them instead of this wallet — including one you press yourself. Revoke
          by clearing the box.
        </p>
      </div>

      {delegateSet && (
        <p className={styles.note} data-testid="vault-position-delegated-note">
          {truncateAddress(delegate)} currently receives this wallet&rsquo;s claims.
        </p>
      )}

      <div className={styles.action} data-testid="vault-position-delegate-claim">
        <label className={styles.label} htmlFor="vault-claim-for-input">
          claim for benefactors who delegated to you
        </label>
        <input
          id="vault-claim-for-input"
          className={styles.input}
          value={claimForInput}
          onChange={(e) => setClaimForInput(e.target.value)}
          placeholder="0x…, 0x… — addresses that named this wallet"
          data-testid="vault-position-claim-for-input"
        />
        <TxButton
          state={delegateClaimTx.state}
          onClick={() =>
            delegateClaimTx.send({
              ...at,
              functionName: 'claimFeesAsDelegate',
              args: [claimForList],
            })
          }
          label="claim for them"
          className="btn btn-secondary"
          disabled={claimForList.length === 0}
          {...(claimForList.length === 0
            ? { disabledHint: 'name at least one address that delegated to this wallet' }
            : {})}
          successLabel="claimed on their behalf — tx confirmed."
          errorText="claim failed — try again"
          onReset={delegateClaimTx.reset}
          testId="vault-position-claim-for-btn"
        />
        <p className={styles.note}>
          The whole sum is paid to this wallet, which is what being their delegate means. Every
          address must have named this wallet or the transaction reverts. The vault publishes no
          index of who delegated to whom, so they are named here rather than guessed at.
        </p>
      </div>
    </section>
  )
}
